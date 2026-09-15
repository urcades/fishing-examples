// Differential evidence supplements the independent, hand-derived checkpoints.
// Python produces fixed inputs once; Rust replays them without recomputing controls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { call } from '../playground/wasm.mjs';
const cases = [];
for (const dimensions of [0, 1, 2]) for (const seed of [0, 42, 0xffffffff]) {
  const pattern = ['keep','point','hold','wander','opposite'].map((kind,i)=>({
    behavior: i<2?'surge':i===2?'warning':'rest', duration: .1+i*.07,
    jitter: .7, pace: .3+i*.6, intensity: .1+i*.2,
    target: kind==='point'?{kind,point:[0,1]}:kind==='wander'?{kind,distance:1}:{kind}
  }));
  cases.push({ seed, config: {mode:dimensions?'tracking':'pressure',dimensions,
    capture:{kind:'rectangle'},pattern,nibbles:{count:2,duration:.05,gap:.05},maxTicks:600,
    parameters:{waitMin:1/60,waitMax:1/60,reelRate:0,escapeRate:0,strength:.2,lineCapacity:10}} });
}
cases.push({seed:42,config:{mode:'hook',dimensions:0,capture:{kind:'rectangle'},
  parameters:{waitMin:20,waitMax:20,biteWindow:4},maxTicks:2400,nibbles:{count:2,duration:.5,gap:.6}}});
const source = `
import sys,json
sys.dont_write_bytecode=True
sys.path.insert(0,sys.argv[1])
import fishing as f
out=[]
for case in json.load(sys.stdin):
 c=f.config(case['config']);s=f.create_state(case['seed'],c);trace={'initial':s,'steps':[]}
 while not f.terminal(s):
  primary=1 if s['phase'] in ['ready','bite'] else (1 if s['phase']=='struggle' and s['tick']%17<8 else 0)
  u={'primary':primary,'steer':(s['tick']%31)/15-1}
  before=json.dumps(s);r=f.step(s,u,c);assert json.dumps(s)==before
  s=json.loads(json.dumps(r['state']));f.validate_state(s,c)
  trace['steps'].append({'input':u,'result':r,'observation':f.observe(s,c)})
 out.append(trace)
json.dump(out,sys.stdout)
`;
const result=spawnSync('python3',['-c',source,fileURLToPath(new URL('../ports/python',import.meta.url))],{
 input:JSON.stringify(cases),encoding:'utf8',maxBuffer:32*1024*1024
});
assert.equal(result.status,0,result.stderr);
const expected=JSON.parse(result.stdout);
const discrete=new Set(['version','dimensions','tick','phaseTicks','duration','behaviorTicks','behaviorDuration','rng','segmentIndex','nibblesLeft']);
function close(a,b,path='root',key=''){
 if(typeof b==='number'&&!discrete.has(key)) assert.ok(Math.abs(a-b)<=1e-12,`${path}: ${a} vs ${b}`);
 else if(b && typeof b==='object'){
  assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);
  for(const k of Object.keys(b))close(a[k],b[k],`${path}.${k}`,k);
 }else assert.deepEqual(a,b,path);
}
let ticks=0;
for(const [i,c] of cases.entries()){
 let state=call('create',c);close(state,expected[i].initial);
 for(const entry of expected[i].steps){
  const r=call('step',{config:c.config,state:JSON.parse(JSON.stringify(state)),input:entry.input});
  close(r,entry.result,`case ${i} tick ${r.state.tick}`);state=r.state;
  close(call('observe',{config:c.config,state}),entry.observation);ticks++;
 }
}
const base={mode:'tracking',dimensions:2,capture:{kind:'rectangle'}};
for(const extra of [{pattern:Array(17).fill({})},{pattern:[{pace:11}]},{pattern:[{target:{kind:'hold',distance:1}}]},
 {pattern:[{target:{kind:'point',point:[0,2]}}]},{nibbles:{count:1.5}},{nibbles:{count:9}},{maxTicks:36001}])
 assert.throws(()=>call('config',{config:{...base,...extra}}));
console.log(`Extension parity passed: ${cases.length} full traces / ${ticks} ticks, all target rules, snapshots and observations; 7 invalid programs rejected.`);
