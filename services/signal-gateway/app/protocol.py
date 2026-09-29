"""Small, dependency-free MRPH v1 wire protocol helpers."""

import math
import struct

MRPH_MAGIC = b"MRPH"
MRPH_VERSION = 1
MRPH_FLAG_SIMULATED = 1
MRPH_HEADER = struct.Struct("<4sHHIIfHH")


def stream_hash(value: str) -> int:
    current = 2166136261
    for byte in value.encode("utf-8", errors="replace"):
        current ^= byte
        current = (current * 16777619) & 0xFFFFFFFF
    return current


def encode_sample_batch(
    stream: str,
    sample_rate: float,
    samples: list[list[float]],
    timestamps: list[float],
    simulated: bool,
    sequence: int,
) -> bytes:
    if not samples or len(samples) != len(timestamps):
        raise ValueError("Sample batch must include matching frames and timestamps.")

    channel_count = len(samples[0])
    if channel_count < 1 or channel_count > 65535:
        raise ValueError("Unsupported channel count.")
    if sequence < 0 or sequence > 0xFFFFFFFF:
        raise ValueError("Sequence must fit in an unsigned 32-bit integer.")

    for frame in samples:
        if len(frame) != channel_count:
            raise ValueError("All sample frames must have the same channel count.")
        if not all(math.isfinite(float(value)) for value in frame):
            raise ValueError("Samples must contain only finite values.")

    if not math.isfinite(float(sample_rate)) or sample_rate < 0:
        raise ValueError("Sample rate must be finite and non-negative.")
    if not all(math.isfinite(float(timestamp)) for timestamp in timestamps):
        raise ValueError("Timestamps must contain only finite values.")

    flags = MRPH_FLAG_SIMULATED if simulated else 0
    payload = bytearray(
        MRPH_HEADER.pack(
            MRPH_MAGIC,
            MRPH_VERSION,
            flags,
            sequence,
            stream_hash(stream),
            float(sample_rate),
            channel_count,
            len(samples),
        )
    )
    for timestamp, frame in zip(timestamps, samples, strict=True):
        payload.extend(struct.pack("<d", float(timestamp)))
        payload.extend(struct.pack(f"<{channel_count}f", *[float(value) for value in frame]))
    return bytes(payload)
