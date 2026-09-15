import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig, createState, step, observe, MAX_TICKS } from '../../playground/engine.mjs';

const config = createConfig();
const frozen = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};
function hook(seed = 42, cfg = config) {
  let state = step(createState(seed), { lift: 1 }, cfg).state;
  while (state.phase === 'waiting') state = step(state, { lift: 0 }, cfg).state;
  assert.equal(state.phase, 'bite');
  return step(state, { lift: 1 }, cfg).state;
}

test('one transition is pure, deterministic and JSON serializable', () => {
  const state = frozen(createState(42));
  const input = frozen({ lift: 1 });
  const cfg = frozen(createConfig());
  const before = JSON.stringify([state, input, cfg]);
  const a = step(state, input, cfg);
  assert.deepEqual(a, step(state, input, cfg));
  assert.equal(JSON.stringify([state, input, cfg]), before);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  assert.equal(a.state.phase, 'waiting');
  assert.deepEqual(a.events, ['cast']);
});

test('a fresh press is required at the bite; preholding cannot auto-hook', () => {
  let held = createState();
  for (let i = 0; i < MAX_TICKS && !['caught', 'escaped'].includes(held.phase); i++) held = step(held, { lift: 1 }, config).state;
  assert.equal(held.reason, 'missed_bite');
  assert.equal(hook().phase, 'struggle');
});

test('alignment controls progress, strain, and fatigue independently of lift', () => {
  const state = { ...hook(), tension: 0.6, energy: 0.9, behavior: 'surge', fishPosition: 0.5, tacklePosition: 0.5 };
  const aligned = observe(state, config);
  const missed = observe({ ...state, tacklePosition: 0.15 }, config);
  assert.equal(aligned.alignment, 1);
  assert.equal(missed.alignment, 0);
  assert.ok(aligned.progressRate > 0 && missed.progressRate < 0);
  assert.ok(aligned.targetTension < missed.targetTension);
  assert.ok(aligned.energyRate < 0 && missed.energyRate > 0);
  assert.deepEqual(observe({ ...state, lift: 1 }, config), observe({ ...state, lift: 0 }, config));
});

test('lift drives inertial tackle motion; boundaries clear outward velocity', () => {
  const state = hook();
  const up = step(state, { lift: 1 }, config).state;
  const down = step(state, { lift: 0 }, config).state;
  assert.ok(up.tacklePosition > state.tacklePosition && up.tackleVelocity > 0);
  assert.ok(down.tacklePosition < state.tacklePosition && down.tackleVelocity < 0);
  const top = step({ ...state, tacklePosition: 1 - config.windowSize / 2, tackleVelocity: 0.9 }, { lift: 1 }, config).state;
  assert.equal(top.tacklePosition, 1 - config.windowSize / 2);
  assert.equal(top.tackleVelocity, 0);
});

test('perfect alignment stays safe at maximum strength and base tension', () => {
  const cfg = createConfig({ strength: 1.6, baseTension: 0.5, response: 0.3 });
  const state = { ...hook(42, cfg), behavior: 'surge', energy: 1, tension: 0.999 };
  assert.ok(observe(state, cfg).targetTension < 1);
  const next = step(state, { lift: 0 }, cfg).state;
  assert.equal(next.phase, 'struggle');
  assert.ok(next.tension < state.tension);
});

test('partial overlap is continuous and exhausted fish move more slowly', () => {
  const state = { ...hook(), fishPosition: 0.5, tacklePosition: 0.5 - config.windowSize / 2 };
  assert.ok(Math.abs(observe(state, config).alignment - 0.5) < 1e-10);
  const fresh = { ...state, behavior: 'surge', fishTarget: 0.9, fishVelocity: 0.5, energy: 1 };
  const tired = { ...fresh, energy: 0.1 };
  assert.ok(step(fresh, { lift: 1 }, config).state.fishVelocity > step(tired, { lift: 1 }, config).state.fishVelocity);
});

function trackingInput(state) {
  const error = state.fishPosition + state.fishVelocity * 0.12 - state.tacklePosition;
  return { lift: 10 * error + 2 * (state.fishVelocity - state.tackleVelocity) > 0 ? 1 : 0 };
}

test('tracking can land every preset; holding still is not a universal winning strategy', () => {
  for (const cfg of [config, createConfig({ strength: 0.7, surge: 0.9, rest: 0.8, fatigue: 0.18, fishSpeed: 0.45 }), createConfig({ strength: 1.3, surge: 2.3, rest: 1.8, fatigue: 0.065, fishSpeed: 0.28 })]) {
    for (const seed of [1, 7, 42, 321]) {
      let state = hook(seed, cfg);
      while (state.phase === 'struggle') state = step(state, trackingInput(state), cfg).state;
      assert.equal(state.phase, 'caught', `seed ${seed}, config ${JSON.stringify(cfg)}`);
    }
  }
  for (const lift of [0, 1]) {
    let state = hook();
    while (state.phase === 'struggle') state = step(state, { lift }, config).state;
    assert.equal(state.phase, 'escaped');
  }
});

test('all reachable trajectories stay bounded, including adversarial input and extreme configs', () => {
  for (let seed = 0; seed < 100; seed++) {
    const cfg = createConfig({ strength: seed % 2 ? 1.6 : 0.4, surge: seed % 3 ? 3 : 0.5, rest: seed % 2 ? 0.4 : 3, fatigue: seed % 2 ? 0.03 : 0.25, fishSpeed: seed % 2 ? 0.65 : 0.15, windowSize: seed % 3 ? 0.12 : 0.45 });
    let state = hook(seed, cfg);
    while (state.phase === 'struggle') {
      const lift = [0, 1, 0.5, -10, 20, NaN, Infinity][(state.tick * 17 + seed) % 7];
      state = step(frozen(state), frozen({ lift }), cfg).state;
      for (const key of ['progress', 'tension', 'energy', 'lift', 'fishPosition', 'fishTarget', 'tacklePosition']) assert.ok(Number.isFinite(state[key]) && state[key] >= 0 && state[key] <= 1, key);
      assert.ok(Math.abs(state.tackleVelocity) <= 0.9);
      assert.ok(Math.abs(state.fishVelocity) <= cfg.fishSpeed * 1.7);
      assert.ok(state.tacklePosition >= cfg.windowSize / 2 && state.tacklePosition <= 1 - cfg.windowSize / 2);
      for (const key of ['tick', 'phaseTicks', 'behaviorTicks', 'behaviorDuration', 'duration']) assert.ok(Number.isInteger(state[key]) && state[key] >= 0 && state[key] <= MAX_TICKS, key);
      assert.ok(Number.isInteger(state.rng) && state.rng >= 0 && state.rng <= 0xffffffff);
    }
    assert.ok(state.tick <= MAX_TICKS);
  }
});

test('timeouts and simultaneous win/loss have explicit precedence; terminal states absorb', () => {
  const starting = hook();
  const timeout = step({ ...starting, tick: MAX_TICKS - 1 }, { lift: 0 }, config);
  assert.equal(timeout.state.reason, 'timeout');
  const raceConfig = createConfig({ strength: 1.6, reelRate: 0.2, escapeRate: 0.02 });
  const collision = step({ ...starting, progress: 0.9999, tension: 0.9999, behavior: 'surge', energy: 1, fishPosition: 0.5, tacklePosition: 0.5 - raceConfig.windowSize / 2 }, { lift: 1 }, raceConfig);
  assert.equal(collision.state.reason, 'line_broke');
  assert.deepEqual(step(collision.state, { lift: 1 }, config), { state: collision.state, events: [] });
});

test('a serialized input record replays every snapshot, and resumed snapshots agree', () => {
  let state = createState(17), lift = 0;
  const states = [state], inputs = [];
  for (let count = 0; count < MAX_TICKS && !['caught', 'escaped'].includes(state.phase); count++) {
    if (state.phase === 'ready' || state.phase === 'bite') lift = 1;
    else if (state.phase === 'waiting') lift = 0;
    else lift = trackingInput(state).lift;
    const input = { lift };
    state = step(state, input, config).state;
    inputs.push(input); states.push(state);
  }
  assert.equal(state.phase, 'caught');
  const wire = JSON.parse(JSON.stringify({ seed: 17, config, inputs, states }));
  let replay = createState(wire.seed);
  for (let i = 0; i < wire.inputs.length; i++) {
    replay = step(replay, wire.inputs[i], wire.config).state;
    assert.deepEqual(replay, wire.states[i + 1]);
  }
  const mid = Math.floor(inputs.length / 2);
  let resumed = wire.states[mid];
  for (let i = mid; i < inputs.length; i++) resumed = step(resumed, inputs[i], config).state;
  assert.deepEqual(resumed, state);
});

test('configuration and seed normalization reject non-finite state', () => {
  assert.equal(createState(NaN).rng, 42);
  assert.equal(createState(-1).rng, 0xffffffff);
  assert.throws(() => createConfig({ strength: NaN }), /finite/);
  assert.throws(() => createConfig({ strength: 100 }), /between/);
});
