import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, captureAlignment } from '../../playground/geometry.mjs';
import { prepareEncounter } from '../../playground/loadout.mjs';
import { createState, step, observe, isTerminal, MAX_TICKS } from '../../playground/protocol.mjs';

test('ring holes, triangle taper, and oval orientation change real capture', () => {
  const q = (shape, x = .5, y = .5) => captureAlignment(shape, x, y, .5, .5, .28);
  for (const id of ['rectangle', 'circle', 'oval', 'triangle', 'starburst']) assert.ok(q(id) > .99999);
  assert.ok(q('ring') < 1e-12);
  assert.ok(q('ring', .605, .5) > .85);
  assert.ok(q('triangle', .5, .43) > q('triangle', .5, .60));
  assert.ok(q('oval', .59, .5) > q('oval', .5, .59));
  assert.equal(q('rectangle', .5, .9), 0);
  for (const shape of Object.values(SHAPES)) {
    assert.ok(shape.area > 0 && shape.area <= 1);
    assert.equal((shape.path.match(/M/g) ?? []).length, shape.rings.length);
  }
});

// Independent point-in-polygon integration checks clipping of concavities
// and holes. The gameplay implementation never uses this sampled oracle.
function inside(point, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i], [xj, yj] = polygon[j];
    if ((y > point[1]) !== (yj > point[1]) && point[0] < (xj - x) * (point[1] - y) / (yj - y) + x) hit = !hit;
  }
  return hit;
}
test('polygon clipping agrees with an independent area oracle at edges and holes', () => {
  for (const id of Object.keys(SHAPES)) for (const [fx, fy] of [[.5, .5], [.60, .59], [.5, .60], [.54, .54], [.39, .5]]) {
    let hits = 0;
    const n = 90, rings = SHAPES[id].rings;
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
      const p = [(fx - .03 + (x + .5) * .06 / n - .36) / .28, (fy - .03 + (y + .5) * .06 / n - .36) / .28];
      if (inside(p, rings[0]) && (!rings[1] || !inside(p, rings[1]))) hits++;
    }
    assert.ok(Math.abs(captureAlignment(id, fx, fy, .5, .5, .28) - hits / (n * n)) < .012, `${id} ${fx},${fy}`);
  }
});

test('shape affects two-axis resource rates and stays inactive in earlier modes', () => {
  for (const style of ['spatial', 'pressure', 'bite']) assert.deepEqual(prepareEncounter({ style, shape: 'ring' }).config, prepareEncounter({ style }).config);
  const e = prepareEncounter({ style: 'two-axis', shape: 'ring' });
  const s = { ...createState(e.seed, e.config), phase: 'struggle', behaviorDuration: 60 };
  assert.ok(observe(s, e.config).progressRate < 0);
  assert.ok(observe({ ...s, fishX: .605 }, e.config).progressRate > 0);
});

test('every shape can land a fish; the ring requires tracking its rim', () => {
  for (const shape of Object.keys(SHAPES)) {
    const e = prepareEncounter({ style: 'two-axis', shape });
    let s = createState(e.seed, e.config), rimSide = 1;
    for (let i = 0; i < MAX_TICKS && !isTerminal(s); i++) {
      if (s.fishX > .7) rimSide = -1;
      if (s.fishX < .3) rimSide = 1;
      const offset = shape === 'ring' ? rimSide * e.config.windowSize * .37 : 0;
      const lift = s.phase !== 'struggle' ? +(s.phase !== 'waiting') : +(10 * (s.fishPosition + s.fishVelocity * .12 - s.tacklePosition) + 2 * (s.fishVelocity - s.tackleVelocity) > 0);
      const steer = Math.sign(10 * (s.fishX + offset + s.fishVelocityX * .12 - s.tackleX) + 2 * (s.fishVelocityX - s.tackleVelocityX));
      s = step(s, { lift, steer }, e.config).state;
      assert.ok(observe(s, e.config).alignment >= 0 && observe(s, e.config).alignment <= 1);
    }
    assert.equal(s.phase, 'caught', `${shape}: ${s.reason}`);
  }
});
