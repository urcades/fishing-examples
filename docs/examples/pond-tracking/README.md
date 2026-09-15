# Pond tracking

Mechanisms: `tracking`, dimensions `1`.

Hold the primary button to raise the tackle; release to let it fall.

Interval overlap is the fraction of the fish covered by the tackle. It drives automatic reeling, strain and fatigue. Fatigue reduces fish movement speed. This reproduces the accepted Stardew-inspired demo, with neutral gear preserving its earlier trajectory. Horizontal motion and polygon capture are inactive.

- [definition.json](definition.json): mechanisms, base parameters, capture, hook allowance.
- [loadout.json](loadout.json): complete numeric fish, rod and bait profiles.

Resolve these two data files with seed 42, create state from the returned seed/config, then provide one input per 1/60 simulated second. No example-specific transition function is needed.

From the package root:

```sh
cargo run --locked --example play -- pond-tracking
```

The headless host supplies a simple feedback controller. The browser supplies human input and rendering. Neither changes the protocol.
