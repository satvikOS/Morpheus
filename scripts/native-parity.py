#!/usr/bin/env python3
"""MRPH byte parity against the existing Python and optional retained Rust core."""
import json
import math
import random
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "native/morpheus-core-cpp/build"
sys.path.insert(0, str(ROOT / "services/signal-gateway"))
from app.protocol import encode_sample_batch  # noqa: E402


def f32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def close(actual, expected, tolerance=1e-8):
    if isinstance(expected, list):
        assert len(actual) == len(expected)
        for left, right in zip(actual, expected, strict=True):
            close(left, right, tolerance)
    else:
        assert math.isclose(actual, expected, abs_tol=tolerance, rel_tol=tolerance), (actual, expected)


def main():
    tool = BUILD / "morpheus_protocol_tool"
    rust = BUILD / "morpheus_rust_reference"
    fixtures = json.loads((ROOT / "tests/protocol/mrph-v1-golden.json").read_text())
    cases = list(fixtures["cases"])
    rng = random.Random(71)
    for _ in range(80):
        channels = rng.choice([1, 2, 8, 64, 256])
        frames = rng.randint(1, 16)
        cases.append({"stream": "Morpheus-é", "sample_rate": rng.choice([0, 256, 1024, 2000]),
                      "samples": [[f32(rng.uniform(-20, 20)) for _ in range(channels)] for _ in range(frames)],
                      "timestamps": [10 + i / 2000 for i in range(frames)], "simulated": bool(rng.getrandbits(1)),
                      "sequence": rng.choice([0, 1, 42, 0xFFFFFFFF])})
    with tempfile.TemporaryDirectory(prefix="morpheus-parity-") as directory:
        source, target = Path(directory) / "in.mrph", Path(directory) / "out.mrph"
        for case in cases:
            encoded = encode_sample_batch(case["stream"], case["sample_rate"], case["samples"],
                                          case["timestamps"], case["simulated"], case["sequence"])
            if "expected_hex" in case:
                assert encoded.hex() == case["expected_hex"], "Python behavior changed against committed golden"
            source.write_bytes(encoded)
            subprocess.run([str(tool), "roundtrip", str(source), str(target)], check=True, capture_output=True)
            assert target.read_bytes() == encoded, "C++ MRPH bytes differ"
            if rust.exists():
                subprocess.run([str(rust), "roundtrip", str(source), str(target)], check=True, capture_output=True)
                assert target.read_bytes() == encoded, "Rust MRPH bytes differ"
    actual = json.loads(subprocess.check_output([str(tool), "dsp"], text=True))
    values = [f32(math.sin(2 * math.pi * 10 * i / 256)) for i in range(256)]
    # Independent DFT oracle, rather than duplicating the production FFT.
    windowed = [x * (0.5 - 0.5 * math.cos(2 * math.pi * i / 255)) for i, x in enumerate(values)]
    spectrum = []
    for k in range(129):
        re = sum(x * math.cos(-2 * math.pi * k * i / 256) for i, x in enumerate(windowed))
        im = sum(x * math.sin(-2 * math.pi * k * i / 256) for i, x in enumerate(windowed))
        spectrum.append((re * re + im * im) / (256 * 256))
    close(actual["spectrum"], spectrum, 1e-10)
    close(actual["alpha"], sum(spectrum[8:13]), 1e-10)
    close(actual["rms"], f32(math.sqrt(sum(x * x for x in values) / 256)), 1e-7)
    envelope = [[min(values[i * 256 // 7:(i + 1) * 256 // 7]),
                 max(values[i * 256 // 7:(i + 1) * 256 // 7])] for i in range(7)]
    close(actual["envelope"], envelope, 1e-7)
    if rust.exists():
        reference = json.loads(subprocess.check_output([str(rust), "dsp"], text=True))
        for key in actual:
            close(actual[key], reference[key], 1e-7 if key in {"rms", "notch", "envelope"} else 1e-10)
    print(json.dumps({"test": "native-parity", "wire_cases": len(cases),
                      "python_byte_parity": True, "actual_rust_execution": rust.exists(),
                      "independent_dft_oracle": True, "rust_dsp_parity": rust.exists()}))


if __name__ == "__main__":
    main()
