#!/usr/bin/env python3
"""Exercise UDP, bounded high-channel ring, on-disk integrity, failure and interruption."""
import hashlib
import json
import os
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "native/morpheus-core-cpp/build"
HEADER = struct.Struct("<4sHHIIfHH")


def recordings(directory):
    paths = list(Path(directory).glob("*.mrph"))
    assert len(paths) == 1, paths
    raw = paths[0].read_bytes()
    manifest_path = Path(str(paths[0]) + ".manifest.json")
    metadata = json.loads(manifest_path.read_text())
    assert raw[:12] == b"MRPHSESSION\x01"
    assert hashlib.sha256(raw).hexdigest() == metadata["sha256"]
    assert hashlib.sha256(manifest_path.read_bytes()).hexdigest() == Path(str(manifest_path) + ".sha256").read_text().strip()
    assert metadata["bytes"] == len(raw) and metadata["simulated"] is True
    assert metadata["hardware_clock_verified"] is False
    assert paths[0].stat().st_mode & 0o077 == 0
    offset, packets, frames = 20, 0, 0
    previous_time = -float("inf")
    while offset < len(raw):
        length, = struct.unpack_from("<I", raw, offset)
        offset += 4
        packet = raw[offset:offset + length]
        magic, version, flags, sequence, _, rate, channels, count = HEADER.unpack_from(packet)
        assert magic == b"MRPH" and version == 1 and flags & 1
        assert sequence == packets & 0xFFFFFFFF
        assert length == 24 + count * (8 + 4 * channels)
        for i in range(count):
            timestamp, = struct.unpack_from("<d", packet, 24 + i * (8 + 4 * channels))
            assert timestamp > previous_time
            previous_time = timestamp
        packets += 1
        frames += count
        offset += length
    assert offset == len(raw) and packets == metadata["packets"] and frames == metadata["frames"]
    return metadata


def main():
    gateway = str(BUILD / "morpheus_gateway")
    # Override optional user environment so tests never send or record elsewhere.
    env = {k: v for k, v in os.environ.items() if not k.startswith("MORPHEUS_")}
    env.update({"MORPHEUS_STREAM_NAME": 'Test "stream"\nreference'})
    with tempfile.TemporaryDirectory(prefix="morpheus-integration-") as directory:
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
        udp.bind(("127.0.0.1", 0))
        udp.settimeout(.1)
        received = []
        active = threading.Event()
        active.set()

        def receive():
            while active.is_set():
                try:
                    received.append(HEADER.unpack_from(udp.recv(65535))[3])
                except socket.timeout:
                    continue

        thread = threading.Thread(target=receive)
        thread.start()
        result = subprocess.run([gateway, "--rate", "4000", "--channels", "256", "--batch", "1",
                                 "--ring-seconds", "1", "--duration", "1.25", "--record-dir", directory,
                                 "--udp-target", f"127.0.0.1:{udp.getsockname()[1]}"],
                                env=env, capture_output=True, text=True, timeout=15, check=True)
        time.sleep(.1)
        active.clear()
        thread.join(timeout=2)
        udp.close()
        summary = json.loads(result.stdout)
        metadata = recordings(directory)
        assert summary["ring_frames"] == summary["ring_capacity"] == 4000
        assert metadata["frames"] >= 4000 and metadata["channels"] == 256
        assert summary["udp_sent"] + summary["udp_errors"] == metadata["packets"]
        assert received and len(set(received)) == len(received)
        print(json.dumps({"test": "native-udp-recording", "summary": summary,
                          "udp_received": len(received), "display_packet_loss": metadata["packets"] - len(received),
                          "packets_per_second": metadata["packets"] / summary["elapsed_seconds"],
                          "sha256_verified": True, "manifest_hash_verified": True}))
    with tempfile.TemporaryDirectory(prefix="morpheus-budget-") as directory:
        result = subprocess.run([gateway, "--record-dir", directory, "--max-record-bytes", "100",
                                 "--duration", ".1"], env=env, capture_output=True, text=True, timeout=5)
        assert result.returncode != 0 and "budget" in result.stderr
        assert list(Path(directory).glob("*.partial"))
        assert not list(Path(directory).glob("*.manifest.json"))
    with tempfile.TemporaryDirectory(prefix="morpheus-interrupt-") as directory:
        # A long batch interval exercises interruptibility as well as finalization.
        process = subprocess.Popen([gateway, "--rate", "1", "--batch", "16", "--record-dir", directory], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert "synthetic reference" in process.stderr.readline()
        time.sleep(.1)
        process.send_signal(signal.SIGTERM)
        stdout, _ = process.communicate(timeout=5)
        assert process.returncode == 0
        assert json.loads(stdout)["frames"] > 0
        recordings(directory)
    with tempfile.TemporaryDirectory(prefix="morpheus-crash-") as directory:
        process = subprocess.Popen([gateway, "--record-dir", directory], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert "synthetic reference" in process.stderr.readline()
        process.kill()
        process.communicate(timeout=5)
        assert list(Path(directory).glob("*.partial"))
        assert not list(Path(directory).glob("*.manifest.json"))
    for arguments in [["--rate", "nan"], ["--channels", "65536"], ["--batch", "0"], ["--rate", "-1"]]:
        result = subprocess.run([gateway, *arguments], env=env, capture_output=True, text=True, timeout=5)
        assert result.returncode != 0
    print(json.dumps({"test": "native-failure-paths", "disk_budget_failure": True,
                      "sigterm_finalization": True, "abrupt_stop_stays_partial": True, "invalid_config_rejected": True}))


if __name__ == "__main__":
    main()
