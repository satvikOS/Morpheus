#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TASK_BUILD=${MORPHEUS_NATIVE_BUILD:-"$TASK_ROOT/native/morpheus-core-cpp/build"}
cmake -S "$TASK_ROOT/native/morpheus-core-cpp" -B "$TASK_BUILD" -DCMAKE_BUILD_TYPE=Release
cmake --build "$TASK_BUILD" --parallel 4
ctest --test-dir "$TASK_BUILD" --output-on-failure
if command -v rustc >/dev/null 2>&1; then
  rustc --edition 2021 -O -A dead_code "$TASK_ROOT/native/morpheus-core-cpp/tools/rust_reference.rs" -o "$TASK_BUILD/morpheus_rust_reference"
fi
python3 "$TASK_ROOT/scripts/native-parity.py" "$TASK_BUILD"
python3 "$TASK_ROOT/scripts/native-integration.py" "$TASK_BUILD"
