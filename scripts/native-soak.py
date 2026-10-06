#!/usr/bin/env python3
"""Opt-in one-hour synthetic high-channel memory soak; no recording allocation."""
import argparse
import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--seconds", type=float, default=3600)
args = parser.parse_args()
if args.seconds < 1 or args.seconds > 86400:
    parser.error("seconds must be in 1..86400")
env = {k: v for k, v in os.environ.items() if not k.startswith("MORPHEUS_")}
process = subprocess.Popen([str(ROOT / "native/morpheus-core-cpp/build/morpheus_gateway"),
                            "--rate", "2000", "--channels", "256", "--batch", "16",
                            "--ring-seconds", "2", "--duration", str(args.seconds)],
                           env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
rss = []
try:
    assert "synthetic reference" in process.stderr.readline()
    while process.poll() is None:
        snapshot = subprocess.run(["ps", "-o", "rss=", "-p", str(process.pid)], capture_output=True, text=True)
        if snapshot.stdout.strip():
            rss.append(int(snapshot.stdout.strip()))
        time.sleep(min(1, args.seconds / 10))
    stdout, stderr = process.communicate(timeout=5)
    assert process.returncode == 0, stderr
    summary = json.loads(stdout)
    assert summary["ring_frames"] <= summary["ring_capacity"] == 4000
    assert summary["frames"] >= args.seconds * 2000 * .9
    if len(rss) > 3:
        # The OS may fault preallocated pages in during warmup; assess only after
        # two samples, with an explicit tolerance for allocator/OS accounting.
        assert max(rss[2:]) - min(rss[2:]) < 16 * 1024, rss
    print(json.dumps({"test": "native-soak", "requested_seconds": args.seconds,
                      "rss_min_kib": min(rss) if rss else None, "rss_max_kib": max(rss) if rss else None,
                      "summary": summary, "hardware_synchronization_verified": False}))
finally:
    if process.poll() is None:
        process.terminate()
        process.communicate(timeout=5)
