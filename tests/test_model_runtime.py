import importlib.util
import pathlib
import tempfile
import threading
import time
import unittest

path = pathlib.Path(__file__).parents[1] / "services/signal-gateway/app/model_runtime.py"
spec = importlib.util.spec_from_file_location("model_runtime", path)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def dataset():
    return [{"id": f"{session}-{label}-{repeat}", "subjectId": "anonymous", "sessionId": session,
             "label": label, "features": [offset + repeat / 20, offset * 2 + repeat / 20],
             "featureNames": ["alpha", "rms"], "sourceMode": "simulation"}
            for session in ("s1", "s2", "s3") for label, offset in (("awake", -5), ("imagery", 5)) for repeat in range(2)]


class ModelTests(unittest.TestCase):
    def test_session_splits_seed_and_null(self):
        config = runtime.validate_request({"rows": dataset(), "permutations": 20, "seed": 99})
        first = runtime.evaluate(config)
        self.assertEqual(first, runtime.evaluate(config))
        self.assertEqual(first["balanced_accuracy"], 1)
        self.assertLess(first["null_mean"], first["balanced_accuracy"])
        self.assertEqual(first["evidence_level"], "engineering-evaluation")
        for fold in first["folds"]:
            self.assertFalse(set(fold["train_ids"]) & set(fold["test_ids"]))
            self.assertTrue(all(identifier.startswith(fold["session"]) for identifier in fold["test_ids"]))
        config["model"] = "diagonal-lda"
        self.assertEqual(runtime.evaluate(config)["balanced_accuracy"], 1)

    def test_rejects_leakage_and_incompatible_features(self):
        for mutate in (
            lambda rows: rows[0].update(features=[float("nan"), 1]),
            lambda rows: rows[0].update(featureNames=["x", "y"]),
            lambda rows: rows[0].update(subjectId="other"),
            lambda rows: rows[0].update(id=rows[1]["id"]),
            lambda rows: [row.update(sessionId="s1") for row in rows],
            lambda rows: [row.update(label="awake") for row in rows if row["sessionId"] == "s1"],
        ):
            rows = dataset()
            mutate(rows)
            with self.assertRaises(ValueError):
                runtime.validate_request({"rows": rows})

    def test_cancellation(self):
        event = threading.Event()
        event.set()
        with self.assertRaises(InterruptedError):
            runtime.evaluate(runtime.validate_request({"rows": dataset()}), event)

    def test_durable_manifest_and_restart(self):
        with tempfile.TemporaryDirectory() as root:
            engine = runtime.LocalModelRuntime(pathlib.Path(root))
            run = engine.submit({"rows": dataset(), "permutations": 20})
            for _ in range(200):
                stored = engine.get(run["id"])
                if stored["status"] in ("COMPLETED", "FAILED"):
                    break
                time.sleep(0.01)
            engine.close()
            self.assertEqual(stored["status"], "COMPLETED")
            self.assertEqual(len(stored["output_sha256"]), 64)
            self.assertEqual([e["status"] for e in stored["events"]], ["QUEUED", "RUNNING", "COMPLETED"])
            engine = runtime.LocalModelRuntime(pathlib.Path(root))
            self.assertEqual(engine.get(run["id"])["result"], stored["result"])
            engine.close()


if __name__ == "__main__":
    unittest.main()
