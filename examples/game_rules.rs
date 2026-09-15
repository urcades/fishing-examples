//! Game-owned preparation, performance and rewards; none of these are protocol types.
use fishing::{create_state, observe, step, Config, Input, Phase, State, DT};

#[derive(Clone, Copy)]
enum GameRules {
    Equipment { rod_tier: u8 },
    Progression { skill_level: u8 },
}
fn prepare(rules: GameRules) -> Config {
    let bonus = match rules {
        GameRules::Equipment { rod_tier } => f64::from(rod_tier.min(5)) * 0.04,
        GameRules::Progression { skill_level } => f64::from(skill_level.min(10)) * 0.02,
    };
    let mut config = Config::default();
    config.parameters.window_size = 0.2 + bonus;
    config
}
#[derive(Debug, Default, Clone, Copy, PartialEq)]
struct Performance {
    ticks: u32,
    aligned_ticks: u32,
    alignment_sum: f64,
}
fn record(old: Performance, before: &State, after: &State, alignment: f64) -> Performance {
    if before.phase != Phase::Struggle || after.tick == before.tick {
        return old;
    }
    // Resource integration reads the OLD geometry, including on the terminal tick.
    Performance {
        ticks: old.ticks + 1,
        aligned_ticks: old.aligned_ticks + u32::from(alignment >= 1.0 - 1e-12),
        alignment_sum: old.alignment_sum + alignment,
    }
}
#[derive(Debug, PartialEq)]
struct Reward {
    coins: u32,
    xp: u32,
    quality: &'static str,
}
fn reward(caught: bool, performance: Performance, base_price: u32, shore_distance: u8) -> Reward {
    if !caught {
        return Reward {
            coins: 0,
            xp: 0,
            quality: "none",
        };
    }
    // Illustrative economy policy, not a Stardew formula or a property of fishing.
    let perfect = performance.ticks > 0 && performance.aligned_ticks == performance.ticks;
    let premium = perfect && shore_distance >= 3;
    Reward {
        coins: if premium {
            base_price.saturating_mul(2)
        } else {
            base_price
        },
        xp: if perfect { 20 } else { 10 },
        quality: if premium { "premium" } else { "ordinary" },
    }
}
fn main() -> Result<(), String> {
    let c = prepare(GameRules::Equipment { rod_tier: 2 });
    assert_eq!(c, prepare(GameRules::Progression { skill_level: 4 }));
    let mut s = create_state(42, &c)?;
    let mut performance = Performance::default();
    while !s.is_terminal() {
        let primary = match s.phase {
            Phase::Ready | Phase::Bite => 1.0,
            Phase::Struggle => {
                let m = s.motion.as_ref().unwrap();
                f64::from(
                    10.0 * (m.fish_position - m.tackle_position)
                        + 2.0 * (m.fish_velocity - m.tackle_velocity)
                        > 0.0,
                )
            }
            _ => 0.0,
        };
        let observation = observe(&s, &c)?;
        let next = step(
            &s,
            Input {
                primary,
                steer: 0.0,
            },
            &c,
        )?;
        performance = record(performance, &s, &next.state, observation.alignment);
        s = next.state;
    }
    println!(
        "Outcome: {:?}; struggle: {:.2}s; mean alignment: {:.3}",
        s.reason,
        f64::from(performance.ticks) * DT,
        performance.alignment_sum / f64::from(performance.ticks.max(1))
    );
    println!(
        "Game reward: {:?}",
        reward(s.phase == Phase::Caught, performance, 40, 4)
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn different_game_policies_produce_the_same_replay() {
        let a = prepare(GameRules::Equipment { rod_tier: 2 });
        let b = prepare(GameRules::Progression { skill_level: 4 });
        assert_eq!(a, b);
        let mut x = create_state(42, &a).unwrap();
        let mut y = create_state(42, &b).unwrap();
        for i in 0..600 {
            let u = Input {
                primary: if i % 7 < 3 { 1.0 } else { 0.0 },
                steer: 0.0,
            };
            let rx = step(&x, u, &a).unwrap();
            let ry = step(&y, u, &b).unwrap();
            assert_eq!(rx, ry);
            x = rx.state;
            y = ry.state;
        }
    }
    #[test]
    fn performance_uses_pre_step_geometry_and_includes_the_terminal_tick() {
        let mut c = prepare(GameRules::Equipment { rod_tier: 0 });
        c.parameters.wait_min = DT;
        c.parameters.wait_max = DT;
        c.parameters.reel_rate = 60.0;
        let mut s = create_state(42, &c).unwrap();
        let mut stats = Performance::default();
        for primary in [1.0, 0.0, 1.0, 0.0] {
            let q = observe(&s, &c).unwrap().alignment;
            let r = step(
                &s,
                Input {
                    primary,
                    steer: 0.0,
                },
                &c,
            )
            .unwrap();
            stats = record(stats, &s, &r.state, q);
            s = r.state;
        }
        assert_eq!(s.phase, Phase::Caught);
        assert_eq!(stats.ticks, 1);
        assert_eq!(stats.aligned_ticks, 1);
        assert_eq!(record(stats, &s, &s, 0.0), stats);
        assert_ne!(reward(true, stats, 40, 1), reward(true, stats, 40, 4));
        assert_eq!(reward(false, stats, 40, 4).coins, 0);
    }
}
