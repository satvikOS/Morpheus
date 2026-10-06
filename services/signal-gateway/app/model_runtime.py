"""Bounded, local-only classical decoding jobs. No acquisition hot-path work."""
from __future__ import annotations

import hashlib
import json
import math
import random
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VERSION = "m3-classical-1.0.0"
MODELS = [
    {"id": "nearest-centroid", "version": VERSION, "name": "Nearest centroid",
     "implementation": "python-standard-library", "license": "repository-license-unspecified",
     "weights": "fit-on-training-fold-only", "input": "versioned labeled feature snapshots",
     "limitations": "Reference classifier; state labels are reports, not verified dream content."},
    {"id": "diagonal-lda", "version": VERSION, "name": "Regularized diagonal LDA",
     "implementation": "python-standard-library", "license": "repository-license-unspecified",
     "weights": "fit-on-training-fold-only", "input": "versioned labeled feature snapshots",
     "limitations": "Equal class priors, diagonal pooled covariance; no hyperparameter search."},
]
RECIPES = {
    "nearest-centroid": {"id": "m3-nearest-centroid-v1", "version": "1.0.0", "adapterId": "nearest-centroid", "sourcePaperIds": ["horikawa-2013", "wong-2025"]},
    "diagonal-lda": {"id": "m3-diagonal-lda-v1", "version": "1.0.0", "adapterId": "diagonal-lda", "sourcePaperIds": ["horikawa-2013", "wong-2025"]},
    "causal-perturbation": {"id": "causal-paired-contrast-v1", "version": "1.0.0", "adapterId": "causal-perturbation", "sourcePaperIds": ["boyden-2005", "ryan-2015", "marshel-2019"]},
}
from app.unified_model import RECIPE as UNIFIED_RECIPE
RECIPES["morpheus-shared-encoder"] = UNIFIED_RECIPE


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_request(payload: dict[str, Any]) -> dict[str, Any]:
    model = payload.get("model", "nearest-centroid")
    if model not in {item["id"] for item in MODELS}:
        raise ValueError("Unknown model identifier.")
    rows = payload.get("rows")
    if not isinstance(rows, list) or not 8 <= len(rows) <= 2048:
        raise ValueError("Provide 8–2048 labeled snapshots from independent sessions.")
    if not isinstance(payload.get("seed", 2026), int) or isinstance(payload.get("seed"), bool):
        raise ValueError("Seed must be an integer.")
    permutations = payload.get("permutations", 100)
    if not isinstance(permutations, int) or isinstance(permutations, bool) or not 20 <= permutations <= 200:
        raise ValueError("Permutation count must be an integer from 20 to 200.")
    normalized = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Every snapshot must be an object.")
        for key in ("id", "subjectId", "sessionId", "label"):
            if not isinstance(row.get(key), str) or not row[key].strip() or len(row[key]) > 128:
                raise ValueError(f"Every snapshot needs a bounded {key}.")
        features = row.get("features")
        if not isinstance(features, list) or not 1 <= len(features) <= 64 or any(
            isinstance(v, bool) or not isinstance(v, (float, int)) or abs(v) > 1e12 or not math.isfinite(v)
            for v in features
        ):
            raise ValueError("Features must contain 1–64 finite numbers with magnitude ≤1e12.")
        names = row.get("featureNames")
        if not isinstance(names, list) or len(names) != len(features) or any(
            not isinstance(name, str) or not name or len(name) > 128 for name in names
        ) or len(set(names)) != len(names):
            raise ValueError("Feature names must be unique and match the feature width.")
        normalized.append({**{key: row[key] for key in ("id", "subjectId", "sessionId", "label")},
                           "features": list(features), "featureNames": names,
                           "sourceMode": row.get("sourceMode", "unverified"),
                           "featureSchema": row.get("featureSchema", "legacy-unspecified"),
                           "sourceKind": row.get("sourceKind", "unknown"),
                           "sampleRate": row.get("sampleRate"), "channelCount": row.get("channelCount")})
    if len({r["id"] for r in normalized}) != len(rows):
        raise ValueError("Duplicate snapshot IDs would leak repeated observations.")
    if len({r["subjectId"] for r in normalized}) != 1:
        raise ValueError("This model is subject-specific; select exactly one subject.")
    if any(r["featureNames"] != normalized[0]["featureNames"] for r in normalized):
        raise ValueError("All snapshots must share identical ordered feature names.")
    for row in normalized:
        if row["sourceMode"] not in ("live", "simulation", "unverified", "idle"):
            raise ValueError("Unknown source mode.")
        for key in ("featureSchema", "sourceKind"):
            if not isinstance(row[key], str) or not row[key] or len(row[key]) > 128:
                raise ValueError(f"Invalid {key} provenance.")
        if row["sourceKind"] not in ("simulation_fixture", "local_acquisition_unverified", "unknown"):
            raise ValueError("Unknown source kind.")
        if (row["sourceKind"] == "simulation_fixture" and row["sourceMode"] == "live") or (row["sourceKind"] == "local_acquisition_unverified" and row["sourceMode"] == "simulation"):
            raise ValueError("Source mode contradicts recorded source kind.")
        if row["sampleRate"] is not None and (isinstance(row["sampleRate"], bool) or not isinstance(row["sampleRate"], (int, float)) or not 0 < row["sampleRate"] <= 100000 or not math.isfinite(row["sampleRate"])):
            raise ValueError("Invalid sample rate provenance.")
        if row["channelCount"] is not None and (isinstance(row["channelCount"], bool) or not isinstance(row["channelCount"], int) or not 0 < row["channelCount"] <= 4096):
            raise ValueError("Invalid channel count provenance.")
    if len({canonical([r[key] for key in ("sourceMode", "featureSchema", "sourceKind", "sampleRate", "channelCount")]) for r in normalized}) != 1:
        raise ValueError("Mixed source or feature-schema provenance cannot share a decoding run.")
    sessions = sorted({r["sessionId"] for r in normalized})
    labels = sorted({r["label"] for r in normalized})
    if len(sessions) < 3 or not 2 <= len(labels) <= 8:
        raise ValueError("At least three sessions and two to eight labels are required.")
    # Require a complete crossed design. Never fall back to leave-one-row-out.
    for session in sessions:
        if {r["label"] for r in normalized if r["sessionId"] == session} != set(labels):
            raise ValueError("Every session must contain every label for session-blocked evaluation.")
    # Bound total work, including the full refit for each null replicate.
    if len(rows) * len(sessions) * len(normalized[0]["features"]) * (permutations + 1) > 20_000_000:
        raise ValueError("Requested evaluation exceeds the local reference job budget; reduce rows or permutations.")
    return {"schema_version": 1, "model": model, "model_version": VERSION,
            "preprocessing_version": "training-fold-zscore-1", "rows": normalized,
            "seed": payload.get("seed", 2026), "permutations": permutations,
            "split": "leave-one-session-out", "null": "within-session-label-shuffle"}


def balanced_accuracy(predictions: list[dict[str, Any]], labels: list[str]) -> float:
    return sum(sum(p["predicted"] == label for p in predictions if p["actual"] == label) /
               sum(p["actual"] == label for p in predictions) for label in labels) / len(labels)


def evaluate(config: dict[str, Any], cancelled: threading.Event | None = None) -> dict[str, Any]:
    rows = config["rows"]
    labels = sorted({r["label"] for r in rows})
    sessions = sorted({r["sessionId"] for r in rows})

    def predict(data: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = []
        for session in sessions:
            if cancelled and cancelled.is_set():
                raise InterruptedError("Job cancelled.")
            train = [r for r in data if r["sessionId"] != session]
            test = [r for r in data if r["sessionId"] == session]
            width = len(train[0]["features"])
            means = [sum(r["features"][j] for r in train) / len(train) for j in range(width)]
            scales = [max(math.sqrt(sum((r["features"][j] - means[j]) ** 2 for r in train) / len(train)), 1e-9)
                      for j in range(width)]
            def transform(r: dict[str, Any]) -> list[float]:
                return [(r["features"][j] - means[j]) / scales[j] for j in range(width)]
            groups = {label: [transform(r) for r in train if r["label"] == label] for label in labels}
            centroids = {label: [sum(v[j] for v in group) / len(group) for j in range(width)]
                         for label, group in groups.items()}
            variance = [max(sum((v[j] - centroids[label][j]) ** 2 for label, group in groups.items()
                                for v in group) / max(1, len(train) - len(labels)), 1e-3) for j in range(width)]
            for row in test:
                values = transform(row)
                distances = {label: sum((values[j] - centroids[label][j]) ** 2 /
                                        (variance[j] if config["model"] == "diagonal-lda" else 1)
                                        for j in range(width)) for label in labels}
                predicted = min(labels, key=lambda label: distances[label])
                result.append({"id": row["id"], "sessionId": session, "actual": row["label"],
                               "predicted": predicted, "squared_distance": distances[predicted]})
        return result

    predictions = predict(rows)
    observed = balanced_accuracy(predictions, labels)
    rng = random.Random(config["seed"])
    null_scores = []
    for _ in range(config["permutations"]):
        permuted = [dict(r) for r in rows]
        for session in sessions:
            indices = [i for i, r in enumerate(rows) if r["sessionId"] == session]
            shuffled = [rows[i]["label"] for i in indices]
            rng.shuffle(shuffled)
            for i, label in zip(indices, shuffled, strict=True):
                permuted[i]["label"] = label
        null_scores.append(balanced_accuracy(predict(permuted), labels))
    folds = [{"session": session, "train_ids": [r["id"] for r in rows if r["sessionId"] != session],
              "test_ids": [r["id"] for r in rows if r["sessionId"] == session],
              "balanced_accuracy": balanced_accuracy([p for p in predictions if p["sessionId"] == session], labels)}
             for session in sessions]
    # Cluster bootstrap over sessions; repeated snapshots are not independent replicates.
    bootstrap = sorted(sum(rng.choice(folds)["balanced_accuracy"] for _ in folds) / len(folds) for _ in range(500))
    confusion = {a: {b: sum(p["actual"] == a and p["predicted"] == b for p in predictions) for b in labels}
                 for a in labels}
    return {"schema_version": 1, "model_version": VERSION, "classes": labels, "rows": len(rows),
            "independent_sessions": len(sessions), "validation": config["split"], "accuracy":
            sum(p["actual"] == p["predicted"] for p in predictions) / len(predictions),
            "balanced_accuracy": observed, "chance": 1 / len(labels),
            "permutation_p": (1 + sum(v >= observed for v in null_scores)) / (len(null_scores) + 1),
            "null_mean": sum(null_scores) / len(null_scores), "null_scores": null_scores,
            "ci95_session_bootstrap": [bootstrap[12], bootstrap[487]], "confusion": confusion,
            "folds": folds, "predictions": predictions,
            "evidence_level": "engineering-evaluation" if any(r["sourceMode"] != "live" for r in rows) else "exploratory-statistics",
            "limitations": ["Within-session shuffles assume label exchangeability; autocorrelated/overlapping windows may violate it.",
                            "No calibration or recovered subjective imagery; a small session count gives weak uncertainty estimates.",
                            "Exploratory per-run p-value; comparisons across models/runs require a preregistered correction."]}


class LocalModelRuntime:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.database = directory / "model-runs.sqlite3"
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="morpheus-model")
        self.slots = threading.BoundedSemaphore(4)
        self.cancellations: dict[str, threading.Event] = {}
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, document TEXT NOT NULL)")
            # Interrupted jobs survive restart with a truthful final status.
            for identifier, raw in db.execute("SELECT id, document FROM runs").fetchall():
                run = json.loads(raw)
                if run["status"] in ("QUEUED", "RUNNING"):
                    run.update(status="FAILED", error="Local process interrupted; create a new run from the saved manifest.")
                    run["events"].append({"status": "FAILED", "timestamp": stamp()})
                    db.execute("UPDATE runs SET document=? WHERE id=?", (canonical(run), identifier))
        self.database.chmod(0o600)

    @contextmanager
    def connect(self):
        database = sqlite3.connect(self.database, timeout=5)
        try:
            with database:
                yield database
        finally:
            database.close()

    def get(self, identifier: str) -> dict[str, Any] | None:
        with self.lock, self.connect() as db:
            row = db.execute("SELECT document FROM runs WHERE id=?", (identifier,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self) -> list[dict[str, Any]]:
        with self.lock, self.connect() as db:
            rows = db.execute("SELECT document FROM runs ORDER BY rowid DESC LIMIT 50").fetchall()
        return [{k: v for k, v in json.loads(row[0]).items() if k not in ("config", "result")} for row in rows]

    def save(self, run: dict[str, Any]) -> None:
        with self.lock, self.connect() as db:
            db.execute("INSERT OR REPLACE INTO runs VALUES (?, ?)", (run["id"], canonical(run)))

    def submit(self, payload: dict[str, Any]) -> dict[str, Any]:
        method = payload.get("method", "classical-decoding")
        if method == "unified-model":
            from app.unified_model import validate_unified_request, IMPLEMENTATION_SHA256
            config = validate_unified_request(payload)
            config["implementation_sha256"] = IMPLEMENTATION_SHA256
        elif method == "causal-perturbation":
            from app.causal_analysis import validate_causal_request
            config = validate_causal_request(payload)
            config["model"] = "causal-perturbation"
        elif method == "classical-decoding":
            config = validate_request(payload)
        else:
            raise ValueError("Method does not have a reviewed executable adapter.")
        recipe = RECIPES[config["model"]]
        if payload.get("recipe", recipe) != recipe:
            raise ValueError("Recipe provenance does not match a reviewed implementation and version.")
        config["recipe"] = json.loads(canonical(recipe))
        if not self.slots.acquire(blocking=False):
            raise OverflowError("Local model queue is full (four jobs maximum).")
        identifier = str(uuid.uuid4())
        run = {"id": identifier, "status": "QUEUED", "created_at": stamp(), "model": config["model"],
               "config": config, "input_sha256": hashlib.sha256(canonical(config).encode()).hexdigest(),
               "events": [{"status": "QUEUED", "timestamp": stamp()}], "executor": "local-python-science-adapter"}
        event = threading.Event()
        try:
            self.save(run)
            with self.lock:
                self.cancellations[identifier] = event
            self.pool.submit(self.execute, json.loads(canonical(run)), event)
        except Exception:
            with self.lock:
                self.cancellations.pop(identifier, None)
            self.slots.release()
            raise
        return run

    def execute(self, run: dict[str, Any], event: threading.Event) -> None:
        identifier = run["id"]
        started = time.perf_counter()
        try:
            if event.is_set():
                raise InterruptedError("Job cancelled.")
            run["status"] = "RUNNING"
            run["events"].append({"status": "RUNNING", "timestamp": stamp()})
            self.save(run)
            if run["model"] == "morpheus-shared-encoder":
                from app.unified_model import train_unified
                result = train_unified(run["config"], event)
            elif run["model"] == "causal-perturbation":
                from app.causal_analysis import evaluate_causal
                result = evaluate_causal(run["config"], event)
            else:
                result = evaluate(run["config"], event)
            if event.is_set():
                raise InterruptedError("Job cancelled.")
            run.update(status="COMPLETED", result=result,
                       output_sha256=hashlib.sha256(canonical(result).encode()).hexdigest())
        except InterruptedError as error:
            run.update(status="CANCELLED", error=str(error))
        except Exception as error:
            run.update(status="FAILED", error=str(error))
        finally:
            run["elapsed_ms"] = (time.perf_counter() - started) * 1000
            run["events"].append({"status": run["status"], "timestamp": stamp()})
            try:
                self.save(run)
            finally:
                with self.lock:
                    self.cancellations.pop(identifier, None)
                self.slots.release()

    def cancel(self, identifier: str) -> bool:
        with self.lock:
            event = self.cancellations.get(identifier)
            if event is None:
                return False
            event.set()
        return True

    def close(self) -> None:
        with self.lock:
            for event in self.cancellations.values():
                event.set()
        self.pool.shutdown(wait=True, cancel_futures=False)
