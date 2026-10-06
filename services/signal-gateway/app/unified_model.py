"""A bounded, trainable shared representation pilot; private inputs remain local.

Feature tokens feed one Transformer backbone and two jointly optimized heads.
This implementation is deliberately small enough to test before model scaling.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import threading
from pathlib import Path
from typing import Any

VERSION = "morpheus-shared-representation-1.1.0"
IMPLEMENTATION_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
RECIPE = {"id": "morpheus-shared-representation-v1", "version": "1.1.0", "adapterId": "morpheus-shared-encoder",
          "sourcePaperIds": ["caruana-1997", "guo-inagaki-2017", "vaswani-2017"]}


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def dependency_available() -> bool:
    import importlib.util
    return importlib.util.find_spec("torch") is not None


def reviewed_manifest(payload: Any = None) -> dict[str, Any]:
    manifest = json.loads((Path(__file__).parent / "unified-contributions.json").read_text())
    content = {key: value for key, value in manifest.items() if key != "contentSha256"}
    if hashlib.sha256(canonical(content).encode()).hexdigest() != manifest["contentSha256"]:
        raise ValueError("Reviewed contribution manifest integrity failed.")
    if payload is not None and payload != manifest:
        raise ValueError("Model contribution manifest does not match the reviewed implemented objective bindings.")
    return manifest


def validate_unified_request(payload: dict[str, Any]) -> dict[str, Any]:
    if not dependency_available():
        raise ValueError("Install requirements-models.txt on the local science gateway to train the unified model.")
    source, design = payload.get("source"), payload.get("design")
    if not isinstance(source, dict) or source.get("kind") not in ("synthetic", "public-neural-recording"):
        raise ValueError("A synthetic or public-neural-recording source contract is required.")
    for key in ("datasetId", "datasetVersion", "license", "featureSchema"):
        if not isinstance(source.get(key), str) or not source[key] or len(source[key]) > 256:
            raise ValueError(f"Source requires a bounded {key}.")
    if len(canonical(source)) > 65536:
        raise ValueError("Source provenance exceeds 64 KiB.")
    if source["kind"] != "synthetic":
        from urllib.parse import urlsplit
        url = source.get("url")
        if not isinstance(url, str) or len(url) > 2048:
            raise ValueError("Public recordings require an HTTPS source URL.")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.hostname in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Public recordings require a public HTTPS URL without credentials.")
    if not isinstance(design, dict) or design.get("inputTiming") not in ("pre-task-event", "pre-awakening") or design.get("assignment") != "observational" or design.get("independentUnitsConfirmed") is not True:
        raise ValueError("Declare pre-task-event or pre-awakening inputs, observational pilot design and independent-unit identity review.")
    outcome_contract = payload.get("outcome", {"name": "engineered response", "unit": "arbitrary units"} if source["kind"] == "synthetic" else None)
    if not isinstance(outcome_contract, dict) or len(canonical(outcome_contract)) > 4096 or any(not isinstance(outcome_contract.get(key), str) or not outcome_contract[key] or len(outcome_contract[key]) > 256 for key in ("name", "unit")):
        raise ValueError("Declare the measured outcome name and unit before model training.")
    if "scope" in outcome_contract and (not isinstance(outcome_contract["scope"], str) or not outcome_contract["scope"] or len(outcome_contract["scope"]) > 1024):
        raise ValueError("Outcome scope must be a bounded description of the measured population.")
    epochs, width, seed = payload.get("epochs", 30), payload.get("hiddenWidth", 32), payload.get("seed", 2026)
    if isinstance(epochs, bool) or not isinstance(epochs, int) or not 10 <= epochs <= 100:
        raise ValueError("Epoch count must be 10–100.")
    if isinstance(width, bool) or not isinstance(width, int) or width not in (16, 32, 64):
        raise ValueError("Hidden width must be 16, 32 or 64.")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 4294967295:
        raise ValueError("Seed must be an integer from 0 to 2^32−1.")
    raw = payload.get("rows")
    if not isinstance(raw, list) or not 48 <= len(raw) <= 4096:
        raise ValueError("Provide 48–4096 rows from six or more independent units.")
    rows = []
    for row in raw:
        if not isinstance(row, dict):
            raise ValueError("Each training row must be an object.")
        for key in ("id", "subjectId", "sessionId", "label"):
            if not isinstance(row.get(key), str) or not row[key] or len(row[key]) > 128:
                raise ValueError(f"Every row requires a bounded {key}.")
        features, names = row.get("features"), row.get("featureNames")
        if not isinstance(features, list) or not 1 <= len(features) <= 32 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or abs(v) > 1e6 or not math.isfinite(v) for v in features):
            raise ValueError("Provide 1–32 finite features of magnitude ≤1e6.")
        if not isinstance(names, list) or len(names) != len(features) or any(not isinstance(v, str) or not v or len(v) > 128 for v in names) or len(set(names)) != len(names):
            raise ValueError("Feature names must be bounded, unique and match the feature width.")
        if any(name.lower() in ("label", "outcome", "condition", "stimulated", "delay_rate", "post_event_rate") for name in names):
            raise ValueError("Target or post-event features are forbidden; review feature timing before training.")
        outcome = row.get("outcome")
        if "outcome" not in row or (outcome is not None and (isinstance(outcome, bool) or not isinstance(outcome, (int, float)) or abs(outcome) > 1e6 or not math.isfinite(outcome))):
            raise ValueError("Outcome must be a finite bounded measurement or explicit null for unmeasured data.")
        rows.append({key: row[key] for key in ("id", "subjectId", "sessionId", "label", "features", "featureNames", "outcome")})
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate IDs could leak repeated observations.")
    names = rows[0]["featureNames"]
    if any(row["featureNames"] != names for row in rows):
        raise ValueError("All units must use one identical ordered feature schema.")
    units, labels = sorted({r["subjectId"] for r in rows}), sorted({r["label"] for r in rows})
    if not 6 <= len(units) <= 16 or not 2 <= len(labels) <= 8:
        raise ValueError("Use 6–16 independent units and 2–8 labels.")
    for unit in units:
        if sum(r["subjectId"] == unit and r["outcome"] is not None for r in rows) < 2:
            raise ValueError("Each independent unit must contain at least two observed outcomes; missing measurements are not zero.")
        for label in labels:
            if sum(r["subjectId"] == unit and r["label"] == label for r in rows) < 2:
                raise ValueError("Each independent unit must contain at least two rows of every label.")
    # Conservative training-work estimate prevents high-width, many-fold requests.
    work = len(rows) * epochs * (len(units) + 1) * len(names) * width * width
    if work > 2_000_000_000:
        raise ValueError("Training request exceeds the local two-billion operation estimate; reduce rows, epochs or width.")
    return {"method": "unified-model", "model": "morpheus-shared-encoder", "source": json.loads(canonical(source)),
            "design": {"inputTiming": design["inputTiming"], "assignment": "observational", "independentUnitsConfirmed": True}, "rows": rows,
            "contributionManifest": reviewed_manifest(payload.get("contributionManifest")),
            "outcome": json.loads(canonical(outcome_contract)),
            "epochs": epochs, "hiddenWidth": width, "seed": seed, "version": VERSION}


def build_shared_model(feature_count: int, width: int, label_count: int):
    import torch
    from torch import nn
    class SharedModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.value = nn.Linear(1, width)
            self.feature_identity = nn.Parameter(torch.empty(feature_count, width))
            nn.init.normal_(self.feature_identity, std=0.02)
            layer = nn.TransformerEncoderLayer(width, 4, width * 2, dropout=0.0, activation="gelu", batch_first=True)
            self.backbone = nn.TransformerEncoder(layer, 1, enable_nested_tensor=False)
            self.normalization = nn.LayerNorm(width)
            self.classification = nn.Linear(width, label_count)
            self.regression = nn.Linear(width, 1)

        def forward(self, features):
            tokens = self.value(features.unsqueeze(-1)) + self.feature_identity.unsqueeze(0)
            latent = self.normalization(self.backbone(tokens).mean(dim=1))
            return self.classification(latent), self.regression(latent).squeeze(-1)
    return SharedModel()


def train_unified(config: dict[str, Any], cancelled: threading.Event | None = None) -> dict[str, Any]:
    import torch
    from torch import nn
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    rows = config["rows"]
    labels = sorted({r["label"] for r in rows})
    units = sorted({r["subjectId"] for r in rows})
    width, feature_count = config["hiddenWidth"], len(rows[0]["features"])

    def check_cancelled():
        if cancelled and cancelled.is_set():
            raise InterruptedError("Unified model training cancelled.")

    def fit(train_rows, seed):
        check_cancelled()
        torch.manual_seed(seed)
        x = torch.tensor([r["features"] for r in train_rows], dtype=torch.float32)
        y = torch.tensor([labels.index(r["label"]) for r in train_rows], dtype=torch.long)
        observed = torch.tensor([r["outcome"] is not None for r in train_rows], dtype=torch.bool)
        # Zero is only a masked tensor placeholder, never a measured or imputed target.
        target = torch.tensor([r["outcome"] if r["outcome"] is not None else 0 for r in train_rows], dtype=torch.float32)
        train_units = sorted({r["subjectId"] for r in train_rows})
        counts = {u: sum(r["subjectId"] == u for r in train_rows) for u in train_units}
        unit_weight = torch.tensor([1 / (len(train_units) * counts[r["subjectId"]]) for r in train_rows])
        outcome_counts = {u: sum(r["subjectId"] == u and r["outcome"] is not None for r in train_rows) for u in train_units}
        outcome_weight = torch.tensor([1 / (len(train_units) * outcome_counts[r["subjectId"]]) if r["outcome"] is not None else 0 for r in train_rows])
        # Train-fold preprocessing gives each independent unit equal influence.
        mean = (x * unit_weight[:, None]).sum(0)
        scale = (((x - mean).square() * unit_weight[:, None]).sum(0)).sqrt().clamp_min(1e-6)
        outcome_mean = (target * outcome_weight).sum()
        outcome_scale = (((target - outcome_mean).square() * outcome_weight).sum()).sqrt().clamp_min(1e-6)
        x, target_scaled = (x - mean) / scale, (target - outcome_mean) / outcome_scale
        class_counts = {(u, label): sum(r["subjectId"] == u and r["label"] == label for r in train_rows) for u in train_units for label in labels}
        class_weight = torch.tensor([1 / (len(train_units) * len(labels) * class_counts[(r["subjectId"], r["label"])]) for r in train_rows])
        model = build_shared_model(feature_count, width, len(labels))
        optimizer = torch.optim.AdamW(model.parameters(), lr=0.003, weight_decay=0.0001)
        generator = torch.Generator().manual_seed(seed)
        model.train()
        last_loss = 0.0
        for epoch in range(config["epochs"]):
            indices = torch.randperm(len(train_rows), generator=generator)
            for batch in indices.split(64):
                check_cancelled()
                logits, predictions = model(x[batch])
                classification = (nn.functional.cross_entropy(logits, y[batch], reduction="none") * class_weight[batch]).sum()
                regression = ((predictions - target_scaled[batch]).square() * outcome_weight[batch]).sum()
                loss = (classification + 0.5 * regression) * len(train_rows) / len(batch)
                if not torch.isfinite(loss):
                    raise ValueError("Nonfinite training loss; review numeric scale and input data.")
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 5.0)
                optimizer.step()
                last_loss = float(loss.detach())
        ordered = sorted(zip(target[observed].tolist(), outcome_weight[observed].tolist()))
        cumulative, median = 0.0, ordered[-1][0]
        for value, weight in ordered:
            cumulative += weight
            if cumulative >= 0.5:
                median = value
                break
        linear_x = torch.cat([torch.ones(len(train_rows), 1), x], dim=1)
        gram = linear_x.T @ (linear_x * outcome_weight[:, None])
        ridge = torch.eye(feature_count + 1) * .001
        ridge[0, 0] = 0
        coefficients = torch.linalg.solve(gram + ridge, linear_x.T @ (target_scaled * outcome_weight))
        return model.eval(), {"feature_mean": mean.tolist(), "feature_scale": scale.tolist(),
                              "outcome_mean": float(outcome_mean), "outcome_scale": float(outcome_scale),
                              "outcome_weighted_median": median, "linear_ridge_coefficients": coefficients.tolist()}, last_loss

    def predict(model, preprocessing, test_rows):
        features = torch.tensor([r["features"] for r in test_rows], dtype=torch.float32)
        features = (features - torch.tensor(preprocessing["feature_mean"])) / torch.tensor(preprocessing["feature_scale"])
        with torch.no_grad():
            logits, target = model(features)
        return logits.argmax(1).tolist(), (target * preprocessing["outcome_scale"] + preprocessing["outcome_mean"]).tolist()

    folds = []
    for index, unit in enumerate(units):
        check_cancelled()
        training = [r for r in rows if r["subjectId"] != unit]
        testing = [r for r in rows if r["subjectId"] == unit]
        model, preprocessing, loss = fit(training, config["seed"] + index)
        predicted, outcomes = predict(model, preprocessing, testing)
        accuracy = sum(sum(predicted[i] == labels.index(label) for i, r in enumerate(testing) if r["label"] == label) /
                       sum(r["label"] == label for r in testing) for label in labels) / len(labels)
        rated = [i for i, r in enumerate(testing) if r["outcome"] is not None]
        mae = sum(abs(outcomes[i] - testing[i]["outcome"]) for i in rated) / len(rated)
        baseline_mae = sum(abs(preprocessing["outcome_mean"] - testing[i]["outcome"]) for i in rated) / len(rated)
        median_mae = sum(abs(preprocessing["outcome_weighted_median"] - testing[i]["outcome"]) for i in rated) / len(rated)
        coefficients = preprocessing["linear_ridge_coefficients"]
        linear = [(coefficients[0] + sum(coefficients[j + 1] * (r["features"][j] - preprocessing["feature_mean"][j]) / preprocessing["feature_scale"][j] for j in range(feature_count))) * preprocessing["outcome_scale"] + preprocessing["outcome_mean"] for r in testing]
        linear_mae = sum(abs(linear[i] - testing[i]["outcome"]) for i in rated) / len(rated)
        folds.append({"unitId": unit, "balanced_accuracy": accuracy, "regression_mae": mae,
                      "regression_baseline_mae": baseline_mae, "regression_median_baseline_mae": median_mae, "regression_ridge_baseline_mae": linear_mae,
                      "trainIds": [r["id"] for r in training], "testIds": [r["id"] for r in testing],
                      "observed_outcomes": len(rated), "outcomeTestIds": [testing[i]["id"] for i in rated],
                      "preprocessing": preprocessing, "last_training_batch_loss": loss})
    # Deployment checkpoint uses all admitted rows only after independent-unit evaluation.
    final, preprocessing, loss = fit(rows, config["seed"] + len(units))
    state = {key: tensor.detach().cpu().tolist() for key, tensor in final.state_dict().items()}
    observed_count = sum(r["outcome"] is not None for r in rows)
    coverage = {"observed": observed_count, "missing": len(rows) - observed_count,
                "by_label": {label: {"observed": sum(r["label"] == label and r["outcome"] is not None for r in rows),
                                     "total": sum(r["label"] == label for r in rows)} for label in labels},
                "rating_scope": config["outcome"].get("scope", "Only observed measurements; unmeasured targets are masked from normalization, regression loss and MAE.")}
    checkpoint = {"format": "morpheus-safe-json-state-dict-v1", "version": VERSION, "torch_version": torch.__version__,
                  "architecture": {"featureCount": feature_count, "hiddenWidth": width, "heads": 4, "layers": 1, "activation": "gelu"},
                  "featureNames": rows[0]["featureNames"], "labels": labels, "preprocessing": preprocessing,
                  "featureSchema": config["source"]["featureSchema"], "source": config["source"],
                  "outcome": config["outcome"], "outcome_coverage": coverage,
                  "training_config_sha256": hashlib.sha256(canonical(config).encode()).hexdigest(),
                  "training": {"seed": config["seed"], "epochs": config["epochs"], "objectives": {"classification": 1.0, "regression": 0.5},
                               "optimizer": "AdamW lr=0.003 weight_decay=0.0001", "independent_units": len(units), "rows": len(rows)},
                  "implementation_sha256": config.get("implementation_sha256") or IMPLEMENTATION_SHA256,
                  "contribution_manifest": config.get("contributionManifest"),
                  "state_dict": state, "fit_scope": "all admitted rows after held-out evaluation; no held-out inference claim for this final checkpoint"}
    accuracy = sum(f["balanced_accuracy"] for f in folds) / len(folds)
    rng = random.Random(config["seed"])
    distribution = sorted(sum(rng.choice(folds)["balanced_accuracy"] for _ in folds) / len(folds) for _ in range(1000))
    return {"version": VERSION, "balanced_accuracy": accuracy, "chance": 1 / len(labels),
            "ci95_accuracy_unit_bootstrap": [distribution[24], distribution[974]],
            "regression_mae": sum(f["regression_mae"] for f in folds) / len(folds),
            "regression_baseline_mae": sum(f["regression_baseline_mae"] for f in folds) / len(folds),
            "regression_median_baseline_mae": sum(f["regression_median_baseline_mae"] for f in folds) / len(folds),
            "regression_ridge_baseline_mae": sum(f["regression_ridge_baseline_mae"] for f in folds) / len(folds),
            "independent_units": len(units), "rows": len(rows), "folds": folds,
            "training": {"epochs": config["epochs"], "hiddenWidth": width, "parameters": sum(p.numel() for p in final.parameters()),
                         "objectives": ["equal-unit/class cross entropy on all labeled rows", "0.5 × equal-unit train-scaled outcome MSE on observed measurements only"],
                         "optimizer": "AdamW lr=0.003 weight_decay=0.0001", "last_training_batch_loss": loss,
                         "execution": "deterministic CPU, one torch thread, fixed epochs; no test-fold tuning"},
            "observed_outcomes": observed_count, "outcome_coverage": coverage,
            "evidence_level": "engineering-fixture" if config["source"]["kind"] == "synthetic" else "public-recording-engineering-pilot",
            "checkpoint": checkpoint, "checkpoint_sha256": hashlib.sha256(canonical(checkpoint).encode()).hexdigest(),
            "limitations": ["This tested pilot shares one learned representation across two tasks; it is not a trained human brain, dream-video or disease-treatment model.",
                            "Six units is an input floor, not adequate-power assurance. The unit bootstrap describes held-out-unit score spread with overlapping training folds; it does not refit models or capture full training uncertainty.",
                            "No inferential significance or randomization claim is made for this model evaluation; repeated model selection needs nested held-out units.",
                            "Outcome supervision and MAE cover observed ratings only. Missingness may depend on report category; predictions for unrated categories are extrapolations, not evidence of an absent experience or a zero rating.",
                            "Pre-task-event or pre-awakening timing and source declarations require independent audit; they do not verify optical onset, report validity or absence of experimental confounds.",
                            "Predicting a change score from baseline can reflect mathematical coupling; assess a post-event-only target and baseline-adjusted controls before biological interpretation.",
                            "Fixed schema supports numerical feature tokens. Report, image, audio and temporal encoders require aligned licensed data and tested adapters before admission.",
                            "Thousands of contributions can be registered, but only reviewed implemented objective bindings affect training. Paper metadata is not model knowledge."]}


def predict_shared(checkpoint: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Restore only the known JSON architecture; never deserialize executable weights."""
    import torch
    if not isinstance(checkpoint, dict) or checkpoint.get("format") != "morpheus-safe-json-state-dict-v1" or checkpoint.get("version") not in (VERSION, "morpheus-shared-representation-1.0.0"):
        raise ValueError("Unsupported shared-model JSON checkpoint format or version.")
    architecture = checkpoint.get("architecture")
    names, labels = checkpoint.get("featureNames"), checkpoint.get("labels")
    if not isinstance(names, list) or not 1 <= len(names) <= 32 or any(not isinstance(v, str) or not v or len(v) > 128 for v in names) or len(set(names)) != len(names):
        raise ValueError("Invalid checkpoint feature schema.")
    if not isinstance(labels, list) or not 2 <= len(labels) <= 8 or any(not isinstance(v, str) or not v or len(v) > 128 for v in labels) or len(set(labels)) != len(labels):
        raise ValueError("Invalid checkpoint labels.")
    if not isinstance(architecture, dict) or type(architecture.get("hiddenWidth")) is not int or architecture["hiddenWidth"] not in (16, 32, 64) or architecture != {"featureCount": len(names), "hiddenWidth": architecture["hiddenWidth"], "heads": 4, "layers": 1, "activation": "gelu"}:
        raise ValueError("Checkpoint architecture is outside the reviewed bounds.")
    if not isinstance(payload, dict) or payload.get("featureSchema") != checkpoint.get("featureSchema") or payload.get("featureNames") != names or not isinstance(checkpoint.get("featureSchema"), str):
        raise ValueError("Prediction data must match the exact checkpoint feature schema and ordered names.")
    rows = payload.get("rows")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 256:
        raise ValueError("Prediction accepts 1–256 feature rows.")
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"] or len(row["id"]) > 128 or not isinstance(row.get("features"), list) or len(row["features"]) != len(names) or any(isinstance(v, bool) or not isinstance(v, (int, float)) or abs(v) > 1e6 or not math.isfinite(v) for v in row["features"]):
            raise ValueError("Every prediction row requires an ID and bounded finite numeric features.")
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Prediction IDs must be unique.")
    preprocessing = checkpoint.get("preprocessing")
    if not isinstance(preprocessing, dict):
        raise ValueError("Checkpoint has no preprocessing.")
    for key in ("feature_mean", "feature_scale"):
        values = preprocessing.get(key)
        if not isinstance(values, list) or len(values) != len(names) or any(isinstance(v, bool) or not isinstance(v, (float, int)) or abs(v) > 1e12 or not math.isfinite(v) for v in values):
            raise ValueError("Invalid checkpoint preprocessing.")
    if any(v < .999e-6 for v in preprocessing["feature_scale"]):
        raise ValueError("Checkpoint scales must be positive.")
    for key in ("outcome_mean", "outcome_scale"):
        value = preprocessing.get(key)
        if isinstance(value, bool) or not isinstance(value, (float, int)) or abs(value) > 1e12 or not math.isfinite(value) or (key == "outcome_scale" and value < .999e-6):
            raise ValueError("Invalid checkpoint outcome preprocessing.")
    torch.set_num_threads(1)
    model = build_shared_model(len(names), architecture["hiddenWidth"], len(labels))
    raw = checkpoint.get("state_dict")
    expected = model.state_dict()
    if not isinstance(raw, dict) or set(raw) != set(expected):
        raise ValueError("Checkpoint tensors do not match the known model.")
    restored = {}
    for key, template in expected.items():
        try:
            tensor = torch.tensor(raw[key], dtype=torch.float32)
        except (TypeError, ValueError, RuntimeError, OverflowError) as error:
            raise ValueError("Invalid checkpoint tensor values.") from error
        if tensor.shape != template.shape or not torch.isfinite(tensor).all() or tensor.abs().max() > 1e6:
            raise ValueError("Checkpoint tensor shape or values are invalid.")
        restored[key] = tensor
    model.load_state_dict(restored, strict=True)
    model.eval()
    x = torch.tensor([r["features"] for r in rows], dtype=torch.float32)
    x = (x - torch.tensor(preprocessing["feature_mean"])) / torch.tensor(preprocessing["feature_scale"])
    with torch.no_grad():
        logits, outcomes = model(x)
        probabilities = logits.softmax(-1).tolist()
        measured = (outcomes * preprocessing["outcome_scale"] + preprocessing["outcome_mean"]).tolist()
    if any(not math.isfinite(value) for value in measured) or any(not math.isfinite(value) for values in probabilities for value in values):
        raise ValueError("Nonfinite inference output; review input scale.")
    coverage = checkpoint.get("outcome_coverage")
    if checkpoint["version"] == VERSION and coverage is None:
        raise ValueError("Checkpoint must preserve observed outcome coverage.")
    if coverage is not None and (not isinstance(coverage, dict) or not isinstance(coverage.get("by_label"), dict) or set(coverage["by_label"]) != set(labels) or any(not isinstance(c, dict) or type(c.get("observed")) is not int or type(c.get("total")) is not int or not 0 <= c["observed"] <= c["total"] for c in coverage["by_label"].values())):
        raise ValueError("Invalid checkpoint outcome coverage.")
    return {"model": "morpheus-shared-encoder", "version": checkpoint["version"], "featureSchema": checkpoint["featureSchema"],
            "predictions": [{"id": row["id"], "label": labels[max(range(len(labels)), key=lambda j: probabilities[i][j])],
                             "probabilities": dict(zip(labels, probabilities[i])), "outcome": measured[i],
                             "outcome_extrapolation": coverage is None or coverage["by_label"][labels[max(range(len(labels)), key=lambda j: probabilities[i][j])]]["observed"] == 0,
                             "outcome_scope": coverage.get("rating_scope", "Observed measurements only") if coverage else "Legacy checkpoint does not record outcome coverage; scope requires review."} for i, row in enumerate(rows)],
            "interpretation": "Final all-data checkpoint predictions. Evaluation requires independent new units; these outputs are not a held-out or biological validation claim."}
