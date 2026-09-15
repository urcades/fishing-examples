#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo build --locked --release --target wasm32-unknown-unknown --lib
task_target_dir=${CARGO_TARGET_DIR:-target}
cp "$task_target_dir/wasm32-unknown-unknown/release/fishing_examples.wasm" playground/fishing_protocol.wasm
