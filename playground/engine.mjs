// Narrow v2 compatibility shim used only by historical regression tests.
import * as protocol from './protocol.mjs?v=0.2.0';
import { call } from './wasm.mjs?v=0.2.0';
export { HZ,DT,MAX_TICKS,FISH_RADIUS,isTerminal } from './protocol.mjs?v=0.2.0';
export const random = seed => call('random', {seed});
export function createConfig(overrides = {}) { const {style,captureShape,...values} = protocol.createConfig(overrides); return Object.freeze(values); }
export function createState(seed) { const {style,...state} = protocol.createState(seed); return {...state,version:2}; }
const config = c => ({...c,style:'spatial',captureShape:'rectangle'});
const state = s => ({...s,version:3,style:'spatial'});
export function step(s,input,c) { const r=protocol.step(state(s),input,config(c)); const {style,...next}=r.state; return {state:next.tick===s.tick?s:{...next,version:2},events:r.events}; }
export function observe(s,c) { return protocol.observe(state(s),config(c)); }
