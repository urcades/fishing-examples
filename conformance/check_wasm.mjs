import assert from 'node:assert/strict';
import { call, readData } from '../playground/wasm.mjs';
const load=name=>readData(new URL(`./fixtures/${name}.json`,import.meta.url));
function close(a,b,path='root'){
  if(typeof a==='number'&&typeof b==='number')assert.ok(Math.abs(a-b)<=1e-12,`${path}: ${a} vs ${b}`);
  else if(Array.isArray(a)){assert.equal(a.length,b.length,path);a.forEach((v,i)=>close(v,b[i],`${path}[${i}]`));}
  else if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);for(const k of Object.keys(a))close(a[k],b[k],`${path}.${k}`);}
  else assert.equal(a,b,path);
}
const fixture=await load('trajectories');let ticks=0;
for(const c of fixture.traces){
  const checkpoints=new Map(c.checkpoints.map(p=>[p.at,p]));let state=call('create',{config:c.config,seed:c.seed});close(state,checkpoints.get(0).state);
  for(const [i,input] of c.inputs.entries()){
    const result=call('step',{config:c.config,state,input});state=result.state;ticks++;
    if(checkpoints.has(i+1)){const p=checkpoints.get(i+1);close(state,p.state,`${c.id}/${i+1}`);assert.deepEqual(result.events,p.events);}
    else assert.deepEqual(result.events,[]);
  }
}
for(const c of fixture.steps)close(call('step',{state:c.state,input:c.input,config:c.config}),c.expected,c.id);
for(const c of await load('geometry'))close(call('capture',{capture:c.capture,fish:[c.fishX,c.fishY],tackle:[c.tackleX,c.tackleY],size:c.size,radius:c.radius}),c.expected,c.id);
const r=await load('resolution');
for(const c of r.resolve)close(call('resolve',{definition:c.definition,loadout:c.loadout,seed:c.seed}),c.expected,c.id);
for(const c of r.select)close(call('select',{pool:c.pool,bait:c.bait,seed:c.seed}),c.expected,c.id);
console.log(`Rust/WASM conformance passed: ${fixture.traces.length} traces / ${ticks} ticks, ${fixture.steps.length} edge cases, 30 geometry cases, ${r.resolve.length} resolutions, ${r.select.length} selections.`);
for(const c of await load('invalid')){const {id,op,...args}=c;assert.throws(()=>call(op,args),undefined,id);}
console.log(`Rust/WASM validation passed: ${(await load('invalid')).length} invalid imports rejected.`);
