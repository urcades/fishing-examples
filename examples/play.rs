//! Headless host: load a documented recipe, then provide a simple input policy.
use fishing_protocol::*;
use std::{env, fs, path::PathBuf};
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let folder = env::args().nth(1).unwrap_or_else(|| "one-good-bite".into());
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("docs/examples")
        .join(folder);
    let definition: Definition =
        serde_json::from_str(&fs::read_to_string(root.join("definition.json"))?)?;
    let loadout: Loadout = serde_json::from_str(&fs::read_to_string(root.join("loadout.json"))?)?;
    let encounter = resolve(&definition, &loadout, 42)?;
    let c = &encounter.config;
    let mut s = create_state(encounter.seed, c)?;
    while !s.is_terminal() {
        let primary = match s.phase {
            Phase::Ready | Phase::Bite => 1.0,
            Phase::Struggle if c.mode == Mode::Pressure => {
                if s.tension
                    < if s.behavior == Behavior::Surge {
                        0.68
                    } else {
                        0.85
                    }
                {
                    1.0
                } else {
                    0.0
                }
            }
            Phase::Struggle => {
                let m = s.motion.as_ref().unwrap();
                if 10.0 * (m.fish_position + m.fish_velocity * 0.12 - m.tackle_position)
                    + 2.0 * (m.fish_velocity - m.tackle_velocity)
                    > 0.0
                {
                    1.0
                } else {
                    0.0
                }
            }
            _ => 0.0,
        };
        let steer = s.motion.as_ref().map_or(0.0, |m| {
            let v = 10.0 * (m.fish_x + m.fish_velocity_x * 0.12 - m.tackle_x)
                + 2.0 * (m.fish_velocity_x - m.tackle_velocity_x);
            if v == 0.0 {
                0.0
            } else {
                v.signum()
            }
        });
        let next = step(&s, Input { primary, steer }, c)?;
        if !next.events.is_empty() {
            println!("{}", serde_json::to_string(&next)?);
        }
        s = next.state;
    }
    Ok(())
}
