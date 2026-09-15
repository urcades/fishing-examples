# Independent Python port

`fishing.py` implements the same pure config/resolve/select/create_state/step/observe operations using Python dictionaries and the standard library. It reads `spec/parameters.json` for numeric defaults and bounds; ship that data with this port. It never loads the Rust library, runs the native CLI or invokes WebAssembly.

Run from the package root:

```sh
python3 conformance/check_python.py
```

Python's `round` and unbounded integers need explicit protocol handling: durations use `floor(seconds*60+.5)`, and RNG uses a 32-bit mask. Geometry uses the supplied polygon vertices and the same prescribed clipping order. Functions copy mutable inputs before updating them.

This is a readable conformance port, not an optimized production engine. A host can validate immutable configs once in its own trusted layer to avoid repeated geometry validation; do not remove validation at untrusted import boundaries. The reference port deliberately favors explicit checks over performance.
