"""Prediction CLI admission and actual trained-checkpoint round-trip tests."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "services/signal-gateway/tools/model_predict.py"
sys.path.insert(0, str(ROOT / "services/signal-gateway"))
from app.unified_model import dependency_available, validate_unified_request, train_unified

spec = importlib.util.spec_from_file_location("morpheus_model_predict_cli", CLI)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class PredictionAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.directory = Path(self.workspace.name)
        self.checkpoint = self.directory / "checkpoint.json"
        self.input = self.directory / "input.json"
        self.output = self.directory / "predictions.json"
        self.checkpoint.write_text('{"format":"not-trained"}')
        self.input.write_text(json.dumps({"featureSchema": "pre-event-v1", "featureNames": ["pre_event_a"], "rows": [{"id": "prediction-1", "features": [0.25]}]}))

    def invoke(self, digest):
        return subprocess.run([sys.executable, str(CLI), "--checkpoint", str(self.checkpoint),
                               "--checkpoint-sha256", digest, "--input", str(self.input), "--output", str(self.output)],
                              capture_output=True, text=True, timeout=30)

    def digest(self):
        return hashlib.sha256(cli.canonical_bytes(json.loads(self.checkpoint.read_text()))).hexdigest()

    def test_hash_rejection_precedes_model_loading_and_never_writes(self):
        result = self.invoke("0" * 64)
        self.assertEqual(result.returncode, 2)
        self.assertIn("does not match", result.stderr)
        self.assertFalse(self.output.exists())
        self.assertNotIn(str(self.directory), result.stderr)
        self.assertNotIn("prediction-1", result.stderr)

    def test_oversized_input_and_checkpoint_are_rejected_without_output(self):
        self.input.write_bytes(b" " * (cli.MAX_BYTES + 1))
        result = self.invoke(self.digest())
        self.assertEqual(result.returncode, 2)
        self.assertIn("Prediction input exceeds", result.stderr)
        self.assertFalse(self.output.exists())
        self.checkpoint.write_bytes(b" " * (cli.MAX_BYTES + 1))
        result = self.invoke("0" * 64)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Checkpoint exceeds", result.stderr)
        self.assertFalse(self.output.exists())

    def test_json_duplicate_keys_and_nonfinite_numbers_are_rejected(self):
        for content in ('{"featureSchema":"a","featureSchema":"b"}', '{"value":NaN}'):
            self.input.write_text(content)
            result = self.invoke(self.digest())
            self.assertEqual(result.returncode, 2)
            self.assertFalse(self.output.exists())

    def test_prediction_bounds_and_unknown_fields_are_rejected(self):
        valid = {"featureSchema": "pre-event-v1", "featureNames": ["a"], "rows": [{"id": "p", "features": [0]}]}
        changes = [lambda p: p.update(rows=p["rows"] * 257),
                   lambda p: p["rows"][0].update(features=[True]),
                   lambda p: p["rows"][0].update(features=[1000001]),
                   lambda p: p["rows"][0].update(features=[10 ** 400]),
                   lambda p: p["rows"][0].update(features=[0, 1]),
                   lambda p: p.update(model="unreviewed-model"),
                   lambda p: p["rows"][0].update(outcome=1)]
        for mutate in changes:
            payload = json.loads(json.dumps(valid))
            mutate(payload)
            with self.assertRaises(cli.PredictionCliError):
                cli.validate_payload(payload)

    def test_output_is_exclusive_and_private(self):
        cli.write_exclusive(self.output, {"predictions": []})
        original = self.output.read_bytes()
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        with self.assertRaises(cli.PredictionCliError):
            cli.write_exclusive(self.output, {"predictions": [{"private": "replacement"}]})
        self.assertEqual(self.output.read_bytes(), original)


@unittest.skipUnless(dependency_available(), "optional local torch runtime is not installed")
class PredictionRoundTripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = {"source": {"kind": "synthetic", "datasetId": "prediction-cli-fixture", "datasetVersion": "1", "license": "engineering-fixture", "featureSchema": "pre-event-v1"},
                       "design": {"inputTiming": "pre-task-event", "assignment": "observational", "independentUnitsConfirmed": True},
                       "outcome": {"name": "Engineered response", "unit": "arbitrary units"},
                       "epochs": 10, "hiddenWidth": 16, "seed": 2026,
                       "rows": [{"id": f"u{unit}-r{trial}", "subjectId": f"u{unit}", "sessionId": f"s{unit}", "label": "low" if trial < 4 else "high",
                                 "features": [(trial - 3.5) / 2 + unit * .01, (trial % 3 - 1) / 2], "featureNames": ["pre_event_a", "pre_event_b"],
                                 "outcome": trial / 2} for unit in range(6) for trial in range(8)]}
        cls.result = train_unified(validate_unified_request(cls.fixture))

    def test_actual_checkpoint_cli_predictions_match_direct_runtime(self):
        from app.unified_model import predict_shared
        checkpoint = self.result["checkpoint"]
        self.assertEqual(checkpoint["outcome"], self.fixture["outcome"])
        payload = {"featureSchema": self.fixture["source"]["featureSchema"], "featureNames": ["pre_event_a", "pre_event_b"],
                   "rows": [{"id": "new-measurement-a", "features": [-1, .25]}, {"id": "new-measurement-b", "features": [1, -.25]}]}
        expected = predict_shared(checkpoint, payload)
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            checkpoint_path, input_path, output_path = [directory / name for name in ("checkpoint.json", "input.json", "predictions.json")]
            # Pretty printing does not change the canonical checkpoint hash.
            checkpoint_path.write_text(json.dumps(checkpoint, indent=2))
            input_path.write_text(json.dumps(payload))
            command = [sys.executable, str(CLI), "--checkpoint", str(checkpoint_path), "--checkpoint-sha256", self.result["checkpoint_sha256"],
                       "--input", str(input_path), "--output", str(output_path)]
            completed = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(json.loads(output_path.read_text()), expected)
            self.assertNotIn("new-measurement", completed.stdout)
            original = output_path.read_bytes()
            repeated = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertEqual(repeated.returncode, 2)
            self.assertEqual(output_path.read_bytes(), original)
            input_path.write_text(json.dumps({**payload, "featureSchema": "different-source-schema"}))
            command[-1] = str(directory / "invalid-predictions.json")
            invalid = subprocess.run(command, capture_output=True, text=True, timeout=30)
            self.assertEqual(invalid.returncode, 2)
            self.assertFalse((directory / "invalid-predictions.json").exists())


if __name__ == "__main__":
    unittest.main()
