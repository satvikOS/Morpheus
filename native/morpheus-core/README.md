# morpheus-core

Rust-native bounded signal primitives for latency-sensitive Morpheus components.

The initial crate provides a fixed-capacity, preallocated multi-channel ring buffer with:

- deterministic memory after construction
- synchronized frame writes
- per-channel snapshots
- interleaved snapshots
- unit tests for wraparound and synchronization
- no external dependencies

This is intentionally not wired into the Vercel web build. The browser keeps its own bounded typed-array buffer. The Rust crate is for the local/native execution plane where profiling justifies moving acquisition-side DSP and transport work out of Python.

Planned evolution:

1. C ABI / Python extension boundary
2. zero-copy frame views where safe
3. SIMD filters after benchmarking
4. artifact/quality metrics
5. multi-stream clock-aligned buffering
6. optional GPU staging buffers
