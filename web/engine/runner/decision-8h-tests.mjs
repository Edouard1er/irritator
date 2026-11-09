import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dynamicMinimal, dynamicSchaefer, planningDefinition } from './decision-8h-fixture.mjs';
import { tstarSchaefer } from './decision-8f-fixture.mjs';
import { schaeferOracle, feedbackOracle } from './decision-8e-oracle.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { source } from './decision-8c-fixture.mjs';
import { validateRequest, parseWrapperResult } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER;
assert.ok(runner, 'Set IRRITATOR_RUNNER');
let app;
if (process.env.DECISION_8H_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
async function run(m, name, error = false, engineCode = 70) {
  validateRequest(m);
  const p = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(p.status, error ? 2 : 0, p.stdout + p.stderr);
  const r = JSON.parse(p.stdout);
  if (!error) { parseWrapperResult(r, m); assert.equal(p.stderr, ''); }
  else { assert.match(p.stderr, /EXECUTION_ERROR/); assert.equal(r.error.code, 'EXECUTION_ERROR'); assert.equal(r.error.engineCategory, 3); assert.equal(r.error.engineCode, engineCode); }
  if (app) {
    const res = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    const { runId, requestId, ...actual } = await res.json();
    assert.equal(res.status, error ? 422 : 200); assert.ok(error ? requestId : runId); assert.deepEqual(actual, r);
  }
  if (process.env.IRRITATOR_8H_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_8H_EVIDENCE, { recursive: true });
    writeFileSync(resolve(process.env.IRRITATOR_8H_EVIDENCE, name + '.json'), JSON.stringify({ request: m, result: r, exit: p.status, httpEqualsNative: !!app }, null, 2));
  }
  return r;
}
const def = (m, id) => m.model.definitions.find(d => d.id === id);
const rows = (r, c, p) => r.resultEvents.filter(e => e.value[2] === c && e.port === p).sort((a, b) => a.value[1]-b.value[1]);
const last = (r, path) => r.observations.find(o => o.component === path).samples.at(-1).value;
const near = (a, b, t = .05) => assert.ok(Number.isFinite(a) && Math.abs(a-b) <= t, `${a} != ${b} tol=${t}`);
const plan = m => def(m, 'BuildPlan');
function removePayload(m, id) {
  const d = plan(m); d.connections = d.connections.filter(e => e.from.component !== id + 'Tag');
  return m;
}
// Direct wire fixtures exercise protocol permutations independently of the
// graphical planner. Dates are explicit test stimuli, never ordering epsilons.
function manual() {
  const m = dynamicMinimal();
  m.model.definitions = m.model.definitions.filter(d => d.id === 'LinearProspect');
  m.model.components = m.model.components.filter(c => c.id === 'forecast');
  m.model.connections = []; m.model.observations = []; m.simulation.end = 10;
  return m;
}
function transmission(m, campaign, initial, values, H, at = 0) {
  source(m, 'forecast', 2, initial, 0, campaign, at);
  values.forEach((v, i) => source(m, 'forecast', 3, v, i, campaign, at));
  for (const [field, value] of [[0, campaign], [1, 1], [2, H], [6, values.length], [3, 0]]) source(m, 'forecast', 4, value, field, campaign, at);
}
test('8H delivered graphs and import/export retain all graphical plan settings', async () => {
  for (const [file, create] of [['decision-dynamic-plan-minimal-v3.json', dynamicMinimal], ['tstar-schaefer-dynamic-plan-v3.json', dynamicSchaefer]]) {
    const m = JSON.parse(readFileSync(new URL('../../examples/' + file, import.meta.url)));
    assert.deepEqual(m, create()); assert.deepEqual(await run(m, file), await run(JSON.parse(JSON.stringify(m)), file + '-roundtrip'));
  }
  const a = dynamicSchaefer(), b = tstarSchaefer();
  for (const id of ['SchaeferPlant', 'SchaeferProspect', 'SynchronizePair']) assert.deepEqual(def(a, id), def(b, id));
});
test('8H independent linear model: observed -1/1, domains 3/2, H 2/1, actual individual outcomes', async () => {
  const r = await run(dynamicMinimal(), 'linear-two-campaigns');
  for (const c of [1, 2]) {
    assert.deepEqual(rows(r, c, 8).map(e => e.value), [[c === 1 ? 3 : 2, c, c]]);
    assert.deepEqual(rows(r, c, 7).map(e => e.value), [[c === 1 ? 3 : 2, c === 1 ? 3 : 2, c]]);
    assert.deepEqual(rows(r, c, 5).map(e => e.value[0]), c === 1 ? [-1, 0, 1] : [-1, 0]);
    const initial = c === 1 ? -1 : 1, H = c === 1 ? 2 : 1;
    for (const e of rows(r, c, 4)) near(e.value[0], initial, 1e-10);
    rows(r, c, 6).forEach((e, i) => near(e.value[0], initial + H * rows(r, c, 5)[i].value[0], .002));
    assert.ok(rows(r, c, 8)[0].bag < rows(r, c, 3)[0].bag);
  }
  near(last(r, 'plant/X'), 1, .002); assert.equal(last(r, 'plant/hold'), 0);
});
test('8H Schaefer: actual 3 then 2 children, dynamic H and external decision', async () => {
  const r = await run(dynamicSchaefer(), 'schaefer-two-campaigns');
  for (const c of [1, 2]) {
    const E = c === 1 ? [80, 150, 260] : [80, 150], H = c === 1 ? 20 : 10;
    assert.deepEqual(rows(r, c, 14).map(e => e.value), [[E.length, c, c]]);
    assert.deepEqual(rows(r, c, 13).map(e => e.value), [[E.length, E.length, c]]);
    assert.deepEqual(rows(r, c, 9).map(e => e.value[0]), E);
    const N = rows(r, c, 7)[0].value[0], C = rows(r, c, 8)[0].value[0];
    assert.ok(c === 1 ? N < 140 : N >= 140);
    rows(r, c, 12).forEach((e, i) => near(e.value[0], schaeferOracle(N, C, E[i], H).C, .3));
    rows(r, c, 11).forEach((e, i) => near(e.value[0], Math.min(N, schaeferOracle(N, C, E[i], H).N), .05));
    const winner = rows(r, c, 12).reduce((a, b) => a.value[0] > b.value[0] ? a : b);
    const legacy = p => r.resultEvents.find(e => e.port === p && e.time === (c === 1 ? 1 : 3)).value[0];
    near(legacy(1), winner.value[0], 1e-10);
    near(legacy(0), rows(r, c, 11).find(e => e.value[1] === winner.value[1]).value[0], 1e-10);
    assert.equal(legacy(4), E[winner.value[1]]);
  }
  assert.equal(last(r, 'plant/effort'), 150);
  near(last(r, 'plant/N'), feedbackOracle(5).N, .05); near(last(r, 'plant/C'), feedbackOracle(5).C, .1);
});
test('8H graphical second domain [80] changes action and piecewise analytic trajectory', async () => {
  const m = dynamicSchaefer({ secondDomain: [80] }), r = await run(m, 'schaefer-single-second');
  assert.deepEqual(rows(r, 2, 9).map(e => e.value), [[80, 0, 2]]);
  assert.deepEqual(rows(r, 2, 13).map(e => e.value), [[1, 1, 2]]);
  assert.equal(last(r, 'plant/effort'), 80);
  const at3 = feedbackOracle(3), expected = schaeferOracle(at3.N, at3.C, 80, 2);
  near(last(r, 'plant/N'), expected.N, .05); near(last(r, 'plant/C'), expected.C, .1);
  for (const id of ['N', 'C']) for (const s of r.observations.find(o => o.component === 'plant/' + id).samples) {
    const analytic = s.time <= 3 ? feedbackOracle(s.time) : schaeferOracle(at3.N, at3.C, 80, s.time - 3);
    near(s.value, analytic[id], id === 'N' ? .05 : .1);
  }
  assert.ok(Math.abs(last(r, 'plant/N') - feedbackOracle(5).N) > 10);
  const samples = r.observations.find(o => o.component === 'plant/effort').samples;
  // Discrete scalar observations retain their historical resampling convention.
  // Exact action dates are asserted against native output bags by the C++ proof.
  assert.deepEqual(samples.map(s => s.value), [260, 150, 80]);
});
test('8H threshold editable: native comparator chooses the other branch', async () => {
  const r = await run(dynamicMinimal({ threshold: -2 }), 'linear-condition-edited');
  assert.deepEqual(rows(r, 1, 8).map(e => e.value), [[2, 2, 1]]);
  assert.equal(last(r, 'plant/hold'), 0); near(last(r, 'plant/X'), -1, .002);
});
test('8H dynamic values need not belong to the statically declared capacity grid', async () => {
  const m = manual(); transmission(m, 1, 7, [4, 5], .5); source(m, 'forecast', 1, 0, 0, 1, 1);
  const r = await run(m, 'new-domain-values');
  assert.deepEqual(rows(r, 1, 5).map(e => e.value[0]), [4, 5]);
  rows(r, 1, 6).forEach((e, i) => near(e.value[0], [9, 9.5][i], .002));
});
test('8H multidimensional dynamic product has deterministic first-factor-fastest identities', async () => {
  const m = dynamicSchaefer();
  m.model.components.find(c => c.id === 'forecast').experiment.factors.find(f => f.id === 'qHypothesis').values = [.0008, .001];
  m.model.definitions[m.model.definitions.findIndex(d => d.id === 'BuildPlan')] = planningDefinition({ threshold: 140, factorIndex: 2, low: [80, 150, 260], high: [80, 150], lowH: 20, highH: 10, context: [{ index: 3, values: [.0008, .001] }] });
  const r = await run(m, 'multidimensional-plans');
  for (const c of [1, 2]) {
    const E = c === 1 ? [80, 150, 260] : [80, 150];
    assert.deepEqual(rows(r, c, 9).map(e => e.value[0]), [...E, ...E]);
    assert.deepEqual(rows(r, c, 10).map(e => e.value[0]), E.map(() => .0008).concat(E.map(() => .001)));
    assert.deepEqual(rows(r, c, 13).map(e => e.value), [[E.length * 2, E.length * 2, c]]);
  }
});
test('8H incomplete plans, missing observation and empty domains are rejected explicitly', async () => {
  for (const id of ['lowIdentity', 'lowVersion', 'lowHorizon', 'lowCount', 'lowValue1']) await run(removePayload(dynamicMinimal(), id), 'missing-' + id, true);
  const missing = dynamicMinimal(); missing.model.connections = missing.model.connections.filter(e => !(e.from.component === 'observer' && e.to.component === 'forecast' && e.to.port === 2));
  await run(missing, 'missing-observation', true);
  const empty = dynamicMinimal(); plan(empty).components.find(c => c.id === 'lowCount').parameters.left = 0;
  await run(empty, 'empty-domain', true);
});
test('8H duplicate, contradictory, oversized, horizon and late factor transactions reject', async () => {
  for (const [name, port, value, key, at] of [['duplicate-value', 3, -1, 0, 1], ['contradictory-value', 3, 77, 0, 1], ['duplicate-identity', 4, 1, 0, 1], ['late-value', 3, -1, 0, 1.5], ['duplicate-seal', 4, 0, 3, 1.5]]) {
    const m = dynamicMinimal(); source(m, 'forecast', port, value, key, 1, at); await run(m, name, true);
  }
  for (const [id, value] of [['lowCount', 4], ['lowHorizon', 3], ['lowHorizon', 0], ['lowVersion', 0], ['lowIdentity', 0]]) {
    const m = dynamicMinimal(); plan(m).components.find(c => c.id === id).parameters.left = value; await run(m, 'excess-' + id + '-' + value, true);
  }
});
test('8H incomplete transmission waits until explicit seal; run cannot use an unsealed plan', async () => {
  const m = removePayload(dynamicMinimal(), 'lowSeal');
  // Second campaign is suppressed so no later state is borrowed from it.
  m.simulation.end = 2;
  const r = await run(m, 'unsealed-wait'); assert.equal(r.resultEvents.length, 0);
  source(m, 'forecast', 1, 0, 0, 1, 1.5); await run(m, 'unsealed-run', true);
});
test('8H absent observations cannot execute a campaign from prototype sentinel states', async () => {
  const m = dynamicMinimal(); m.model.connections = m.model.connections.filter(e => !(e.from.component.startsWith('cycle') && e.to.component === 'observer'));
  const r = await run(m, 'absent-observation'); assert.equal(r.resultEvents.length, 0); near(last(r, 'plant/X'), -1, .002);
});
test('8H delayed overlapping replies retain plan-specific counts and factors', async () => {
  const m = dynamicMinimal({ delay: 4 }); m.simulation.end = 8;
  const r = await run(m, 'overlap-delayed');
  // Without the first action at t=1, X remains -1: both observations select low.
  for (const c of [1, 2]) assert.deepEqual(rows(r, c, 5).map(e => e.value[0]), [-1, 0, 1]);
  assert.equal(rows(r, 1, 7)[0].time, 5); assert.equal(rows(r, 2, 7)[0].time, 7);
});
test('8H overlapping different plans preserve immutable delayed response snapshots', async () => {
  const m = manual(); transmission(m, 1, -1, [-1, 0, 1], 2); transmission(m, 2, 7, [-1, 0], 1, 2);
  source(m, 'forecast', 1, 5, 0, 1, 1); source(m, 'forecast', 1, 0, 0, 2, 3);
  const r = await run(m, 'overlap-different-plans');
  assert.deepEqual(rows(r, 1, 5).map(e => e.value[0]), [-1, 0, 1]); assert.deepEqual(rows(r, 2, 5).map(e => e.value[0]), [-1, 0]);
  assert.equal(rows(r, 1, 7)[0].time, 6); assert.equal(rows(r, 2, 7)[0].time, 3);
  assert.deepEqual(rows(r, 1, 4).map(e => e.value[0]), [-1, -1, -1]); assert.deepEqual(rows(r, 2, 4).map(e => e.value[0]), [7, 7]);
});
test('8H init cancels old delayed responses; cancel closes a plan and rejects replay', async () => {
  const m = manual(); transmission(m, 1, -1, [-1, 0, 1], 2); transmission(m, 2, 7, [-1, 0], 1, 2);
  source(m, 'forecast', 1, 5, 0, 1, 1); source(m, 'forecast', 0, 0, 0, 2, 3); source(m, 'forecast', 1, 0, 0, 2, 4);
  const r = await run(m, 'init-cancels'); assert.equal(rows(r, 1, 7).length, 0); assert.deepEqual(rows(r, 2, 7).map(e => e.value), [[2, 2, 2]]);
  const canceled = manual(); transmission(canceled, 1, -1, [-1, 0, 1], 2); source(canceled, 'forecast', 4, 0, 4, 1, 1);
  const c = await run(canceled, 'cancel-plan'); assert.equal(rows(c, 1, 7).length, 0);
  source(canceled, 'forecast', 1, 0, 0, 1, 2); await run(canceled, 'cancel-replay', true);
});
test('8H a complete seal/init/run bag retains its validation acknowledgement', async () => {
  const m = manual(); transmission(m, 1, -1, [-1, 0, 1], 2);
  source(m, 'forecast', 0, 0, 0, 1); source(m, 'forecast', 1, 0, 0, 1);
  const r = await run(m, 'confluent-seal-init-run');
  assert.deepEqual(rows(r, 1, 8).map(e => e.value), [[3, 1, 1]]);
  assert.deepEqual(rows(r, 1, 7).map(e => e.value), [[3, 3, 1]]);
  assert.ok(rows(r, 1, 8)[0].bag < rows(r, 1, 3)[0].bag);
});
test('8H init preserves acknowledgements of independently staged future plans', async () => {
  const m = manual(); transmission(m, 1, -1, [-1, 0, 1], 2); transmission(m, 2, 7, [-1, 0], 1);
  source(m, 'forecast', 0, 0, 0, 1); source(m, 'forecast', 1, 0, 0, 1); source(m, 'forecast', 1, 0, 0, 2, 1);
  const r = await run(m, 'init-preserves-future-plan');
  assert.deepEqual(rows(r, 1, 8).map(e => e.value), [[3, 1, 1]]); assert.deepEqual(rows(r, 2, 8).map(e => e.value), [[2, 2, 2]]);
  assert.deepEqual(rows(r, 2, 7).map(e => e.value), [[2, 2, 2]]);
});
test('8H two coupled instances own independent plans and scenario identities', async () => {
  const a = dynamicMinimal();
  const scope = { id: 'Experiment', name: 'Independent instance', inputs: [], outputs: [], components: a.model.components, connections: a.model.connections };
  const m = { ...a, model: { id: 'two-instances', definitions: [...a.model.definitions, scope], components: ['a', 'b'].map(id => ({ id, type: 'coupled', definition: scope.id, parameters: {} })), connections: [], observations: ['a', 'b'].map(id => ({ component: id + '/plant/X', samplingInterval: .1 })) } };
  const r = await run(m, 'two-independent-instances');
  for (const id of ['a/forecast', 'b/forecast']) assert.deepEqual(r.resultEvents.filter(e => e.component === id && e.port === 7).map(e => e.value), [[3, 3, 1], [2, 2, 2]]);
});
test('8H a native nonfinite child criterion rejects the campaign without fabricated result rows', async () => {
  const m = manual(), d = def(m, 'LinearProspect');
  d.components.push(atom('nonfinite', 'qss3_power', { n: 2000 }));
  d.connections.push(edge('u', 0, 'nonfinite', 0));
  m.model.components[0].experiment.selections[0].target = 'nonfinite';
  transmission(m, 1, 7, [2], 1);
  source(m, 'forecast', 1, 0, 0, 1, 1);
  // 2^2000 overflows inside the actual prospective model. The legacy
  // optimizer rejects its nonfinite criterion before per-scenario restitution.
  const r = await run(m, 'native-invalid-criterion', true, 67);
  assert.equal(r.status, 'failed'); assert.equal(r.resultEvents, undefined);
});
test('8H parser rejects missing/duplicate/ambiguous scenario results and false closing counts', async () => {
  const m = dynamicMinimal(), good = await run(m, 'parser-reference');
  const invalid = structuredClone(good);
  invalid.resultEvents.find(e => e.port === 3 && e.value[2] === 1 && e.value[1] === 0).value[0] = 0;
  invalid.resultEvents = invalid.resultEvents.filter(e => !(e.value[2] === 1 && e.value[1] === 0 && [4, 5, 6].includes(e.port)));
  invalid.resultEvents.find(e => e.port === 7 && e.value[2] === 1).value[0] = 2;
  // An invalid child has only its explicit status: no invented factor/criterion.
  parseWrapperResult(invalid, m);
  const fabricated = structuredClone(invalid);
  const invented = structuredClone(good.resultEvents.find(e => e.port === 4 && e.value[2] === 1 && e.value[1] === 0));
  fabricated.resultEvents.splice(fabricated.resultEvents.findIndex(e => e.bag > invented.bag), 0, invented);
  assert.throws(() => parseWrapperResult(fabricated, m));
  for (const mutate of [
    r => { r.resultEvents.splice(r.resultEvents.findIndex(e => e.port === 6), 1); },
    r => { r.resultEvents.find(e => e.port === 7).value[1] = 2; },
    r => { r.resultEvents.find(e => e.port === 3).value[1] = 7; },
    r => { const e = r.resultEvents.find(e => e.port === 5); e.value[1] = 1; },
    r => { r.resultEvents.find(e => e.port === 8).value[0] = 2; }
  ]) { const r = structuredClone(good); mutate(r); assert.throws(() => parseWrapperResult(r, m)); }
});
