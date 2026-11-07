import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { schaeferExternal, decisionFiltrage } from './decision-8b-fixture.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { validateRequest, parseWrapperResult, wrapperOutputs } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER;
assert.ok(runner, 'Set IRRITATOR_RUNNER');
const evidence = process.env.IRRITATOR_8B_EVIDENCE;
let app;
if (process.env.DECISION_8B_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 });
  test.after(async () => app.close());
}
const last = (r, id) => r.observations.find(o => o.component === id).samples.at(-1).value;
const param = (m, id) => m.model.definitions.find(d => d.id === 'DecisionFiltrage').components.find(c => c.id === id).parameters;
export const rows = r => [0, 1, 2, 3, 4, 5].map(id => Object.fromEntries([['E', 5], ['q', 6], ['Nmin', 7], ['CH', 8]].map(([k, p]) => [k, r.resultEvents.find(e => e.port === p && e.value[1] === id).value[0]])));
async function run(m, name) {
  validateRequest(m);
  const process = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(process.status, 0, process.stdout + process.stderr);
  let r = JSON.parse(process.stdout);
  if (m.schemaVersion === 3) parseWrapperResult(r, m);
  if (app) {
    const response = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    const json = await response.json(); assert.equal(response.status, 200, JSON.stringify(json));
    const { runId, ...http } = json; assert.ok(runId); assert.deepEqual(http, r); r = http;
  }
  if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(resolve(evidence, name + '.json'), JSON.stringify({ request: m, result: r, httpEqualsNative: !!app }, null, 2)); }
  return r;
}
test('8B: six native scenarios, raw ports, internal e3 and external e5', async () => {
  const m = schaeferExternal(), r = await run(m, 'baseline');
  const source = JSON.parse(readFileSync(new URL('../../model-test/schaefer-six-scenarios.source.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.model.definitions[0], source.model.definitions[0]);
  assert.equal(r.wrappers[0].scenarioCount, 6);
  assert.equal(wrapperOutputs(m.model.components[1].experiment).length, 10);
  assert.equal(last(r, 'internalE'), 260); assert.equal(last(r, 'internalQ'), .0008);
  assert.equal(last(r, 'action'), 150); assert.equal(last(r, 'identity'), 4); assert.equal(last(r, 'selected'), 1);
  const values = rows(r);
  assert.deepEqual(values.map(x => [x.E, x.q]), [[80,.0008],[150,.0008],[260,.0008],[80,.001],[150,.001],[260,.001]]);
  for (const row of values) {
    // Independent solution with the exact InvK from the six-scenario source.
    const alpha=.35-row.q*row.E, beta=.35/300;
    const d=1+beta*150*Math.expm1(alpha*20)/alpha;
    const N=150*Math.exp(alpha*20)/d, C=row.q*row.E*Math.log(d)/beta;
    assert.ok(Math.abs(row.CH-C)<.05, JSON.stringify(row));
    assert.ok(Math.abs(row.Nmin-Math.min(150,N))<.05, JSON.stringify(row));
  }
  assert.equal(last(r, 'score'), values[4].CH);
  assert.deepEqual(r.resultEvents.at(-1).value, [6,6,1]);
  for (const p of [4,5,6,7,8]) assert.deepEqual(r.resultEvents.filter(e => e.port === p).map(e => e.value.slice(1)), [0,1,2,3,4,5].map(i => [i,1]));
  assert.ok(r.resultEvents.every(e => e.time === 1));
  assert.ok(m.model.connections.filter(e => e.to.component === 'external').every(e => e.from.port >= 5));
});
test('8B: each prospective row matches an independent flat native Schaefer run', async () => {
  const r=await run(schaeferExternal(),'flat-comparison-source');
  for (const [i,row] of rows(r).entries()) {
    const source=JSON.parse(readFileSync(new URL('../../model-test/schaefer-six-scenarios.source.json',import.meta.url),'utf8'));
    const m={schemaVersion:1,model:{id:'flat-six-scenarios',components:source.model.definitions[0].components,connections:source.model.definitions[0].connections,observations:[]},simulation:{start:0,end:20}};
    m.model.components.find(c=>c.id==='E').parameters.value=row.E;
    m.model.components.find(c=>c.id==='q').parameters.value=row.q;
    m.model.observations=['N','C'].map(component=>({component,samplingInterval:.1}));
    const flat=await run(m,'flat-e'+(i+1));
    assert.ok(Math.abs(last(flat,'C')-row.CH)<1e-9);
    assert.ok(Math.abs(Math.min(...flat.observations.find(o=>o.component==='N').samples.map(s=>s.value))-row.Nmin)<1e-9);
  }
});
for (const [threshold, action, identity, receipt] of [[120,260,2,260], [140,150,4,150], [160,0,-1,-999]]) test(`8B: configurable threshold ${threshold}`, async () => {
  const r = await run(schaeferExternal(threshold), 'threshold-' + threshold);
  assert.equal(last(r, 'action'), action); assert.equal(last(r, 'identity'), identity);
  assert.equal(last(r, 'selected'), identity === -1 ? 0 : 1); assert.equal(last(r, 'actionReceipt'), receipt);
  assert.equal(last(r, 'internalE'), 260);
});
test('8B: explicitly enabled fallback is emitted on an empty cohort', async () => {
  const m = schaeferExternal(160); Object.assign(param(m, 'select'), { emitFallback: 1, fallback: -7 });
  const r = await run(m, 'explicit-fallback');
  assert.equal(last(r, 'actionReceipt'), -7); assert.equal(last(r, 'selected'), 0); assert.equal(last(r, 'identity'), -1);
});
test('8B: repeated campaigns release rows and retain campaign identities', async () => {
  const m = schaeferExternal();
  for (let i = 1; i <= 8; ++i) { m.model.components.push(atom('run' + i, 'constant', { offset: 1 + i*.15 })); m.model.connections.push(edge('run' + i, 0, 'decision', 1)); }
  const r = await run(m, 'campaigns');
  assert.deepEqual(r.resultEvents.filter(e => e.port === 9).map(e => e.value), Array.from({ length: 9 }, (_, i) => [6,6,i+1]));
  assert.equal(last(r, 'action'), 150); assert.equal(last(r, 'identity'), 4);
});
test('8B: coupled definition is reusable with independent native states', async () => {
  const m = schaeferExternal(); m.model.components.push({ id: 'other', type: 'coupled', parameters: {}, definition: 'DecisionFiltrage' }, atom('otherAction', 'value_memory', { emitOnWrite: 1 }));
  m.model.connections.push(...m.model.connections.filter(e => e.to.component === 'external').map(e => ({ from: e.from, to: { ...e.to, component: 'other' } })), edge('other', 0, 'otherAction', 0));
  m.model.observations.push({ component: 'otherAction', samplingInterval: .1 });
  const r = await run(m, 'reuse'); assert.equal(last(r, 'otherAction'), 150); assert.equal(last(r, 'action'), 150);
});
test('8B: external decision is independent of a changed or empty internal objective', async () => {
  for (const objective of [{ method:'simple',type:'minimize',primary:'CH' }, { method:'epsilon-constrained',type:'maximize',primary:'CH',epsilons:[1000,0],operations:['greater-equal','greater-equal'] }]) {
    const m = schaeferExternal(); m.model.components[1].experiment.objective = objective;
    const r = await run(m, 'objective-' + objective.method);
    assert.equal(last(r, 'action'), 150); assert.equal(last(r, 'identity'), 4);
    if (objective.method === 'simple') assert.equal(last(r, 'internalE'), 80);
    else assert.equal(r.resultEvents.filter(e => e.port < 4).length, 0);
  }
});
function delayed(missing = false) {
  const m = { schemaVersion: 2, model: { id: 'delayed-fields', definitions:[decisionFiltrage()], components:[{ id:'external',type:'coupled',parameters:{},definition:'DecisionFiltrage' }, atom('received','value_memory',{initial:-999,emitOnWrite:1}), atom('status','value_memory',{initial:-999,emitOnWrite:1})], connections:[edge('external',0,'received',0),edge('external',3,'status',0)], observations:['received','status'].map(component=>({component,samplingInterval:.1})) }, simulation:{start:0,end:3} };
  for (const [name,value,time,port,id] of [['end',1,0,3,0],['score',497,0,1,4],['biomass',150,.5,0,4],...missing?[]:[['effort',150,1.5,2,4]]]) {
    m.model.components.push(atom(name,'constant',{value,offset:time}),atom(name+'Tag','event_tag',{identity:id,campaign:7}));
    m.model.connections.push(edge(name,0,name+'Tag',0),edge(name+'Tag',0,'external',port));
  }
  return m;
}
test('8B: early closure waits for condition and action of the same candidate/campaign', async () => {
  const early=delayed();early.simulation.end=1.4;
  const pending=await run(early,'delayed-fields-before-action');assert.equal(last(pending,'received'),-999);assert.equal(last(pending,'status'),-999);
  const r = await run(delayed(), 'delayed-fields'); assert.equal(last(r,'received'),150); assert.equal(last(r,'status'),1);
  // Sampled observation interpolation is not an event timestamp log. The C++
  // composition test additionally asserts the exact emission time of 1.5.
});
test('8B: missing mandatory action leaves campaign pending without a fictitious decision', async () => {
  const r=await run(delayed(true),'missing-action'); assert.equal(last(r,'received'),-999); assert.equal(last(r,'status'),-999);
});
test('8B: JSON v3 roundtrip preserves definitions, ports and native decisions', async () => {
  const m=schaeferExternal(), r=await run(m,'before-roundtrip');
  assert.deepEqual(await run(JSON.parse(JSON.stringify(m)),'after-roundtrip'),r);
});
