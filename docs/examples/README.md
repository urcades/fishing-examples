# Four recipes, one protocol

| Recipe | Definition | Behavior |
| --- | --- | --- |
| [One good bite](one-good-bite/README.md) | hook / 0D | Fresh hook catches immediately. |
| [Pond tracking](pond-tracking/README.md) | tracking / 1D | Hold to rise; interval alignment reels automatically. |
| [Give and take](give-and-take/README.md) | pressure / 0D | Reel versus release changes progress, strain and fatigue. |
| [Open water](open-water/README.md) | tracking / 2D | Move in two axes; polygon overlap drives all three resources. |

Each folder has `definition.json` and `loadout.json`: complete portable authoring inputs accepted by `resolve`. Names and presentation text live here, never in the core. All examples use the same lifecycle and 60 Hz clock. The default loadouts retain the original tuning.

[shared/catalog.json](shared/catalog.json) holds the demonstration's four fish, three rods, four baits and six normalized capture shapes. Perch is the neutral fish; minnow is faster and tires sooner; carp is strong and persistent; loach prefers lower targets. Reed is responsive with a narrow window; Oak is slower with a wider window and stronger line. Bait preferences weight pond draws and waiting; bait persistence extends the hook window.

The `shared/loadout.mjs` file is browser authoring glue: catalog selection, metadata, editing and effect descriptions. Numeric resolution and random selection delegate to Rust. It is not required by native hosts. `shared/catalog.mjs` loads data for the browser; native hosts read JSON directly.

The browser keeps one in-memory loadout/recording per example, pauses when switching, and locks authoring during active/replayed recordings. Pause exposes single-tick input controls. Scrub inspects saved state; replay executes the same inputs through Rust and compares every snapshot. Reload clears browser sessions. The pure core retains no history.

Shapes currently share the rod's outer bounding window. Rectangle offers the most area; circle, oval, ring, triangle and starburst introduce different tracking constraints. Shape data remains fixed during a recording. No rotation, dynamic resizing, fish-specific shape bonus or automatic species-to-shape selection is included.

## Bringing your own game rules

These four recipes use the optional fish/rod/bait resolver. It is one authoring
model, not a requirement. [examples/game_rules.rs](../../examples/game_rules.rs)
shows two game-owned preparation policies producing identical encounter configs:
rod tier in one game, skill level in another. It then folds pre-step alignment into
performance statistics and applies host-owned quality, price and XP rules.

Run `cargo run --locked --example game_rules`; its tests run with `cargo test --all-targets`.
This is a headless integration example, not a fifth fishing mechanic. Shore distance
only affects its illustrative reward policy; it never enters the simulation state.
The reward rules and metadata are deliberately outside the crate.
