"""Independent Python implementation of Fishing Protocol draft 0.1.

Only the standard library is used. No Rust/WASM/JavaScript subprocesses.
Schema bounds and canonical geometry are data, not implementation imports.
"""
from copy import deepcopy
import json
from math import floor, isfinite
from pathlib import Path

HZ, DT, MAX_TICKS, RADIUS = 60, 1 / 60, 3600, .03
BOUNDS = json.loads((Path(__file__).resolve().parents[2] / 'spec/parameters.json').read_text())
DEFAULTS = {k: v['default'] for k, v in BOUNDS.items()}

def clamp(n, low=0., high=1.):
    return min(high, max(low, n))

def bounded(n, low, high):
    if isinstance(n, bool) or not isinstance(n, (int, float)) or not isfinite(n) or not low <= n <= high:
        raise ValueError(f'number must be finite and in [{low}, {high}]')

def random(seed):
    bounded(seed, 0, 0xffffffff)
    if type(seed) is not int: raise ValueError('seed must be an integer')
    seed = (1664525 * seed + 1013904223) & 0xffffffff
    return seed, seed / 4294967296

def ticks(seconds):
    # Python round uses ties-to-even; protocol uses floor(x + 0.5).
    return max(1, floor(seconds * HZ + .5))

def area(points):
    # Explicit left fold: newer Python sum() can use compensated summation.
    total=0.
    for i,p in enumerate(points):
        n=points[(i+1)%len(points)];total+=p[0]*n[1]-n[0]*p[1]
    return abs(total)/2

def inside(p, ring):
    hit = False
    for i, a in enumerate(ring):
        b = ring[i-1]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0]-a[0]) * (p[1]-a[1]) / (b[1]-a[1]) + a[0]: hit = not hit
    return hit

def cross(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def on(a,b,p): return cross(a,b,p)==0 and min(a[0],b[0])<=p[0]<=max(a[0],b[0]) and min(a[1],b[1])<=p[1]<=max(a[1],b[1])
def intersects(a,b,c,d):
    u,v,w,z=cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)
    return ((u>0>v or u<0<v) and (w>0>z or w<0<z)) or on(a,b,c) or on(a,b,d) or on(c,d,a) or on(c,d,b)

def validate_capture(c):
    if c == {'kind':'rectangle'}: return
    if set(c) != {'kind','rings'} or c['kind'] != 'polygon': raise ValueError('capture kind')
    rings=c['rings']
    if not 1<=len(rings)<=2: raise ValueError('ring count')
    for ring in rings:
        if not 3<=len(ring)<=48: raise ValueError('vertex count')
        for p in ring:
            if len(p)!=2: raise ValueError('point dimensions')
            for n in p: bounded(n,0,1)
        if area(ring)<=1e-12: raise ValueError('degenerate polygon')
        for i,a in enumerate(ring):
            b=ring[(i+1)%len(ring)]
            if a==b: raise ValueError('duplicate vertices')
            for j in range(i+1,len(ring)):
                if j==i+1 or (i==0 and j==len(ring)-1): continue
                if intersects(a,b,ring[j],ring[(j+1)%len(ring)]): raise ValueError('self intersection')
    if len(rings)==2:
        for i,p in enumerate(rings[1]):
            if not inside(p,rings[0]): raise ValueError('hole outside')
            for j,a in enumerate(rings[0]):
                if intersects(p,rings[1][(i+1)%len(rings[1])],a,rings[0][(j+1)%len(rings[0])]): raise ValueError('hole crossing')

def config(value):
    if set(value)-{'mode','dimensions','parameters','capture'}: raise ValueError('unknown config field')
    c=deepcopy(value); c['parameters']=dict(DEFAULTS,**c.get('parameters',{})); p=c['parameters']
    if type(c['dimensions']) is not int: raise ValueError('integer dimensions')
    if (c['mode'],c['dimensions']) not in [('hook',0),('pressure',0),('tracking',1),('tracking',2)]: raise ValueError('mechanisms')
    if set(p)!=set(BOUNDS): raise ValueError('unknown parameter')
    for k,v in p.items(): bounded(v,BOUNDS[k]['min'],BOUNDS[k]['max'])
    if p['waitMin']>p['waitMax']: raise ValueError('wait range')
    validate_capture(c['capture'])
    if c['dimensions']!=2 and c['capture']!={'kind':'rectangle'}: raise ValueError('polygon needs 2D')
    return c

def validate_state(s,c):
    if set(s) != {'version','mode','dimensions','tick','phase','phaseTicks','duration','behavior','behaviorTicks','behaviorDuration','progress','tension','energy','primary','rng','reason','motion'}: raise ValueError('state fields')
    if type(s['version']) is not int or type(s['dimensions']) is not int: raise ValueError('integer schema/mechanisms')
    if s['version']!=1 or s['mode']!=c['mode'] or s['dimensions']!=c['dimensions']: raise ValueError('state mechanisms/version')
    for k in ['tick','phaseTicks','duration','behaviorTicks','behaviorDuration']:
        bounded(s[k],0,MAX_TICKS)
        if type(s[k]) is not int: raise ValueError('integer timer')
    if s['phaseTicks']>s['tick'] or s['behaviorTicks']>s['tick']: raise ValueError('elapsed timer exceeds total')
    if not terminal(s) and s['tick']==MAX_TICKS: raise ValueError('tick limit')
    for k in ['progress','tension','energy','primary']: bounded(s[k],0,1)
    bounded(s['rng'],0,0xffffffff)
    if type(s['rng']) is not int: raise ValueError('integer RNG')
    if s['phase'] not in ['ready','waiting','bite','struggle','caught','escaped'] or s['behavior'] not in ['rest','warning','surge']: raise ValueError('state enum')
    if terminal(s)!=(s['reason'] is not None): raise ValueError('terminal reason')
    if s['phase']=='caught' and (s['reason']!='landed' or s['progress']!=1): raise ValueError('caught')
    if s['phase']=='escaped' and s['reason'] not in ['missed_bite','line_broke','got_away','timeout']: raise ValueError('escaped')
    if s['phase']=='struggle' and c['mode']=='hook': raise ValueError('hook has no struggle')
    if s['phase'] in ['waiting','bite'] and not 0<=s['phaseTicks']<s['duration']: raise ValueError('phase timer')
    m=s['motion'];p=c['parameters']
    if c['mode']=='tracking':
        if m is None: raise ValueError('motion required')
        if set(m)!={'fishPosition','fishVelocity','fishTarget','tacklePosition','tackleVelocity','fishX','fishVelocityX','fishTargetX','tackleX','tackleVelocityX','steer'}: raise ValueError('motion fields')
        for k in ['fishPosition','fishTarget','tacklePosition','fishX','fishTargetX','tackleX']: bounded(m[k],0,1)
        for k in ['fishVelocity','fishVelocityX']: bounded(m[k],-p['fishSpeed']*1.7,p['fishSpeed']*1.7)
        for k in ['tackleVelocity','tackleVelocityX']: bounded(m[k],-p['tackleSpeed'],p['tackleSpeed'])
        bounded(m['steer'],-1,1)
    elif m is not None: raise ValueError('nonspatial motion')
    return s

def create_state(seed,c):
    c=config(c); random(seed)  # Validate without consuming a draw.
    m=dict(fishPosition=.5,fishVelocity=0.,fishTarget=.5,tacklePosition=.5,tackleVelocity=0.,fishX=.5,fishVelocityX=0.,fishTargetX=.5,tackleX=.5,tackleVelocityX=0.,steer=0.) if c['mode']=='tracking' else None
    return dict(version=1,mode=c['mode'],dimensions=c['dimensions'],tick=0,phase='ready',phaseTicks=0,duration=0,behavior='rest',behaviorTicks=0,behaviorDuration=0,progress=.25,tension=0.,energy=1.,primary=0.,rng=seed,reason=None,motion=m)

def terminal(s): return s['phase'] in ['caught','escaped']

def clip(points,axis,bound,greater):
    if not points: return []
    out=[]; previous=points[-1]; was=previous[axis]>=bound if greater else previous[axis]<=bound
    for point in points:
        yes=point[axis]>=bound if greater else point[axis]<=bound
        if yes!=was:
            t=(bound-previous[axis])/(point[axis]-previous[axis]);out.append([previous[0]+t*(point[0]-previous[0]),previous[1]+t*(point[1]-previous[1])])
        if yes: out.append(point)
        previous,was=point,yes
    return out

def interval(fish,tackle,size,radius=RADIUS): return clamp((min(fish+radius,tackle+size/2)-max(fish-radius,tackle-size/2))/(2*radius))
def alignment(c,fish,tackle,size,radius=RADIUS):
    if c['kind']=='rectangle': return interval(fish[0],tackle[0],size,radius)*interval(fish[1],tackle[1],size,radius)
    left,bottom=tackle[0]-size/2,tackle[1]-size/2
    minx,maxx=(fish[0]-radius-left)/size,(fish[0]+radius-left)/size
    miny,maxy=(fish[1]-radius-bottom)/size,(fish[1]+radius-bottom)/size
    if maxx<=0 or minx>=1 or maxy<=0 or miny>=1: return 0.
    areas=[area(clip(clip(clip(clip(r,0,minx,True),0,maxx,False),1,miny,True),1,maxy,False)) for r in c['rings']]
    side=2*radius/size
    return clamp((areas[0]-(areas[1] if len(areas)>1 else 0))/(side*side))

def rates(s,c,primary):
    p=c['parameters']; active=s['phase']=='struggle'; pull=p['strength']*s['energy']*(1 if s['behavior']=='surge' else .15) if active else 0.
    q=qx=qy=0.
    if s['motion'] is not None:
        m=s['motion']; qy=interval(m['fishPosition'],m['tacklePosition'],p['windowSize']);q=qy
        if c['dimensions']==2:
            qx=interval(m['fishX'],m['tackleX'],p['windowSize']);q=alignment(c['capture'],[m['fishX'],m['fishPosition']],[m['tackleX'],m['tacklePosition']],p['windowSize'])
    target=progress=energy=0.
    if active:
        if c['mode']=='pressure':
            target=primary*(p['baseTension']+pull)/p['lineCapacity'];progress=p['reelRate']*primary-p['escapeRate']*pull*(1-primary)
            energy=p['recovery']*(1-primary)*(1-s['energy'])-p['fatigue']*(s['tension']*p['lineCapacity'])*s['energy']
        else:
            target=(p['baseTension']*q+pull*(.3+1.1*(1-q)))/p['lineCapacity'];progress=p['reelRate']*q-p['escapeRate']*(.4+pull)*(1-q)
            energy=p['recovery']*(1-q)*(1-s['energy'])-p['fatigue']*q*(s['tension']*p['lineCapacity'])*s['energy']
    return dict(alignment=q,pull=pull,targetTension=target,progressRate=progress,tensionRate=(target-s['tension'])/p['response'] if active else 0.,energyRate=energy,alignmentX=qx,alignmentY=qy)

def observe(s,c):
    c=config(c);validate_state(s,c);return rates(s,c,s['primary'])

def enter_behavior(s,b,c):
    p=c['parameters'];r=.5
    if b!='warning': s['rng'],r=random(s['rng'])
    s.update(behavior=b,behaviorTicks=0,behaviorDuration=ticks(p[b]*(1+(r*2-1)*p['jitter'])))
    if c['mode']!='tracking' or b=='surge': return
    s['rng'],r=random(s['rng']);m=s['motion']
    raw=clamp(m['fishPosition']+(r*2-1)*p['restWander'],.08,.92) if b=='rest' else .6+r*.3 if m['fishPosition']<.5 else .1+r*.3
    m['fishTarget']=raw if p['targetCenter']==.5 and p['targetSpread']==1 else clamp(p['targetCenter']+(raw-.5)*p['targetSpread'],.08,.92)
    if c['dimensions']==2:
        s['rng'],r=random(s['rng']);m['fishTargetX']=clamp(m['fishX']+(r*2-1)*.16,.08,.92) if b=='rest' else .6+r*.3 if m['fishX']<.5 else .1+r*.3

def move_axis(position,velocity,acceleration,limit,low,high):
    speed=clamp(velocity+acceleration*DT,-limit,limit);raw=position+speed*DT
    return clamp(raw,low,high),0. if raw<=low or raw>=high else speed

def movement(s,c,u,steer):
    if s['motion'] is None: return None
    p=c['parameters'];m=s['motion'];n=dict(m);vigor=.35+.65*s['energy'];pace=1.7 if s['behavior']=='surge' else .65
    n['tacklePosition'],n['tackleVelocity']=move_axis(m['tacklePosition'],m['tackleVelocity'],(2*u-1)*p['tackleAcceleration']-p['tackleDamping']*m['tackleVelocity'],p['tackleSpeed'],p['windowSize']/2,1-p['windowSize']/2)
    target=m['fishPosition'] if s['behavior']=='warning' else m['fishTarget']
    n['fishPosition'],n['fishVelocity']=move_axis(m['fishPosition'],m['fishVelocity'],7*vigor*(target-m['fishPosition'])-3*m['fishVelocity'],p['fishSpeed']*vigor*pace,RADIUS,1-RADIUS)
    if c['dimensions']==2:
        n['tackleX'],n['tackleVelocityX']=move_axis(m['tackleX'],m['tackleVelocityX'],steer*p['tackleAcceleration']-p['tackleDamping']*m['tackleVelocityX'],p['tackleSpeed'],p['windowSize']/2,1-p['windowSize']/2)
        target=m['fishX'] if s['behavior']=='warning' else m['fishTargetX']
        n['fishX'],n['fishVelocityX']=move_axis(m['fishX'],m['fishVelocityX'],7*vigor*(target-m['fishX'])-3*m['fishVelocityX'],p['fishSpeed']*vigor*pace,RADIUS,1-RADIUS);n['steer']=steer
    return n

def finish(n,phase,reason):
    n.update(phase=phase,phaseTicks=0,duration=0,reason=reason);return dict(state=n,events=[phase])

def step(s,input,c):
    c=config(c);validate_state(s,c)
    if set(input)-{'primary','steer'}: raise ValueError('unknown input')
    u=input.get('primary',0.);steer=input.get('steer',0.)
    if isinstance(u,bool) or isinstance(steer,bool) or not isfinite(u) or not isfinite(steer): raise ValueError('finite input')
    u,steer=clamp(u),clamp(steer,-1,1);pressed=u>0 and s['primary']==0
    if terminal(s) or (s['phase']=='ready' and not pressed): return dict(state=deepcopy(s),events=[])
    n=deepcopy(s);n.update(tick=s['tick']+1,phaseTicks=s['phaseTicks']+1,primary=u);events=[];p=c['parameters']
    if s['phase']=='ready':
        n['rng'],r=random(s['rng']);n.update(phase='waiting',phaseTicks=0,duration=ticks(p['waitMin']+r*(p['waitMax']-p['waitMin'])));events=['cast']
    elif s['phase']=='waiting':
        if n['phaseTicks']>=s['duration']: n.update(phase='bite',phaseTicks=0,duration=ticks(p['biteWindow']));events=['bite']
    elif s['phase']=='bite':
        if n['phaseTicks']>=s['duration']: return finish(n,'escaped','missed_bite')
        if pressed:
            if c['mode']=='hook':
                n['progress']=1.;r=finish(n,'caught','landed');r['events'].insert(0,'hooked');return r
            n.update(phase='struggle',phaseTicks=0,duration=0);enter_behavior(n,'rest',c);events=['hooked','rest']
    elif s['phase']=='struggle':
        r=rates(s,c,u);progress=s['progress']+r['progressRate']*DT;tension=s['tension']+r['tensionRate']*DT
        n.update(motion=movement(s,c,u,steer),progress=clamp(progress),tension=clamp(tension),energy=clamp(s['energy']+r['energyRate']*DT),behaviorTicks=s['behaviorTicks']+1)
        if tension>=1: return finish(n,'escaped','line_broke')
        if progress<=0: return finish(n,'escaped','got_away')
        if progress>=1: return finish(n,'caught','landed')
        if n['behaviorTicks']>=s['behaviorDuration']:
            b={'rest':'warning','warning':'surge','surge':'rest'}[s['behavior']];enter_behavior(n,b,c);events=[b]
    if n['tick']>=MAX_TICKS: return finish(n,'escaped','timeout')
    return dict(state=n,events=events)

FISH_KEYS=['strength','fishSpeed','surge','rest','fatigue','recovery','biteWindow','targetCenter','targetSpread','restWander']
ROD_KEYS=['windowSize','reelRate','lineCapacity','tackleAcceleration','tackleDamping','tackleSpeed']

def validate_profile(kind,p):
    keys=FISH_KEYS if kind=='fish' else ROD_KEYS if kind=='rod' else ['attraction','biteBonus']
    extras=['preference','pondWeight'] if kind=='fish' else ['affinity'] if kind=='bait' else []
    if set(p)!=set(keys+extras): raise ValueError('profile fields')
    for k in keys:
        b=BOUNDS[k] if k in BOUNDS else {'min':.5,'max':2.5} if k=='attraction' else {'min':0,'max':.5}
        bounded(p[k],b['min'],b['max'])
    if kind=='fish':
        bounded(p['pondWeight'],float.fromhex('0x1p-1022'),10)
        if len(p['preference'].encode())>64: raise ValueError('preference length')
    if kind=='bait':
        if len(p['affinity'])>64: raise ValueError('affinity count')
        for k,v in p['affinity'].items():
            if len(k.encode())>64: raise ValueError('affinity length')
            bounded(v,float.fromhex('0x1p-1022'),5)

def select(pool,bait,seed):
    if not 1<=len(pool)<=64: raise ValueError('pool bound')
    validate_profile('bait',bait)
    for f in pool: validate_profile('fish',f)
    weights=[f['pondWeight']*bait['affinity'].get(f['preference'],1) for f in pool]
    total=0.
    for weight in weights: total+=weight
    if not isfinite(total) or any(not isfinite(w) or w<=0 for w in weights): raise ValueError('selection weight')
    odds=[w/total for w in weights]
    seed,r=random(seed);acc=0.;index=len(pool)-1
    for i,p in enumerate(odds):
        acc+=p
        if r<acc: index=i;break
    return dict(index=index,seed=seed,odds=odds)

def resolve(definition,loadout,seed):
    if set(definition)-{'mode','dimensions','parameters','capture','hookBonus'}: raise ValueError('definition fields')
    if set(loadout)!={'fish','rod','bait'}: raise ValueError('loadout fields')
    random(seed); d=deepcopy(definition);bonus=d.pop('hookBonus',0.);bounded(bonus,0,.5);c=config(d);p=c['parameters'];notes=[]
    for owner in ['fish','rod','bait']: validate_profile(owner,loadout[owner])
    f,r,b=loadout['fish'],loadout['rod'],loadout['bait']
    if c['mode']!='hook':
        for k in ['strength','surge','rest','fatigue','recovery']: p[k]=f[k]
        for k in ['reelRate','lineCapacity']: p[k]=r[k]
    if c['mode']=='tracking':
        for k in ['fishSpeed','targetCenter','targetSpread','restWander']: p[k]=f[k]
        for k in ['windowSize','tackleAcceleration','tackleDamping','tackleSpeed']: p[k]=r[k]
    affinity=b['affinity'].get(f['preference'],1)
    for k,v,low,high,label in [('waitMin',1.5/(b['attraction']*affinity),.4,5,'Minimum wait'),('waitMax',3/(b['attraction']*affinity),.4,8,'Maximum wait'),('biteWindow',f['biteWindow']+bonus+b['biteBonus'],.5,2,'Bite duration')]:
        p[k]=clamp(v,low,high)
        if v!=p[k]: notes.append(f'{label} capped at {p[k]:.2f} to stay within the model bounds.')
    return dict(version=1,config=config(c),seed=seed,notes=notes)
