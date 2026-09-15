# Conformance and provenance

These expected values were captured from the accepted JavaScript demo **before** replacing its implementation with Rust. The source hashes are recorded in `fixtures/provenance.json`; the historical JS implementation is not included in this repository. The fixture files themselves are the checked-in contract; running checks never regenerates them.

- `fixtures/trajectories.json`: 12 full input sequences / 8,080 ticks, expected state at start, every 30 ticks, every event, and terminal; eight explicit boundary/precedence transitions. Check every event, including the absence of events between checkpoints.
- `fixtures/geometry.json`: 30 partial overlaps across rectangle, circle, oval, ring, triangle and starburst. Includes hole and edge cases with canonical vertices.
- `fixtures/invalid.json`: 17 invalid imports covering mode/dimension mismatches, ranges, unknown fields, impossible timers, malformed geometry and underflowed selection weights. Every implementation must reject them.
- `fixtures/resolution.json`: 24 profile resolutions across all mechanisms and rod tradeoffs; 12 weighted selections across four baits and boundary seeds.

Rust tests (`cargo test`) and independent Python (`python3 conformance/check_python.py`) consume exactly these files. `node conformance/check_wasm.mjs` checks the compiled Rust module through the same JSON bridge as the browser. Python never calls Rust/WASM/JavaScript. It uses only the standard library and the protocol's parameter-bound data.

Require exact strings, event ordering, integer counters and RNG. Require absolute numeric error <=1e−12 at checkpoints. Compare object keys as sets, not serialization order. Always test intermediate events; an identical final catch is not sufficient. Rounding numeric snapshots to presentation precision invalidates the record.

The original 32 tests under `tests/legacy` now run through the Rust/WASM presentation adapter. They retain original full-trajectory SHA hashes for spatial/pressure, adversarial bounds and replay tests, all 192 fish/rod/bait/style combinations with the rectangle, and all six shapes with the baseline loadout. These provide regression coverage beyond the portable checkpoint corpus.

A new port should:

1. Implement the wire records, checked config defaults and semantic validation.
2. Implement exact integer RNG/duration rules, then lifecycle and pressure.
3. Add movement, interval/polygon capture, profile resolution and selection.
4. Replay the stored inputs without deriving new control decisions from its own state.
5. Check every event and expected checkpoint, including resumption from serialized snapshots.
6. Add the language's validator tests and run a real host adapter before claiming production readiness.

The suite covers the four supported recipes; it is not exhaustive model checking or proof of equivalence across all valid configurations. All-shape/all-loadout difficulty balancing, long-term schema migrations and other CPU/compiler targets remain future validation work. A changed golden requires an explicit protocol/tuning decision with recorded provenance, never an automatic “accept current output” command.
