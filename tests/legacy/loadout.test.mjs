import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, FISH, RODS, BAITS, resolveLoadout, prepareEncounter } from '../../playground/loadout.mjs';
import { createConfig, createState, step, observe, STYLES, MAX_TICKS, isTerminal } from '../../playground/protocol.mjs';

test('catalog values fit the sliders without browser rounding', () => {
  const catalogs = { fish: FISH, rod: RODS, bait: BAITS };
  for (const field of FIELDS) for (const profile of Object.values(catalogs[field.owner])) {
    const steps = (profile[field.key] - field.min) / field.step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `${profile.id}.${field.key}`);
  }
});

test('neutral loadouts preserve all existing fish tuning and consume no selection draw', () => {
  for (const style of STYLES) for (const fish of ['perch', 'minnow', 'carp']) {
    const e = prepareEncounter({ style, fish, seed: 42 });
    const f = FISH[fish];
    const expected = createConfig(style === 'bite' ? { style } : {
      style, strength: f.strength, surge: f.surge, rest: f.rest, fatigue: f.fatigue,
      ...(style === 'pressure' ? {} : { fishSpeed: f.fishSpeed }),
    });
    assert.deepEqual(e.config, expected);
    assert.equal(e.seed, 42);
    assert.equal(e.fishId, fish);
  }
});

test('resolution is pure, deeply immutable and survives JSON serialization', () => {
  const input = Object.freeze({ style: 'two-axis', fish: FISH.loach, rod: RODS.swift, bait: BAITS.worm });
  const before = JSON.stringify(input);
  const a = resolveLoadout(input);
  assert.deepEqual(a, resolveLoadout(JSON.parse(before)));
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(a.config) && Object.isFrozen(FISH.loach));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test('bait-weighted pond draws use explicit seed state and normalized probabilities', () => {
  const worm = prepareEncounter({ fish: 'pond', bait: 'worm', seed: 42 });
  assert.deepEqual(worm, prepareEncounter({ fish: 'pond', bait: 'worm', seed: 42 }));
  assert.notEqual(worm.seed, 42);
  assert.ok(Math.abs(worm.odds.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-12);
  const bare = prepareEncounter({ fish: 'pond', seed: 42 });
  assert.ok(worm.odds.find(x => x.id === 'perch').probability > bare.odds.find(x => x.id === 'perch').probability);
  const choices = new Set(Array.from({ length: 32 }, (_, i) => prepareEncounter({ fish: 'pond', seed: (i * 2654435761) >>> 0 }).fishId));
  assert.equal(choices.size, Object.keys(FISH).length);
});

test('bait changes real wait/hook timing; caps are visible in the report', () => {
  const bare = prepareEncounter({ seed: 42 });
  const worm = prepareEncounter({ seed: 42, bait: 'worm' });
  assert.ok(worm.config.waitMin < bare.config.waitMin);
  assert.ok(worm.config.biteWindow > bare.config.biteWindow);
  const cast = e => step(createState(e.seed, e.config), { lift: 1 }, e.config).state;
  assert.ok(cast(worm).duration < cast(bare).duration);
  const capped = prepareEncounter({ style: 'bite', fishEdits: { biteWindow: 2 }, baitEdits: { biteBonus: .5 } });
  assert.equal(capped.config.biteWindow, 2);
  assert.ok(capped.notes.some(note => note.includes('capped')));
});

test('inactive attributes stay inactive instead of secretly changing difficulty', () => {
  const original = prepareEncounter({ style: 'bite' });
  const changed = prepareEncounter({ style: 'bite', rod: 'sturdy', fishEdits: { strength: 1.6, fishSpeed: .65 } });
  assert.deepEqual(changed.config, original.config);
  assert.ok(changed.effects.filter(row => row.owner === 'rod').every(row => !row.active));
  const pressure = prepareEncounter({ style: 'pressure', rodEdits: { windowSize: .4, tackleAcceleration: 5 } });
  assert.deepEqual(pressure.config, createConfig({ style: 'pressure' }));
});

test('stronger line lowers normalized strain without reducing transmitted fatigue effort', () => {
  for (const style of ['spatial', 'pressure', 'two-axis']) {
    const normal = createConfig({ style, lineCapacity: 1 });
    const strong = createConfig({ style, lineCapacity: 1.5 });
    const s = { ...createState(42, normal), phase: 'struggle', behavior: 'surge', tension: .6, energy: .8, lift: 1 };
    const a = observe(s, normal), b = observe({ ...s, tension: .4 }, strong);
    assert.ok(Math.abs(a.energyRate - b.energyRate) < 1e-12);
    assert.ok(Math.abs(a.targetTension / 1.5 - b.targetTension) < 1e-12);
    assert.equal(a.progressRate, b.progressRate);
  }
});

test('rod handling and fish depth preference affect actual movement', () => {
  const a = prepareEncounter(), b = prepareEncounter({ rod: 'swift' });
  const s = { ...createState(42, a.config), phase: 'struggle', behaviorDuration: 100 };
  assert.ok(step(s, { lift: 1 }, b.config).state.tackleVelocity > step(s, { lift: 1 }, a.config).state.tackleVelocity);
  const loach = prepareEncounter({ fish: 'loach' });
  let fish = createState(42, loach.config);
  for (let i = 0; i < 250 && fish.phase !== 'struggle'; i++) fish = step(fish, { lift: +(fish.phase !== 'waiting') }, loach.config).state;
  assert.equal(fish.phase, 'struggle');
  assert.ok(fish.fishTarget < .5);
});

test('every catalog combination is bounded and catchable by a tracking policy', () => {
  for (const style of STYLES) for (const fish of Object.keys(FISH)) for (const rod of Object.keys(RODS)) for (const bait of Object.keys(BAITS)) {
    const e = prepareEncounter({ style, fish, rod, bait, seed: 42 });
    let s = createState(e.seed, e.config);
    for (let i = 0; i < MAX_TICKS && !isTerminal(s); i++) {
      const lift = s.phase !== 'struggle' ? +(s.phase !== 'waiting') : style === 'pressure'
        ? +(s.tension < (s.behavior === 'surge' ? .68 : .85))
        : +(10 * (s.fishPosition + s.fishVelocity * .12 - s.tacklePosition) + 2 * (s.fishVelocity - s.tackleVelocity) > 0);
      const steer = style === 'two-axis' ? Math.sign(10 * (s.fishX + s.fishVelocityX * .12 - s.tackleX) + 2 * (s.fishVelocityX - s.tackleVelocityX)) : 0;
      s = step(s, { lift, steer }, e.config).state;
      for (const key of ['progress', 'tension', 'energy', 'fishPosition', 'tacklePosition']) assert.ok(Number.isFinite(s[key]) && s[key] >= 0 && s[key] <= 1);
    }
    assert.equal(s.phase, 'caught', `${style}/${fish}/${rod}/${bait}: ${s.reason}`);
  }
});

test('a prepared pond encounter replays from its saved config and simulation seed', () => {
  const e = JSON.parse(JSON.stringify(prepareEncounter({ fish: 'pond', rod: 'swift', bait: 'dough', style: 'two-axis', seed: 12345 })));
  let a = createState(e.seed, e.config), b = createState(e.seed, e.config);
  for (let i = 0; i < 500; i++) {
    const input = { lift: +(a.phase !== 'waiting'), steer: i % 3 - 1 };
    a = step(a, input, e.config).state;
    b = step(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(input)), e.config).state;
    assert.deepEqual(a, b);
  }
});

test('invalid profile edits and unknown catalog IDs fail before a run starts', () => {
  assert.throws(() => prepareEncounter({ rod: 'missing' }), /rod/);
  assert.throws(() => prepareEncounter({ fishEdits: { strength: NaN } }), /finite/);
  assert.throws(() => prepareEncounter({ rodEdits: { lineCapacity: 0 } }), /between/);
  assert.throws(() => prepareEncounter({ baitEdits: { mysteryBuff: 1 } }), /Unknown/);
});
