"""Independent metadata, provenance, download-boundary, and EEG numerical checks."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

TOOL = Path(__file__).parents[1] / "services/signal-gateway/tools/dream_features.py"
spec = importlib.util.spec_from_file_location("dream_features", TOOL)
dream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dream)
try:
    import numpy as np
except ImportError:
    np = None


def metadata_fixture(subjects=8, repetitions=3):
    records, reports, inventory = [], [], {}
    case_id = 0
    for subject in range(1, subjects + 1):
        for code in dream.TARGET_CODES:
            for repeat in range(repetitions):
                case_id += 1
                name = f"ID_{case_id:03d}_S{subject}_N1_A{case_id}.edf"
                records.append({"Filename": name, "Case ID": str(case_id), "Subject ID": str(subject),
                                "Experience": code, "Duration": "60", "EEG sample rate": "2000",
                                "Number of EEG channels": "25", "Last sleep stage": "3", "Proportion artifacts": ""})
                reports.append({"Filename": name, "Case ID": str(case_id), "Experience": code,
                                "Dream complexity": str(1.5 + repeat) if code == "2" else ""})
                inventory[dream.PACKAGE_PREFIX + "Data/PSG/" + name] = SimpleNamespace(file_size=6967680, compress_size=4000000, flag_bits=0, CRC=123)
    return records, reports, inventory


class MetadataTests(unittest.TestCase):
    def test_real_labels_ratings_and_missingness_are_distinct(self):
        records, reports, _ = metadata_fixture()
        joined = dream.validate_metadata(records, reports)
        self.assertEqual({row["label"] for row in joined}, {"NoExperience", "WithoutRecall", "Experience"})
        self.assertTrue(all(row["rating"] is None for row in joined if row["experienceCode"] in ("0", "1")))
        measured = [row for row in joined if row["experienceCode"] == "2"]
        self.assertEqual(measured[0]["rating"], 1.5)
        self.assertEqual(measured[0]["ratingRaw"], "1.5")
        self.assertTrue(all(row["upstreamArtifactProportion"] is None for row in joined))
        records[0]["Experience"] = reports[0]["Experience"] = "-2"
        self.assertEqual(dream.validate_metadata(records, reports)[0]["label"], "NoExperienceOrWithoutRecall")

    def test_mismatched_identity_report_code_and_fake_outcome_are_rejected(self):
        for change in (
            lambda r, p: r[0].update({"Subject ID": "99"}),
            lambda r, p: p[0].update({"Experience": "2"}),
            lambda r, p: p[0].update({"Dream complexity": "0"}),
            lambda r, p: p[0].update({"Dream complexity": "2"}),
            lambda r, p: p[-1].update({"Dream complexity": "nan"}),
            lambda r, p: r[0].update({"EEG sample rate": "250"}),
            lambda r, p: p.append(copy.deepcopy(p[0])),
        ):
            records, reports, _ = metadata_fixture()
            change(records, reports)
            with self.assertRaises(ValueError):
                dream.validate_metadata(records, reports)

    def test_csv_does_not_silently_shift_or_fill_missing_columns(self):
        self.assertEqual(dream.read_csv(b"A,B\n1,2\n,\n"), [{"A": "1", "B": "2"}])
        for content in (b"A,A\n1,2\n", b"A,B\n1\n", b"A,B\n1,2,3\n"):
            with self.assertRaises(ValueError):
                dream.read_csv(content)

    def test_hash_selection_is_fixed_before_features_and_independent_of_rating_magnitude(self):
        records, reports, inventory = metadata_fixture(repetitions=4)
        joined = dream.validate_metadata(records, reports)
        selected, excluded = dream.select_cases(joined, inventory)
        changed = copy.deepcopy(joined)
        for row in changed:
            if row["rating"] is not None:
                row["rating"] = 7.0
        selected_again, _ = dream.select_cases(list(reversed(changed)), inventory)
        self.assertEqual([row["filename"] for row in selected], [row["filename"] for row in selected_again])
        self.assertEqual(len(selected), 72)
        self.assertEqual(len(excluded), 24)
        # Another seed is an explicit different selection, never a hidden feature-based rerank.
        alternate, _ = dream.select_cases(joined, inventory, seed=2027)
        self.assertNotEqual([row["filename"] for row in selected], [row["filename"] for row in alternate])

    def test_stage_independence_and_measured_outcome_gates_do_not_relax(self):
        records, reports, inventory = metadata_fixture()
        for row in records:
            if int(row["Subject ID"]) > 5:
                row["Last sleep stage"] = "5"
        with self.assertRaisesRegex(ValueError, "5 independent subjects"):
            dream.select_cases(dream.validate_metadata(records, reports), inventory)
        records, reports, inventory = metadata_fixture()
        for row in reports:
            if row["Filename"].split("_S")[1].split("_")[0] == "1":
                row["Dream complexity"] = ""
        with self.assertRaisesRegex(ValueError, "actual ratings"):
            dream.select_cases(dream.validate_metadata(records, reports), inventory)
        records, reports, inventory = metadata_fixture()
        for entry in inventory.values():
            entry.flag_bits = 1
        with self.assertRaisesRegex(ValueError, "bounded reviewed schema"):
            dream.select_cases(dream.validate_metadata(records, reports), inventory)

    def test_post_qc_gate_keeps_whole_people_and_missing_targets(self):
        records, reports, _ = metadata_fixture(repetitions=2)
        joined = dream.validate_metadata(records, reports)
        rows = [{"subjectId": row["subjectId"], "label": row["label"], "outcome": row["rating"]} for row in joined]
        gate, retained = dream.cohort_gate(rows)
        self.assertTrue(gate["passed"])
        self.assertEqual(gate["independentSubjects"], 8)
        self.assertEqual(gate["rows"], 48)
        self.assertEqual(gate["observedByLabel"], {"Experience": 16})
        # One removed class record disqualifies the person's other recordings too.
        rows.pop(0)
        gate, retained = dream.cohort_gate(rows)
        self.assertEqual(gate["independentSubjects"], 7)
        self.assertTrue(all(row["subjectId"] != "1" for row in retained))
        self.assertFalse(gate["passed"])  # Only42 independent awakenings remain.
        self.assertTrue(all(row["outcome"] is None for row in retained if row["label"] != "Experience"))

    def test_selection_seal_and_metadata_file_are_both_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "source").mkdir()
            metadata = b"A,B\n1,2\n"
            (root / "source/Records.csv").write_bytes(metadata)
            payload = {"extractorVersion": dream.VERSION, "archiveId": dream.ARCHIVE_ID,
                       "metadata": {"Records.csv": {"sha256": dream.digest(metadata)}}}
            sealed = {**payload, "selectionSha256": dream.digest(dream.canonical(payload))}
            dream.save_json(root / "selection.json", sealed)
            self.assertEqual(dream.load_selection(root), sealed)
            (root / "source/Records.csv").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "Source metadata changed"):
                dream.load_selection(root)
            (root / "source/Records.csv").write_bytes(metadata)
            sealed["archiveId"] = 1
            dream.save_json(root / "selection.json", sealed)
            with self.assertRaisesRegex(ValueError, "integrity/version"):
                dream.load_selection(root)

    def test_nuisance_controls_preserve_rows_targets_and_fixed_qc_indices(self):
        main = {"source": {"featureSchema": dream.VERSION}, "seed": 2026, "epochs": 30,
                "hiddenWidth": 32, "outcome": {"name": "real rating", "scope": "Experience only"},
                "rows": [{"id": "r1", "subjectId": "p1", "sessionId": "n1", "label": "WithoutRecall",
                          "outcome": None, "featureNames": dream.FEATURE_NAMES, "features": list(range(20)),
                          "provenance": {"sleepStage": "N3"}}]}
        controls = dream.control_inputs(main)
        self.assertEqual(main["rows"][0]["features"], list(range(20)))
        self.assertEqual(controls["qc"]["rows"][0]["featureNames"], ["adc_clipping_fraction", "prolonged_flatline_fraction"])
        self.assertEqual(controls["qc"]["rows"][0]["features"], [18, 19])
        self.assertEqual(controls["stage"]["rows"][0]["features"], [0, 1])
        for control in controls.values():
            self.assertIsNone(control["rows"][0]["outcome"])
            self.assertEqual(control["rows"][0]["id"], "r1")
            self.assertEqual(control["rows"][0]["label"], "WithoutRecall")
            self.assertEqual(control["outcome"], main["outcome"])
            self.assertEqual((control["epochs"], control["seed"], control["hiddenWidth"]), (30, 2026, 32))
            self.assertNotEqual(control["source"]["featureSchema"], dream.VERSION)
        main["rows"][0]["featureNames"] = ["bad"]
        with self.assertRaisesRegex(ValueError, "fixed main EEG schema"):
            dream.control_inputs(main)


class RangeBoundaryTests(unittest.TestCase):
    def test_budget_is_cumulative_durable_and_includes_failed_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            budget = dream.Budget(path, 12)
            budget.charge(8)
            self.assertEqual(dream.Budget(path, 12).received, 8)
            with self.assertRaisesRegex(ValueError, "cap"):
                budget.reserve_check(5)
            budget.reserve_check(4)

    def test_only_pinned_exact_range_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            budget = dream.Budget(Path(directory) / "ledger.json")
            with self.assertRaises(ValueError):
                dream.RangeReader("https://example.com/other.zip", 100, budget)
            reader = dream.RangeReader(f"https://ndownloader.figshare.com/files/{dream.ARCHIVE_ID}", 100, budget)
            reader.seek(10)
            response = mock.MagicMock()
            response.__enter__.return_value = response
            response.status = 206
            response.headers = {"Content-Range": "bytes 10-13/100", "Content-Length": "4"}
            response.read.return_value = b"abcd"
            with mock.patch.object(dream.urllib.request, "urlopen", return_value=response) as opened:
                self.assertEqual(reader.read(4), b"abcd")
                self.assertEqual(opened.call_args.args[0].get_header("Range"), "bytes=10-13")
            self.assertEqual(budget.received, 4)
            self.assertEqual(reader.tell(), 14)
            response.status = 200  # Even a public full-file response is forbidden.
            with mock.patch.object(dream.urllib.request, "urlopen", return_value=response):
                with self.assertRaisesRegex(ValueError, "no full-download fallback"):
                    reader.read(4)
            response.status = 206
            response.headers = {"Content-Range": "bytes 14-17/100", "Content-Length": "4"}
            response.read.return_value = b""
            with mock.patch.object(dream.urllib.request, "urlopen", return_value=response):
                with self.assertRaisesRegex(ValueError, "ended early"):
                    reader.read(4)
            with self.assertRaises(ValueError):
                reader.seek(101)
            with self.assertRaises(ValueError):
                reader.seek(-1)


def edf_fixture(unit="uV", frequency=10):
    names = [name for region in dream.REGIONS.values() for name in region]
    channels, records, samples = len(names), 60, 2000
    def field(value, width):
        encoded = str(value).encode("ascii")
        if len(encoded) > width:
            raise AssertionError("Fixture EDF field exceeds its width")
        return encoded.ljust(width, b" ")
    header = b"".join((field("0", 8), field("PRIVATE PATIENT", 80), field("PRIVATE RECORDING", 80),
                       field("01.01.01", 8), field("00.00.00", 8), field(256 + 256 * channels, 8),
                       field("", 44), field(records, 8), field(1, 8), field(channels, 4)))
    for values, width in ((names, 16), ([""] * channels, 80), ([unit] * channels, 8),
                          ([-100] * channels, 8), ([100] * channels, 8), ([-32768] * channels, 8),
                          ([32767] * channels, 8), (["unknown source prefilter"] * channels, 80),
                          ([samples] * channels, 8), ([""] * channels, 32)):
        header += b"".join(field(value, width) for value in values)
    time = np.arange(records * samples) / samples
    # The input amplitude is specified in physical units; the decoder must apply EDF calibration.
    digital = np.rint(20 * np.sin(2 * np.pi * frequency * time) / 200 * 65535 - .5).astype("<i2")
    payload = np.concatenate([np.tile(digital[record * samples:(record + 1) * samples], channels) for record in range(records)])
    return header + payload.tobytes()


@unittest.skipIf(np is None, "NumPy is optional in stdlib-only CI; install model test requirements for spectral tests")
class EEGNumericalTests(unittest.TestCase):
    def test_edf_calibration_and_alpha_band_conservation(self):
        decoded = dream.decode_edf(edf_fixture())
        self.assertEqual(decoded["duration"], 60)
        self.assertEqual(decoded["channels"]["F3"]["rate"], 2000)
        self.assertAlmostEqual(float(np.max(decoded["channels"]["F3"]["valuesUV"])), 20, places=2)
        features, qc = dream.spectral_features(decoded)
        self.assertEqual(len(features), len(dream.FEATURE_NAMES))
        self.assertTrue(qc["passed"])
        # A20uV10Hz sine has200uV² power; alpha must dominate the disjoint other bands.
        for offset in (0, 5, 10):
            self.assertAlmostEqual(features[offset + 2], np.log10(200), places=3)
            self.assertGreater(features[offset + 2] - max(features[offset], features[offset + 1], features[offset + 3], features[offset + 4]), 4)
        self.assertAlmostEqual(features[15], np.log10(20 / np.sqrt(2)), places=3)
        self.assertFalse(any("PRIVATE" in str(value) for value in decoded.values()))

    def test_unit_conversion_and_beta_frequency_selectivity(self):
        features, _ = dream.spectral_features(dream.decode_edf(edf_fixture(frequency=20)))
        self.assertAlmostEqual(features[4], np.log10(200), places=3)
        millivolts, _ = dream.spectral_features(dream.decode_edf(edf_fixture(unit="mV")))
        self.assertAlmostEqual(millivolts[2] - dream.spectral_features(dream.decode_edf(edf_fixture()))[0][2], 6, places=3)
        self.assertAlmostEqual(millivolts[15] - features[15], 3, places=3)

    def test_truncation_missing_channels_wrong_rate_and_discontinuous_edf_reject(self):
        data = edf_fixture()
        with self.assertRaisesRegex(ValueError, "payload size"):
            dream.decode_edf(data[:-2])
        mutated = bytearray(data)
        mutated[192:197] = b"EDF+D"
        with self.assertRaisesRegex(ValueError, "continuous"):
            dream.decode_edf(bytes(mutated))
        decoded = dream.decode_edf(data)
        del decoded["channels"]["F3"]
        with self.assertRaisesRegex(ValueError, "channel F3 is absent"):
            dream.spectral_features(decoded)
        decoded = dream.decode_edf(data)
        decoded["channels"]["F3"]["rate"] = 1000
        with self.assertRaisesRegex(ValueError, "units/rate"):
            dream.spectral_features(decoded)

    def test_clipping_and_prolonged_constant_runs_are_flagged_without_imputation(self):
        decoded = dream.decode_edf(edf_fixture())
        decoded["channels"]["F3"]["digital"] = np.zeros(120000, dtype="<i2")
        decoded["channels"]["F3"]["valuesUV"] = np.zeros(120000)
        _, qc = dream.spectral_features(decoded)
        self.assertFalse(qc["passed"])
        self.assertEqual(qc["prolongedFlatlineFractionMaximum"], 1)
        self.assertIn("required_channel_prolonged_flatline_gt_0.05", qc["flags"])
        decoded = dream.decode_edf(edf_fixture())
        raw = decoded["channels"]["F3"]["digital"].copy()
        raw[:2000] = 32767
        decoded["channels"]["F3"]["digital"] = raw
        _, qc = dream.spectral_features(decoded)
        self.assertFalse(qc["passed"])
        self.assertIn("required_channel_adc_clipping_gt_0.01", qc["flags"])


if __name__ == "__main__":
    unittest.main()
