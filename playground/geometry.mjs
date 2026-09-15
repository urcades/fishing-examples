// Rendering adapter: the canonical vertices are example data, not SVG paths.
import { SHAPES as DATA } from '../docs/examples/shared/catalog.mjs?v=0.2.0';
import { call } from './wasm.mjs?v=0.2.0';
export const SHAPES = Object.freeze(Object.fromEntries(Object.entries(DATA).map(([id, shape]) => [id, Object.freeze({ ...shape,
  path: shape.rings.map(ring => ring.map(([x,y],i) => `${i?'L':'M'}${x*100},${(1-y)*100}`).join(' ')+'Z').join(' '),
})])));
export function captureAlignment(id, fishX, fishY, tackleX, tackleY, size, radius = .03) {
  if (!Object.hasOwn(SHAPES,id)) throw new RangeError('Unknown capture shape');
  return call('capture', { capture: id === 'rectangle' ? {kind:'rectangle'} : {kind:'polygon',rings:SHAPES[id].rings}, fish:[fishX,fishY], tackle:[tackleX,tackleY], size, radius });
}
