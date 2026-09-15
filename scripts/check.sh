#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
python3 conformance/check_python.py
sh scripts/build-wasm.sh
node --test tests/legacy/*.test.mjs
node conformance/check_wasm.mjs

node conformance/check_extensions.mjs
