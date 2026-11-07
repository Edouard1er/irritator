import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { groupedSchaefer, uncertaintyTstar } from './decision-8g-fixture.mjs';
import { tstarSchaefer } from './decision-8f-fixture.mjs';
import { schaeferOracle } from './decision-8e-oracle.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { document, source, observe } from './decision-8c-fixture.mjs';
import { validateRequest, parseWrapperResult, parseResult } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER;
assert.ok(runner, 'Set IRRITATOR_RUNNER');
let app;
if (process.env.DECISION_8G_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
async function run(m, name, expected = 0) {
  validateRequest(m);
  const p = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(p.status, expected, p.stdout + p.stderr);
  const r = JSON.parse(p.stdout);
  if (!expected) { (m.schemaVersion === 3 ? parseWrapperResult : parseResult)(r, m); assert.equal(p.stderr, ''); }
  else assert.match(p.stderr, /^[A-Z_]+:/);
  if (app) {
    const res = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    const { runId, requestId, ...actual } = await res.json();
    assert.equal(res.status, expected ? 422 : 200); assert.ok(expected ? requestId : runId); assert.deepEqual(actual, r);
  }
  if (process.env.IRRITATOR_8G_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_8G_EVIDENCE, { recursive: true });
    writeFileSync(resolve(process.env.IRRITATOR_8G_EVIDENCE, name + '.json'), JSON.stringify({ request: m, result: r, exit: p.status, stderrBytes: Buffer.byteLength(p.stderr), httpEqualsNative: !!app }, null, 2));
  }
  return r;
}
const last = (r, id) => {
  const matches=r.observations.filter(o=>o.component===id||o.component.endsWith('/'+id));
  assert.equal(matches.length,1,`Unique observation ${id}`);return matches[0].samples.at(-1).value;
};
const near = (a, b, tol = .05) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${a} != ${b} tol=${tol}`);
const wrapper = m => m.model.components.find(c => c.type === 'simulation_wrapper');
const def = (m, id) => m.model.definitions.find(d => d.id === id);
const rows = (r, c, p) => r.resultEvents.filter(e => e.port === p && e.value[2] === c).sort((a,b) => a.value[1]-b.value[1]);
function receipts(m, dynamic = false) {
  const prefix = dynamic ? 'observer/decide/' : 'external/';
  const d = def(m, 'GroupedDecision');
  if(dynamic)m.model.observations=m.model.observations.filter(o=>['plant/N','plant/C','applied'].includes(o.component));
  const reads=new Map();
  for (const name of ['minCH', 'maxCH', 'minN', 'count']) {
    for (let c = 1; c <= (dynamic ? 2 : 1); ++c) for (let gid = 0; gid < 3; ++gid) {
      const id = `${name}g${gid}c${c}`;
      const store=id+'Store';
      d.components.push(atom(store, 'value_memory'),atom(id, 'value_memory', { initial: -999, emitOnWrite: 1 }));
      d.connections.push(edge(name, 0, store, 0),edge(store,0,id,0));
      // Read after every campaign has finished. The owned keyed table retains
      // both campaigns, without adding ports or changing any engine budget.
      const readKey=`${c}/${gid}`;
      if(reads.has(readKey))d.connections.push(edge(reads.get(readKey),0,store,1));
      else {source({model:d}, store, 1, 0, gid, c, dynamic ? 4 : 2);reads.set(readKey,d.components.at(-1).id);}
      m.model.observations.push({ component: prefix+id, samplingInterval: .1 });
    }
  }
  return m;
}

test('8G delivered graphs, unchanged plant/prospect, export/reimport', async () => {
  for (const [filename, create] of [['decision-grouped-schaefer-v3.json', groupedSchaefer], ['tstar-schaefer-uncertainty-v3.json', uncertaintyTstar]]) {
    const saved = JSON.parse(readFileSync(new URL('../../examples/' + filename, import.meta.url)));
    assert.deepEqual(saved, create()); assert.deepEqual(await run(saved, filename), await run(JSON.parse(JSON.stringify(saved)), filename + '-roundtrip'));
  }
  const m = uncertaintyTstar(), baseline = tstarSchaefer();
  for (const id of ['SchaeferPlant', 'SchaeferProspect', 'SynchronizePair']) assert.deepEqual(def(m, id), def(baseline, id));
  assert.equal(def(m, 'SchaeferPlant').components.find(c => c.id === 'q').parameters.value, .001);
  assert.ok(m.model.connections.filter(e => e.to.component === 'plant' && e.to.port === 1).every(e => ['initialCommand', 'observer'].includes(e.from.component)));
  const bounded=uncertaintyTstar();def(bounded,'ObserverDecision').components.find(c=>c.id==='baselineC').parameters.capacity=6;
  assert.equal(last(await run(bounded,'c0-relay-capacity'),'applied'),150);
});
test('8G fixed state groups agree with six native individual simulations and indicative oracles', async () => {
  const m = receipts(groupedSchaefer()), r = await run(m, 'fixed-groups');
  for (let i = 0; i < 3; ++i) {
    const E = [80,150,260][i], CH = [], Nmin = [];
    for (const q of [.0008,.001]) {
      const flat = structuredClone(def(m, 'Schaefer'));
      flat.components.find(c => c.id === 'E').parameters.value = E;
      flat.components.find(c => c.id === 'q').parameters.value = q;
      const f = await run({ schemaVersion: 1, model: { id: 'flat-native', components: flat.components, connections: flat.connections,
        observations: ['N','C'].map(component => ({ component, samplingInterval: .1 })) }, simulation: { start: 0, end: 20 } }, `individual-${E}-${q}`);
      CH.push(last(f,'C')); Nmin.push(Math.min(150,last(f,'N')));
      const analytic = schaeferOracle(150,0,E,20,q); near(CH.at(-1),analytic.C,.25); near(last(f,'N'),analytic.N);
      const sid = rows(r,1,5).find(e => e.value[0]===E && rows(r,1,6).some(qe => qe.value[1]===e.value[1] && qe.value[0]===q)).value[1];
      near(rows(r,1,8).find(e=>e.value[1]===sid).value[0],CH.at(-1),1e-8);
    }
    near(last(r,`minCHg${i}c1`),Math.min(...CH),1e-8); near(last(r,`maxCHg${i}c1`),Math.max(...CH),1e-8);
    near(last(r,`minNg${i}c1`),Math.min(...Nmin),1e-8); assert.equal(last(r,`countg${i}c1`),2);
    near(last(r,`minCHg${i}c1`),[286.94425,445.31250,530.66797][i],.02);
    near(last(r,`minNg${i}c1`),[150,150,83.87396][i],.02);
  }
});
test('8G policies A/B and D are graph parameters: max minimum, constraint and secondary selection', async () => {
  for(const [constrained,threshold,E,primary] of [[false,0,260,1],[true,140,150,1],[true,1000,150,0]]) {
    const m=groupedSchaefer({threshold,constrained});
    observe(m,'external',7,'primary'); observe(m,'external',8,'secondary');
    const r=await run(m,'policy-'+threshold); assert.equal(last(r,'actionReceipt'),E); assert.equal(last(r,'primary'),primary); assert.equal(last(r,'secondary'),1);
  }
  const negative=document('unconstrained-groups',[{id:'external',type:'coupled',parameters:{},definition:'GroupedDecision'}],[],groupedSchaefer({constrained:false}).model.definitions.filter(d=>d.id!=='Schaefer'));
  for(const [id,N,CH,E] of [[0,-10,5,80],[1,-20,8,150]])for(const [p,v] of [N,CH,E,1].entries())source(negative,'external',p,v,id);
  source(negative,'external',4,2,2);observe(negative,'external',0,'action');observe(negative,'external',7,'primary');
  const n=await run(negative,'unconstrained-negative-context');assert.equal(last(n,'action'),150);assert.equal(last(n,'primary'),1);
});
test('8G two dynamic campaigns: children, per-effort reductions, decisions, q remains contextual', async () => {
  const m=receipts(uncertaintyTstar(),true), r=await run(m,'two-cycles');
  assert.deepEqual(rows(r,1,13).map(e=>e.value),[[6,6,1]]); assert.deepEqual(rows(r,2,13).map(e=>e.value),[[6,6,2]]);
  for(const c of [1,2]) {
    const Ns=rows(r,c,7),Cs=rows(r,c,8),Es=rows(r,c,9),qs=rows(r,c,10);
    assert.equal(new Set(Ns.map(e=>e.value[0])).size,1); assert.equal(new Set(Cs.map(e=>e.value[0])).size,1);
    for(let g=0;g<3;++g) {
      const ids=Es.filter(e=>e.value[0]===[80,150,260][g]).map(e=>e.value[1]);
      const ch=rows(r,c,12).filter(e=>ids.includes(e.value[1])).map(e=>e.value[0]);
      const n=rows(r,c,11).filter(e=>ids.includes(e.value[1])).map(e=>e.value[0]);
      near(last(r,`minCHg${g}c${c}`),Math.min(...ch),1e-10); near(last(r,`maxCHg${g}c${c}`),Math.max(...ch),1e-10);
      near(last(r,`minNg${g}c${c}`),Math.min(...n),1e-10); assert.equal(last(r,`countg${g}c${c}`),2);
      for(const sid of ids) {
        const q=qs.find(e=>e.value[1]===sid).value[0], E=Es.find(e=>e.value[1]===sid).value[0];
        const expected=schaeferOracle(Ns[0].value[0],Cs[0].value[0],E,20,q);
        near(rows(r,c,12).find(e=>e.value[1]===sid).value[0],expected.C,.3);
      }
    }
  }
  near(rows(r,1,7)[0].value[0],138.722797477662,1e-10); near(rows(r,2,7)[0].value[0],148.032956366218,1e-10);
  assert.equal(last(r,'applied'),150); near(last(r,'plant/N'),155.007095478631,1e-10);
  const a=await run(uncertaintyTstar({constrained:false}),'dynamic-policy-a'); assert.equal(last(a,'applied'),260); assert.notEqual(rows(a,2,7)[0].value[0],rows(r,2,7)[0].value[0]);
});
function synthetic({operation=0,validation=0,required=11,capacity=128}={}) {
  const m=document('generic-grouping',[atom('group','group_aggregate',{operation,validation,required,capacity,endCount:0})]);
  for(const [p,id] of [[0,'value'],[1,'action'],[2,'end'],[3,'status'],[4,'validCount'],[7,'invalid'],[8,'campaignStatus']]) observe(m,'group',p,id);
  return m;
}
function member(m,id,key,v,{valid=1,weight,at=0,campaign=1,omit=[]}={}) {
  for(const [p,x] of [[0,key],[1,key],[2,v],[3,valid],[4,weight]]) if(x!==undefined&&!omit.includes(p))source(m,'group',p,x,id,campaign,at);
}
test('8G policy C uses explicit unequal weights; zero/negative/missing weights cannot invent an expectation', async () => {
  const m=synthetic({operation:6});
  member(m,0,80,10,{weight:1});member(m,1,80,30,{weight:3});member(m,2,150,24,{weight:2});
  source(m,'group',5,3); m.model.components.push(atom('pick','candidate_select',{emitFallback:0}));
  m.model.connections.push(edge('group',0,'pick',0),edge('group',1,'pick',1),edge('group',2,'pick',2));observe(m,'pick',0,'selectedAction');
  const r=await run(m,'weighted-policy');assert.equal(last(r,'selectedAction'),80); // 25 > 24 ; descriptive means would choose 150
  const descriptive=structuredClone(m);descriptive.model.components.find(c=>c.id==='group').parameters.operation=3;
  assert.equal(last(await run(descriptive,'descriptive-policy'),'selectedAction'),150);
  for(const [name,weight,seal] of [['zero',0,false],['negative',-1,false],['missing',undefined,true]]) {
    const x=synthetic({operation:6});member(x,0,80,10,{weight});source(x,'group',5,1);
    if(seal)source(x,'group',6,0,0,1,1);
    const out=await run(x,'weight-'+name); assert.equal(last(out,'end'),0);assert.equal(last(out,'campaignStatus'),0);
  }
  for(const [name,weights,expected] of [['weighted-schaefer',[1,3],260],['weighted-schaefer-empty',[0,0],-999]]) {
    const x=groupedSchaefer({operation:6,threshold:0});for(let id=0;id<6;++id)source(x,'external',6,weights[id<3?0:1],id);
    assert.equal(last(await run(x,name),'actionReceipt'),expected);
  }
});
test('8G operations, equal-valued groups, exact keys and singleton groups', async()=>{
  for(const [operation,v] of [[0,2],[1,6],[2,8],[3,4],[4,2],[5,20],[6,5]]) {
    const m=synthetic({operation});member(m,7,80,2,{weight:1});member(m,2,80,6,{weight:3});source(m,'group',5,2,0,1,.1);
    const r=await run(m,'operation-'+operation);assert.equal(last(r,'value'),v);assert.equal(last(r,'status'),1);
  }
  const m=synthetic();member(m,0,1,7);member(m,1,1+Number.EPSILON,7);source(m,'group',5,2,0,1,.1);
  const r=await run(m,'exact-keys');assert.equal(last(r,'end'),2);
  const k=synthetic();member(k,7,99,12,{omit:[1]});source(k,'group',1,80,7);source(k,'group',5,1,0,1,.1);
  assert.equal(last(await run(k,'key-independent-action'),'action'),80);
});
test('8G invalid, absent and late fields: strict or explicitly partial, no valid group means no action',async()=>{
  for(const validation of [0,1]) {
    const m=synthetic({validation});member(m,0,80,10);member(m,1,80,0,{valid:0,omit:[2]});source(m,'group',5,2,0,1,.1);
    const r=await run(m,'invalid-policy-'+validation);assert.equal(last(r,'end'),validation);assert.equal(last(r,'status'),validation?2:0);assert.equal(last(r,'validCount'),1);
    const missing=synthetic({validation});member(missing,0,80,10);source(missing,'group',5,2,0,1,.1);source(missing,'group',6,0,0,1,1);
    const mr=await run(missing,'missing-policy-'+validation);assert.equal(last(mr,'end'),validation);assert.equal(last(mr,'campaignStatus'),validation?2:0);
  }
  const absent=synthetic();member(absent,0,80,10,{omit:[2]});source(absent,'group',5,1,0,1,.1);
  const pending=await run(absent,'pending-field');assert.equal(last(pending,'end'),0);assert.equal(last(pending,'value'),0);assert.equal(last(pending,'campaignStatus'),3);
  source(absent,'group',2,10,0,1,1);const late=await run(absent,'late-field');assert.equal(last(late,'value'),10);assert.equal(last(late,'end'),1);
  const invalid=synthetic();member(invalid,0,80,0,{valid:0,omit:[2]});source(invalid,'group',5,1,0,1,.1);
  const empty=await run(invalid,'no-valid');assert.equal(last(empty,'end'),0);assert.equal(last(empty,'validCount'),0);
  const shared=synthetic();member(shared,0,80,10);source(shared,'group',5,1,0,1,.1);source(shared,'group',6,0,0,1,1);
  assert.equal(last(await run(shared,'seal-already-complete'),'value'),10);
  const asymmetric=groupedSchaefer();asymmetric.model.connections=asymmetric.model.connections.filter(e=>!(e.from.component==='decision'&&e.from.port===7&&e.to.component==='external'));
  source(asymmetric,'external',7,0,0,1,2);
  asymmetric.model.components.push(atom('closedStatus','value_memory',{initial:-1,emitOnWrite:1}));asymmetric.model.connections.push(edge('external',3,'closedStatus',0));asymmetric.model.observations.push({component:'closedStatus',samplingInterval:.1});
  const ar=await run(asymmetric,'asymmetric-metrics-sealed');assert.equal(last(ar,'actionReceipt'),-999);assert.equal(last(ar,'closedStatus'),0);
  const frame=document('invalid-raw-frame',[{id:'external',type:'coupled',parameters:{},definition:'GroupedDecision'},atom('receipt','value_memory',{initial:-999,emitOnWrite:1}),atom('selection','value_memory',{initial:-1,emitOnWrite:1})],
    [edge('external',0,'receipt',0),edge('external',3,'selection',0)],groupedSchaefer().model.definitions.filter(d=>d.id!=='Schaefer'));
  frame.model.observations=['receipt','selection'].map(component=>({component,samplingInterval:.1}));
  for(const [p,v]of[150,20,80,1].entries())source(frame,'external',p,v,0);
  source(frame,'external',3,0,1);source(frame,'external',4,1,2,1,.1);source(frame,'external',7,0,0,1,1);
  const fr=await run(frame,'invalid-raw-frame');assert.equal(last(fr,'receipt'),-999);assert.equal(last(fr,'selection'),0);
});
test('8G duplicate IDs, replay after closure, action conflicts and capacity are explicit protocol errors',async()=>{
  const duplicate=synthetic();member(duplicate,0,80,10);source(duplicate,'group',2,12,0,1,.1);await run(duplicate,'duplicate',2);
  const replay=synthetic();member(replay,0,80,10);source(replay,'group',5,1,0,1,.1);member(replay,9,150,12,{at:1});await run(replay,'replay',2);
  const cap=synthetic({capacity:1});member(cap,0,80,10);member(cap,1,150,12);await run(cap,'capacity',2);
  const conflict=synthetic();member(conflict,0,80,10);member(conflict,1,80,12,{omit:[1]});source(conflict,'group',1,150,1);source(conflict,'group',5,2,0,1,.1);await run(conflict,'action-conflict',2);
});
test('8G overlapping and sequential campaigns release capacity and preserve identities',async()=>{
  const m=synthetic({capacity:2});member(m,0,80,10,{at:1,campaign:1});member(m,0,150,20,{at:.1,campaign:2});
  source(m,'group',5,1,0,1,0);source(m,'group',5,1,0,2,0);
  const r=await run(m,'overlap');assert.equal(last(r,'value'),10);assert.equal(last(r,'action'),80);
  const seq=synthetic({capacity:1});for(let c=0;c<10;++c){member(seq,0,80,c,{campaign:c,at:c*.1});source(seq,'group',5,1,0,c,c*.1+.01);}
  const out=await run(seq,'sequential');assert.equal(last(out,'value'),9);
});
test('8G equal decision scores choose smallest group identity; both branches empty emit no action',async()=>{
  const m=groupedSchaefer();wrapper(m).experiment.factors[1].values=[.001];
  const d=def(m,'GroupedDecision');d.components.find(c=>c.id==='minCH').parameters.operation=4;
  // Disable the constraint: all count scores tie; secondary Nmin ties for 80/150, identity chooses 80.
  d.components.find(c=>c.id==='admissible').parameters.right=0;
  assert.equal(last(await run(m,'equal-decision'),'actionReceipt'),80);
  const empty=groupedSchaefer();wrapper(empty).experiment.factors[1].values=[.001];
  const gd=def(empty,'GroupedDecision');gd.components.filter(c=>c.type==='group_aggregate').forEach(c=>c.parameters.required=15);
  source(empty,'external',7,0,0,1,2);
  empty.model.components.push(atom('emptyStatus','value_memory',{initial:-1,emitOnWrite:1}));empty.model.connections.push(edge('external',3,'emptyStatus',0));empty.model.observations.push({component:'emptyStatus',samplingInterval:.1});
  // Seal missing weights explicitly: both branches close empty, with no action.
  const noAction=await run(empty,'both-empty');assert.equal(last(noAction,'actionReceipt'),-999);assert.equal(last(noAction,'emptyStatus'),0);
});
test('8G resets and delayed wrapper cancellation preserve 8F protocol',async()=>{
  const m=uncertaintyTstar({times:[1,3],delay:3});const r=await run(m,'cancel-delayed');
  assert.equal(r.resultEvents.length,0);assert.equal(last(r,'applied'),260);
  const overlap=uncertaintyTstar({delay:3});overlap.simulation.end=7;
  overlap.model.connections=overlap.model.connections.filter(e=>!(e.from.component==='observer'&&e.from.port===3&&e.to.component==='forecast'));
  const both=await run(overlap,'overlap-wrapper');assert.deepEqual(both.resultEvents.filter(e=>e.port===13).map(e=>[e.time,e.value[2]]),[[4,1],[6,2]]);
  assert.notEqual(rows(both,1,7)[0].value[0],rows(both,2,7)[0].value[0]);assert.equal(last(both,'applied'),150);
  const reset=synthetic();member(reset,0,80,99);source(reset,'group',7,0,0,1,.5);member(reset,0,150,7,{at:.5});source(reset,'group',5,1,0,1,.5);
  assert.equal(last(await run(reset,'reset'),'value'),7);
});
