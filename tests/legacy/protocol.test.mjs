import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createConfig, createState, step, observe, STYLES, MAX_TICKS, isTerminal } from '../../playground/protocol.mjs';

const freeze = object => Object.freeze(object);
function control(s) {
  let lift = +(s.phase === 'ready' || s.phase === 'bite');
  let steer = 0;
  if (s.phase === 'struggle') {
    lift = s.style === 'pressure' ? +(s.tension < (s.behavior === 'surge' ? .68 : .85))
      : +(10 * (s.fishPosition + s.fishVelocity * .12 - s.tacklePosition) + 2 * (s.fishVelocity - s.tackleVelocity) > 0);
    if (s.style === 'two-axis') steer = Math.sign(10 * (s.fishX + s.fishVelocityX * .12 - s.tackleX) + 2 * (s.fishVelocityX - s.tackleVelocityX));
  }
  return { lift, steer };
}
function run(style, seed = 42) {
  const config = createConfig({ style });
  let state = createState(seed, config);
  const states = [state], inputs = [];
  for (let i = 0; i < MAX_TICKS && !isTerminal(state); i++) {
    const input = control(state);
    state = step(freeze(state), freeze(input), config).state;
    states.push(state); inputs.push(input);
  }
  return { config, seed, state, states, inputs };
}
const digest = states => createHash('sha256').update(JSON.stringify(states)).digest('hex');

// Golden traces were captured BEFORE refactoring, from the accepted v2
// spatial engine and the saved original v1 pressure engine respectively.
test('the accepted spatial and original pressure trajectories are frozen', () => {
  const spatial = run('spatial').states.map(({ style, ...s }) => ({ ...s, version: 2 }));
  assert.equal(digest(spatial), 'd345e0627ca5d13163d155751d6b648fe32364e832871594b244fbe3a629d68d');
  const pressure = run('pressure').states.map(s => ({
    version: 1, tick: s.tick, phase: s.phase, phaseTicks: s.phaseTicks, duration: s.duration,
    behavior: s.behavior, behaviorTicks: s.behaviorTicks, behaviorDuration: s.behaviorDuration,
    progress: s.progress, tension: s.tension, energy: s.energy, pressure: s.lift, rng: s.rng, reason: s.reason,
  }));
  assert.equal(digest(pressure), 'e9715eaabdc1a1428f865645ecbaa2073e538dc212e9e08a3624bfee7de6c6f3');
});

test('bite-only skips struggle and lands on a fresh hook edge', () => {
  const r = run('bite');
  assert.equal(r.state.phase, 'caught');
  assert.equal(r.state.progress, 1);
  assert.equal(r.states.some(s => s.phase === 'struggle'), false);
  assert.ok(r.states.every(s => s.tension === 0 && s.energy === 1));
  const cfg = createConfig({ style: 'bite' });
  let held = createState(42, cfg);
  for (let i = 0; i < MAX_TICKS && !isTerminal(held); i++) held = step(held, { lift: 1 }, cfg).state;
  assert.equal(held.reason, 'missed_bite');
  const bite = r.states.find(s => s.phase === 'bite');
  assert.equal(step({ ...bite, phaseTicks: bite.duration - 1 }, { lift: 1 }, cfg).state.reason, 'missed_bite');
});

test('every example is catchable, serializable and replays every snapshot', () => {
  for (const style of STYLES) for (const seed of [1, 7, 42, 321]) {
    const r = JSON.parse(JSON.stringify(run(style, seed)));
    assert.equal(r.state.phase, 'caught', `${style}, seed ${seed}`);
    let state = createState(seed, r.config);
    for (let i = 0; i < r.inputs.length; i++) {
      const before = JSON.stringify(state);
      const result = step(freeze(state), r.inputs[i], r.config);
      assert.equal(JSON.stringify(state), before);
      state = result.state;
      assert.deepEqual(state, r.states[i + 1]);
    }
    assert.strictEqual(step(state, { lift: 1, steer: 1 }, r.config).state, state);
  }
});

test('two-axis overlap couples both axes to the same resource rates', () => {
  const cfg = createConfig({ style: 'two-axis' });
  const s = { ...createState(42, cfg), phase: 'struggle', behaviorDuration: 60, behavior: 'surge', tension: .5, energy: .9 };
  const aligned = observe(s, cfg), missed = observe({ ...s, tackleX: .15 }, cfg);
  assert.equal(aligned.alignment, 1);
  assert.equal(missed.alignment, 0);
  assert.ok(aligned.progressRate > 0 && missed.progressRate < 0);
  assert.ok(aligned.targetTension < missed.targetTension);
  const half = observe({ ...s, tackleX: .5 - cfg.windowSize / 2 }, cfg);
  assert.ok(Math.abs(half.alignment - .5) < 1e-10);
  const right = step(s, { lift: 1, steer: 1 }, cfg).state;
  const left = step(s, { lift: 1, steer: -1 }, cfg).state;
  assert.ok(right.tackleX > s.tackleX && left.tackleX < s.tackleX);
});

test('new dimensions and all variants remain bounded under adversarial input', () => {
  for (const style of STYLES) for (let seed = 0; seed < 24; seed++) {
    const cfg = createConfig({ style, windowSize: seed % 2 ? .12 : .45, fishSpeed: seed % 2 ? .65 : .15 });
    let s = createState(seed, cfg);
    for (let i = 0; i < MAX_TICKS && !isTerminal(s); i++) {
      const input = s.phase === 'struggle' ? { lift: [NaN, -1, .5, 2][i % 4], steer: [Infinity, -4, 0, 5][i % 4] } : control(s);
      s = step(s, input, cfg).state;
      for (const key of ['progress', 'tension', 'energy', 'fishPosition', 'tacklePosition', ...(style === 'two-axis' ? ['fishX', 'tackleX', 'fishTargetX'] : [])]) assert.ok(Number.isFinite(s[key]) && s[key] >= 0 && s[key] <= 1, key);
      if (style === 'two-axis') {
        assert.ok(Math.abs(s.tackleVelocityX) <= .9 && Math.abs(s.fishVelocityX) <= cfg.fishSpeed * 1.7);
        assert.ok(s.tackleX >= cfg.windowSize / 2 && s.tackleX <= 1 - cfg.windowSize / 2);
        assert.ok(s.steer >= -1 && s.steer <= 1);
      }
    }
    assert.ok(isTerminal(s) && s.tick <= MAX_TICKS);
  }
});

test('style is part of the wire contract and cannot change during an encounter', () => {
  assert.throws(() => createConfig({ style: 'unknown' }), /style/);
  assert.throws(() => step(createState(), { lift: 1 }, createConfig({ style: 'bite' })), /style/);
});
