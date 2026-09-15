# Fishing examples

Four playable fishing minigames built on the
[`fishing-protocol` Rust crate](https://github.com/urcades/fishing).
This repository owns the hosts and demonstration data; all gameplay dynamics
come from the imported crate, compiled natively or to WebAssembly.

## Play

```sh
git clone https://github.com/urcades/fishing-examples.git
cd fishing-examples
python3 -m http.server 8057 --bind 127.0.0.1
```

Open <http://127.0.0.1:8057/playground/>. The checked-in WASM binary lets the
static demo run without a Rust installation. Keyboard and on-screen controls,
loadout editing, state inspection, recording and replay are included.

[The four recipes](docs/examples/README.md) are reaction-only hooking,
pressure/release, vertical tracking, and two-axis geometric capture. Each has
portable definition/loadout JSON. Fish, rods, bait and capture shapes live in
`docs/examples/shared/catalog.json`.

## Build and run native hosts

```sh
rustup target add wasm32-unknown-unknown
sh scripts/build-wasm.sh
cargo run --locked --example play -- one-good-bite
cargo run --locked --example play -- open-water
cargo run --locked --bin fishing-json
```

The CLI accepts one JSON request per line and returns `{"ok": ...}` or
`{"error": "diagnostic"}`. For example:

```json
{"op":"create","seed":42,"config":{"mode":"hook","dimensions":0,"capture":{"kind":"rectangle"}}}
```

The JSON dispatcher and WASM allocation ABI live in `src/lib.rs`. They import
`fishing_protocol`; they contain no second implementation of its dynamics.
Requests are capped at 64 KiB. JavaScript owns inputs, rendering and memory
management; the WASM module has no host imports.

## Verify and port

```sh
sh scripts/check.sh
```

This checks formatting, Clippy, native conformance, the independent Python port,
rebuilt WASM conformance, and all 32 original gameplay regressions. No Node or
Python packages are needed. Cargo downloads the Rust dependencies.

[Conformance fixtures](conformance/README.md) cover 12 traces / 8,080 advancing
ticks, eight transition boundaries, 30 geometry cases, 24 loadout resolutions,
12 weighted draws and 17 invalid imports. The original tests additionally cover
192 fish/rod/bait/style combinations, six capture shapes, bounds and replay.
Expected outputs are preserved from the prototype; checks do not regenerate them.

The [protocol specification](https://github.com/urcades/fishing/blob/main/spec/PROTOCOL.md)
and the [wire schemas](spec/fishing.schema.json) describe the contract. The
[Python port](ports/python/README.md) is an independent implementation checked
against the same fixtures. Numeric tolerance is 1e−12; discrete state and events
must match exactly. This is bounded test evidence, not exhaustive equivalence.

Licensed under MIT OR Apache-2.0, at your option.
