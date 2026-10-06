"""HTTP and local-resource boundaries for opt-in persistent scientific jobs."""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "services/signal-gateway"))
try:
    from fastapi.testclient import TestClient
    import httpx  # TestClient's optional dependency; skip in standard-library-only environments.
    from app import main, model_api, model_runtime
    HAVE_API = True
except ImportError:
    HAVE_API = False


def dataset():
    return [{"id": f"{session}-{label}-{repeat}", "subjectId": "anonymous-test", "sessionId": session,
             "label": label, "features": [offset + repeat / 20, offset * 2 + repeat / 20],
             "featureNames": ["alpha", "rms"], "sourceMode": "simulation",
             "sourceKind": "simulation_fixture", "featureSchema": "test-features-v1", "sampleRate": 256,
             "channelCount": 1}
            for session in ("s1", "s2", "s3") for label, offset in (("awake", -5), ("imagery", 5))
            for repeat in range(2)]


@unittest.skipUnless(HAVE_API, "FastAPI/httpx are optional for the stdlib-only test environment")
class ModelApiTests(unittest.TestCase):
    def setUp(self):
        model_api.close_runtime()
        self.directory = tempfile.TemporaryDirectory()
        self.environment = mock.patch.dict(os.environ, {
            "MORPHEUS_MODEL_RUN_DIR": self.directory.name, "VERCEL": "0", "MORPHEUS_ALLOWED_ORIGINS": "",
            "MORPHEUS_NATIVE_UDP_BIND": "",
        })
        self.environment.start()
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        model_api.close_runtime()
        self.client.close()
        self.environment.stop()
        self.directory.cleanup()

    def submit(self, **kwargs):
        return self.client.post("/models/runs", json={"rows": dataset(), "permutations": 20, **kwargs})

    def terminal(self, identifier):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            response = self.client.get(f"/models/runs/{identifier}")
            self.assertEqual(response.status_code, 200, response.text)
            if response.json()["status"] in {"COMPLETED", "FAILED", "CANCELLED"}:
                return response.json()
            time.sleep(0.01)
        self.fail("A bounded reference model job did not reach a terminal state.")

    def test_router_integration_and_explicit_local_only_enablement(self):
        self.assertEqual(self.client.get("/models/registry").status_code, 200)
        self.assertTrue(self.client.get("/models/registry").json()["enabled"])
        with mock.patch.dict(os.environ, {"MORPHEUS_MODEL_RUN_DIR": ""}):
            self.assertFalse(self.client.get("/models/registry").json()["enabled"])
            self.assertEqual(self.client.get("/models/runs").status_code, 409)
            self.assertEqual(self.submit().status_code, 409)
        with mock.patch.dict(os.environ, {"VERCEL": "1"}):
            self.assertFalse(self.client.get("/models/registry").json()["enabled"])
            self.assertEqual(self.client.get("/models/runs").status_code, 409)
            self.assertEqual(self.submit().status_code, 409)
        self.assertFalse((pathlib.Path(self.directory.name) / "model-runs.sqlite3").exists())

    def test_foreign_origins_cannot_read_write_or_cancel_private_runs(self):
        foreign = {"origin": "https://untrusted.example"}
        for method, path, kwargs in [
            ("get", "/models/runs", {}), ("get", "/models/runs/arbitrary-id", {}),
            ("post", "/models/runs", {"json": {"rows": dataset(), "permutations": 20}}),
            ("post", "/models/runs/arbitrary-id/cancel", {}),
        ]:
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path, headers=foreign, **kwargs)
                self.assertEqual(response.status_code, 403, response.text)
        self.assertIsNone(model_api._runtime)
        for origin in ["http://localhost:3000", "http://127.0.0.1:8000", "http://[::1]:3000", "https://morpheus-three.vercel.app"]:
            self.assertEqual(self.client.get("/models/runs", headers={"origin": origin}).status_code, 200)
        self.assertEqual(self.client.get("/models/runs", headers={"origin": "http://localhost.evil.example"}).status_code, 403)
        self.assertEqual(self.client.get("/models/runs", headers={"origin": "http://[invalid-ipv6]"}).status_code, 403)

    def test_registry_and_run_listing_never_include_feature_data(self):
        payload = self.submit()
        self.assertEqual(payload.status_code, 202, payload.text)
        self.assertNotIn("config", payload.json())
        complete = self.terminal(payload.json()["id"])
        self.assertEqual(complete["status"], "COMPLETED")
        listing = self.client.get("/models/runs").json()["runs"]
        self.assertNotIn("config", listing[0])
        self.assertNotIn("result", listing[0])
        registry = self.client.get("/models/registry").json()
        self.assertNotIn("anonymous-test", json.dumps(registry))
        self.assertNotIn("s1-awake-0", json.dumps(listing))

    def test_invalid_json_and_shapes_are_422_and_oversize_is_413(self):
        for body in ["not-json", "[]", "null", "42", '{}', '{"rows":"not-array"}']:
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/models/runs", content=body).status_code, 422)
        huge = self.client.post("/models/runs", content=b"x" * (4 * 1024 * 1024 + 1))
        self.assertEqual(huge.status_code, 413)
        self.assertEqual(self.client.get("/models/runs").json()["runs"], [])

    def test_invalid_features_and_leakage_designs_never_create_runs(self):
        mutations = [
            lambda rows: rows[0].update(features=[True, 1]),
            lambda rows: rows[0].update(features=[1e13, 1]),
            lambda rows: rows[0].update(featureNames=["alpha", "alpha"]),
            lambda rows: rows[0].update(featureNames=["wrong", "rms"]),
            lambda rows: rows[0].update(subjectId="other-subject"),
            lambda rows: rows[0].update(id=rows[1]["id"]),
            lambda rows: [row.update(sessionId="one-session") for row in rows],
            lambda rows: [row.update(label="awake") for row in rows if row["sessionId"] == "s1"],
        ]
        for mutation in mutations:
            rows = dataset()
            mutation(rows)
            with self.subTest(mutation=mutation):
                response = self.client.post("/models/runs", json={"rows": rows, "permutations": 20})
                self.assertEqual(response.status_code, 422, response.text)
        for additional in [{"permutations": True}, {"permutations": 19}, {"seed": True}, {"model": "invented-model"}]:
            self.assertEqual(self.submit(**additional).status_code, 422)
        self.assertEqual(self.client.get("/models/runs").json()["runs"], [])

    def test_mixed_source_and_sample_schemas_are_rejected(self):
        mutations = [
            lambda row: row.update(sourceMode="live", sourceKind="local_acquisition_unverified"),
            lambda row: row.update(featureSchema="incompatible-features-v9"),
            lambda row: row.update(sampleRate=512),
            lambda row: row.update(channelCount=2),
        ]
        for mutation in mutations:
            rows = dataset()
            mutation(rows[0])
            with self.subTest(mutation=mutation):
                response = self.client.post("/models/runs", json={"rows": rows, "permutations": 20})
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get("/models/runs").json()["runs"], [])

    def test_known_source_mode_contradictions_and_invalid_provenance_are_422(self):
        mutations = [
            lambda row: row.update(sourceMode="live", sourceKind="simulation_fixture"),
            lambda row: row.update(sourceKind="invented-provenance"),
            lambda row: row.update(sampleRate=True),
            lambda row: row.update(channelCount=0),
        ]
        for mutation in mutations:
            rows = dataset()
            for row in rows: mutation(row)
            with self.subTest(mutation=mutation):
                response = self.client.post("/models/runs", json={"rows": rows, "permutations": 20})
                self.assertEqual(response.status_code, 422, response.text)
        rows = dataset()
        rows[0]["features"][0] = 10 ** 500
        self.assertEqual(self.client.post("/models/runs", content=json.dumps({"rows": rows, "permutations": 20})).status_code, 422)

    def test_queue_bound_and_cancellation_releases_capacity(self):
        entered = threading.Event()
        release = threading.Event()
        original_evaluate = model_runtime.evaluate
        def bounded_slow_evaluate(config, cancelled=None):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("Test evaluator timeout")
            return original_evaluate(config, cancelled)
        with mock.patch.object(model_runtime, "evaluate", side_effect=bounded_slow_evaluate):
            first = self.submit()
            self.assertEqual(first.status_code, 202)
            self.assertTrue(entered.wait(1))
            try:
                queued = [self.submit() for _ in range(3)]
                self.assertTrue(all(response.status_code == 202 for response in queued))
                self.assertEqual(self.submit().status_code, 429)
                cancellation = self.client.post(f'/models/runs/{queued[-1].json()["id"]}/cancel')
                self.assertEqual(cancellation.status_code, 200)
                self.assertTrue(cancellation.json()["cancellation_requested"])
                self.assertEqual(self.client.post("/models/runs/no-such-run/cancel").status_code, 404)
            finally:
                release.set()
            self.assertEqual(self.terminal(queued[-1].json()["id"])["status"], "CANCELLED")
            for response in [first, *queued]: self.terminal(response.json()["id"])
        next_run = self.submit()
        self.assertEqual(next_run.status_code, 202)
        self.assertEqual(self.terminal(next_run.json()["id"])["status"], "COMPLETED")

    def test_completed_manifests_are_immutable_and_hashes_match(self):
        submitted = self.submit(model="diagonal-lda", seed=17)
        self.assertEqual(submitted.status_code, 202, submitted.text)
        identifier = submitted.json()["id"]
        completed = self.terminal(identifier)
        self.assertEqual(completed["status"], "COMPLETED")
        self.assertEqual(completed["input_sha256"], hashlib.sha256(model_runtime.canonical(completed["config"]).encode()).hexdigest())
        self.assertEqual(completed["output_sha256"], hashlib.sha256(model_runtime.canonical(completed["result"]).encode()).hexdigest())
        self.assertIn("featureSchema", completed["config"]["rows"][0])
        for method in ("put", "patch", "delete"):
            self.assertEqual(getattr(self.client, method)(f"/models/runs/{identifier}").status_code, 405)
        cancelled = self.client.post(f"/models/runs/{identifier}/cancel")
        self.assertFalse(cancelled.json()["cancellation_requested"])
        completed["config"]["rows"][0]["features"][0] = 999  # Local response mutation cannot alter persisted state.
        self.assertEqual(self.client.get(f"/models/runs/{identifier}").json()["output_sha256"], completed["output_sha256"])
        self.assertNotEqual(self.client.get(f"/models/runs/{identifier}").json()["config"]["rows"][0]["features"][0], 999)

    def test_artifact_exports_preserve_sealed_numeric_bytes_and_private_boundaries(self):
        identifier = self.submit().json()["id"]
        completed = self.terminal(identifier)
        response = self.client.get(f"/models/runs/{identifier}/export")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.text, model_runtime.canonical(completed))
        checkpoint = {"format": "numeric-serialization-test", "values": [0.0, 1.0, 1e-7]}
        with mock.patch.object(model_api._runtime, "get", return_value={"status": "COMPLETED", "result": {"checkpoint": checkpoint}}):
            exported = self.client.get(f"/models/runs/{identifier}/checkpoint")
            self.assertEqual(exported.text, model_runtime.canonical(checkpoint))
            self.assertIn("0.0", exported.text)
            self.assertEqual(hashlib.sha256(exported.content).hexdigest(), hashlib.sha256(model_runtime.canonical(checkpoint).encode()).hexdigest())
        self.assertEqual(self.client.get(f"/models/runs/{identifier}/checkpoint").status_code, 409)
        self.assertEqual(self.client.get("/models/runs/missing/export").status_code, 404)
        self.assertEqual(self.client.get(f"/models/runs/{identifier}/export", headers={"Origin": "https://unknown.example"}).status_code, 403)
        with mock.patch.dict(os.environ, {"VERCEL": "1"}):
            self.assertEqual(self.client.get(f"/models/runs/{identifier}/export").status_code, 409)

    def test_storage_failure_is_structured_and_does_not_consume_queue_slots(self):
        # Initialize before injecting SQL faults, so this targets persistence rather than directory setup.
        self.assertEqual(self.client.get("/models/runs").status_code, 200)
        runtime = model_api._runtime
        with mock.patch.object(runtime, "save", side_effect=sqlite3.OperationalError("private-test-storage-path")):
            response = self.submit()
        self.assertEqual(response.status_code, 503, response.text)
        self.assertNotIn("private-test-storage-path", response.text)
        self.assertIsInstance(response.json().get("detail"), str)
        next_run = self.submit()
        self.assertEqual(next_run.status_code, 202, next_run.text)
        self.assertEqual(self.terminal(next_run.json()["id"])["status"], "COMPLETED")

    def test_reviewed_recipe_provenance_is_saved_and_arbitrary_paper_methods_are_rejected(self):
        envelope = {"id": "m3-nearest-centroid-v1", "version": "1.0.0", "adapterId": "nearest-centroid", "sourcePaperIds": ["horikawa-2013", "wong-2025"]}
        run = self.submit(recipe=envelope)
        self.assertEqual(run.status_code, 202, run.text)
        completed = self.terminal(run.json()["id"])
        self.assertEqual(completed["config"]["recipe"], envelope)
        for tampered in [{**envelope, "id": "llm-invented-paper-method"}, {**envelope, "version": "9.0.0"}, {**envelope, "sourcePaperIds": ["invented-citation"]}]:
            self.assertEqual(self.submit(recipe=tampered).status_code, 422)
        self.assertEqual(self.submit(method="arbitrary-paper-code").status_code, 422)

    def test_paired_perturbation_recipe_runs_through_the_same_bounded_local_job_api(self):
        rows = [{"trialId": f"unit-{unit}-{condition}-{repeat}", "unitId": f"unit-{unit}", "sessionId": "session-1", "condition": condition,
                 "outcome": unit * .1 + (1 if condition == "stimulated" else 0), "qcPassed": True}
                for unit in range(6) for condition in ("stimulated", "sham") for repeat in range(2)]
        envelope = {"id": "causal-paired-contrast-v1", "version": "1.0.0", "adapterId": "causal-perturbation", "sourcePaperIds": ["boyden-2005", "ryan-2015", "marshel-2019"]}
        payload = {"method": "causal-perturbation", "recipe": envelope, "rows": rows,
                   "source": {"kind": "synthetic", "datasetId": "api-test-fixture", "datasetVersion": "1"},
                   "design": {"assignment": "observational", "independentUnitsConfirmed": True}, "outcome": {"name": "synthetic response", "unit": "fixture units"},
                   "permutations": 200, "bootstrapSamples": 200, "seed": 2026}
        response = self.client.post("/models/runs", json=payload)
        self.assertEqual(response.status_code, 202, response.text)
        complete = self.terminal(response.json()["id"])
        self.assertEqual(complete["status"], "COMPLETED", complete.get("error"))
        self.assertEqual(complete["config"]["recipe"], envelope)
        self.assertEqual(complete["result"]["evidence_level"], "engineering-fixture")
        self.assertEqual(complete["result"]["independent_units"], 6)
        self.assertAlmostEqual(complete["result"]["estimate"]["mean_difference"], 1)
        self.assertEqual(complete["input_sha256"], hashlib.sha256(model_runtime.canonical(complete["config"]).encode()).hexdigest())
        self.assertEqual(complete["output_sha256"], hashlib.sha256(model_runtime.canonical(complete["result"]).encode()).hexdigest())

    def test_sql_initialization_and_read_failures_are_sanitized_503(self):
        blocked = pathlib.Path(self.directory.name) / "not-a-directory"
        blocked.write_text("private-test-path")
        with mock.patch.dict(os.environ, {"MORPHEUS_MODEL_RUN_DIR": str(blocked)}):
            response = self.client.get("/models/runs")
        self.assertEqual(response.status_code, 503, response.text)
        self.assertNotIn(str(blocked), response.text)
        self.assertIsNone(model_api._runtime)
        self.assertEqual(self.client.get("/models/runs").status_code, 200)
        runtime = model_api._runtime
        with mock.patch.object(runtime, "list", side_effect=sqlite3.OperationalError("private-test-path")):
            response = self.client.get("/models/runs")
        self.assertEqual(response.status_code, 503, response.text)
        self.assertNotIn("private-test-path", response.text)
        with mock.patch.object(runtime, "get", side_effect=sqlite3.OperationalError("private-test-path")):
            response = self.client.get("/models/runs/an-id")
            cancellation = self.client.post("/models/runs/an-id/cancel")
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(cancellation.status_code, 503, cancellation.text)

    def test_main_shutdown_closes_the_shared_job_runtime(self):
        with TestClient(main.app, raise_server_exceptions=False) as client:
            self.assertEqual(client.get("/models/runs").status_code, 200)
            self.assertIsNotNone(model_api._runtime)
        self.assertIsNone(model_api._runtime)


if __name__ == "__main__":
    unittest.main()
