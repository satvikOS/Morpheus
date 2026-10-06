"""Pinned, bounded public NWB import; never acquires or stimulates a subject.

Requires PyNWB 4.2.0 only in the local workstation environment. Network IO is
restricted to the fixed public DANDI source, with checksums before NWB parsing.
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
from typing import Any
from urllib.request import urlopen
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.causal_analysis import evaluate_causal, validate_causal_request

DANDISET = "000009"
DATASET_VERSION = "0.220126.1903"
API = "https://api.dandiarchive.org/api"
BASE = f"{API}/dandisets/{DANDISET}/versions/{DATASET_VERSION}"
IMPORT_VERSION = "dandi000009-task-delay-1.0.0"
FEATURE_VERSION = "dandi000009-pre-event-population-1.0.0"
FEATURE_NAMES = ["baseline_mean_rate_hz", "baseline_neuron_rate_population_sd_hz",
                 "baseline_zero_neuron_fraction", "task_instruction_right"]
HARD_FILE_LIMIT = 16 * 1024 * 1024
HARD_TOTAL_LIMIT = 64 * 1024 * 1024
PLAN = {
    "version": IMPORT_VERSION, "datasetId": f"DANDI:{DANDISET}", "datasetVersion": DATASET_VERSION,
    "sourceDoi": "10.48324/dandi.000009/0.220126.1903", "paperDoi": "10.1038/nature22324",
    "license": "CC-BY-4.0", "independentUnit": "NWB subject.subject_id (mouse), never a neuronal Units row",
    "selection": "First lexicographic +ogen extracellular asset per mouse within byte budget; no selection by neural response.",
    "recordingRegion": "Thalamus", "recordingHemisphere": "left", "perturbationRegion": "ALM", "perturbationHemisphere": "left",
    "eligibility": "is_good=1; stim_present in {0,1}; recorded left/right task instruction; finite task timestamps; baseline/outcome windows fit trial and precede cue; both trial instruction directions retained; behavioral correctness never filters trials.",
    "perturbationLabelGate": "All stimulated trials must have photo_stim_period=delay; no-stim trials are control, never sham.",
    "outcome": "Mean spike rate across all recorded neurons, 0.10 to 0.60 seconds after pole_out_time, minus mean pre-event rate -0.60 to -0.10 seconds; windows are task locked, not verified light-onset locked.",
    "baselineToleranceHz": 5.0, "baselineRule": "Each matched mouse/session condition-mean baseline difference must be at most 5 Hz in magnitude; failure stops inference, no adaptive exclusion.",
    "assignment": "observational", "registered": False,
    "timingLimitation": "Published NWB trial perturbation labels/sites lack a continuous optical waveform in sampled assets; exact light onset/exposure is not independently verified.",
    "trainingFeatures": {"version": FEATURE_VERSION, "names": FEATURE_NAMES,
                         "rule": "Pre-event baseline neural summaries and recorded task instruction only; no perturbation labels, identifiers or post-event neural outcome in features; split by whole animal."},
}


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _get_json(url: str) -> Any:
    with urlopen(url, timeout=20) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("Public metadata exceeds the bounded JSON budget.")
    return json.loads(raw)


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def cache_asset(asset: dict[str, Any], cache: Path, file_limit: int) -> tuple[Path, dict[str, Any]]:
    identifier = asset["asset_id"]
    if not re.fullmatch(r"[0-9a-f-]{36}", identifier):
        raise ValueError("Invalid immutable DANDI asset ID.")
    metadata = _get_json(f"{API}/assets/{identifier}/")
    size = asset["size"]
    expected_sha = metadata.get("digest", {}).get("dandi:sha2-256")
    if (not isinstance(size, int) or not 0 < size <= file_limit or metadata.get("contentSize") != size
            or metadata.get("path") != asset["path"] or not re.fullmatch(r"[0-9a-f]{64}", str(expected_sha))):
        raise ValueError("Asset size/path/checksum metadata gate failed.")
    cached = cache / f"{identifier}.nwb"
    if not cached.exists():
        temporary = cache / f".{identifier}.{uuid.uuid4().hex}.part"
        try:
            with urlopen(f"{API}/assets/{identifier}/download/", timeout=30) as response, temporary.open("xb") as out:
                temporary.chmod(0o600)
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > file_limit or total > size:
                        raise ValueError("NWB download exceeds the declared byte budget.")
                    out.write(chunk)
            if total != size or _sha(temporary) != expected_sha:
                raise ValueError("NWB download SHA256/size differs from pinned asset metadata.")
            os.replace(temporary, cached)
        finally:
            temporary.unlink(missing_ok=True)
    if cached.stat().st_size != size or _sha(cached) != expected_sha:
        raise ValueError("Cached NWB bytes differ from the immutable asset checksum.")
    return cached, {"assetId": identifier, "path": asset["path"], "size": size, "sha256": expected_sha,
                    "metadataUrl": f"{API}/assets/{identifier}/", "localCache": str(cached)}


def _location(location: str) -> dict[str, str]:
    return dict(part.strip().split(": ", 1) for part in location.split(";") if ": " in part)


def extract_trials(path: Path, asset: dict[str, Any], feature_rows: list[dict[str, Any]] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from pynwb import NWBHDF5IO

    with NWBHDF5IO(str(path), "r", load_namespaces=True) as io:
        nwb = io.read()
        if nwb.subject is None or not nwb.subject.subject_id or nwb.trials is None or nwb.units is None:
            raise ValueError("Required subject/trial/spike data absent.")
        subject = str(nwb.subject.subject_id)
        if asset["path"].split("/")[0] != "sub-" + subject:
            raise ValueError("NWB subject does not match the versioned asset path.")
        groups = [_location(str(group.location)) for group in nwb.electrode_groups.values()]
        sites = [_location(str(site.location)) for site in nwb.ogen_sites.values()]
        description = {"subjectId": subject, "recordingLocations": groups, "perturbationLocations": sites,
                       "opticalWaveformPresent": bool(nwb.stimulus), "neurons": len(nwb.units)}
        if not groups or any(g.get("brain_region") != "Thalamus" or g.get("hemisphere") != "left" for g in groups):
            return [], {**description, "gate": "EXCLUDED", "reason": "Recording region/hemisphere differs from locked plan."}
        if not sites or any(s.get("brain_region") != "ALM" or s.get("hemisphere") != "left" for s in sites):
            return [], {**description, "gate": "EXCLUDED", "reason": "Perturbation region/hemisphere differs from locked plan."}
        required = {"start_time", "stop_time", "pole_out_time", "cue_start_time", "stim_present", "is_good", "photo_stim_period", "type"}
        if not required <= set(nwb.trials.colnames) or "spike_times" not in nwb.units.colnames:
            raise ValueError("Trial timing/control schema differs from the adapter version.")
        if not 1 <= len(nwb.units) <= 256 or len(nwb.trials) > 4096:
            raise ValueError("NWB trial/neuron dimensions exceed the bounded adapter.")
        spikes = [nwb.units["spike_times"][i][:] for i in range(len(nwb.units))]
        if any(len(train) > 2_000_000 or any(not math.isfinite(float(v)) for v in train)
               or any(train[i] > train[i+1] for i in range(len(train)-1)) for train in spikes):
            raise ValueError("Spike timestamps must be finite and sorted within bounded arrays.")
        # Read the bounded table once, never load a raw electrophysiology array.
        table = nwb.trials.to_dataframe()
        if table.index.has_duplicates:
            raise ValueError("Duplicate NWB trial IDs.")
        rows = []
        pre_outcome_rows = []
        excluded: dict[str, int] = {}
        for trial_id, trial in table.iterrows():
            reason = None
            if trial["is_good"] != 1:
                reason = "quality_flag"
            elif trial["stim_present"] not in (0, 1):
                reason = "condition_missing"
            elif trial["type"] not in ("lick left", "lick right"):
                reason = "instruction_missing"
            elif trial["stim_present"] == 1 and trial["photo_stim_period"] != "delay":
                # A different perturbation phase changes the estimand: fail the
                # session rather than silently removing selected conditions.
                return [], {**description, "gate": "EXCLUDED", "reason": "Mixed/non-delay perturbation phase."}
            times = [float(trial[key]) for key in ("start_time", "stop_time", "pole_out_time", "cue_start_time")]
            if reason is None and (not all(math.isfinite(v) for v in times) or
                                  not times[0] <= times[2] - .6 < times[2] + .6 <= times[1] or times[2] + .6 > times[3]):
                reason = "task_window_invalid"
            if reason:
                excluded[reason] = excluded.get(reason, 0) + 1
                continue
            anchor = times[2]
            def rate(begin: float, end: float) -> float:
                return math.fsum(bisect.bisect_left(train, end) - bisect.bisect_left(train, begin) for train in spikes) / len(spikes) / (end-begin)
            baseline_rates = [(bisect.bisect_left(train, anchor-.1) - bisect.bisect_left(train, anchor-.6)) / .5 for train in spikes]
            baseline_mean = math.fsum(baseline_rates) / len(baseline_rates)
            delay_mean = rate(anchor+.1, anchor+.6)
            identifier = f"{asset['asset_id']}:{trial_id}"
            condition = "stimulated" if trial["stim_present"] == 1 else "control"
            rows.append({"trialId": identifier, "unitId": subject,
                         "sessionId": asset["asset_id"], "condition": "stimulated" if trial["stim_present"] == 1 else "control",
                         "baseline": baseline_mean, "outcome": delay_mean, "qcPassed": True})
            pre_outcome_rows.append({"id": identifier, "subjectId": subject, "sessionId": asset["asset_id"],
                                     "features": [baseline_mean, math.sqrt(math.fsum((r-baseline_mean)**2 for r in baseline_rates) / len(baseline_rates)),
                                                  sum(r == 0 for r in baseline_rates) / len(baseline_rates), float(trial["type"] == "lick right")],
                                     "featureNames": list(FEATURE_NAMES), "label": condition,
                                     "outcome": delay_mean-baseline_mean})
        counts = {condition: sum(row["condition"] == condition for row in rows) for condition in ("stimulated", "control")}
        if min(counts.values()) < 2:
            return [], {**description, "gate": "EXCLUDED", "reason": "Fewer than two eligible trials in either condition.", "excludedTrials": excluded}
        if feature_rows is not None:
            feature_rows.extend(pre_outcome_rows)
        return rows, {**description, "gate": "PASSED", "conditionCounts": counts, "excludedTrials": excluded,
                      "neuronWeighting": "Equal neurons within this recorded session; neurons do not increase independent n."}


def import_dataset(cache_dir: Path, output_dir: Path, max_subjects: int = 16,
                   file_limit: int = HARD_FILE_LIMIT, total_limit: int = HARD_TOTAL_LIMIT) -> dict[str, Any]:
    if not 6 <= max_subjects <= 24 or not 1 <= file_limit <= HARD_FILE_LIMIT or not file_limit <= total_limit <= HARD_TOTAL_LIMIT:
        raise ValueError("Import limits require 6–24 candidate subjects, files≤16MiB and total≤64MiB.")
    cache = cache_dir.expanduser().resolve()
    output = output_dir.expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any((output / name).exists() for name in ("extraction-plan.json", "causal-request.json", "import-manifest.json", "unified-model-input.json")):
        raise ValueError("Output directory already holds a run; use a fresh directory to preserve immutable artifacts.")
    # Lock the retrospective extraction recipe before inspecting neural outcomes.
    plan_sha = hashlib.sha256(canonical(PLAN)).hexdigest()
    (output / "extraction-plan.json").write_bytes(canonical({"plan": PLAN, "sha256": plan_sha,
                                                           "lockedBeforeExtraction": True, "lockedBeforeCollection": False}))
    info = _get_json(BASE + "/info/")["metadata"]
    if "spdx:CC-BY-4.0" not in info.get("license", []) or info.get("version") != DATASET_VERSION:
        raise ValueError("Pinned dataset license/version gate failed.")
    listing = _get_json(BASE + "/assets/?page_size=200")
    if listing.get("next") or len(listing.get("results", [])) != listing.get("count"):
        raise ValueError("Pinned dataset listing is incomplete; adapter metadata budget must be reviewed.")
    candidates: dict[str, dict[str, Any]] = {}
    for asset in sorted(listing["results"], key=lambda item: item["path"]):
        if asset["path"].endswith("ecephys+ogen.nwb") and 0 < asset["size"] <= file_limit:
            candidates.setdefault(asset["path"].split("/")[0], asset)
    manifest = {"schema_version": 1, "adapterVersion": IMPORT_VERSION, "source": {"datasetId": f"DANDI:{DANDISET}",
                "datasetVersion": DATASET_VERSION, "doi": PLAN["sourceDoi"], "license": "CC-BY-4.0"},
                "planSha256": plan_sha, "fileLimitBytes": file_limit, "totalLimitBytes": total_limit,
                "assets": [], "gates": [], "downloadedBytes": 0, "analysisStatus": "INPUT_GATES_PENDING"}
    rows = []
    training_rows: list[dict[str, Any]] = []
    for asset in list(candidates.values())[:max_subjects]:
        if manifest["downloadedBytes"] + asset["size"] > total_limit:
            manifest["gates"].append({"assetId": asset["asset_id"], "gate": "EXCLUDED", "reason": "Total byte budget."})
            break
        cached, provenance = cache_asset(asset, cache, file_limit)
        manifest["assets"].append(provenance)
        manifest["downloadedBytes"] += asset["size"]
        extracted, gate = extract_trials(cached, asset, training_rows)
        rows.extend(extracted)
        manifest["gates"].append({"assetId": asset["asset_id"], **gate})
    manifest["downloadedSubjectCount"] = len(manifest["assets"])
    manifest["eligibleSubjectCount"] = len({row["unitId"] for row in rows})
    manifest["eligibleTrialCount"] = len(rows)
    request = {"method": "causal-perturbation", "controlCondition": "control",
               "source": {"kind": "public-animal-optogenetic", "datasetId": f"DANDI:{DANDISET}", "datasetVersion": DATASET_VERSION,
                          "url": f"https://dandiarchive.org/dandiset/{DANDISET}/{DATASET_VERSION}"},
               "design": {"assignment": "observational", "independentUnitsConfirmed": True,
                          "registration": {"registered": False, "lockedBeforeCollection": False}},
               "outcome": {"name": "Task delay mean-neuron firing rate change", "unit": "spikes/second/neuron"},
               "baselineTolerance": PLAN["baselineToleranceHz"], "rows": rows, "seed": 2026,
               "bootstrapSamples": 1000, "permutations": 2000}
    (output / "causal-request.json").write_bytes(canonical(request))
    # A separate immutable input manifest avoids a circular dependency between
    # the result hash and the final run-status manifest.
    input_manifest = {key: value for key, value in manifest.items() if key != "analysisStatus"}
    input_sha = hashlib.sha256(canonical(input_manifest)).hexdigest()
    (output / "input-manifest.json").write_bytes(canonical(input_manifest))
    manifest["inputManifestSha256"] = input_sha
    training = {"schema_version": 1, "method": "unified-model", "model": "morpheus-shared-encoder",
                "epochs": 30, "hiddenWidth": 32, "seed": 2026,
                "featureSchema": FEATURE_VERSION, "rows": training_rows,
                "source": {**request["source"], "kind": "public-neural-recording", "license": "CC-BY-4.0", "featureSchema": FEATURE_VERSION,
                           "assets": [{key: asset[key] for key in ("assetId", "path", "sha256")} for asset in manifest["assets"]]},
                "design": {"inputTiming": "pre-task-event", "assignment": "observational", "independentUnitsConfirmed": True},
                "outcome": {"name": "Task delay mean-neuron firing rate minus pre-event baseline", "unit": "spikes/second/neuron"},
                "requiredSplit": "leave-one-animal-out", "independentUnitField": "subjectId", "license": "CC-BY-4.0",
                "importManifestSha256": input_sha, "extractionPlanSha256": plan_sha,
                "limitations": ["Public animal circuit-data engineering pilot; not a human or dream model.",
                                "Features are pre-outcome measurements; trial instruction is included, perturbation target label is excluded.",
                                "Baseline features precede pole_out; optical onset is unverified, so pre-intervention timing is not established.",
                                "The baseline feature also appears subtracted in the continuous outcome; mathematical coupling can contribute predictive performance.",
                                "Repeated trials/sessions and neurons are correlated; fit scaling/encoder/heads on training animals only.",
                                "This retrospective adapter does not reproduce source-paper figures or verify optical onset or random assignment."]}
    (output / "unified-model-input.json").write_bytes(canonical(training))
    manifest["unifiedModelInputSha256"] = hashlib.sha256(canonical(training)).hexdigest()
    try:
        config = validate_causal_request(request)
        result = evaluate_causal(config)
        result["import_manifest_sha256"] = input_sha
        result["extraction_plan_sha256"] = plan_sha
        result["limitations"].extend([PLAN["timingLimitation"], "Retrospective region/window selection is exploratory; this is not a replication of the source paper's figures."])
        result["limitations"].append("Task instruction balance, trial-order effects, cellular composition and assignment records are not verified by this adapter; residual confounding remains possible.")
        (output / "causal-result.json").write_bytes(canonical(result))
        manifest["analysisStatus"] = "COMPLETED_EXPLORATORY_ASSOCIATION"
        manifest["configSha256"] = config["config_sha256"]
        manifest["resultSha256"] = hashlib.sha256(canonical(result)).hexdigest()
    except ValueError as error:
        manifest["analysisStatus"] = "INPUT_GATE_FAILED"
        manifest["error"] = str(error)
    (output / "import-manifest.json").write_bytes(canonical(manifest))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-subjects", type=int, default=16)
    parser.add_argument("--max-file-bytes", type=int, default=HARD_FILE_LIMIT)
    parser.add_argument("--max-total-bytes", type=int, default=HARD_TOTAL_LIMIT)
    args = parser.parse_args()
    manifest = import_dataset(args.cache_dir, args.output_dir, args.max_subjects, args.max_file_bytes, args.max_total_bytes)
    print(json.dumps({key: manifest.get(key) for key in ("analysisStatus", "downloadedSubjectCount", "eligibleSubjectCount",
                                                       "eligibleTrialCount", "downloadedBytes", "error")}, indent=2))
    if manifest["analysisStatus"] == "INPUT_GATE_FAILED":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
