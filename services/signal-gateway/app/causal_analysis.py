"""Bounded analysis of already collected perturbation/control measurements.

This module never stimulates tissue or devices. A unit is an independent animal
or participant, not a neuron, image, trial, or repeated recording session.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import math
import random
import re
from collections import defaultdict
from typing import Any
from urllib.parse import urlsplit

METHOD = "causal-perturbation"
VERSION = "paired-cluster-perturbation-1.0.0"
SOURCES = [
    {"doi": "10.1038/nn1525", "url": "https://doi.org/10.1038/nn1525",
     "role": "Foundational targeted optical perturbation; not this statistical implementation."},
    {"doi": "10.1126/science.aaw5202", "url": "https://doi.org/10.1126/science.aaw5202",
     "role": "Animal ensemble perturbation with behavioral controls; methodological inspiration."},
    {"doi": "10.1126/science.aaa5542", "url": "https://doi.org/10.1126/science.aaa5542",
     "role": "Mouse engram retrieval perturbation; context only, not evidence of universal memory persistence."},
    {"doi": "10.1038/nature22324", "url": "https://doi.org/10.1038/nature22324",
     "role": "Public mouse perturbation/control recordings; source-specific adapter still required."},
]


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _text(value: Any, field: str, limit: int = 128) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError(f"{field} must be a nonempty bounded string.")
    return value


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or abs(value) > 1e12 or not math.isfinite(value):
        raise ValueError(f"{field} must be finite with magnitude at most 1e12.")
    return float(value)


def _integer(value: Any, field: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{field} must be an integer from {low} to {high}.")
    return value


def validate_causal_request(payload: dict[str, Any]) -> dict[str, Any]:
    """Copy, validate and canonically order immutable trial records before jobs."""
    if not isinstance(payload, dict):
        raise ValueError("Causal request must be an object.")
    if payload.get("method", METHOD) != METHOD or payload.get("model", METHOD) != METHOD:
        raise ValueError("Unknown causal method.")
    if isinstance(payload.get("alpha", .05), bool) or payload.get("alpha", .05) != .05:
        raise ValueError("This version uses a fixed two-sided alpha of 0.05.")
    source = payload.get("source")
    if not isinstance(source, dict) or source.get("kind") not in (
        "synthetic", "public-animal-optogenetic", "public-observational"
    ):
        raise ValueError("Record synthetic, public-animal-optogenetic, or public-observational source provenance.")
    source = {key: _text(source.get(key), f"source.{key}") for key in ("kind", "datasetId", "datasetVersion")} | {
        "url": source.get("url")
    }
    if source["url"] is not None:
        _text(source["url"], "source.url", 2048)
        parsed = urlsplit(source["url"])
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Source URL must be a credential-free HTTPS reference.")
        hostname = parsed.hostname.lower().rstrip(".")
        if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
            raise ValueError("Public source references cannot use local/private hosts.")
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            address = None
        if address is not None and not address.is_global:
            raise ValueError("Public source references cannot use private IP addresses.")
    elif source["kind"] != "synthetic":
        raise ValueError("Public data requires a source URL and a pinned dataset version.")
    design = payload.get("design")
    if not isinstance(design, dict) or design.get("assignment") not in ("randomized", "observational"):
        raise ValueError("Record randomized or observational assignment.")
    if design.get("independentUnitsConfirmed") is not True:
        raise ValueError("Confirm unit IDs identify independent animals/participants, not neurons or trials.")
    randomized = design["assignment"] == "randomized"
    randomization = design.get("randomization")
    if randomized:
        if not isinstance(randomization, dict) or randomization.get("recorded") is not True:
            raise ValueError("Randomized designs require a recorded assignment manifest.")
        digest = randomization.get("recordSha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            raise ValueError("Randomization recordSha256 must identify the saved assignment manifest.")
        randomization = {"recorded": True, "recordSha256": digest.lower(),
                         "method": _text(randomization.get("method"), "randomization.method", 512)}
    else:
        randomization = None
    registration = design.get("registration", {})
    if not isinstance(registration, dict):
        raise ValueError("Registration must be an object.")
    registered = registration.get("registered", False)
    if not isinstance(registered, bool):
        raise ValueError("registration.registered must be boolean.")
    if registered:
        if registration.get("lockedBeforeCollection") is not True:
            raise ValueError("A registered design requires a plan locked before collection.")
        registration = {"registered": True, "lockedBeforeCollection": True,
                        "id": _text(registration.get("id"), "registration.id", 512)}
    else:
        registration = {"registered": False, "lockedBeforeCollection": False}
    design = {"assignment": design["assignment"], "independentUnitsConfirmed": True,
              "randomization": randomization, "registration": registration}
    outcome = payload.get("outcome")
    if not isinstance(outcome, dict):
        raise ValueError("Specify the outcome name and measurement unit.")
    outcome = {key: _text(outcome.get(key), f"outcome.{key}") for key in ("name", "unit")}
    control = payload.get("controlCondition", "sham")
    if control not in ("sham", "control"):
        raise ValueError("controlCondition must be sham or control.")
    rows = payload.get("rows")
    if not isinstance(rows, list) or not 24 <= len(rows) <= 8192:
        raise ValueError("Provide 24–8192 repeated matched stimulated/control observations.")
    normalized = []
    identifiers = set()
    blocks: dict[tuple[str, str], set[str]] = defaultdict(set)
    counts: dict[tuple[str, str], int] = defaultdict(int)
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Every trial must be an object.")
        item = {key: _text(row.get(key), key) for key in ("trialId", "unitId", "sessionId")}
        if item["trialId"] in identifiers:
            raise ValueError("Duplicate trial IDs would count the same observation twice.")
        identifiers.add(item["trialId"])
        if row.get("condition") not in ("stimulated", control):
            raise ValueError("All rows must use stimulated and the selected control condition.")
        if row.get("qcPassed") is not True:
            raise ValueError("Every submitted trial must pass the saved eligibility/QC rule.")
        item.update(condition=row["condition"], outcome=_number(row.get("outcome"), "outcome"), qcPassed=True)
        if row.get("baseline") is not None:
            item["baseline"] = _number(row["baseline"], "baseline")
        normalized.append(item)
        blocks[(item["unitId"], item["sessionId"])].add(item["condition"])
        counts[(item["unitId"], item["condition"])] += 1
    units = {row["unitId"] for row in normalized}
    if not 6 <= len(units) <= 128:
        raise ValueError("Require 6–128 independent animals/participants; repeated sessions do not increase n.")
    if any(conditions != {"stimulated", control} for conditions in blocks.values()):
        raise ValueError("Every unit/session block requires both stimulated and sham/control observations.")
    if any(counts[(unit, condition)] < 2 for unit in units for condition in ("stimulated", control)):
        raise ValueError("Every independent unit needs at least two trials in each condition.")
    baseline_count = sum("baseline" in row for row in normalized)
    if baseline_count not in (0, len(normalized)):
        raise ValueError("Baseline measurements must be present for every row or none.")
    tolerance = payload.get("baselineTolerance")
    if tolerance is not None:
        tolerance = _number(tolerance, "baselineTolerance")
        if tolerance < 0 or not baseline_count:
            raise ValueError("Baseline tolerance must be nonnegative and requires baseline measurements.")
    if baseline_count and tolerance is None:
        raise ValueError("Record the prespecified baselineTolerance when using baseline measurements.")
    bootstrap = _integer(payload.get("bootstrapSamples", 1000), "bootstrapSamples", 200, 5000)
    permutations = _integer(payload.get("permutations", 2000), "permutations", 200, 10000)
    seed = _integer(payload.get("seed", 2026), "seed", 0, 2**32 - 1)
    draws = 2**len(units) if len(units) <= 16 else permutations
    if len(units) * (draws + bootstrap) > 2_000_000:
        raise ValueError("Requested cluster inference exceeds the local work budget.")
    normalized.sort(key=lambda row: (row["unitId"], row["sessionId"], row["trialId"]))
    config = {"schema_version": 1, "method": METHOD, "model": METHOD, "model_version": VERSION,
              "method_version": VERSION, "source": source, "design": design, "outcome": outcome,
              "controlCondition": control, "rows": normalized, "seed": seed,
              "bootstrapSamples": bootstrap, "permutations": permutations, "baselineTolerance": tolerance, "alpha": .05}
    config["config_sha256"] = hashlib.sha256(_canonical(config).encode()).hexdigest()
    return config


def _mean(values: list[float]) -> float:
    return math.fsum(values) / len(values)


def _percentile(values: list[float], fraction: float) -> float:
    index = (len(values) - 1) * fraction
    low = int(index)
    high = min(low + 1, len(values) - 1)
    return values[low] + (values[high] - values[low]) * (index - low)


def _cancel(cancelled: Any) -> None:
    if cancelled is not None and cancelled.is_set():
        raise InterruptedError("Causal analysis cancelled.")


def evaluate_causal(config: dict[str, Any], cancelled: Any = None) -> dict[str, Any]:
    """Equal-unit contrasts, cluster CI and bounded two-sided sign-flip test.

    Enumeration is exact for the sign distribution, not automatically the
    experiment's assignment distribution. See the exported assumptions.
    """
    _cancel(cancelled)
    canonical_config = validate_causal_request(config)
    if config.get("config_sha256") not in (None, canonical_config["config_sha256"]):
        raise ValueError("Trial/config manifest changed after validation; create a new run.")
    config = canonical_config
    grouped: dict[tuple[str, str], dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in config["rows"]:
        grouped[(row["unitId"], row["sessionId"])][row["condition"]].append(row)
    baseline = "baseline" in config["rows"][0]
    sessions = []
    baseline_deltas = []
    effects: dict[str, list[float]] = defaultdict(list)
    trial_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for (unit, session), conditions in sorted(grouped.items()):
        _cancel(cancelled)
        stim = conditions["stimulated"]
        control = conditions[config["controlCondition"]]
        stim_mean = _mean([r["outcome"] - r.get("baseline", 0) for r in stim])
        control_mean = _mean([r["outcome"] - r.get("baseline", 0) for r in control])
        delta = stim_mean - control_mean
        item = {"unitId": unit, "sessionId": session, "stimulatedMean": stim_mean,
                "controlMean": control_mean, "effect": delta}
        if baseline:
            difference = _mean([r["baseline"] for r in stim]) - _mean([r["baseline"] for r in control])
            item["baselineDifference"] = difference
            baseline_deltas.append(difference)
            if abs(difference) > config["baselineTolerance"]:
                raise ValueError(f"Baseline QC failed in unit/session {unit}/{session}; imbalance exceeds the saved tolerance.")
        sessions.append(item)
        effects[unit].append(delta)
        trial_counts[unit][0] += len(stim)
        trial_counts[unit][1] += len(control)
    unit_effects = [{"unitId": unit, "effect": _mean(values), "matchedSessions": len(values),
                     "stimulatedTrials": trial_counts[unit][0], "controlTrials": trial_counts[unit][1]}
                    for unit, values in sorted(effects.items())]
    values = [unit["effect"] for unit in unit_effects]
    n = len(values)
    observed = _mean(values)
    rng = random.Random(config["seed"])
    bootstrap = []
    for _ in range(config["bootstrapSamples"]):
        _cancel(cancelled)
        bootstrap.append(_mean([rng.choice(values) for _ in values]))
    bootstrap.sort()
    exact = n <= 16
    draws = 2**n if exact else config["permutations"]
    extreme = 0
    threshold = abs(observed)
    # Include numerical ties; tolerance is relative to the observed/data scale.
    tolerance = max(threshold, max(abs(v) for v in values)) * 1e-12
    for index in range(draws):
        _cancel(cancelled)
        if exact:
            null = _mean([value if index & (1 << i) else -value for i, value in enumerate(values)])
        else:
            null = _mean([value if rng.getrandbits(1) else -value for value in values])
        extreme += abs(null) >= threshold - tolerance
    test = {"method": "unit-cluster-sign-flip", "enumeration": "exact" if exact else "monte-carlo",
            "p_value": extreme / draws if exact else (extreme + 1) / (draws + 1),
            "draws": draws, "extreme_draws": extreme, "minimum_p": 2 / draws if exact else 1 / (draws + 1),
            "null_hypothesis": "Independent-unit stimulated-minus-control effects have zero center and sign-exchangeable distributions.",
            "assumptions": ["Animal/participant clusters are independent; neuron/trial/session IDs cannot substitute for independent units.",
                            "Under the null, whole-unit effects are sign exchangeable (e.g. symmetric around zero).",
                            "Exact enumeration describes this sign distribution, not necessarily the original trial-assignment randomization."]}
    if not exact:
        # Wilson binomial interval for the underlying tail probability. It
        # quantifies Monte Carlo error, not effect uncertainty or multiplicity.
        proportion = extreme / draws
        z = 1.959963984540054
        denominator = 1 + z*z / draws
        center = (proportion + z*z / (2*draws)) / denominator
        half = z * math.sqrt(proportion*(1-proportion)/draws + z*z/(4*draws*draws)) / denominator
        test["monte_carlo_ci95"] = [max(0, center-half), min(1, center+half)]
    registered = config["design"]["registration"]["registered"]
    randomized = config["design"]["assignment"] == "randomized"
    level = ("engineering-fixture" if config["source"]["kind"] == "synthetic" else
             "observational-association" if not randomized or config["source"]["kind"] == "public-observational" else
             "registered-randomized-design" if registered else "exploratory-randomized-design")
    limitations = ["This software checks declared provenance; a hash or checkbox does not independently verify random assignment, registration, or unit independence.",
                   "Equal-session then equal-unit averaging targets an average animal/participant effect, not an average trial effect.",
                   "The percentile cluster bootstrap can have poor coverage with few independent units; six is an input floor, not a power guarantee.",
                   "One unadjusted, two-sided test is reported; multiple outcomes, recipes or runs require a prespecified correction.",
                   "Sham controls differ from no-stimulation controls; neither alone proves cell specificity or excludes all optical/behavioral confounding.",
                   "Effects in public animal perturbation recordings do not establish dream recovery, human circuit causality, or disease treatment efficacy."]
    if not baseline:
        limitations.append("No pre-treatment baseline was recorded; baseline balance was not assessed.")
    if level == "observational-association":
        limitations.append("Assignment/provenance does not support a randomized causal claim; sign-flip inference is exploratory association under its stated assumptions.")
    return {"schema_version": 1, "method": METHOD, "model_version": VERSION,
            "config_sha256": config["config_sha256"], "source": config["source"], "outcome": config["outcome"],
            "evidence_level": level, "independent_units": n, "matched_sessions": len(sessions), "rows": len(config["rows"]),
            "estimate": {"mean_difference": observed, "ci95_cluster_bootstrap": [_percentile(bootstrap, .025), _percentile(bootstrap, .975)],
                         "unit": config["outcome"]["unit"], "baseline_adjusted": baseline},
            "unit_effects": unit_effects, "session_effects": sessions, "randomization_test": test,
            "qc": {"all_passed": True, "matched_control_gate": "PASSED", "baseline_present": baseline,
                   "baseline_mean_difference": _mean(baseline_deltas) if baseline else None,
                   "baseline_max_absolute_difference": max(map(abs, baseline_deltas)) if baseline else None,
                   "baseline_tolerance": config["baselineTolerance"], "baseline_gate": "PASSED" if baseline else "NOT_RECORDED"},
            "methodology": {"version": VERSION, "sources": SOURCES,
                            "aggregation": "Mean outcome-minus-baseline per condition/session; stimulated minus control; equal session weights within unit; equal unit weights.",
                            "confidence_interval": "95% percentile bootstrap resampling independent units, preserving each unit's repeated-session aggregate."},
            "limitations": limitations,
            "interpretation": "Measured matched perturbation/control contrast. Synthetic fixtures validate engineering only; observational data remain association; randomized-design eligibility is conditional on independently audited assignment and controls."}
