import copy
import hashlib
import json
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/signal-gateway"))
from app.unified_model import dependency_available, validate_unified_request, train_unified, predict_shared


def fixture():
    return {"source": {"kind": "synthetic", "datasetId": "shared-encoder-test", "datasetVersion": "1", "license": "engineering-fixture", "featureSchema": "pre-event-v1"},
            "design": {"inputTiming": "pre-task-event", "assignment": "observational", "independentUnitsConfirmed": True}, "epochs": 40, "hiddenWidth": 16, "seed": 2026,
            "rows": [{"id": f"u{u}-r{r}", "subjectId": f"u{u}", "sessionId": f"s{u}", "label": "low" if r < 4 else "high",
                      "features": [(r - 3.5) / 2 + u * 0.01, (r % 3 - 1) / 2], "featureNames": ["pre_event_a", "pre_event_b"],
                      "outcome": 2 * ((r - 3.5) / 2 + u * 0.01) + 0.3 * (r % 3 - 1) / 2} for u in range(6) for r in range(8)]}


@unittest.skipUnless(dependency_available(), "optional local torch runtime is not installed")
class SharedEncoderTests(unittest.TestCase):
    def test_joint_learning_unit_holdout_and_checkpoint_integrity(self):
        config = validate_unified_request(fixture())
        result = train_unified(config)
        self.assertEqual(result["checkpoint"]["outcome"], {"name": "engineered response", "unit": "arbitrary units"})
        self.assertEqual(result["independent_units"], 6)
        self.assertGreaterEqual(result["balanced_accuracy"], .9)
        self.assertLess(result["regression_mae"], result["regression_baseline_mae"] * .5)
        self.assertEqual(result["evidence_level"], "engineering-fixture")
        self.assertEqual(len(result["training"]["objectives"]), 2)
        for fold in result["folds"]:
            self.assertFalse(set(fold["trainIds"]) & set(fold["testIds"]))
            self.assertTrue(all(identifier.startswith(fold["unitId"] + "-") for identifier in fold["testIds"]))
            expected = [r for r in config["rows"] if r["subjectId"] != fold["unitId"]]
            mean = sum(r["features"][0] for r in expected) / len(expected)
            self.assertAlmostEqual(fold["preprocessing"]["feature_mean"][0], mean, places=5)
        digest = hashlib.sha256(json.dumps(result["checkpoint"], sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        self.assertEqual(result["checkpoint_sha256"], digest)
        repeated = train_unified(config)
        self.assertEqual(result["checkpoint_sha256"], repeated["checkpoint_sha256"])

    def test_invalid_timing_schema_units_targets_and_work_budget(self):
        changes = [lambda p: p["design"].update(inputTiming="post-event"),
                   lambda p: p["rows"][0].update(featureNames=["outcome", "b"]),
                   lambda p: p["rows"][0].update(id=p["rows"][1]["id"]),
                   lambda p: p["rows"][0].update(features=[float("nan"), 0]),
                   lambda p: p.update(epochs=True),
                   lambda p: p.update(hiddenWidth=16.0),
                   lambda p: p["rows"][0].update(features=[10 ** 400, 0]),
                   lambda p: p["rows"][0].update(outcome=10 ** 400),
                   lambda p: p["design"].update(independentUnitsConfirmed=False),
                   lambda p: p.update(rows=p["rows"][:40])]
        for change in changes:
            payload = copy.deepcopy(fixture())
            change(payload)
            with self.assertRaises(ValueError):
                validate_unified_request(payload)

    def test_cancellation_prevents_training(self):
        event = threading.Event()
        event.set()
        with self.assertRaises(InterruptedError):
            train_unified(validate_unified_request(fixture()), event)

    def test_missing_ratings_do_not_enter_scaling_controls_loss_or_mae(self):
        payload = fixture()
        payload["design"]["inputTiming"] = "pre-awakening"
        payload["outcome"] = {"name": "Measured rating", "unit": "score", "scope": "Rated high reports only"}
        for row in payload["rows"]:
            if row["label"] == "low":
                row["outcome"] = None
        config = validate_unified_request(payload)
        self.assertEqual(config["design"]["inputTiming"], "pre-awakening")
        result = train_unified(config)
        self.assertEqual(result["observed_outcomes"], 24)
        self.assertEqual(result["outcome_coverage"]["by_label"]["low"], {"observed": 0, "total": 24})
        self.assertEqual(result["checkpoint"]["outcome_coverage"]["rating_scope"], "Rated high reports only")
        for fold in result["folds"]:
            train = [r for r in payload["rows"] if r["subjectId"] != fold["unitId"] and r["outcome"] is not None]
            self.assertAlmostEqual(fold["preprocessing"]["outcome_mean"], sum(r["outcome"] for r in train) / len(train), places=5)
            self.assertEqual(fold["observed_outcomes"], 4)
            self.assertEqual(len(fold["outcomeTestIds"]), 4)
        predicted = predict_shared(result["checkpoint"], {"featureSchema": config["source"]["featureSchema"],
                    "featureNames": payload["rows"][0]["featureNames"], "rows": [{"id": "new-low", "features": payload["rows"][0]["features"]}]})
        self.assertEqual(predicted["predictions"][0]["label"], "low")
        self.assertTrue(predicted["predictions"][0]["outcome_extrapolation"])
        invalid = copy.deepcopy(payload)
        for row in invalid["rows"]:
            if row["subjectId"] == "u0" and row["id"] != "u0-r7":
                row["outcome"] = None
        with self.assertRaisesRegex(ValueError, "two observed"):
            validate_unified_request(invalid)
        absent = copy.deepcopy(payload)
        del absent["rows"][0]["outcome"]
        with self.assertRaisesRegex(ValueError, "explicit null"):
            validate_unified_request(absent)


if __name__ == "__main__":
    unittest.main()
