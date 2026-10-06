#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TASK_BUILD=${MORPHEUS_NATIVE_BUILD:-"$TASK_ROOT/native/morpheus-core-cpp/build"}
cmake -S "$TASK_ROOT/native/morpheus-core-cpp" -B "$TASK_BUILD" -DCMAKE_BUILD_TYPE=Release
cmake --build "$TASK_BUILD" --parallel 4
"$TASK_BUILD/morpheus_benchmark"
if command -v rustc >/dev/null 2>&1; then
  rustc --edition 2021 -O -A dead_code "$TASK_ROOT/native/morpheus-core-cpp/bench/rust_benchmark.rs" -o "$TASK_BUILD/morpheus_rust_benchmark"
  "$TASK_BUILD/morpheus_rust_benchmark"
else
  echo 'Rust comparator unavailable; retained implementation must not be removed.' >&2
fi
