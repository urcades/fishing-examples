/** Authoring profiles resolve once, before a cast. No catalog lookup in step. */
import { captureFor } from '../../../playground/protocol.mjs';
import { call } from '../../../playground/wasm.mjs';
import { FIELDS, FISH, RODS, BAITS, EXAMPLES } from './catalog.mjs';
export { FIELDS, FISH, RODS, BAITS };
import { SHAPES } from '../../../playground/geometry.mjs';
export const LOADOUT_VERSION = 1;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export function isActive(uses, style) {
  return uses === 'all' || (uses === 'struggle' && style !== 'bite') || (uses === 'spatial' && ['spatial', 'two-axis'].includes(style));
}

function profile(owner, base, edits = {}) {
  const allowed = FIELDS.filter(field => field.owner === owner);
  for (const key of Object.keys(edits)) if (!allowed.some(field => field.key === key)) throw new RangeError(`Unknown ${owner} attribute: ${key}`);
  const result = { ...base, ...edits, ...(base.affinity ? { affinity: { ...base.affinity } } : {}) };
  for (const field of allowed) {
    const value = result[field.key];
    if (!Number.isFinite(value)) throw new TypeError(`${owner}.${field.key} must be finite`);
    if (value < field.min || value > field.max) throw new RangeError(`${owner}.${field.key} must be between ${field.min} and ${field.max}`);
  }
  return result;
}
function validateExtras(fish, bait) {
  if (!Number.isFinite(fish.pondWeight) || fish.pondWeight <= 0 || fish.pondWeight > 10) throw new RangeError('Fish pond weight must be in (0,10]');
  for (const value of Object.values(bait.affinity)) if (!Number.isFinite(value) || value <= 0 || value > 5) throw new RangeError('Bait affinity must be in (0,5]');
}
export function resolveLoadout({ style = 'spatial', fish = FISH.perch, rod = RODS.willow, bait = BAITS.bare, shape = 'rectangle' } = {}) {
  // Copy before freezing. Resolution must not even freeze caller-owned data.
  const profiles = { fish: profile('fish', fish), rod: profile('rod', rod), bait: profile('bait', bait) };
  ({ fish, rod, bait } = profiles);
  validateExtras(fish, bait);
  if (!Object.hasOwn(SHAPES, shape)) throw new RangeError('Unknown tackle shape');
  const definition = EXAMPLES[style];
  if (!definition) throw new RangeError('Unknown fishing style');
  const affinity = bait.affinity[fish.preference] ?? 1;
  const native = call('resolve', { definition: { ...definition, capture: style === 'two-axis' ? captureFor(shape) : { kind: 'rectangle' } }, loadout: {fish: coreProfile('fish',fish), rod: coreProfile('rod',rod), bait: coreProfile('bait',bait)}, seed: 0 });
  const { notes } = native;
  const config = Object.freeze({ ...native.config.parameters, style, captureShape: style === 'two-axis' ? shape : 'rectangle' });
  const effects = [
    { owner: 'fish + bait', label: 'Wait', value: `${config.waitMin.toFixed(2)}–${config.waitMax.toFixed(2)} s`, active: true, detail: `1.5–3 s ÷ (${bait.attraction.toFixed(2)} attraction × ${affinity.toFixed(2)} preference).` },
    { owner: 'fish + bait', label: 'Bite', value: `${config.biteWindow.toFixed(2)} s`, active: true, detail: `${fish.biteWindow.toFixed(2)} s fish + ${style === 'bite' ? '.50' : '0'} s style + ${bait.biteBonus.toFixed(2)} s bait.` },
    { owner: 'fish', label: 'Pull / rhythm', value: `${fish.strength.toFixed(2)} · ${fish.surge.toFixed(1)} / ${fish.rest.toFixed(1)} s`, active: style !== 'bite', detail: 'Strength, then surge / rest durations.' },
    { owner: 'fish', label: 'Fatigue / recovery', value: `${fish.fatigue.toFixed(3)} / ${fish.recovery.toFixed(2)}`, active: style !== 'bite', detail: 'Larger fatigue means faster tiring; larger recovery means faster recovery when given room.' },
    { owner: 'fish', label: 'Movement', value: `${fish.fishSpeed.toFixed(2)}/s · home ${Math.round(fish.targetCenter * 100)}%`, active: isActive('spatial', style), detail: `Travel range ${Math.round(fish.targetSpread * 100)}%; rest wander ${fish.restWander.toFixed(2)}.` },
    { owner: 'rod', label: 'Window', value: `${Math.round(rod.windowSize * 100)}%`, active: isActive('spatial', style), detail: 'Bounding window width/height in normalized track units.' },
    { owner: 'rod', label: 'Handling', value: `${rod.tackleAcceleration.toFixed(1)} / ${rod.tackleDamping.toFixed(1)}`, active: isActive('spatial', style), detail: `Acceleration / damping; top speed ${rod.tackleSpeed.toFixed(2)}/s.` },
    { owner: 'rod', label: 'Reel / capacity', value: `${rod.reelRate.toFixed(3)}/s · ${rod.lineCapacity.toFixed(2)}×`, active: style !== 'bite', detail: 'Stronger line tolerates more effort; fatigue uses effort, not normalized line strain.' },
    { owner: 'tackle', label: 'Capture shape', value: `${SHAPES[shape].name} · ${Math.round(SHAPES[shape].area * 100)}% area`, active: style === 'two-axis', detail: `${SHAPES[shape].hint} Area is relative to the same bounding rectangle; shapes are not equal-area buffs.` },
  ];
  return freeze({ config, effects, notes, profiles });
}

function lookup(catalog, id, owner) {
  if (!Object.hasOwn(catalog, id)) throw new RangeError(`Unknown ${owner}: ${id}`);
  return catalog[id];
}
export function prepareEncounter({ style = 'spatial', fish = 'perch', rod = 'willow', bait = 'bare', shape = 'rectangle', seed = 42, fishEdits = {}, rodEdits = {}, baitEdits = {} } = {}) {
  const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 42;
  const b = profile('bait', lookup(BAITS, bait, 'bait'), baitEdits);
  const r = profile('rod', lookup(RODS, rod, 'rod'), rodEdits);
  const pool = Object.values(FISH);
  const selection = call('select', { pool: pool.map(f => coreProfile('fish',f)), bait: coreProfile('bait',b), seed: normalizedSeed });
  const odds = pool.map((f,i) => ({id:f.id,name:f.name,probability:selection.odds[i]}));
  let fishId = fish, simulationSeed = normalizedSeed;
  if (fish === 'pond') {
    if (Object.keys(fishEdits).length) throw new RangeError('Pin a fish before editing its attributes');
    fishId = pool[selection.index].id; simulationSeed = selection.seed;
  }
  const f = profile('fish', lookup(FISH, fishId, 'fish'), fishEdits);
  const resolved = resolveLoadout({ style, fish: f, rod: r, bait: b, shape });
  return freeze({ ...resolved, loadoutVersion: LOADOUT_VERSION, fishId, requestedFish: fish, rodId: rod, baitId: bait, shape,
    sourceSeed: normalizedSeed, seed: simulationSeed, odds,
  });
}

// Labels/descriptions never cross the protocol boundary.
function coreProfile(owner, p) {
  return Object.fromEntries([...FIELDS.filter(f => f.owner === owner).map(f => [f.key,p[f.key]]),
    ...(owner === 'fish' ? [['preference',p.preference],['pondWeight',p.pondWeight]] : owner === 'bait' ? [['affinity',p.affinity]] : [])]);
}
