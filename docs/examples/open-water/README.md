# Open water

Mechanisms: `tracking`, dimensions `2`.

Primary controls rise/fall; steer in [-1,1] controls lateral acceleration.

Both axes contribute to one capture fraction, which drives progress, strain and fatigue. Replace the rectangle capture with a polygon and optional hole to change the region itself. Canonical circle/oval/ring/triangle/starburst vertices are in ../shared/catalog.json; copy the rings into {"kind":"polygon","rings":[...]}. Never regenerate those vertices with platform-specific trigonometry. The ring requires an offset to track its rim.

- [definition.json](definition.json): mechanisms, base parameters, capture, hook allowance.
- [loadout.json](loadout.json): complete numeric fish, rod and bait profiles.

Resolve these two data files with seed 42, create state from the returned seed/config, then provide one input per 1/60 simulated second. No example-specific transition function is needed.

From the package root:

```sh
cargo run --locked --example play -- open-water
```

The headless host supplies a simple feedback controller. The browser supplies human input and rendering. Neither changes the protocol.
