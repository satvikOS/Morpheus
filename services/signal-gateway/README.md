# Morpheus Signal Gateway

The signal gateway is the local neuroscience ecosystem adapter for Morpheus. v0.7 separates the authoritative/native acquisition plane from the browser display plane.

## Local integrations

- Lab Streaming Layer discovery and chunk ingestion
- BrainFlow board/device ecosystem
- marker LSL outlet
- MRPH v1 binary batch relay
- WebRTC sample DataChannel
- binary WebSocket fallback
- optional native Rust UDP bridge
- local engineering recording
- offline PyNWB conversion

## Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-local.txt

export MORPHEUS_LOCAL_RECORDING_DIR="$HOME/morpheus-sessions"
export MORPHEUS_NATIVE_UDP_BIND=127.0.0.1:8790

uvicorn app.main:app --host 127.0.0.1 --port 8787
```

For the Rust native path:

```bash
export MORPHEUS_UDP_TARGET=127.0.0.1:8790
export MORPHEUS_RECORD_DIR="$HOME/morpheus-native-sessions"
cargo run --release --manifest-path ../../native/morpheus-gateway/Cargo.toml
```

Select `morpheus-native` from the workstation's discovered streams after the bridge receives its first MRPH packet.

## Transport semantics

Samples are delivered in binary MRPH frame batches. The browser ingestion Worker validates sequence numbers and keeps packet rate separate from frame/sample rate.

WebRTC is preferred for the local browser relay. WebSocket remains an explicit fallback; authoritative recording happens before either browser transport.

## Recording

`MORPHEUS_LOCAL_RECORDING_DIR` enables the Python engineering recorder. The native Rust gateway can independently record its MRPH packet stream when `MORPHEUS_RECORD_DIR` is configured.

The native recorder computes a SHA-256 digest after the finalized file is closed and writes a manifest alongside it.

For existing JSONL sessions:

```bash
python tools/jsonl_to_nwb.py /path/session.jsonl /path/session.nwb
```

For native MRPH recordings:

```bash
python tools/mrph_to_nwb.py /path/session.mrph /path/session.nwb
```

## Timing

Hosted Vercel instances are not considered stable marker-clock authorities. Real experimental timing belongs on the local acquisition plane. Software-synchronized markers retain uncertainty; hardware/DAQ triggers remain the reference for protocols requiring tighter bounds.
