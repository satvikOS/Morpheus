"""Bounded, versioned EEG/report pilot from the openly licensed DREAM DATA1 package.

Selection is sealed from source metadata before EEG features are calculated. A public
ZIP is read with HTTP ranges; the full 1.6 GB archive is never downloaded. Reports
without measured perceptual-complexity ratings have null outcomes, never zeros.
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import io
import json
import math
import os
import re
import threading
import urllib.request
import zipfile
import zlib
from pathlib import Path

VERSION = "dream-data1-preawakening-features-1.0.0"
ARTICLE_URL = "https://api.figshare.com/v2/articles/24058740/versions/1"
ARCHIVE_ID = 42196143
ARCHIVE_BYTES = 1614575476
UPSTREAM_ARCHIVE_MD5 = "6534806c2d0862cbedfdf6f7b91d7ddd"
PACKAGE_PREFIX = "Noreika_DATA1/"
DOWNLOAD_LIMIT = 512 * 1024 * 1024
SEED = 2026
MAX_PER_CLASS = 3
STAGES = {"2": "N2", "3": "N3"}
LABELS = {"0": "NoExperience", "1": "WithoutRecall", "2": "Experience", "-1": "ExperienceWithOrWithoutRecall",
          "-2": "NoExperienceOrWithoutRecall", "-3": "ExperienceOrNoExperience", "-4": "Unknown"}
TARGET_CODES = ("0", "1", "2")
REGIONS = {"frontal": ("F3", "F4", "Fz"), "central": ("C3", "C4", "Cz"), "posterior": ("P3", "P4", "Pz", "O1", "O2")}
BANDS = {"delta": (0.5, 4), "theta": (4, 8), "alpha": (8, 12), "sigma": (12, 16), "beta": (16, 30)}
FEATURE_NAMES = [f"{region}_log10_{band}_uV2" for region in REGIONS for band in BANDS] + [f"{region}_log10_rms_uV" for region in REGIONS] + ["adc_clipping_fraction", "prolonged_flatline_fraction"]
FEATURE_CONTRACT = {"version": VERSION, "regions": REGIONS, "bandsHz": BANDS,
                    "input": "source 60 seconds immediately preceding awakening, N2/N3 metadata subset",
                    "requiredRateHz": 2000, "spectralWindowSeconds": 4, "overlapFraction": 0.5,
                    "window": "numpy.hanning symmetric Hann", "detrend": "per-window mean subtraction",
                    "filter": "none added; source prefilter headers retained", "psd": "one-sided density, integrate half-open bands",
                    "logFloor": 1e-12, "qcMaximumClippingFraction": 0.01,
                    "flatlineMinimumSeconds": 1, "qcMaximumProlongedFlatlineFraction": 0.05,
                    "featureNames": FEATURE_NAMES, "noMetadataFeatures": True}
FILE_PATTERN = re.compile(r"ID_(\d+)_S(\d+)_N(\d+)_A(\d+)\.edf")
ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DIRECTORY = ROOT / ".local" / "dream-pilot"


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".tmp")
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as handle:
        handle.write(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False).encode() + b"\n")
    temporary.replace(path)


class Budget:
    """Downloaded response-body bytes, including failed reads, remain in a durable ledger."""
    def __init__(self, path: Path, limit: int = DOWNLOAD_LIMIT):
        self.path, self.limit, self.lock = path, limit, threading.Lock()
        self.received = json.loads(path.read_text())["receivedBytes"] if path.exists() else 0
        if not isinstance(self.received, int) or self.received < 0 or self.received > limit:
            raise ValueError("Invalid cumulative download ledger.")

    def reserve_check(self, requested: int) -> None:
        if requested < 0 or self.received + requested > self.limit:
            raise ValueError("Cumulative DREAM download would exceed the 512 MiB cap.")

    def charge(self, received: int) -> None:
        with self.lock:
            self.received += received
            save_json(self.path, {"schema": "dream-download-budget-v1", "limitBytes": self.limit, "receivedBytes": self.received})
            if self.received > self.limit:
                raise ValueError("Cumulative DREAM download exceeded its cap.")


class RangeReader(io.RawIOBase):
    """Seekable public archive reads with mandatory exact 206/Content-Range responses."""
    def __init__(self, url: str, size: int, budget: Budget):
        if url != f"https://ndownloader.figshare.com/files/{ARCHIVE_ID}":
            raise ValueError("Only the pinned public DATA1 archive is admitted.")
        self.url, self.size, self.budget, self.position = url, size, budget, 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset if whence == 2 else -1
        if position < 0 or position > self.size:
            raise ValueError("Archive seek outside the declared file.")
        self.position = position
        return position

    def read(self, amount=-1):
        amount = self.size - self.position if amount < 0 else min(amount, self.size - self.position)
        if amount == 0:
            return b""
        if amount > 8 * 1024 * 1024:
            raise ValueError("A single archive range cannot exceed 8 MiB.")
        self.budget.reserve_check(amount)
        start, end = self.position, self.position + amount - 1
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity", "User-Agent": "Morpheus-DREAM-pilot/1.0"})
        with urllib.request.urlopen(request, timeout=45) as response:
            expected_range = f"bytes {start}-{end}/{self.size}"
            if response.status != 206 or response.headers.get("Content-Range") != expected_range or int(response.headers.get("Content-Length", -1)) != amount:
                raise ValueError("Archive server did not honor the exact bounded range; no full-download fallback is allowed.")
            chunks, remaining = [], amount
            while remaining:
                chunk = response.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise ValueError("Archive range ended early.")
                self.budget.charge(len(chunk))
                chunks.append(chunk)
                remaining -= len(chunk)
        self.position += amount
        return b"".join(chunks)


def read_csv(data: bytes) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
    if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError("CSV metadata has invalid headers.")
    rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("CSV metadata has a changed column count.")
    return [row for row in rows if any(value.strip() for value in row.values())]


def validate_metadata(records, reports):
    report_by_file = {}
    for report in reports:
        name = report.get("Filename", "")
        if not FILE_PATTERN.fullmatch(name) or name in report_by_file:
            raise ValueError("Report files must have unique canonical source names.")
        report_by_file[name] = report
    seen, joined = set(), []
    for row in records:
        name = row.get("Filename", "")
        match = FILE_PATTERN.fullmatch(name)
        if not match or name in seen or str(int(match[2])) != row.get("Subject ID") or str(int(match[1])) != row.get("Case ID"):
            raise ValueError("A record has duplicate or inconsistent case/subject identity.")
        seen.add(name)
        report = report_by_file.get(name)
        if not report or report.get("Case ID") != row["Case ID"] or report.get("Experience") != row.get("Experience") or row.get("Experience") not in LABELS:
            raise ValueError("Report and EEG record identity/labels do not agree.")
        if row.get("Duration") != "60" or row.get("EEG sample rate") != "2000" or row.get("Number of EEG channels") != "25":
            raise ValueError("DATA1 signal schema differs from the reviewed 60 s / 2000 Hz / 25 EEG package.")
        rating_raw = report.get("Dream complexity", "").strip()
        rating = None
        if rating_raw:
            try:
                rating = float(rating_raw)
            except ValueError as error:
                raise ValueError("Perceptual-complexity rating is not numerical.") from error
            if not math.isfinite(rating) or not 1 <= rating <= 7 or row["Experience"] != "2":
                raise ValueError("Perceptual-complexity rating does not match the reviewed 1–7 recalled-report endpoint.")
        joined.append({"filename": name, "caseId": row["Case ID"], "subjectId": row["Subject ID"], "sessionId": match[3],
                       "experienceCode": row["Experience"], "label": LABELS[row["Experience"]], "sleepStageCode": row.get("Last sleep stage", ""),
                       "rating": rating, "ratingRaw": rating_raw, "ratingMissingReason": None if rating is not None else "not_recorded_or_not_applicable",
                       "ratingSource": "Noreika_DATA1/Data/Reports.csv:Dream complexity", "upstreamArtifactProportion": row.get("Proportion artifacts") or None})
    if len(report_by_file) != len(seen):
        raise ValueError("Reports and EEG metadata do not contain the same case set.")
    return joined


def select_cases(joined, inventory, seed=SEED, maximum_per_class=MAX_PER_CLASS):
    """A predetermined hash rank within subject/class; no EEG values or rating magnitudes are used."""
    eligible = [row for row in joined if row["experienceCode"] in TARGET_CODES and row["sleepStageCode"] in STAGES]
    counts = collections.defaultdict(collections.Counter)
    for row in eligible:
        counts[row["subjectId"]][row["experienceCode"]] += 1
    units = sorted((unit for unit, count in counts.items() if all(count[code] >= 2 for code in TARGET_CODES)), key=int)
    if not 6 <= len(units) <= 16:
        raise ValueError(f"N2/N3 three-class gate failed: {len(units)} independent subjects have at least two reports per class.")
    selected = []
    for unit in units:
        for code in TARGET_CODES:
            candidates = [row for row in eligible if row["subjectId"] == unit and row["experienceCode"] == code]
            ranked = sorted(candidates, key=lambda row: digest(f"dream-data1:{seed}:{row['filename']}".encode()))
            for row in ranked[:maximum_per_class]:
                name = PACKAGE_PREFIX + "Data/PSG/" + row["filename"]
                entry = inventory[name]
                # Source files have 29–34 signals because auxiliary channels differ.
                # Exact EEG duration/rate/calibration is checked again from each EDF.
                if entry.file_size not in (6967680, 7083680, 8127680) or entry.compress_size > 8 * 1024 * 1024 or entry.flag_bits & 1:
                    raise ValueError("EDF archive entry differs from the bounded reviewed schema.")
                selected.append({**row, "archiveName": name, "compressedBytes": entry.compress_size, "fileBytes": entry.file_size, "crc32": f"{entry.CRC:08x}"})
    observed = collections.Counter(row["subjectId"] for row in selected if row["rating"] is not None)
    if len(selected) < 48 or any(observed[unit] < 2 for unit in units):
        raise ValueError("The fixed subset does not meet 48 rows / two actual ratings per independent subject.")
    if sum(row["compressedBytes"] for row in selected) + 2 * 1024 * 1024 > DOWNLOAD_LIMIT:
        raise ValueError("The fixed selected archives exceed the cumulative download allowance.")
    chosen = {row["filename"] for row in selected}
    exclusions = [{"filename": row["filename"], "label": row["label"], "reason": "ambiguous_or_unknown_report" if row["experienceCode"] not in TARGET_CODES else "not_N2_or_N3" if row["sleepStageCode"] not in STAGES else "subject_class_coverage" if row["subjectId"] not in units else "predetermined_hash_sampling"} for row in joined if row["filename"] not in chosen]
    return selected, exclusions


def audit(directory: Path):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (directory / "selection.json").exists():
        raise ValueError("A selection already exists. Preserve the sealed pilot instead of overwriting it.")
    budget = Budget(directory / "download-budget.json")
    budget.reserve_check(1024 * 1024)
    with urllib.request.urlopen(ARTICLE_URL, timeout=30) as response:
        raw = response.read(1024 * 1024)
    budget.charge(len(raw))
    article = json.loads(raw)
    if article.get("id") != 24058740 or article.get("version") != 1 or article.get("license", {}).get("name") != "CC BY 4.0":
        raise ValueError("Package version/license differs from the reviewed public source.")
    source = next((entry for entry in article["files"] if entry["id"] == ARCHIVE_ID), None)
    if not source or source["size"] != ARCHIVE_BYTES or source["computed_md5"] != UPSTREAM_ARCHIVE_MD5 or source["is_link_only"] or article.get("is_embargoed"):
        raise ValueError("Package file/access changed.")
    save_json(directory / "source-article.json", article)
    archive = RangeReader(source["download_url"], source["size"], budget)
    metadata = {}
    with zipfile.ZipFile(archive) as package:
        inventory = {entry.filename: entry for entry in package.infolist()}
        if len(inventory) != len(package.infolist()):
            raise ValueError("Duplicate ZIP names.")
        for name in ("README.txt", "ExperimentalDescription.txt", "Records.csv", "Data/Reports.csv", "Records-README.txt"):
            entry = inventory[PACKAGE_PREFIX + name]
            if entry.file_size > 128 * 1024:
                raise ValueError("Source metadata exceeds its bound.")
            data = package.read(entry)
            target = directory / "source" / Path(name).name
            target.parent.mkdir(exist_ok=True, mode=0o700)
            target.write_bytes(data)
            target.chmod(0o600)
            metadata[name] = {"sha256": digest(data), "bytes": len(data), "crc32": f"{entry.CRC:08x}"}
        readme = (directory / "source/README.txt").read_text(encoding="utf-8-sig")
        if "Creative Commons Attribution" not in readme or "4.0" not in readme:
            raise ValueError("The package README does not confirm CC-BY-4.0.")
        joined = validate_metadata(read_csv((directory / "source/Records.csv").read_bytes()), read_csv((directory / "source/Reports.csv").read_bytes()))
        selected, exclusions = select_cases(joined, inventory)
    payload = {"schema": "morpheus-dream-selection-v1", "extractorVersion": VERSION, "articleId": article["id"], "articleVersion": 1,
               "datasetId": "DREAM-set16-amendment0", "doi": "10.6084/m9.figshare.24058740.v1", "sourceUrl": source["download_url"], "archiveId": ARCHIVE_ID,
               "archiveBytes": source["size"], "upstreamArchiveMd5": source["computed_md5"], "wholeArchiveMd5IndependentlyVerified": False,
               "license": "CC-BY-4.0", "metadata": metadata,
               "consentAudit": {"primaryPaper": "https://doi.org/10.1093/nc/niaa006", "finding": "Primary methods report signed informed consent and University of Turku Ethical Board approval.", "access": "Public, unembargoed CC-BY package; no participant contact or new consent collection."},
               "selection": {"seed": SEED, "rank": "SHA256 of dream-data1:seed:source filename", "maximumPerSubjectClass": MAX_PER_CLASS, "stages": ["N2", "N3"], "windowSecondsBeforeAwakening": [60, 0], "featureNames": FEATURE_NAMES,
                             "minimumRows": 48, "minimumIndependentSubjects": 6, "minimumReportsPerClassPerSubject": 2, "minimumObservedRatingsPerSubject": 2},
               "outcome": {"name": "blind-rater perceptual complexity", "unit": "Orlinsky modified ordinal rating points (1–7)", "missing": "null; never zero", "measurement": "Original Reports.csv rating; includes averaged 1.5. Distances between ordinal categories are not established equal."},
               "cases": selected, "exclusions": exclusions}
    seal = {**payload, "selectionSha256": digest(canonical(payload))}
    save_json(directory / "selection.json", seal)
    return summary(seal, budget)


def load_selection(directory: Path):
    selection = json.loads((directory / "selection.json").read_text())
    payload = {key: value for key, value in selection.items() if key != "selectionSha256"}
    if digest(canonical(payload)) != selection["selectionSha256"] or selection.get("extractorVersion") != VERSION or selection.get("archiveId") != ARCHIVE_ID:
        raise ValueError("Sealed selection integrity/version failed.")
    for name, provenance in selection["metadata"].items():
        if digest((directory / "source" / Path(name).name).read_bytes()) != provenance["sha256"]:
            raise ValueError("Source metadata changed after selection.")
    return selection


def summary(selection, budget):
    rows = selection["cases"]
    return {"selectionSha256": selection["selectionSha256"], "selectedRows": len(rows), "independentSubjects": len({row["subjectId"] for row in rows}),
            "labels": dict(collections.Counter(row["label"] for row in rows)), "observedOutcomes": sum(row["rating"] is not None for row in rows),
            "observedByLabel": dict(collections.Counter(row["label"] for row in rows if row["rating"] is not None)),
            "compressedBytesSelected": sum(row["compressedBytes"] for row in rows), "downloadedBytes": budget.received}


def download(directory: Path):
    selection = load_selection(directory)
    budget = Budget(directory / "download-budget.json")
    if (directory / "download-manifest.json").exists():
        return json.loads((directory / "download-manifest.json").read_text())
    contract = {"selectionSha256": selection["selectionSha256"], "featureContract": FEATURE_CONTRACT}
    contract["contractSha256"] = digest(canonical(contract))
    contract_path = directory / "extraction-contract.json"
    if contract_path.exists():
        if json.loads(contract_path.read_text()) != json.loads(canonical(contract)):
            raise ValueError("Feature/QC contract changed after the first download.")
    else:
        save_json(contract_path, contract)
    raw_directory = directory / "edf"
    raw_directory.mkdir(exist_ok=True, mode=0o700)
    archive = RangeReader(selection["sourceUrl"], selection["archiveBytes"], budget)
    progress_path = directory / "download-progress.json"
    progress = json.loads(progress_path.read_text()) if progress_path.exists() else {"selectionSha256": selection["selectionSha256"], "files": []}
    if progress["selectionSha256"] != selection["selectionSha256"]:
        raise ValueError("Download progress belongs to a different immutable selection.")
    hashes = progress["files"]
    verified = {entry["filename"]: entry for entry in hashes}
    with zipfile.ZipFile(archive) as package:
        for index, case in enumerate(selection["cases"]):
            path = raw_directory / case["filename"]
            if not FILE_PATTERN.fullmatch(case["filename"]):
                raise ValueError("Invalid selected destination name.")
            if path.exists():
                saved = verified.get(case["filename"])
                if not saved or path.stat().st_size != saved["bytes"] or digest(path.read_bytes()) != saved["sha256"]:
                    raise ValueError("Existing download has no matching verified ledger entry.")
                continue
            if case["filename"] in verified:
                raise ValueError("A verified download was removed; preserve the cumulative budget and investigate.")
            info = package.getinfo(case["archiveName"])
            if info.file_size != case["fileBytes"] or info.compress_size != case["compressedBytes"] or f"{info.CRC:08x}" != case["crc32"]:
                raise ValueError("Pinned ZIP entry changed.")
            data = package.read(info)  # ZIP CRC is checked by zipfile; each entry is bounded above.
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as handle:
                handle.write(data)
            hashes.append({"filename": case["filename"], "sha256": digest(data), "bytes": len(data), "sourceCrc32": case["crc32"]})
            save_json(progress_path, {"selectionSha256": selection["selectionSha256"], "files": hashes})
            print(json.dumps({"downloadedCase": index + 1, "of": len(selection["cases"]), "receivedBytes": budget.received}), flush=True)
    manifest = {"schema": "dream-selected-edf-download-v1", "selectionSha256": selection["selectionSha256"], "files": hashes, "receivedBytes": budget.received,
                "wholeArchiveVerified": False, "verification": "Selected decompressed EDF SHA256 and ZIP-entry CRC32; upstream whole-archive MD5 is retained but not independently checked."}
    save_json(directory / "download-manifest.json", manifest)
    return manifest


def decode_edf(data: bytes):
    """Continuous EDF/EDF+C int16 decoding; patient/date fields are never exported."""
    import numpy as np
    if len(data) < 256 or data[:8].strip() != b"0" or b"EDF+D" in data[192:236]:
        raise ValueError("Only continuous EDF is supported.")
    try:
        header_bytes, records = int(data[184:192]), int(data[236:244])
        record_seconds, signal_count = float(data[244:252]), int(data[252:256])
    except ValueError as error:
        raise ValueError("Invalid EDF fixed header.") from error
    if not 1 <= signal_count <= 256 or header_bytes != 256 + 256 * signal_count or not 1 <= records <= 3600 or not math.isfinite(record_seconds) or not 0 < record_seconds <= 60:
        raise ValueError("EDF header exceeds the admitted bounds.")
    cursor = 256
    fields = []
    for width in (16, 80, 8, 8, 8, 8, 8, 80, 8, 32):
        fields.append([data[cursor + index * width:cursor + (index + 1) * width].decode("ascii", "replace").strip() for index in range(signal_count)])
        cursor += width * signal_count
    try:
        samples = [int(value) for value in fields[8]]
    except ValueError as error:
        raise ValueError("Invalid EDF sample counts.") from error
    if any(not 1 <= value <= 120000 for value in samples) or len(data) != header_bytes + records * sum(samples) * 2:
        raise ValueError("EDF payload size disagrees with its header.")
    digital = np.frombuffer(data, dtype="<i2", offset=header_bytes).reshape(records, sum(samples))
    channels, offset = {}, 0
    for index, count in enumerate(samples):
        label = fields[0][index].removeprefix("EEG ").strip()
        if label in channels:
            raise ValueError("Duplicate EDF channel identity.")
        try:
            physical_min, physical_max = float(fields[3][index]), float(fields[4][index])
            digital_min, digital_max = int(fields[5][index]), int(fields[6][index])
        except ValueError as error:
            raise ValueError("Invalid EDF calibration.") from error
        if not all(math.isfinite(value) for value in (physical_min, physical_max)) or physical_max <= physical_min or not -32768 <= digital_min < digital_max <= 32767:
            raise ValueError("EDF calibration is not finite and ordered.")
        raw = digital[:, offset:offset + count].reshape(-1)
        offset += count
        unit = fields[2][index].lower().replace("µ", "u").replace("μ", "u")
        multiplier = {"uv": 1.0, "mv": 1000.0, "v": 1000000.0}.get(unit)
        channels[label] = {"digital": raw, "unit": unit, "rate": count / record_seconds, "prefilter": fields[7][index],
                           "digitalMin": digital_min, "digitalMax": digital_max, "valuesUV": None if multiplier is None else ((raw.astype(float) - digital_min) * (physical_max - physical_min) / (digital_max - digital_min) + physical_min) * multiplier}
    return {"duration": records * record_seconds, "channels": channels}


def prolonged_flatline(raw, rate):
    import numpy as np
    boundaries = np.flatnonzero(np.diff(raw) != 0) + 1
    lengths = np.diff(np.concatenate(([0], boundaries, [len(raw)])))
    return float(lengths[lengths >= rate].sum() / len(raw))


def spectral_features(decoded):
    """Four-second Hann Welch PSD, 50% overlap, 60 s window; no labels/ratings enter."""
    import numpy as np
    if abs(decoded["duration"] - 60) > 1e-6:
        raise ValueError("EEG does not provide the sealed 60-second pre-awakening window.")
    features, region_rms, clipping, flatline, prefilters = [], [], [], [], {}
    for region, names in REGIONS.items():
        psds, rms = [], []
        for name in names:
            if name not in decoded["channels"]:
                raise ValueError(f"Required EEG channel {name} is absent; do not invent or change the schema.")
            channel = decoded["channels"][name]
            values = channel["valuesUV"]
            if channel["rate"] != 2000 or values is None or not np.isfinite(values).all():
                raise ValueError("Required EEG channel has unsupported units/rate or nonfinite values.")
            clip = float(np.mean((channel["digital"] <= channel["digitalMin"]) | (channel["digital"] >= channel["digitalMax"])))
            flat = prolonged_flatline(channel["digital"], 2000)
            clipping.append(clip); flatline.append(flat)
            prefilters[name] = channel["prefilter"]
            centered = values - values.mean()
            rms.append(float(np.sqrt(np.mean(centered * centered))))
            segments = np.lib.stride_tricks.sliding_window_view(values, 8000)[::4000]
            segments = segments - segments.mean(axis=1, keepdims=True)
            window = np.hanning(8000)
            power = np.abs(np.fft.rfft(segments * window, axis=1)) ** 2 / (2000 * np.sum(window * window))
            power[:, 1:-1] *= 2
            psds.append(power.mean(axis=0))
        mean_psd = np.mean(psds, axis=0)
        frequencies = np.fft.rfftfreq(8000, 1 / 2000)
        for low, high in BANDS.values():
            band = float(np.sum(mean_psd[(frequencies >= low) & (frequencies < high)]) * 0.25)
            features.append(math.log10(max(band, 1e-12)))
        region_rms.append(math.log10(max(float(np.mean(rms)), 1e-12)))
    clip, flat = max(clipping), max(flatline)
    flags = ([] if clip <= 0.01 else ["required_channel_adc_clipping_gt_0.01"]) + ([] if flat <= 0.05 else ["required_channel_prolonged_flatline_gt_0.05"])
    if not all(math.isfinite(value) for value in features + region_rms):
        raise ValueError("Spectral feature computation is nonfinite.")
    return features + region_rms + [clip, flat], {"passed": not flags, "flags": flags, "clippingFractionMaximum": clip, "prolongedFlatlineFractionMaximum": flat,
                                                "prefilterHeaders": prefilters, "criterion": "Fixed engineering screens, not independent clinical artifact adjudication."}


def cohort_gate(rows, required_labels=tuple(LABELS[code] for code in TARGET_CODES)):
    counts, observed = collections.defaultdict(collections.Counter), collections.Counter()
    for row in rows:
        counts[row["subjectId"]][row["label"]] += 1
        observed[row["subjectId"]] += row["outcome"] is not None
    eligible = sorted(unit for unit, values in counts.items() if all(values[label] >= 2 for label in required_labels) and observed[unit] >= 2)
    selected = [row for row in rows if row["subjectId"] in eligible]
    passed = 6 <= len(eligible) <= 16 and len(selected) >= 48
    return {"passed": passed, "eligibleSubjects": eligible, "rows": len(selected), "independentSubjects": len(eligible),
            "observedByLabel": dict(collections.Counter(row["label"] for row in selected if row["outcome"] is not None)),
            "reason": None if passed else "Requires >=6 whole subjects, >=48 real reports, >=2/class/subject and >=2 actual ratings/subject; no threshold is relaxed."}, selected


def control_inputs(payload):
    """Matched-row nuisance requests; feature choice never depends on model scores."""
    controls = {}
    for kind in ("stage", "qc"):
        control = json.loads(canonical(payload))
        control["source"]["parentFeatureSchema"] = VERSION
        control["source"]["featureSchema"] = VERSION + "-" + kind + "-control"
        control["source"]["control"] = {
            "kind": kind + "-only matched-row nuisance control",
            "sameRowsLabelsMissingTargetsSeedEpochsAndWidth": True,
            "limitations": "Two inputs instead of twenty alter feature-identity embedding parameter count. This is a nuisance screen, not a causal or architecture-matched ablation.",
            "featureChoice": "Source N2/N3 indicators, fixed metadata admission stages" if kind == "stage" else "The two QC names/indices already fixed in the pre-waveform extraction contract",
        }
        for row in control["rows"]:
            if row["featureNames"] != FEATURE_NAMES or len(row["features"]) != len(FEATURE_NAMES):
                raise ValueError("Control export requires the fixed main EEG schema.")
            if kind == "stage":
                stage = row["provenance"]["sleepStage"]
                if stage not in STAGES.values():
                    raise ValueError("Stage-only control requires a known source N2/N3 annotation.")
                row["featureNames"] = ["source_scored_n2_indicator", "source_scored_n3_indicator"]
                row["features"] = [float(stage == "N2"), float(stage == "N3")]
            else:
                row["featureNames"] = FEATURE_NAMES[-2:]
                row["features"] = row["features"][-2:]
        controls[kind] = control
    return controls


def extract(directory: Path):
    selection = load_selection(directory)
    download_manifest = json.loads((directory / "download-manifest.json").read_text())
    if download_manifest["selectionSha256"] != selection["selectionSha256"]:
        raise ValueError("Downloaded files do not belong to the sealed selection.")
    contract = json.loads((directory / "extraction-contract.json").read_text())
    contract_payload = {key: value for key, value in contract.items() if key != "contractSha256"}
    if contract_payload != json.loads(canonical({"selectionSha256": selection["selectionSha256"], "featureContract": FEATURE_CONTRACT})) or digest(canonical(contract_payload)) != contract["contractSha256"]:
        raise ValueError("Feature/QC contract integrity failed.")
    hashes = {entry["filename"]: entry for entry in download_manifest["files"]}
    if len(hashes) != len(download_manifest["files"]) or set(hashes) != {case["filename"] for case in selection["cases"]}:
        raise ValueError("Download manifest does not match the exact selected case set.")
    rows, excluded = [], []
    for case in selection["cases"]:
        data = (directory / "edf" / case["filename"]).read_bytes()
        if len(data) != case["fileBytes"] or digest(data) != hashes[case["filename"]]["sha256"] or f"{zlib.crc32(data):08x}" != case["crc32"]:
            raise ValueError("Downloaded EDF integrity failed.")
        try:
            features, qc = spectral_features(decode_edf(data))
        except ValueError as error:
            excluded.append({"filename": case["filename"], "label": case["label"], "reason": str(error)})
            continue
        row = {"id": "dream16-case-" + case["caseId"], "subjectId": "dream16-subject-" + case["subjectId"],
               "sessionId": "dream16-subject-" + case["subjectId"] + "-night-" + case["sessionId"], "label": case["label"],
               "features": features, "featureNames": FEATURE_NAMES, "outcome": case["rating"],
               "provenance": {"edfSha256": hashes[case["filename"]]["sha256"], "sourceFilename": case["filename"], "experienceCode": case["experienceCode"],
                              "ratingRaw": case["ratingRaw"], "ratingSource": case["ratingSource"], "ratingMissingReason": case["ratingMissingReason"],
                              "sleepStage": STAGES[case["sleepStageCode"]], "qc": qc}}
        if qc["passed"]:
            rows.append(row)
        else:
            excluded.append({"filename": case["filename"], "label": case["label"], "reason": qc["flags"]})
    gate, training_rows = cohort_gate(rows)
    eligible = set(gate["eligibleSubjects"])
    excluded += [{"filename": row["provenance"]["sourceFilename"], "label": row["label"], "reason": "post_QC_whole_subject_class_or_rating_coverage"} for row in rows if row["subjectId"] not in eligible]
    source = {"kind": "public-neural-recording", "datasetId": "DREAM-set16-amendment0", "datasetVersion": "figshare24058740.v1", "url": "https://doi.org/10.6084/m9.figshare.24058740.v1",
              "license": "CC-BY-4.0", "featureSchema": VERSION, "selectionSha256": selection["selectionSha256"], "featureContractSha256": contract["contractSha256"], "importerSha256": digest(Path(__file__).read_bytes()),
              "sourceMetadata": selection["metadata"], "edfHashes": hashes, "independentUnitMeaning": "human participant, not window or awakening",
              "reportProvenance": {row["id"]: {key: value for key, value in row["provenance"].items() if key != "qc"} for row in training_rows},
              "stageCountsByLabel": {label: dict(collections.Counter(row["provenance"]["sleepStage"] for row in training_rows if row["label"] == label)) for label in ("NoExperience", "WithoutRecall", "Experience")},
              "selectionDesign": "Fixed hash sampling up to three awakenings per report category per whole participant after N2/N3 filtering; case-control proportions do not estimate population prevalence.",
              "attribution": "Valdas Noreika, Mila Oravecz, Lisa Svartsjö; DATA1 DREAM package. Wong et al.2020 doi:10.1093/nc/niaa006; Noreika et al.2009 doi:10.1016/j.ijpsycho.2009.06.002.",
              "outcome": selection["outcome"], "limitations": ["Retrospective hash-balanced report subset; ordinal rating regression uses an explicit interval approximation.", "Missing ratings occur in no-experience/without-recall reports; predictions there have no measured target and must be marked extrapolations.", "Both historical source stage composition and engineering QC can confound report-status classification. Stage/artifact nuisance controls remain necessary.", "Spectral PSD features classify reports; they do not reconstruct dream content or establish permanent neural storage."]}
    payload = {"method": "unified-model", "model": "morpheus-shared-encoder", "source": source,
               "design": {"inputTiming": "pre-awakening", "assignment": "observational", "independentUnitsConfirmed": True},
               "outcome": {"name": "blind-rater perceptual complexity", "unit": "ordinal Orlinsky modified scale points (1–7)", "scope": "Measured ratings exist only for recalled Experience reports. Other labels have null targets; regression predictions there are extrapolations. Ordinal regression assumes interval distances for this exploratory pilot.", "type": "ordinal_rating", "missing": "null"},
               "rows": training_rows, "seed": SEED, "epochs": 30, "hiddenWidth": 32}
    result = {"schema": "morpheus-dream-features-v1", "extractorVersion": VERSION, "selectionSha256": selection["selectionSha256"], "gate": gate,
              "source": source, "allQualityPassedRows": rows, "exclusions": selection["exclusions"] + excluded,
              "trainingPayload": payload if gate["passed"] else None}
    save_json(directory / "features.json", result)
    if gate["passed"]:
        save_json(directory / "training-input.json", payload)
        for kind, control in control_inputs(payload).items():
            save_json(directory / f"training-input-{kind}-control.json", control)
    return {"gate": gate, "labels": dict(collections.Counter(row["label"] for row in training_rows)), "qcExclusions": len(excluded),
            "featuresSha256": digest((directory / "features.json").read_bytes()), "trainingInput": str(directory / "training-input.json") if gate["passed"] else None,
            "controls": {kind: str(directory / f"training-input-{kind}-control.json") for kind in ("stage", "qc")} if gate["passed"] else {}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("audit", "download", "extract"))
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    arguments = parser.parse_args()
    directory = arguments.directory.resolve()
    if not directory.is_relative_to(DEFAULT_DIRECTORY):
        parser.error("Pilot artifacts must remain in the ignored local .local/dream-pilot directory.")
    try:
        result = {"audit": audit, "download": download, "extract": extract}[arguments.action](directory)
        if arguments.action == "download":
            result = {"verifiedFiles": len(result["files"]), "receivedBytes": result["receivedBytes"],
                      "downloadManifest": str(directory / "download-manifest.json"),
                      "downloadManifestSha256": digest((directory / "download-manifest.json").read_bytes())}
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"DREAM pilot failed: {error}\n")


if __name__ == "__main__":
    main()
