# Native C++ migration and measured boundaries

The C++20 execution path is implemented in `native/morpheus-core-cpp`. It builds with CMake and the standard library, without a DSP framework or network dependency. The synthetic local gateway can already send MRPH v1 to the existing Python/browser bridge and record independently of display delivery. Real amplifier acquisition, hardware synchronization, and neural decoding are separate work. Every generated packet carries the simulated flag.

## Build and run

From the repository root:

```sh
scripts/native-test.sh
scripts/native-benchmark.sh
python3 scripts/native-cloud-test.py

# Run the local native reference with independent raw recording.
native/morpheus-core-cpp/build/morpheus_gateway \
  --rate 2000 --channels 256 --batch 16 --ring-seconds 2 \
  --udp-target 127.0.0.1:8790 --record-dir "$HOME/MorpheusSessions" \
  --duration 30
```

Configure the existing Python science/display adapter with `MORPHEUS_NATIVE_UDP_BIND=127.0.0.1:8790`, start its normal FastAPI server, and select `morpheus-native` after the first packet arrives. Native CLI settings also accept the existing environment variables: `MORPHEUS_STREAM_NAME`, `MORPHEUS_SAMPLE_RATE`, `MORPHEUS_CHANNELS`, `MORPHEUS_BATCH_FRAMES`, `MORPHEUS_RING_SECONDS`, `MORPHEUS_UDP_TARGET`, and `MORPHEUS_RECORD_DIR`. `MORPHEUS_MAX_RECORD_BYTES` defaults to 1 GiB and stops recording with an explicit error when exhausted. Invalid numeric configuration is rejected rather than silently substituted.

The POSIX gateway currently targets macOS/Linux. Ring insertion, protocol encoding into caller storage, reuse of preallocated decode output, and reuse of the FFT workspace avoid steady-state allocation. Ring ownership is single-threaded; concurrent readers require a bounded snapshot handoff. The gateway's recorder is synchronous: slow storage can delay pacing, and `deadline_misses` reports that condition. UDP is nonblocking and disposable; failures are counted after the raw packet is recorded. There is no unbounded transport queue.

## Reference inventory and parity

| Existing behavior | C++ implementation and migration status |
| --- | --- |
| Rust timestamped interleaved ring | Fixed-capacity ring; latest-frame copy and timestamp order verified; adds finite-value checks and a 256 MiB default budget |
| Rust MRPH encode/decode and FNV stream hash | Same little-endian bytes for valid packets; adds finite checks, configurable bounds and exact payload-length checking |
| Rust RMS and min/max reduction | Verified against executed Rust functions |
| Rust Hann FFT, band power and biquad notch | Verified against executed Rust functions and an independent DFT oracle |
| Rust synthetic UDP reference gateway | Equivalent engineering source and MRPH session container; reusable buffers, nonblocking display sink, interruption handling and stronger manifest |
| Python MRPH encoder | Three committed golden fixtures plus 80 deterministic valid cases pass byte-for-byte through Python, C++ and Rust |
| Python LSL, BrainFlow, WebSocket/WebRTC and NWB utilities | Retained as science/device/display adapters; vendor hardware and timing have not been reimplemented or verified in C++ |
| Browser binary ingest | Existing MRPH v1 contract preserved; browser still owns display state rather than raw recording |

The Rust source is retained as an executable comparison oracle. `native-test.sh` compiles the oracle when `rustc` is available and clearly reports whether Rust actually ran. C++ has demonstrated protocol/DSP parity within the documented valid domain, but a blanket speed advantage has not been demonstrated. Removing Rust is therefore premature. Do not run both native reference gateways as competing sources with the same stream identity.

## MRPH v1 wire contract

All multibyte fields use little endian. Samples are IEEE-754 binary32; timestamps are binary64. The 24-byte header is followed by each frame's eight-byte timestamp and `channels` four-byte interleaved samples.

| Offset | Field | Bytes |
| --- | --- | --- |
| 0 | `MRPH` magic | 4 |
| 4 | Protocol version `1` | 2 |
| 6 | Flags (bit 0 means simulated) | 2 |
| 8 | Per-stream packet sequence, modulo 2^32 | 4 |
| 12 | FNV-1a UTF-8 stream identifier | 4 |
| 16 | Sample rate Hz; zero permits irregular streams | 4 |
| 20 | Channel count | 2 |
| 22 | Frame count | 2 |

Default library limits are 4,096 channels, 65,535 frames, 4,194,304 scalar samples, and 16 MiB per packet. Applications can tighten these bounds or increase them within v1's unsigned 16-bit dimensions. Gateway packets are capped at 48 KiB, with an explicit message when a configured batch is reduced. Nonfinite rates, timestamps or samples, negative rates, truncated payloads and trailing bytes are rejected. Rejection leaves the previous decoded values intact. Unknown flags are preserved for forward compatibility. Timestamp monotonicity is a stream/QC question, not a v1 decoder requirement. The sequence tracker distinguishes gaps, duplicates, stale packets and unsigned rollover; reconnects need an explicit reset.

No MRPH v2 was introduced. Existing v1 compatibility is sufficient for this migration; clock provenance is explicit in the recording manifest. A future v2 needs a shared browser/adapter contract and validated clock-domain metadata rather than a gratuitous format change.

## DSP and quality checks

The module provides DC removal, linear detrending, peak, RMS, min/max envelopes, a reusable Hann FFT, band power, notch/lowpass/highpass biquads, one-sided Welch PSD, and channel quality metrics. A configurable bandpass can be composed by cascading a highpass and lowpass; both cutoffs must lie inside the Nyquist range. This is a cascade of second-order filters, not a claim of arbitrary filter order or zero phase.

Rust-compatible FFT power is `|FFT|² / N²`, using the next power of two and a symmetric Hann window. It is an engineering spectrum, not calibrated spectral density. Welch PSD separately removes each complete segment's mean and normalizes by sample rate and Hann window energy; integration uses the frequency-bin width. Tests recover the expected 0.5 mean-square energy of a unit sinusoid. RMS, extrema, line-noise ratio, clipping fraction, finite counts and near-flat step fraction describe instrument quality with caller-supplied thresholds; they do not diagnose a disease or classify a channel clinically. Invalid DSP input is rejected, and filter overflow does not silently poison its state.

## Recording and provenance

The raw container remains compatible with the existing Rust session format: `MRPHSESSION` plus byte `1`, an eight-byte starting Unix nanosecond value, then four-byte packet lengths and MRPH packets. Existing `services/signal-gateway/tools/mrph_to_nwb.py` can consume the unchanged container layout; conversion still requires the PyNWB science adapter.

Files remain `.mrph.partial` until successful flush, fsync and close. Normal SIGINT/SIGTERM finalizes the raw file, a JSON manifest, and a SHA-256 digest of that exact manifest. SIGKILL or disk-budget/write failure preserves an incomplete file without a success manifest. Hashing is streaming, not a whole-session memory read. Raw and manifest files use owner-only permissions. The finalized manifest contains software version, build base commit and dirty-source flag, protocol, stream/channel/rate metadata, logical clock domain, wall start/stop, packet/frame/byte totals, UDP failure count, pacing misses, file hash and explicit simulated/unverified-hardware status.

These digests establish byte integrity, not cryptographic authorship, signed lineage, hardware acquisition provenance, or regulatory chain of custody. An abrupt stop can lose data still buffered by the operating system. Recovery/scanning of partial files and redundant acquisition storage remain future work. A crash between final raw-file rename and manifest completion can leave a raw file with no complete manifest; consumers must require both.

## Verification on 2026-10-06

Executed on an Apple Silicon macOS host with Apple Clang 21, CMake and Rust 1.99.0 (installed to execute the retained comparison). Results are local engineering observations, not hardware synchronization guarantees.

- Release and address/undefined sanitizer builds pass 44,930 assertions, including 20,000 deterministic malformed packet mutations, bounded rings, sequence rollover, independent DFT, PSD integration, filters, extreme numeric inputs, SHA-256 known vectors and recording budgets.
- All seven original Rust unit tests pass. All 83 Python/C++/Rust wire cases and the Rust DSP comparison pass.
- UDP plus recording test: 5,000 packets at 256 channels and 4 kHz, one frame per packet; all 5,000 received locally, zero UDP errors, recording and manifest hashes verified. An earlier measured repeat reached approximately 3,993 packets/sec over 1.252 seconds, with one pacing deadline miss. The final run during parallel web build/model training reached 3,995.27 packets/sec over 1.25148 seconds with **410 pacing deadline misses**, while still receiving all 5,000 packets. Throughput and packet receipt do not establish deadline reliability; shared-host load materially affected pacing. The final receipt is `tmp/final-native-tests.log`. This short local test does not establish loss-free hardware/network acquisition.
- Ten-second soak at 256 channels / 2 kHz: 20,000 frames, 1,250 packets, ring capped at 4,000 frames, RSS remained 5,536 KiB, zero pacing misses. The completed one-hour synthetic ring/RSS receipt contains **7,200,000 frames, 450,000 packets, 4,000 resident ring frames, RSS 4,880–5,536 KiB and 35 pacing deadline misses** over 3,600 seconds (`/tmp/morpheus-native-soak-3600-20261006.json`). This is a bounded-memory synthetic result; it does not exercise recorded storage, network delivery or amplifier hardware, and the deadline misses prevent a zero-jitter claim.
- Disk budget failure, SIGTERM during a long low-rate batch interval, abrupt SIGKILL and invalid configuration paths pass.
- Public C++ HTTP process passes health/build metadata, Vercel route prefixes, method rejection, 8 KiB header rejection, two-second deadlines and 25 raw-socket framing rejection cases (Host, header syntax, ambiguous lengths, Transfer-Encoding and GET bodies). Local Docker is unavailable. The final production deployment `dpl_FQppbyggPUrGzkXRZB5NbJnKCACP` returned `status:ok`, `service:morpheus-cloud-cpp`, `plane:public-metadata` through `/api/cloud-cpp/health`; the preview and production receipts are recorded in `docs/VERCEL.md`. This is a health/metadata process, not a remote acquisition or durable model queue.

Single-run release microbenchmarks (aggregate operation throughput; these are in-process values):

| Operation | C++ operations/sec | Retained Rust operations/sec | Scope difference |
| --- | ---: | ---: | --- |
| Push 256-channel ring frame | 12,501,300 | 57,731,187 | C++ validates every value; Rust copies without finite checking |
| Encode 256 channels × 16 frames | 420,778 | 553,931 | C++ validates and uses caller storage; Rust allocates without finite checking |
| Decode 256 channels × 16 frames | 776,262 | 450,122 | C++ validates all values/exact length and reuses buffers; Rust allocates and accepts trailing bytes |
| 1,024-sample Hann FFT | 84,925 | 95,712 | C++ validates/reuses workspace; Rust allocates |
| RMS of 1,024 samples | 1,191,060 | 2,106,326 | C++ rejects nonfinite values; Rust has no finite-input check |

The ring timer groups 32 operations to reduce clock-resolution artifacts. Benchmarks include compiler barriers/`black_box` to retain measured work, warmup, and p50/p95/p99 output. Different validation and allocation contracts make these implementation comparisons rather than isolated language comparisons. Repeat on the deployment CPU and with actual device/storage/network load before assigning latency guarantees. SIMD is not required; explicit NEON/AVX paths and browser WASM remain unbenchmarked.

Sanitizer command:

```sh
cmake -S native/morpheus-core-cpp -B native/morpheus-core-cpp/build-sanitize \
  -DCMAKE_BUILD_TYPE=Debug -DMORPHEUS_SANITIZERS=ON -DMORPHEUS_BUILD_BENCHMARKS=OFF
cmake --build native/morpheus-core-cpp/build-sanitize --parallel 4
ctest --test-dir native/morpheus-core-cpp/build-sanitize --output-on-failure
```

## Cloud boundary

`services/morpheus-cloud-cpp` implements bounded public HTTP health and honest build/protocol metadata. Direct endpoints and their `/api/cloud-cpp/` equivalents support service routing that preserves the rewrite prefix. Its `Dockerfile.vercel` supports the current OCI deployment workflow documented by [Vercel Container Images](https://vercel.com/docs/functions/container-images); service routing can follow [Vercel Services](https://vercel.com/docs/services), both checked on 2026-10-06. The final project configuration registers this container alongside the frontend and Python public gateway. Configure project `PORT=8080` to match the unprivileged process. The preview and production deployments established remote OCI execution and final production health is recorded in `docs/VERCEL.md`. Production durable cloud jobs, authenticated metadata/model orchestration and operational access control remain separate acceptance gates. No ephemeral in-memory queue is represented as durable scientific execution. Local private model jobs are handled by the Python science adapter and persisted in SQLite, outside this public health service.
