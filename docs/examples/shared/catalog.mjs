import { readData } from '../../../playground/wasm.mjs';
const data = await readData(new URL('./catalog.json', import.meta.url));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const { fish: FISH, rods: RODS, baits: BAITS, fields: FIELDS, shapes: SHAPES } = freeze(data);
export const EXAMPLES = Object.freeze(Object.fromEntries(await Promise.all(Object.entries({ spatial: 'pond-tracking', bite: 'one-good-bite', pressure: 'give-and-take', 'two-axis': 'open-water' }).map(async ([id, folder]) => [id, await readData(new URL(`../${folder}/definition.json`, import.meta.url))]))));
