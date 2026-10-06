#!/usr/bin/env python3
"""Apply an explicitly verified local JSON checkpoint to bounded feature rows."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any

MAX_BYTES = 4 * 1024 * 1024
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class PredictionCliError(ValueError):
    """A bounded, non-sensitive error suitable for the CLI."""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PredictionCliError("JSON objects must not contain duplicate keys.")
        result[key] = value
    return result


def _invalid_constant(_: str) -> None:
    raise PredictionCliError("JSON numbers must be finite.")


def read_json(path: Path, description: str) -> dict[str, Any]:
    """Check a regular file before reading, and cap reads even if it grows."""
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as source:
            metadata = os.fstat(source.fileno())
            if not stat.S_ISREG(metadata.st_mode):
                raise PredictionCliError(f"{description} must be a regular JSON file.")
            if metadata.st_size > MAX_BYTES:
                raise PredictionCliError(f"{description} exceeds the four MiB limit.")
            data = source.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise PredictionCliError(f"{description} exceeds the four MiB limit.")
        value = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
        if not isinstance(value, dict):
            raise PredictionCliError(f"{description} must be a JSON object.")
        return value
    except PredictionCliError:
        raise
    except (OSError, UnicodeError, ValueError, RecursionError, OverflowError):
        raise PredictionCliError(f"Unable to read valid bounded {description.lower()} JSON.") from None


def canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, RecursionError, OverflowError):
        raise PredictionCliError("JSON data cannot be represented as finite canonical JSON.") from None


def validate_payload(payload: dict[str, Any]) -> None:
    if set(payload) != {"featureSchema", "featureNames", "rows"}:
        raise PredictionCliError("Prediction input requires exactly featureSchema, featureNames and rows.")
    schema, names, rows = payload["featureSchema"], payload["featureNames"], payload["rows"]
    if not isinstance(schema, str) or not schema.strip() or len(schema) > 256:
        raise PredictionCliError("Prediction featureSchema must be a bounded nonempty string.")
    if (not isinstance(names, list) or not 1 <= len(names) <= 32
            or not all(isinstance(name, str) and name.strip() and len(name) <= 128 for name in names)
            or len(set(names)) != len(names)):
        raise PredictionCliError("Prediction input requires 1–32 unique ordered feature names.")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 256:
        raise PredictionCliError("Prediction input requires 1–256 rows.")
    identifiers: set[str] = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"id", "features"}:
            raise PredictionCliError("Each prediction row requires exactly id and features.")
        identifier, features = row["id"], row["features"]
        if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 128 or identifier in identifiers:
            raise PredictionCliError("Prediction row IDs must be bounded, nonempty and unique.")
        identifiers.add(identifier)
        if (not isinstance(features, list) or len(features) != len(names)
                or not all(isinstance(value, (int, float)) and not isinstance(value, bool)
                           and abs(value) <= 1e6 and math.isfinite(value) for value in features)):
            raise PredictionCliError("Prediction features must match the schema width and be finite numbers bounded by ±1,000,000.")


def write_exclusive(path: Path, result: dict[str, Any]) -> None:
    data = canonical_bytes(result) + b"\n"
    if len(data) > MAX_BYTES:
        raise PredictionCliError("Prediction output exceeds the four MiB limit.")
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise PredictionCliError("Output already exists; choose a new explicit output file.") from None
    except OSError:
        raise PredictionCliError("Unable to create the explicit output file.") from None
    identity = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
    except OSError:
        # Remove only the newly created partial output, never a replacement file.
        try:
            current = path.stat(follow_symlinks=False)
            if (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                path.unlink()
        except OSError:
            pass
        raise PredictionCliError("Unable to finish writing predictions.") from None


def predict(checkpoint_path: Path, expected_sha256: str, input_path: Path, output_path: Path) -> None:
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected_sha256):
        raise PredictionCliError("Checkpoint SHA-256 must contain exactly 64 hexadecimal characters.")
    checkpoint = read_json(checkpoint_path, "Checkpoint")
    actual = hashlib.sha256(canonical_bytes(checkpoint)).hexdigest()
    if actual != expected_sha256.lower():
        raise PredictionCliError("Checkpoint SHA-256 does not match the explicit expected hash.")
    payload = read_json(input_path, "Prediction input")
    try:
        validate_payload(payload)
    except (OverflowError, RecursionError):
        raise PredictionCliError("Prediction data exceeds the bounded numeric contract.") from None
    # Verification and input admission precede importing the optional ML runtime.
    # Checkpoints are plain JSON tensors; no pickle/object deserialization occurs.
    try:
        from app.unified_model import predict_shared
        result = predict_shared(checkpoint, payload)
    except (ImportError, ValueError, RuntimeError, TypeError, KeyError, OverflowError, RecursionError):
        raise PredictionCliError("The checkpoint or input does not match the installed shared-model prediction contract.") from None
    if not isinstance(result, dict):
        raise PredictionCliError("The local model returned an invalid prediction result.")
    write_exclusive(output_path, result)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True, help="Exported learned JSON checkpoint (not a full run)")
    parser.add_argument("--checkpoint-sha256", required=True, help="Expected canonical JSON hash from the exported run")
    parser.add_argument("--input", type=Path, required=True, help="JSON featureSchema, ordered featureNames and prediction rows")
    parser.add_argument("--output", type=Path, required=True, help="New output file; existing files are never overwritten")
    arguments = parser.parse_args(argv)
    try:
        predict(arguments.checkpoint, arguments.checkpoint_sha256, arguments.input, arguments.output)
    except PredictionCliError as error:
        print(f"Prediction refused: {error}", file=sys.stderr)
        return 2
    print("Predictions written to the requested new file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
