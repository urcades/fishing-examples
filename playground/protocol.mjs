// Compatibility/presentation adapter for the accepted playground's v3 fields.
// This file translates data only. The public Rust wire schema is version 2.
import { call } from './wasm.mjs?v=0.2.0';
import { EXAMPLES, SHAPES } from '../docs/examples/shared/catalog.mjs?v=0.2.0';
export const HZ = 60, DT = 1 / HZ, MAX_TICKS = 3600, FISH_RADIUS = .03, VERSION = 3;
export const STYLES = Object.freeze(Object.keys(EXAMPLES));
export const isTerminal = state => ['caught', 'escaped'].includes(state.phase);
export const captureFor = id => id === 'rectangle' ? { kind: 'rectangle' } : { kind: 'polygon', rings: SHAPES[id].rings };
export function toCoreConfig(c) {
  const { style, captureShape, pattern = [], nibbles = {count:0,duration:.25,gap:.6}, maxTicks = 3600, ...parameters } = c;
  const example = EXAMPLES[style];
  if (!example) throw new RangeError('Unknown fishing style');
  return { mode: example.mode, dimensions: example.dimensions, pattern, nibbles, maxTicks, parameters, capture: example.dimensions === 2 ? captureFor(captureShape) : { kind: 'rectangle' } };
}
export function createConfig({ style = 'spatial', captureShape = 'rectangle', pattern = [], nibbles = {count:0,duration:.25,gap:.6}, maxTicks = 3600, ...overrides } = {}) {
  if (!STYLES.includes(style)) throw new RangeError('Unknown fishing style');
  if (!Object.hasOwn(SHAPES, captureShape)) throw new RangeError('Unknown tackle shape');
  const definition = EXAMPLES[style];
  const core = call('config', { config: { mode: definition.mode, dimensions: definition.dimensions, pattern, nibbles, maxTicks, parameters: { ...definition.parameters, biteWindow: 1.1 + definition.hookBonus, ...overrides }, capture: definition.dimensions === 2 ? captureFor(captureShape) : { kind: 'rectangle' } } });
  return Object.freeze({ ...core.parameters, style, captureShape, ...(pattern.length || nibbles.count || maxTicks !== 3600 ? { pattern: core.pattern, nibbles: core.nibbles, maxTicks: core.maxTicks } : {}) });
}
export function toCoreState(s, c) {
  const { version, style, lift, fishPosition, fishVelocity, fishTarget, tacklePosition, tackleVelocity, fishX, fishVelocityX, fishTargetX, tackleX, tackleVelocityX, steer, ...rest } = s;
  const d = EXAMPLES[c.style];
  if (style !== c.style || version !== VERSION) throw new RangeError('State and config style/version must match');
  return { version: 2, segmentIndex: 0, nibblesLeft: 0, mode: d.mode, dimensions: d.dimensions, ...rest, primary: lift,
    motion: d.mode === 'tracking' ? { fishPosition, fishVelocity, fishTarget, tacklePosition, tackleVelocity, fishX: fishX ?? .5, fishVelocityX: fishVelocityX ?? 0, fishTargetX: fishTargetX ?? .5, tackleX: tackleX ?? .5, tackleVelocityX: tackleVelocityX ?? 0, steer: steer ?? 0 } : null };
}
function fromCoreState(s, style) {
  const m = s.motion;
  // Key order intentionally preserves existing all-snapshot SHA regression tests.
  return { version: VERSION, tick: s.tick, phase: s.phase, phaseTicks: s.phaseTicks, duration: s.duration, behavior: s.behavior, behaviorTicks: s.behaviorTicks, behaviorDuration: s.behaviorDuration, progress: s.progress, tension: s.tension, energy: s.energy, lift: s.primary,
    fishPosition: m?.fishPosition ?? .5, fishVelocity: m?.fishVelocity ?? 0, fishTarget: m?.fishTarget ?? .5, tacklePosition: m?.tacklePosition ?? .5, tackleVelocity: m?.tackleVelocity ?? 0, rng: s.rng, reason: s.reason, style,
    ...(s.segmentIndex || s.nibblesLeft || s.phase === 'nibble' ? {segmentIndex:s.segmentIndex,nibblesLeft:s.nibblesLeft} : {}),
    ...(s.dimensions === 2 ? { steer: m.steer, fishX: m.fishX, fishVelocityX: m.fishVelocityX, fishTargetX: m.fishTargetX, tackleX: m.tackleX, tackleVelocityX: m.tackleVelocityX } : {}) };
}
export function createState(seed = 42, config = createConfig()) {
  return fromCoreState(call('create', { seed: Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 42, config: toCoreConfig(config) }), config.style);
}
export function step(state, input, config) {
  const result = call('step', { state: toCoreState(state, config), input: { primary: Number.isFinite(input.lift) ? input.lift : 0, steer: Number.isFinite(input.steer) ? input.steer : 0 }, config: toCoreConfig(config) });
  return { state: result.state.tick === state.tick ? state : fromCoreState(result.state, config.style), events: result.events };
}
export function observe(state, config) { return call('observe', { state: toCoreState(state, config), config: toCoreConfig(config) }); }
