# Give and take

Mechanisms: `pressure`, dimensions `0`.

Hold the primary button to reel; release to ease tension.

The original three-resource feedback loop has no spatial state. This tick’s primary input determines pressure; old tension determines fatigue. The rest/warning/surge cycle modulates fish effort. Window size, spatial handling, fish travel parameters and tackle geometry are inactive.

- [definition.json](definition.json): mechanisms, base parameters, capture, hook allowance.
- [loadout.json](loadout.json): complete numeric fish, rod and bait profiles.

Resolve these two data files with seed 42, create state from the returned seed/config, then provide one input per 1/60 simulated second. No example-specific transition function is needed.

From the package root:

```sh
cargo run --locked --example play -- give-and-take
```

The headless host supplies a simple feedback controller. The browser supplies human input and rendering. Neither changes the protocol.
