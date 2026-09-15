# One good bite

Mechanisms: `hook`, dimensions `0`.

Press to cast, release, and press again when the float dips.

The definition adds 0.5 seconds to the fish bite window. A clean hook goes directly to caught, without creating motion or advancing struggle resources. Rod attributes and capture shapes are inactive. Preholding cannot hook; expiry takes precedence over a press on the expiry tick.

- [definition.json](definition.json): mechanisms, base parameters, capture, hook allowance.
- [loadout.json](loadout.json): complete numeric fish, rod and bait profiles.

Resolve these two data files with seed 42, create state from the returned seed/config, then provide one input per 1/60 simulated second. No example-specific transition function is needed.

From the package root:

```sh
cargo run --locked --example play -- one-good-bite
```

The headless host supplies a simple feedback controller. The browser supplies human input and rendering. Neither changes the protocol.
