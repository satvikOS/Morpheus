import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import pathlib
import tempfile
import threading
import unittest
from unittest import mock

path = pathlib.Path(__file__).parents[1] / "services/signal-gateway/app/causal_analysis.py"
spec = importlib.util.spec_from_file_location("causal_analysis", path)
causal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(causal)
tool_path = pathlib.Path(__file__).parents[1] / "services/signal-gateway/tools/dandi_optogenetics.py"
tool_spec = importlib.util.spec_from_file_location("dandi_optogenetics", tool_path)
dandi = importlib.util.module_from_spec(tool_spec)
tool_spec.loader.exec_module(dandi)


def fixture(effects=None, units=8):
    effects = effects if effects is not None else [2 + i / 10 for i in range(units)]
    return {
        "method": "causal-perturbation",
        "source": {"kind": "synthetic", "datasetId": "engineering-positive", "datasetVersion": "1"},
        "design": {"assignment": "randomized", "independentUnitsConfirmed": True,
                   "randomization": {"recorded": True, "recordSha256": "a" * 64,
                                     "method": "synthetic balanced paired order"},
                   "registration": {"registered": True, "id": "fixture-plan-1", "lockedBeforeCollection": True}},
        "outcome": {"name": "synthetic response", "unit": "arbitrary units"},
        "baselineTolerance": .01, "bootstrapSamples": 200, "permutations": 500,
        "rows": [{"trialId": f"u{i}-s{s}-{condition}-{repeat}", "unitId": f"animal-{i}",
                  "sessionId": f"session-{s}", "condition": condition, "baseline": 5 + s,
                  "outcome": 5 + s + repeat / 10 + (effect if condition == "stimulated" else 0),
                  "qcPassed": True}
                 for i, effect in enumerate(effects) for s in range(2)
                 for condition in ("stimulated", "sham") for repeat in range(2)],
    }


class CausalAnalysisTests(unittest.TestCase):
    def test_positive_fixture_effect_and_cluster_n(self):
        config = causal.validate_causal_request(fixture())
        result = causal.evaluate_causal(config)
        self.assertEqual(result, causal.evaluate_causal(config))
        self.assertAlmostEqual(result["estimate"]["mean_difference"], 2.35)
        self.assertEqual(result["independent_units"], 8)
        self.assertEqual(result["matched_sessions"], 16)
        self.assertEqual(result["rows"], 64)
        self.assertEqual(result["randomization_test"]["p_value"], 2 / 256)
        self.assertGreater(result["estimate"]["ci95_cluster_bootstrap"][0], 0)
        self.assertEqual(result["evidence_level"], "engineering-fixture")

    def test_null_and_negative_effect(self):
        null = causal.evaluate_causal(causal.validate_causal_request(fixture([1, -1] * 4)))
        self.assertAlmostEqual(null["estimate"]["mean_difference"], 0)
        self.assertEqual(null["randomization_test"]["p_value"], 1)
        negative = causal.evaluate_causal(causal.validate_causal_request(fixture([-2] * 8)))
        self.assertEqual(negative["estimate"]["mean_difference"], -2)
        self.assertEqual(negative["randomization_test"]["p_value"], 2 / 256)

    def test_equal_unit_weights_despite_extra_repeated_sessions(self):
        payload = fixture()
        extra = [copy.deepcopy(row) for row in payload["rows"] if row["unitId"] == "animal-0"]
        for row in extra:
            row["trialId"] += "-extra"
            row["sessionId"] += "-extra"
        payload["rows"].extend(extra)
        result = causal.evaluate_causal(causal.validate_causal_request(payload))
        self.assertAlmostEqual(result["estimate"]["mean_difference"], 2.35)
        self.assertEqual(result["independent_units"], 8)

    def test_missing_control_duplicate_trial_and_small_n_rejected(self):
        for mutate in (
            lambda p: p.update(rows=[r for r in p["rows"] if not (r["unitId"] == "animal-0" and r["condition"] == "sham")]),
            lambda p: p["rows"][0].update(trialId=p["rows"][1]["trialId"]),
            lambda p: p.update(rows=[r for r in p["rows"] if r["unitId"] not in ("animal-5", "animal-6", "animal-7")]),
            lambda p: p["rows"][0].update(qcPassed=False),
            lambda p: p["rows"][0].update(outcome=float("nan")),
            lambda p: p["rows"][0].update(outcome=10**500),
            lambda p: p.update(alpha=True),
            lambda p: p.update(alpha=.1),
            lambda p: p["design"]["randomization"].update(recorded=False),
            lambda p: p["design"]["registration"].update(lockedBeforeCollection=False),
            lambda p: p["rows"][0].pop("baseline"),
        ):
            payload = fixture()
            mutate(payload)
            with self.assertRaises(ValueError):
                causal.validate_causal_request(payload)

    def test_public_source_rejects_private_and_credential_urls(self):
        for url in ("https://localhost/dataset", "https://127.0.0.1/data", "https://[::1]/data",
                    "https://lab.local/data", "https://10.0.0.1/data", "https://user:password@example.org/data"):
            payload = fixture()
            payload["source"].update(kind="public-animal-optogenetic", url=url)
            with self.assertRaises(ValueError):
                causal.validate_causal_request(payload)

    def test_baseline_confound_fails_before_inference(self):
        payload = fixture()
        for row in payload["rows"]:
            if row["condition"] == "stimulated":
                row["baseline"] += 1
        with self.assertRaisesRegex(ValueError, "Baseline QC failed"):
            causal.evaluate_causal(causal.validate_causal_request(payload))

    def test_observational_provenance_cannot_be_upgraded(self):
        payload = fixture()
        payload["source"] = {"kind": "public-observational", "datasetId": "DANDI:000009",
                             "datasetVersion": "0.220126.1903", "url": "https://dandiarchive.org/dandiset/000009/0.220126.1903"}
        result = causal.evaluate_causal(causal.validate_causal_request(payload))
        self.assertEqual(result["evidence_level"], "observational-association")
        payload["source"]["kind"] = "public-animal-optogenetic"
        payload["design"]["assignment"] = "observational"
        self.assertEqual(causal.evaluate_causal(causal.validate_causal_request(payload))["evidence_level"], "observational-association")

    def test_manifest_digest_input_copy_and_trial_immutability(self):
        payload = fixture()
        config = causal.validate_causal_request(payload)
        reverse = copy.deepcopy(payload)
        reverse["rows"].reverse()
        self.assertEqual(config["config_sha256"], causal.validate_causal_request(reverse)["config_sha256"])
        payload["rows"][0]["outcome"] = 100
        self.assertNotEqual(config["rows"][0]["outcome"], payload["rows"][0]["outcome"])
        config["rows"][0]["outcome"] = 100
        with self.assertRaisesRegex(ValueError, "manifest changed"):
            causal.evaluate_causal(config)

    def test_monte_carlo_bounds_and_cancellation(self):
        config = causal.validate_causal_request(fixture(units=17))
        result = causal.evaluate_causal(config)
        test = result["randomization_test"]
        self.assertEqual(test["enumeration"], "monte-carlo")
        self.assertEqual(test["draws"], 500)
        self.assertGreater(test["p_value"], 0)
        self.assertTrue(0 <= test["monte_carlo_ci95"][0] <= test["monte_carlo_ci95"][1] <= 1)
        cancelled = threading.Event()
        cancelled.set()
        with self.assertRaises(InterruptedError):
            causal.evaluate_causal(config, cancelled)


class DandiImportTests(unittest.TestCase):
    def test_full_artifact_contract_unit_identity_and_hash_links(self):
        assets = [{"asset_id": f"asset-{i}", "path": f"sub-mouse-{i}/session_ecephys+ogen.nwb", "size": 100}
                  for i in range(6)]
        def fake_json(url):
            return {"metadata": {"version": dandi.DATASET_VERSION, "license": ["spdx:CC-BY-4.0"]}} if url.endswith("/info/") else {
                "results": assets, "count": len(assets), "next": None}
        def fake_cache(asset, cache, limit):
            return cache / "synthetic-schema.nwb", {"assetId": asset["asset_id"], "path": asset["path"],
                                                    "sha256": "a"*64, "size": 100}
        def fake_extract(path, asset, features):
            unit = asset["path"].split("/")[0][4:]
            rows = [{"trialId": f"{asset['asset_id']}:{condition}:{repeat}", "unitId": unit, "sessionId": asset["asset_id"],
                     "condition": condition, "baseline": 2., "outcome": 3. if condition == "stimulated" else 2., "qcPassed": True}
                    for condition in ("stimulated", "control") for repeat in range(2)]
            features.extend({"id": row["trialId"], "subjectId": unit, "sessionId": row["sessionId"],
                             "features": [2., 0., 0., 0.], "featureNames": dandi.FEATURE_NAMES,
                             "label": row["condition"], "outcome": row["outcome"]-row["baseline"]} for row in rows)
            return rows, {"subjectId": unit, "gate": "PASSED"}
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(dandi, "_get_json", side_effect=fake_json), \
                mock.patch.object(dandi, "cache_asset", side_effect=fake_cache), mock.patch.object(dandi, "extract_trials", side_effect=fake_extract):
            output = pathlib.Path(directory) / "run"
            manifest = dandi.import_dataset(pathlib.Path(directory) / "cache", output)
            training = dandi.json.loads((output / "unified-model-input.json").read_text())
            result = dandi.json.loads((output / "causal-result.json").read_text())
            self.assertEqual(training["method"], "unified-model")
            self.assertEqual(training["model"], "morpheus-shared-encoder")
            self.assertTrue(training["design"]["independentUnitsConfirmed"])
            self.assertEqual({row["subjectId"] for row in training["rows"]}, {f"mouse-{i}" for i in range(6)})
            self.assertEqual(manifest["inputManifestSha256"], hashlib.sha256((output/"input-manifest.json").read_bytes()).hexdigest())
            self.assertEqual(result["import_manifest_sha256"], training["importManifestSha256"])
            self.assertEqual(manifest["unifiedModelInputSha256"], hashlib.sha256((output/"unified-model-input.json").read_bytes()).hexdigest())

    def test_checksum_cache_and_bounded_download(self):
        identifier = "250ea757-e6a9-4520-99b5-f2efd5e3b04f"
        data = b"bounded-test-nwb-bytes"
        asset = {"asset_id": identifier, "path": "sub-example/example.nwb", "size": len(data)}
        metadata = {"path": asset["path"], "contentSize": len(data),
                    "digest": {"dandi:sha2-256": hashlib.sha256(data).hexdigest()}}
        with tempfile.TemporaryDirectory() as directory:
            cache = pathlib.Path(directory)
            with mock.patch.object(dandi, "_get_json", return_value=metadata), mock.patch.object(dandi, "urlopen", return_value=io.BytesIO(data)):
                path, provenance = dandi.cache_asset(asset, cache, 100)
                self.assertEqual(path.read_bytes(), data)
                self.assertEqual(provenance["sha256"], hashlib.sha256(data).hexdigest())
            path.write_bytes(b"tampered")
            with mock.patch.object(dandi, "_get_json", return_value=metadata):
                with self.assertRaisesRegex(ValueError, "Cached NWB"):
                    dandi.cache_asset(asset, cache, 100)
            path.unlink()
            with mock.patch.object(dandi, "_get_json", return_value=metadata), mock.patch.object(dandi, "urlopen", return_value=io.BytesIO(data+b"extra")):
                with self.assertRaisesRegex(ValueError, "byte budget"):
                    dandi.cache_asset(asset, cache, 100)
            self.assertFalse(path.exists())
            self.assertEqual(list(cache.glob("*.part")), [])

    def test_existing_run_is_immutable_and_limits_checked_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / "run"
            output.mkdir()
            (output / "extraction-plan.json").write_text("saved")
            with self.assertRaisesRegex(ValueError, "immutable artifacts"):
                dandi.import_dataset(pathlib.Path(directory) / "cache", output)
            with self.assertRaisesRegex(ValueError, "Import limits"):
                dandi.import_dataset(pathlib.Path(directory) / "cache", output, file_limit=32*1024*1024)

    @unittest.skipUnless(importlib.util.find_spec("pynwb"), "PyNWB local import dependency unavailable")
    def test_real_nwb_mapping_preserves_behavioral_outcomes_and_animal_unit(self):
        from pynwb import NWBFile, NWBHDF5IO
        from pynwb.file import Subject
        from pynwb.ogen import OptogeneticStimulusSite
        nwb = NWBFile("Synthetic schema fixture, no biological data", "fixture", datetime(2026, 1, 1, tzinfo=timezone.utc))
        nwb.subject = Subject(subject_id="fixture-mouse", species="Mus musculus")
        device = nwb.create_device("recording-device")
        nwb.create_electrode_group("group", "fixture", "brain_region: Thalamus; hemisphere: left", device)
        nwb.add_ogen_site(OptogeneticStimulusSite(name="site", device=device, description="synthetic fixture only",
                                                excitation_lambda=470., location="brain_region: ALM; hemisphere: left"))
        for name in ("pole_out_time", "cue_start_time", "stim_present", "is_good", "photo_stim_period", "response", "type"):
            nwb.add_trial_column(name, "synthetic fixture")
        spikes = []
        for i, response in enumerate(("correct", "incorrect", "early lick", "correct", "incorrect")):
            anchor = 2. + i*4
            stimulated = i % 2 == 0
            nwb.add_trial(id=i, start_time=anchor-1, stop_time=anchor+2, pole_out_time=anchor,
                          cue_start_time=anchor+1, stim_present=int(stimulated), is_good=int(i != 4),
                          photo_stim_period="delay" if stimulated else "N/A", response=response,
                          type="lick left" if i < 2 else "lick right")
            spikes.extend([anchor-.4, anchor+.2])
            if stimulated:
                spikes.extend([anchor+.3, anchor+.4])
        nwb.add_unit(id=99, spike_times=sorted(spikes))
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "fixture.nwb"
            with NWBHDF5IO(str(path), "w") as writer:
                writer.write(nwb)
            feature_rows = []
            rows, gate = dandi.extract_trials(path, {"asset_id": "fixture-asset", "path": "sub-fixture-mouse/fixture.nwb"}, feature_rows)
            self.assertEqual(len(rows), 4)
            self.assertEqual({row["unitId"] for row in rows}, {"fixture-mouse"})
            self.assertIn("fixture-asset:2", {row["trialId"] for row in rows})
            self.assertEqual(gate["excludedTrials"], {"quality_flag": 1})
            self.assertEqual(gate["neurons"], 1)
            for row in rows:
                self.assertAlmostEqual(row["baseline"], 2)
                self.assertAlmostEqual(row["outcome"], 6 if row["condition"] == "stimulated" else 2)
            self.assertEqual(len(feature_rows), len(rows))
            for feature in feature_rows:
                self.assertEqual(feature["features"][:3], [2., 0., 0.])
                self.assertEqual(feature["featureNames"], dandi.FEATURE_NAMES)
                self.assertEqual(feature["outcome"], 4 if feature["label"] == "stimulated" else 0)


if __name__ == "__main__":
    unittest.main()
