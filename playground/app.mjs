import { createState, step, observe, HZ, DT, MAX_TICKS, FISH_RADIUS, isTerminal, toCoreConfig, toCoreState } from './protocol.mjs?v=0.2.0';
import { FISH, RODS, BAITS, PATTERNS, FIELDS, isActive, prepareEncounter } from './loadout.mjs?v=0.2.0';
import { SHAPES } from './geometry.mjs?v=0.2.0';
import { random } from './engine.mjs?v=0.2.0';

// This file is the effectful shell: browser events, a clock and DOM rendering.
// The engine can be imported by a completely different renderer unchanged.
const $ = id => document.getElementById(id);
const defaultLoadout = () => ({ fish: 'perch', rod: 'willow', bait: 'bare', shape: 'rectangle', behavior: 'classic', nibbleCount: 0, fishEdits: {}, rodEdits: {}, baitEdits: {} });
const examples = {
  spatial: { description: 'Follow the fish in one dimension. Neutral gear preserves the original feel.', instructions: 'Hold Space or the button to rise; release to fall. Reel automatically while aligned.' },
  bite: { description: 'An easy reaction game: one good hook lands the fish. No struggle.', instructions: 'Press to cast, release, then press again when the float dips. That’s the catch.' },
  pressure: { description: 'The original three-resource loop, with its state machine in view.', instructions: 'Hold Space or the button to reel. Release to lower tension; ease off during surges.' },
  'two-axis': { description: 'Track a fish across open water. Both axes contribute to alignment.', instructions: 'Space rises; release falls. ← → or A / D steer sideways. Reeling is automatic inside the box.' },
};
let loadout = defaultLoadout();
let seed = 42;
let encounter = prepareEncounter({ ...loadout, seed });
let config = encounter.config;
let state = createState(encounter.seed, config);
let frames = [state];
let inputs = [];
let events = [{ tick: 0, label: 'Ready for a cast' }];
let cursor = null;
let replay = null;
let running = true;
let held = false;
let pendingInputs = [];
let accumulator = 0;
let lastTime = null;
let lastRender = 0;
let pointerActivated = false;
let leftHeld = false, rightHeld = false;
let pendingSteering = [];
// At most four independent sessions, each with at most 3,601 snapshots.
// Switching stores references, not copies or another unbounded history.
const sessions = new Map();
const steerInput = () => Number(rightHeld) - Number(leftHeld);

function reset() {
  state = createState(encounter.seed, config);
  frames = [state]; inputs = []; events = [{ tick: 0, label: 'Ready for a cast' }];
  cursor = null; replay = null; running = true; held = false; pendingInputs = []; accumulator = 0;
  leftHeld = false; rightHeld = false; pendingSteering = [];
  $('replay-note').textContent = 'Scrub to inspect. Replay recomputes every state.';
  render();
}

function record(input) {
  const result = step(state, input, config);
  if (result.state === state) return;
  state = result.state;
  inputs.push(input); frames.push(state);
  if (result.events.length) events.push({ tick: state.tick, label: result.events.map(e => ({ cast: 'Cast → waiting', bite: 'Real bite → hook now', nibble: 'Nibble → keep waiting', hooked: config.style === 'bite' ? 'Hook set' : 'Bite → struggle', rest: 'Rest', warning: 'Warning', surge: 'Surge', caught: config.style === 'bite' ? 'Bite → caught' : 'Struggle → caught', escaped: `Escaped · ${state.reason?.replaceAll('_', ' ') ?? ''}` })[e]).join(' · ') });
  if (isTerminal(state)) { running = false; clearLift(); }
}

function replayTick() {
  if (!replay || replay.index >= inputs.length) return;
  replay.state = step(replay.state, inputs[replay.index], config).state;
  replay.index++;
  // Verify EVERY snapshot, not just the final outcome. Any mismatch stops here.
  if (JSON.stringify(replay.state) !== JSON.stringify(frames[replay.index])) {
    running = false;
    $('replay-note').textContent = `Replay mismatch at tick ${replay.index}.`;
    return;
  }
  if (replay.index === inputs.length) {
    $('replay-note').textContent = `Replay matched · all ${inputs.length} ticks identical.`;
    cursor = inputs.length; replay = null; running = false;
  }
}

function clearLift() { held = false; leftHeld = false; rightHeld = false; pendingInputs = []; pendingSteering = []; }
function setSteering(side, value) {
  const before = steerInput();
  if (side === 'left') leftHeld = value; else rightHeld = value;
  if (steerInput() === before) return;
  // Like the primary button, a quick sideways tap gets at least one tick.
  // Two edges per axis are enough; never retain a backlog of old gestures.
  if (pendingSteering.length === 2) pendingSteering[1] = steerInput();
  else pendingSteering.push(steerInput());
}
function queueLift(lift) {
  // Keep at most the first pending edge and the latest one. Sub-tick input
  // bursts must not turn into an unbounded queue or seconds of stale presses.
  if (pendingInputs.length === 2) pendingInputs[1] = { lift };
  else pendingInputs.push({ lift });
}
function goLive() {
  replay = null; cursor = null; clearLift(); accumulator = 0;
  running = !isTerminal(state); render();
  $('action').focus({ preventScroll: true });
}
function pause() {
  if (cursor !== null) return;
  running = !running; clearLift(); accumulator = 0; render();
  if (running) $('action').focus({ preventScroll: true });
}
function startPress() {
  if (replay || cursor !== null || (!running && !isTerminal(state))) return;
  if (isTerminal(state)) reset();
  if (!held) { held = true; queueLift(1); }
  render();
}
function release() {
  if (held) { held = false; queueLift(0); }
  render();
}

$('action').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerActivated = true;
  event.preventDefault();
  // The pointer handler prevents native focus. Restore it explicitly so
  // switching from settings or mouse controls to Space works immediately.
  $('action').focus({ preventScroll: true });
  $('action').setPointerCapture(event.pointerId);
  startPress();
});
$('action').addEventListener('click', () => {
  // Assistive technology may activate a button with a click and no pointer
  // events. Preserve that path without counting an ordinary pointer tap twice.
  if (!pointerActivated) { startPress(); release(); }
  pointerActivated = false;
});
$('action').addEventListener('pointerup', release);
$('action').addEventListener('pointercancel', () => { pointerActivated = false; release(); });
$('action').addEventListener('lostpointercapture', release);
// Queue edges separately from the sampled hold. A quick click must still be
// seen for one tick even when down and up arrive within one animation frame.
document.addEventListener('keydown', event => {
  if (event.target.isContentEditable || (event.target !== $('action') && event.target.matches('input, select, textarea, button, summary, a'))) return;
  if (config.style === 'two-axis' && ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) {
    event.preventDefault();
    if (running && !replay && cursor === null) {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') setSteering('left', true);
      else setSteering('right', true);
    }
    return;
  }
  if (event.code === 'Space' || (event.code === 'Enter' && event.target === $('action'))) {
    event.preventDefault(); if (!event.repeat) startPress();
  }
});
document.addEventListener('keyup', event => {
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') setSteering('left', false);
  if (event.code === 'ArrowRight' || event.code === 'KeyD') setSteering('right', false);
  if (event.code === 'Space' || event.code === 'Enter') release();
});
for (const side of ['left', 'right']) {
  const button = $(`steer-${side}`);
  const setHeld = value => setSteering(side, value);
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !running || replay || cursor !== null) return;
    event.preventDefault(); $('action').focus({ preventScroll: true }); button.setPointerCapture(event.pointerId); setHeld(true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => setHeld(false));
}
function suspend() {
  clearLift(); accumulator = 0;
  if (state.phase !== 'ready' || replay) running = false;
  render();
}
window.addEventListener('blur', suspend);
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
$('reset').addEventListener('click', () => { reset(); $('action').focus({ preventScroll: true }); });
$('pause').addEventListener('click', pause);
$('step').addEventListener('click', () => {
  if (cursor !== null) return;
  running = false; clearLift(); accumulator = 0;
  if (replay) replayTick();
  else record({ lift: Number($('step-input').value), steer: Number($('step-steer').value) });
  render();
});
$('timeline').addEventListener('input', event => {
  if (replay) return;
  cursor = Number(event.target.value); running = false; clearLift(); accumulator = 0; render();
});
$('live').addEventListener('click', goLive);
$('replay').addEventListener('click', () => {
  if (!inputs.length) return;
  replay = { state: createState(encounter.seed, config), index: 0 }; cursor = null; clearLift(); running = true; accumulator = 0;
  $('replay-note').textContent = 'Recomputing the recorded inputs, tick by tick…'; render();
});

// Build controls once. Resolution/reporting only run when authoring data
// changes, never per simulation tick or per DOM render.
for (const [id, p] of Object.entries(PATTERNS)) $('behavior-pattern').add(new Option(p.name, id));
for (const [id, catalog] of [['preset', FISH], ['rod', RODS], ['bait', BAITS], ['shape', SHAPES]]) {
  if (id === 'preset') $('preset').add(new Option('Pond draw · bait weighted', 'pond'));
  for (const item of Object.values(catalog)) $(id).add(new Option(item.name, item.id));
}
for (const owner of ['fish', 'rod', 'bait']) {
  const group = document.createElement('fieldset');
  const legend = document.createElement('legend'); legend.textContent = owner[0].toUpperCase() + owner.slice(1); group.append(legend);
  for (const field of FIELDS.filter(f => f.owner === owner)) {
    const row = document.createElement('div'); row.className = 'parameter'; row.dataset.uses = field.uses;
    const label = document.createElement('label'); label.htmlFor = field.key; label.textContent = field.label;
    const input = document.createElement('input'); Object.assign(input, { id: field.key, type: 'range', min: field.min, max: field.max, step: field.step });
    const output = document.createElement('output'); output.htmlFor = field.key;
    row.append(label, input, output); group.append(row);
    input.addEventListener('input', () => {
      const editsKey = `${owner}Edits`;
      loadout = { ...loadout, [editsKey]: { ...loadout[editsKey], [field.key]: Number(input.value) } };
      rebuildEncounter();
    });
  }
  $('attribute-fields').append(group);
}
function rebuildEncounter() {
  encounter = prepareEncounter({ ...loadout, seed, style: config.style });
  config = encounter.config;
  updateLoadoutView(); updateExampleView(); reset();
}
for (const [id, key] of [['preset', 'fish'], ['rod', 'rod'], ['bait', 'bait'], ['shape', 'shape']]) {
  $(id).addEventListener('change', () => {
    loadout = { ...loadout, [key]: $(id).value, ...(key !== 'shape' ? { [`${key}Edits`]: {} } : {}) };
    rebuildEncounter();
  });
}
function applySeed() {
  const value = Number($('seed').value);
  seed = Number.isFinite(value) ? Math.min(0xffffffff, Math.max(0, Math.trunc(value))) : 42;
  $('seed').value = seed; rebuildEncounter();
}
$('seed').addEventListener('change', applySeed);
$('seed').addEventListener('input', () => { if ($('seed').value !== '' && $('seed').validity.valid) applySeed(); });
$('next-seed').addEventListener('click', () => {
  seed = random(seed).rng; $('seed').value = seed; rebuildEncounter();
});
$('behavior-pattern').addEventListener('change', () => { loadout = {...loadout,behavior:$('behavior-pattern').value}; rebuildEncounter(); });
$('nibble-count').addEventListener('change', () => { loadout = {...loadout,nibbleCount:Number($('nibble-count').value)}; rebuildEncounter(); });
$('restore-loadout').addEventListener('click', () => {
  loadout = { ...loadout, fishEdits: {}, rodEdits: {}, baitEdits: {} }; rebuildEncounter();
});
function updateLoadoutView() {
  const { profiles, effects, notes } = encounter;
  $('behavior-pattern').value = loadout.behavior; $('nibble-count').value = String(loadout.nibbleCount);
  $('behavior-description').textContent = config.style === 'bite' ? 'No struggle: behavior patterns are inactive.' : PATTERNS[loadout.behavior].hint;
  $('preset').value = loadout.fish; $('rod').value = loadout.rod; $('bait').value = loadout.bait; $('shape').value = loadout.shape;
  for (const owner of ['fish', 'rod', 'bait']) {
    const tuned = Object.keys(loadout[`${owner}Edits`]).length ? ' Tuned.' : '';
    $(`${owner}-description`).textContent = profiles[owner].description + tuned + (owner === 'rod' && config.style === 'bite' ? ' Inactive in bite-only.' : '');
  }
  $('shape-description').textContent = config.style === 'two-axis' ? SHAPES[loadout.shape].hint : 'Shape is active in Open water only; this style keeps its original capture rules.';
  $('encounter-label').textContent = `${profiles.fish.name}${loadout.fish === 'pond' ? ' · seeded pond draw' : ' · pinned fish'} · ${profiles.rod.name.split(' · ')[0]} · ${profiles.bait.name.split(' · ')[0]}`;
  $('loadout-summary').textContent = `Hook ${config.biteWindow.toFixed(2)} s · wait ${config.waitMin.toFixed(2)}–${config.waitMax.toFixed(2)} s`;
  $('effects-list').replaceChildren();
  for (const effect of effects) {
    const row = document.createElement('div'); row.className = `effect-row ${effect.active ? '' : 'inactive'}`;
    const label = document.createElement('span'); label.textContent = effect.label;
    const value = document.createElement('strong'); value.textContent = effect.value;
    const detail = document.createElement('small'); detail.textContent = `${effect.owner} · ${effect.active ? effect.detail : 'Inactive in this style.'}`;
    row.append(label, value, detail); $('effects-list').append(row);
  }
  $('odds-label').textContent = loadout.fish === 'pond' ? `Pond draw weights · preview: ${profiles.fish.name}` : 'Pond draw weights · inactive while a fish is pinned';
  $('fish-odds').replaceChildren();
  for (const fish of encounter.odds) {
    const row = document.createElement('div'); row.className = 'odds-row';
    const label = document.createElement('span'); label.textContent = fish.name;
    const bar = document.createElement('meter'); bar.min = 0; bar.max = 1; bar.value = fish.probability; bar.setAttribute('aria-label', `${fish.name} pond probability`);
    const value = document.createElement('output'); value.textContent = `${(fish.probability * 100).toFixed(1)}%`;
    row.append(label, bar, value); $('fish-odds').append(row);
  }
  $('resolution-notes').textContent = notes.join(' ');
  $('resolved-config').textContent = JSON.stringify({ loadoutVersion: encounter.loadoutVersion, selection: loadout, sourceSeed: seed, simulationSeed: encounter.seed, fishId: encounter.fishId, profiles, config: toCoreConfig(config) }, null, 2);
  for (const field of FIELDS) {
    const value = profiles[field.owner][field.key]; $(field.key).value = value;
    const percent = ['windowSize', 'targetCenter', 'targetSpread'].includes(field.key);
    document.querySelector(`output[for="${field.key}"]`).value = percent ? `${Math.round(value * 100)}%` : `${value.toFixed(['fatigue', 'reelRate'].includes(field.key) ? 3 : 2)}${field.unit ? ` ${field.unit}` : ''}`;
    $(field.key).closest('.parameter').classList.toggle('inactive', !isActive(field.uses, config.style));
  }
}

function switchExample(style) {
  if (style === config.style) return;
  sessions.set(config.style, { config, seed, loadout, encounter, state, frames, inputs, events, cursor, replay,
    replayNote: $('replay-note').textContent });
  clearLift(); accumulator = 0;
  const saved = sessions.get(style);
  if (saved) {
    ({ config, seed, loadout, encounter, state, frames, inputs, events, cursor, replay } = saved);
    $('replay-note').textContent = saved.replayNote;
    running = state.phase === 'ready' && cursor === null && replay === null;
  } else {
    loadout = defaultLoadout(); seed = 42;
    encounter = prepareEncounter({ ...loadout, style, seed }); config = encounter.config;
    reset();
  }
  $('seed').value = seed;
  updateLoadoutView(); updateExampleView(); render();
  if (running) $('action').focus({ preventScroll: true });
}
$('example').addEventListener('change', event => switchExample(event.target.value));

const spatialEquations = $('equations').textContent;
function updateExampleView() {
  const style = config.style;
  document.body.dataset.style = style;
  $('example').value = style;
  $('example-description').textContent = examples[style].description;
  $('spatial-play').hidden = !['spatial', 'two-axis'].includes(style);
  $('bite-play').hidden = style !== 'bite';
  $('pressure-play').hidden = style !== 'pressure';
  $('machine-details').hidden = style === 'pressure' || style === 'bite';
  (style === 'pressure' ? $('pressure-machine-slot') : $('machine-details')).append($('shared-machine'));
  $('gauges').hidden = style === 'bite'; $('history-chart').hidden = style === 'bite';
  $('steering-controls').hidden = style !== 'two-axis';
  $('axis-alignment').hidden = style !== 'two-axis';
  $('tracking-title').textContent = style === 'two-axis' ? 'Follow in both directions.' : 'Keep the fish inside.';
  $('tracking-instructions').innerHTML = style === 'two-axis' ? 'Space to rise, release to fall.<br>Arrow keys to steer left and right.' : 'Hold to raise the tackle.<br>Release to let it fall.';
  $('step-input').options[0].textContent = style === 'pressure' ? 'Release / ease off' : style === 'bite' ? 'Release' : 'Release / fall';
  $('step-input').options[1].textContent = style === 'pressure' ? 'Hold / reel' : style === 'bite' ? 'Press / hook' : 'Hold / rise';
  $('capture-path').setAttribute('d', SHAPES[config.captureShape].path);
  $('water-column').dataset.shape = config.captureShape;
  $('function-description').textContent = style === 'bite' ? 'The hook edge takes the shared lifecycle directly from bite to caught. There are no struggle updates, hidden reeling, or resource costs.'
    : style === 'pressure' ? 'The original pressure equations read this tick’s button input and the old progress, tension, and energy. The same lifecycle handles casting, bites, outcomes, and time bounds.'
    : 'One tick reads old positions and energy, derives alignment, and computes all three resource rates. Motion then updates bounded velocities and positions. Rendering and clocks stay outside the function.';
  const spatialWithGear = spatialEquations.replace('T_target = baseTension × q + F × (0.3 + 1.1 × (1 − q))', 'C = line capacity; effort = T × C\nT_target = (baseTension × q + F × (0.3 + 1.1 × (1 − q))) / C')
    .replace('fatigue × q × T × E', 'fatigue × q × effort × E').replace('(2 × lift − 1) × 3.2 − 3.8 × velocity', '(2 × lift − 1) × acceleration − damping × velocity');
  $('equations').textContent = style === 'bite' ? 'ready → waiting → bite → caught\n                     ↘ escaped\n\nWait = (1.5…3 s) / (attraction × fish preference)\nBite = fish bite + style allowance + bait bonus\nFresh press before bite expiry: caught\nStruggle phase: skipped'
    : style === 'pressure' ? 'u = button pressure (0 or 1)\nF = strength × E × behavior\nC = line capacity; effort = T × C\nΔP = (reelRate × u − escapeRate × F × (1 − u)) × dt\nT_target = u × (baseTension + F) / C\nΔT = (T_target − T) / response × dt\nΔE = (recovery × (1 − u) × (1 − E) − fatigue × effort × E) × dt'
    : style === 'two-axis' ? spatialWithGear.replace('q = overlap(fish, tackle window) / fish height', 'q = area(fish box ∩ capture shape) / area(fish box)\nRectangle: q = qx × qy; ring: outer overlap − hole overlap').concat('\nSideways acceleration = steer × acceleration − damping × sideways velocity') : spatialWithGear;
  $('function-note').textContent = style === 'bite' ? `Resolved reaction window: ${config.biteWindow.toFixed(2)} s. Rod and shape attributes are inactive. A press on the expiry tick is too late.`
    : style === 'pressure' ? 'The primary input controls reeling pressure. Neutral loadouts preserve the original v1 trajectories. Capacity separates line strain from fatigue effort.'
    : style === 'two-axis' ? 'Shapes use the same bounded polygons for SVG and scoring. Circles use 48 sides; ring holes really exclude capture. Different shapes have different areas at the same window size.'
    : 'Neutral gear preserves the accepted spatial tuning. Hold = lift 1; release = lift 0. Positions and resources stay in [0,1]; velocities are bounded by the rod.';
}

function statusFor(s) {
  if (s.phase === 'ready') return 'A quiet moment. Cast when you’re ready.';
  if (s.phase === 'waiting') return 'Waiting for a bite… release the button.';
  if (s.phase === 'nibble') return 'Just a nibble… keep waiting. Do not hook yet.';
  if (s.phase === 'bite') return 'Bite! Press now to set the hook.';
  if (s.phase === 'caught') return 'You caught it. A little give, a little take.';
  if (s.phase === 'escaped') return ({ early_hook: 'That was a nibble. Wait for the real bite next time.', missed_bite: 'The bite passed. Try another cast.', line_broke: config.style === 'pressure' ? 'The line broke. Ease off during strong pulls.' : 'The line broke. Keep the tackle closer during surges.', got_away: 'The fish slipped away. Stay with it a little longer.', timeout: 'Time is up. The encounter reached its 60-second bound.' })[s.reason];
  if (config.pattern?.length && s.phase === 'struggle') return `Segment ${(s.segmentIndex ?? 0)+1} / ${config.pattern.length} · ${s.behavior} · follow this fish’s rhythm.`;
  if (config.style === 'pressure') return s.tension >= .75 ? 'Line strain is high. Release to ease off.' : s.behavior === 'warning' ? 'A surge is coming. Be ready to give some line.' : s.behavior === 'surge' ? 'The fish is pulling. Watch your tension.' : 'The fish is resting. Hold to reel it closer.';
  const q = observe(s, config).alignment;
  if (s.tension >= 0.75) return 'Line strain is high — get the fish back inside.';
  if (config.style === 'two-axis' && q < .5) return config.captureShape === 'ring' ? 'Keep the fish on the green rim; the center is empty.' : 'Bring the fish onto the green capture area.';
  if (q < 0.5) return s.fishPosition > s.tacklePosition ? 'The fish is above you. Hold to rise.' : 'The fish is below you. Release to fall.';
  if (s.behavior === 'warning') return 'A surge is coming. Be ready to follow.';
  if (s.behavior === 'surge') return 'Keep following the fish through its surge.';
  return 'Good alignment. You’re reeling the fish in.';
}

function drawChart(index) {
  const end = frames[index].tick;
  const start = Math.max(0, index - 12 * HZ);
  for (const key of ['progress', 'tension', 'energy']) {
    const points = [];
    for (let i = start; i <= index; i += 3) {
      points.push(`${32 + ((frames[i].tick - end + 12 * HZ) / (12 * HZ)) * 756},${126 - frames[i][key] * 114}`);
    }
    points.push(`788,${126 - frames[index][key] * 114}`);
    $(`curve-${key}`).setAttribute('d', `M${points.join(' L')}`);
  }
}

function renderSpatial(s) {
  const metrics = observe(s, config);
  const percent = Math.round(metrics.alignment * 100);
  const active = s.phase === 'struggle';
  const dual = config.style === 'two-axis';
  $('tackle-window').style.bottom = `${(s.tacklePosition - config.windowSize / 2) * 100}%`;
  $('tackle-window').style.height = `${config.windowSize * 100}%`;
  $('tackle-window').style.left = dual ? `${(s.tackleX - config.windowSize / 2) * 100}%` : '';
  $('tackle-window').style.width = dual ? `${config.windowSize * 100}%` : '';
  $('tackle-window').style.right = dual ? 'auto' : '';
  $('fish-marker').style.height = `${FISH_RADIUS * 200}%`;
  $('fish-marker').style.width = dual ? `${FISH_RADIUS * 200}%` : '';
  $('fish-marker').style.left = dual ? `${s.fishX * 100}%` : '';
  $('fish-marker').style.bottom = `${s.fishPosition * 100}%`;
  $('water-column').classList.toggle('aligned', metrics.alignment > 0.5);
  $('water-column').classList.toggle('struggling', active);
  $('water-column').setAttribute('aria-label', dual
    ? `Fish at x ${Math.round(s.fishX * 100)}%, y ${Math.round(s.fishPosition * 100)}%. Tackle at x ${Math.round(s.tackleX * 100)}%, y ${Math.round(s.tacklePosition * 100)}%. Shape ${config.captureShape}. ${percent}% aligned.`
    : `Fish at ${Math.round(s.fishPosition * 100)}%, tackle at ${Math.round(s.tacklePosition * 100)}%. ${percent}% aligned.`);
  $('alignment-value').value = `${percent}%`;
  $('alignment-effect').textContent = !active ? 'Reeling happens automatically while aligned.'
    : `${metrics.progressRate >= 0 ? 'Gaining' : 'Losing'} ground. ${metrics.energyRate < 0 ? 'Tiring the fish.' : 'The fish can recover.'}`;
  $('surge-target').hidden = !active || !!config.pattern?.length || s.behavior !== 'warning';
  $('surge-target').style.bottom = `${s.fishTarget * 100}%`;
  $('surge-target').style.left = dual ? `${s.fishTargetX * 100}%` : '';
  if (dual) $('axis-alignment').textContent = `Bounds X ${Math.round(metrics.alignmentX * 100)}% · Y ${Math.round(metrics.alignmentY * 100)}%`;
  $('surge-direction').textContent = isTerminal(s) ? s.phase === 'caught' ? 'Landed · nicely followed' : 'Gone · try another cast'
    : !active ? 'Cast, wait for a bite, then follow the fish.' : config.pattern?.length ? `Segment ${(s.segmentIndex ?? 0)+1} · ${s.behavior}` : s.behavior === 'warning' ? `Next surge: ${s.fishTarget > s.fishPosition ? 'up ↑' : 'down ↓'}${dual ? s.fishTargetX > s.fishX ? ' and right →' : ' and left ←' : ''}` : s.behavior === 'surge' ? 'Surging · watch the fish' : 'Resting · find your rhythm';
}

function renderBite(s) {
  const biting = s.phase === 'bite';
  const remaining = biting ? Math.max(0, s.duration - s.phaseTicks) / HZ : config.biteWindow;
  const fraction = biting ? remaining / config.biteWindow : s.phase === 'escaped' ? 0 : 1;
  $('bite-play').dataset.phase = s.phase;
  $('bite-headline').textContent = ({ ready: 'One good bite.', waiting: 'Watch the float…', nibble: 'A nibble. Not yet…', bite: 'Bite! Hook it now.', caught: 'A fish, just like that.', escaped: 'Another fish, another chance.' })[s.phase];
  $('bite-caption').textContent = s.phase === 'nibble' ? 'A small tug is a false bite. Wait for the full dip and the hook cue.' : s.phase === 'caught' ? 'A clean hook is the whole game. Cast again whenever you like.' : s.phase === 'escaped' ? s.reason === 'early_hook' ? 'That small tug was a false bite. Wait for the full dip next time.' : 'The bite passed. Release, cast again, and wait for the dip.' : 'Cast, release, and press again when the float dips.';
  $('bite-clock').textContent = biting ? `${remaining.toFixed(2)} s left` : s.phase === 'waiting' ? 'Wait for the dip' : isTerminal(s) ? s.phase === 'caught' ? 'Bite → caught · no struggle' : s.reason === 'early_hook' ? 'Nibble → escaped' : 'Bite → escaped' : `${config.biteWindow.toFixed(2)} s to react`;
  $('bite-fill').style.width = `${fraction * 100}%`;
  document.querySelector('.bite-timer').setAttribute('aria-valuenow', fraction);
  // The float is a rendering of simulation time, so it scrubs and pauses.
  const dip = biting ? 17 : s.phase === 'nibble' ? 6 : s.phase === 'caught' ? -25 : s.phase === 'waiting' ? Math.sin(s.phaseTicks * .06) * 3 : 0;
  $('bobber').setAttribute('transform', `translate(0 ${dip})`);
}

function render() {
  const s = replay?.state ?? (cursor !== null ? frames[cursor] : state);
  const index = replay?.index ?? cursor ?? (frames.length - 1);
  const inspecting = cursor !== null;
  const locked = !['ready', 'caught', 'escaped'].includes(state.phase) || replay !== null || inspecting;
  const status = statusFor(s);
  if (config.style === 'bite') renderBite(s);
  else if (config.style !== 'pressure') renderSpatial(s);
  if ($('status').textContent !== status) $('status').textContent = status;
  $('status').parentElement.classList.toggle('danger', s.phase === 'bite' || s.tension >= 0.75 || s.phase === 'escaped');
  $('time').textContent = `${(s.tick / HZ).toFixed(2)} s`;
  for (const node of document.querySelectorAll('[data-phase]')) node.classList.toggle('active', node.dataset.phase === s.phase);
  for (const node of document.querySelectorAll('[data-behavior]')) node.classList.toggle('active', s.phase === 'struggle' && node.dataset.behavior === s.behavior);
  for (const key of ['progress', 'tension', 'energy']) {
    $(key).value = s[key];
    document.querySelector(`.meter-fill.${key}`).style.width = `${s[key] * 100}%`;
    $(`${key}-value`).value = s[key].toFixed(3);
  }
  $('action').textContent = state.phase === 'ready' ? 'Cast a line' : state.phase === 'waiting' ? 'Waiting…' : state.phase === 'nibble' ? 'Not yet…' : state.phase === 'bite' ? 'Hook the fish!' : isTerminal(state) ? 'Cast again' : config.style === 'pressure' ? held ? 'Reeling…' : 'Hold to reel' : held ? 'Rising…' : 'Hold to rise';
  $('action').classList.toggle('pressed', held && !replay && !inspecting);
  $('action').disabled = !!replay || inspecting || (!running && !isTerminal(state));
  $('pause').textContent = running ? 'Pause' : 'Resume';
  $('pause').disabled = inspecting || (!replay && isTerminal(state));
  $('step').disabled = inspecting || (!replay && isTerminal(state));
  $('step-input-wrap').hidden = running || !!replay || inspecting || isTerminal(state);
  $('step-steer-wrap').hidden = config.style !== 'two-axis' || $('step-input-wrap').hidden;
  for (const side of ['left', 'right']) {
    $(`steer-${side}`).disabled = !running || !!replay || inspecting || isTerminal(state);
    $(`steer-${side}`).classList.toggle('pressed', side === 'left' ? leftHeld : rightHeld);
  }
  $('instruction').textContent = inspecting ? 'Inspecting a recorded tick. Back to live returns to the latest state.' : replay ? 'Playing the recorded inputs through the same transition function.' : !running && !isTerminal(state) ? 'Paused. Resume to play, or choose an input and Step one tick.' : config.style !== 'bite' && ['ready', 'waiting', 'bite'].includes(state.phase) ? 'Press to cast, release, then press again when the fish bites.' : examples[config.style].instructions;
  for (const id of ['preset', 'rod', 'bait', 'shape', 'behavior-pattern', 'nibble-count', 'seed', 'next-seed', 'restore-loadout']) $(id).disabled = locked;
  $('behavior-pattern').disabled = locked || config.style === 'bite';
  $('shared-machine').hidden = !!config.pattern?.length || !!config.nibbles?.count;
  $('pattern-status').textContent = config.pattern?.length ? `Pattern: ${config.pattern.map((p,i)=>`${i+1}. ${p.behavior}`).join(' → ')}. ${s.phase === 'struggle' ? `Current segment: ${(s.segmentIndex ?? 0)+1}.` : 'Starts after hooking.'}` : config.style === 'bite' ? 'Hook-only: wait → bite → caught.' : 'Classic fish: rest → warning → surge.';
  if (config.nibbles?.count) $('pattern-status').textContent += ` False bites: ${config.nibbles.count}; ${s.nibblesLeft ?? 0} still to enter.`;
  for (const field of FIELDS) $(field.key).disabled = locked || !isActive(field.uses, config.style) || (field.owner === 'fish' && loadout.fish === 'pond');
  $('settings-note').textContent = locked ? 'Loadout is fixed for this recording. Reset to edit.' : 'Loadout changes start a fresh recording. Reset repeats the same seed; Next seed makes another draw.';
  $('timeline').max = inputs.length; $('timeline').value = index; $('timeline').disabled = !!replay || !inputs.length;
  $('tick-label').textContent = `Tick ${s.tick} / ${state.tick}`;
  $('history-time').textContent = `${(s.tick / HZ).toFixed(2)} s`;
  $('mode').textContent = replay ? (running ? 'Replaying' : 'Replay paused') : inspecting ? 'Inspecting' : running && !isTerminal(state) ? 'Live' : 'Paused';
  $('live').disabled = !replay && !inspecting;
  $('replay').disabled = !inputs.length || !!replay;
  // A compact, labeled summary for readability. Timers and RNG are included
  // so the hidden state that makes the process Markovian is inspectable too.
  $('state-context').textContent = 'at the selected tick';
  $('state-json').textContent = JSON.stringify(toCoreState(s, config), null, 2);
  const event = events.findLast(e => e.tick <= s.tick);
  $('event').value = event ? `${(event.tick / HZ).toFixed(2)}s · ${event.label}` : 'Ready';
  $('lift-label').textContent = config.style === 'bite' ? `Button = ${s.lift}` : config.style === 'pressure' ? `Pressure = ${s.lift}` : `Lift = ${s.lift.toFixed(0)}${config.style === 'two-axis' ? ` · steer ${s.steer}` : ''} · alignment ${Math.round(observe(s, config).alignment * 100)}%`;
  drawChart(index);
}

function frame(now) {
  if (lastTime === null) lastTime = now;
  // Wall time never enters step. A slow/hidden tab slows or pauses simulated
  // time instead of fast-forwarding an unseen encounter. At most six ticks
  // accumulate per animation frame, and no history exceeds MAX_TICKS + 1.
  const elapsed = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (running) {
    accumulator += elapsed;
    while (accumulator >= DT && running) {
      accumulator -= DT;
      if (replay) replayTick();
      else if (inputs.length < MAX_TICKS) record({ ...(pendingInputs.shift() ?? { lift: held ? 1 : 0 }), steer: pendingSteering.shift() ?? steerInput() });
    }
  }
  if (now - lastRender >= 32) { render(); lastRender = now; }
  requestAnimationFrame(frame);
}
updateLoadoutView();
updateExampleView();
render();
// Keep early clicks from being lost while the WASM module/data initialize.
$('example').disabled = false; $('reset').disabled = false;
$('runtime-status').textContent = 'Protocol draft 0.2 · Rust / WebAssembly';
requestAnimationFrame(frame);
