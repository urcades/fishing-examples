"""Run the independent port against immutable, implementation-neutral fixtures."""
import json
import sys
from pathlib import Path
from copy import deepcopy
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ports/python'))
sys.dont_write_bytecode = True
import fishing as f

def close(a,b,path='root'):
    if isinstance(a,(int,float)) and isinstance(b,(int,float)):
        assert abs(a-b)<=1e-12,(path,a,b)
    elif isinstance(a,dict):
        assert set(a)==set(b),(path,set(a)^set(b))
        for k in a: close(a[k],b[k],path+'.'+k)
    elif isinstance(a,list):
        assert len(a)==len(b),(path,len(a),len(b))
        for i,(x,y) in enumerate(zip(a,b)): close(x,y,f'{path}[{i}]')
    else: assert a==b,(path,a,b)

def load(name): return json.loads((ROOT/'conformance/fixtures'/name).read_text())
traces=load('trajectories.json');ticks=0
for case in traces['traces']:
    c=f.config(case['config']);s=f.create_state(case['seed'],c);checkpoints={v['at']:v for v in case['checkpoints']}
    close(s,checkpoints[0]['state'],case['id'])
    for i,input in enumerate(case['inputs'],1):
        before=deepcopy(s);result=f.step(s,input,c);assert s==before;s=result['state'];ticks+=1;f.validate_state(s,c)
        if i in checkpoints:
            close(s,checkpoints[i]['state'],f"{case['id']} tick {i}");assert result['events']==checkpoints[i]['events']
            # JSON snapshots must resume without hidden interpreter state.
            close(f.step(json.loads(json.dumps(s)),input,c),f.step(s,input,c))
        else: assert not result['events'],(case['id'],i,result['events'])
    assert f.terminal(s)
for c in traces['steps']: close(f.step(c['state'],c['input'],c['config']),c['expected'],c['id'])
for c in load('geometry.json'):
    close(f.alignment(c['capture'],[c['fishX'],c['fishY']],[c['tackleX'],c['tackleY']],c['size'],c['radius']),c['expected'],c['id'])
r=load('resolution.json')
for c in r['resolve']: close(f.resolve(c['definition'],c['loadout'],c['seed']),c['expected'],c['id'])
for c in r['select']: close(f.select(c['pool'],c['bait'],c['seed']),c['expected'],c['id'])
print(f"Python conformance passed: {len(traces['traces'])} traces / {ticks} ticks, {len(traces['steps'])} edge cases, 30 geometry cases, {len(r['resolve'])} resolutions, {len(r['select'])} selections.")
for c in load('invalid.json'):
    try:
        op=c['op']
        if op=='config': f.config(c['config'])
        elif op=='create': f.create_state(c['seed'],c['config'])
        elif op=='step': f.step(c['state'],c['input'],c['config'])
        elif op=='resolve': f.resolve(c['definition'],c['loadout'],c['seed'])
        elif op=='select': f.select(c['pool'],c['bait'],c['seed'])
        else: raise AssertionError('unhandled fixture operation')
    except (ValueError,KeyError,TypeError): pass
    else: raise AssertionError('accepted invalid fixture: '+c['id'])
print(f"Python validation passed: {len(load('invalid.json'))} invalid imports rejected.")
