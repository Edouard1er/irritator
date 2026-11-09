import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dynamicUncertainty } from './decision-8i-fixture.mjs';
import { dynamicSchaefer } from './decision-8h-fixture.mjs';
import { schaeferOracle, feedbackOracle } from './decision-8e-oracle.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { source, document } from './decision-8c-fixture.mjs';
import { validateRequest, parseWrapperResult, parseResult } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER;
assert.ok(runner, 'Set IRRITATOR_RUNNER');
let app;
if (process.env.DECISION_8I_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
async function run(m, name, error = false) {
  validateRequest(m);
  const start = performance.now();
  const p = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const wallMs = performance.now() - start;
  const r = JSON.parse(p.stdout || 'null');
  let evidencePath;
  const evidence = { request: m, result: r, exit: p.status, stderr: p.stderr, wallMs, httpRequested: !!app, httpEqualsNative: null };
  // Save initial failures before asserting, so retries cannot erase evidence.
  if (process.env.IRRITATOR_8I_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_8I_EVIDENCE, { recursive: true });
    evidencePath = resolve(process.env.IRRITATOR_8I_EVIDENCE, name + '.json');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  }
  assert.equal(p.status, error ? 2 : 0, p.stdout + p.stderr);
  if (!error) { (m.schemaVersion === 3 ? parseWrapperResult : parseResult)(r, m); assert.equal(p.stderr, ''); }
  else { assert.equal(r.error.code, 'EXECUTION_ERROR'); assert.match(p.stderr, /EXECUTION_ERROR/); assert.equal(r.resultEvents, undefined); }
  if (app) {
    const res = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    const { runId, requestId, ...actual } = await res.json();
    assert.equal(res.status, error ? 422 : 200); assert.ok(error ? requestId : runId); assert.deepEqual(actual, r);
    if (evidencePath) writeFileSync(evidencePath, JSON.stringify({ ...evidence, httpEqualsNative: true, httpStatus: res.status }, null, 2));
  }
  return r;
}
const def = (m, id) => m.model.definitions.find(d => d.id === id);
const rows = (r, c, p) => r.resultEvents.filter(e => e.value[2] === c && e.port === p).sort((a, b) => a.value[1] - b.value[1]);
const last = (r, path) => r.observations.find(o => o.component === path).samples.at(-1).value;
const near = (a, b, tol = .05) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${a} != ${b} tol=${tol}`);
const parameter = (m, id, field, value) => { def(m, 'BuildPlan').components.find(c => c.id === id).parameters[field] = value; return m; };
const disconnect = (m, id) => { const d = def(m, 'BuildPlan'); d.connections = d.connections.filter(e => e.from.component !== id + 'Tag'); return m; };
function checkPlan(r, c, E, Q, H, planId = c) {
  const n = E.length * Q.length;
  assert.deepEqual(rows(r, c, 14).map(e => e.value), [[n, planId, c]]);
  assert.deepEqual(rows(r, c, 13).map(e => e.value), [[n, n, c]]);
  assert.deepEqual(rows(r, c, 6).map(e => e.value), Array.from({ length: n }, (_, i) => [1, i, c]));
  assert.deepEqual(rows(r, c, 9).map(e => e.value[0]), Q.flatMap(() => E));
  assert.deepEqual(rows(r, c, 10).map(e => e.value[0]), Q.flatMap(q => E.map(() => q)));
  const N = rows(r, c, 7)[0].value[0], C = rows(r, c, 8)[0].value[0];
  for (let i = 0; i < n; ++i) {
    assert.equal(rows(r, c, 7)[i].value[0], N); assert.equal(rows(r, c, 8)[i].value[0], C);
    const a = schaeferOracle(N, C, E[i % E.length], H, Q[Math.floor(i / E.length)]);
    near(rows(r, c, 11)[i].value[0], Math.min(N, a.N)); near(rows(r, c, 12)[i].value[0], a.C, .3);
  }
  assert.ok(rows(r, c, 14)[0].bag < rows(r, c, 6)[0].bag);
  return { N, C };
}

test('8I delivered graphs preserve 8H Plant, Prospect, synchronization and scientific/workspace inputs', async () => {
  for (const [file, options] of [
    ['tstar-schaefer-dynamic-uncertainty-v3.json', {}],
    ['tstar-schaefer-dynamic-uncertainty-single-v3.json', { secondDomain: [80] }],
    ['tstar-schaefer-dynamic-uncertainty-context-v3.json', { secondQ: [.0008] }],
  ]) {
    const m = JSON.parse(readFileSync(new URL('../../examples/' + file, import.meta.url)));
    assert.deepEqual(m, dynamicUncertainty(options));
    for (const id of ['SchaeferPlant', 'SchaeferProspect', 'SynchronizePair']) assert.deepEqual(def(m, id), def(dynamicSchaefer(), id));
    const r = await run(m, file), rr = await run(JSON.parse(JSON.stringify(m)), file + '-roundtrip'); assert.deepEqual(rr, r);
  }
});

test('8I 6 then 4 real scenarios use observed states, independently addressed E/q, and H=20/10', async () => {
  const m = dynamicUncertainty(), r = await run(m, 'main');
  const a = checkPlan(r, 1, [80, 150, 260], [.0008, .001], 20), b = checkPlan(r, 2, [80, 150], [.0008, .001], 10);
  near(a.N, 138.72279747766177, 1e-10); near(a.C, 37.474201388034722, 1e-10);
  near(b.N, 148.0329563662178, 1e-10); near(b.C, 80.549582911628249, 1e-10);
  assert.equal(last(r, 'applied'), 150); assert.equal(last(r, 'primarySelected'), 1); assert.equal(last(r, 'secondarySelected'), 1);
  near(last(r, 'plant/N'), 155.00709547863144, 1e-9); near(last(r, 'plant/C'), 126.05837650688633, 1e-9);
  const old = await run(dynamicSchaefer(), '8h-main-reference');
  for (const id of ['N', 'C']) assert.deepEqual(r.observations.find(o => o.component === 'plant/' + id).samples, old.observations.find(o => o.component === 'plant/' + id).samples);
  for (const id of ['N', 'C']) for (const s of r.observations.find(o => o.component === 'plant/' + id).samples) near(s.value, feedbackOracle(s.time)[id], id === 'N' ? .05 : .1);
  // Compare every prospective result to an independent flat NATIVE simulation.
  for (const c of [1, 2]) for (const e of rows(r, c, 9)) {
    const sid = e.value[1], flat = structuredClone(def(m, 'SchaeferProspect'));
    for (const [id, port] of [['N', 7], ['C', 8], ['E', 9], ['q', 10]]) flat.components.find(x => x.id === id).parameters[id === 'N' || id === 'C' ? 'X' : 'value'] = rows(r, c, port)[sid].value[0];
    const f = await run({ schemaVersion: 1, model: { id: 'independent-child', components: flat.components, connections: flat.connections, observations: ['N', 'C'].map(component => ({ component, samplingInterval: .1 })) }, simulation: { start: 0, end: c === 1 ? 20 : 10 } }, `flat-${c}-${sid}`);
    near(rows(r, c, 12)[sid].value[0], last(f, 'C'), 1e-9);
    near(rows(r, c, 11)[sid].value[0], Math.min(rows(r, c, 7)[sid].value[0], last(f, 'N')), 1e-9);
  }
});

test('8I single E at cycle 2 changes the actual trajectory and matches 8H and an independent analytic oracle', async () => {
  const r = await run(dynamicUncertainty({ secondDomain: [80] }), 'single'), old = await run(dynamicSchaefer({ secondDomain: [80] }), '8h-single-reference');
  checkPlan(r, 1, [80, 150, 260], [.0008, .001], 20); checkPlan(r, 2, [80], [.0008, .001], 10);
  assert.equal(last(r, 'applied'), 80);
  for (const id of ['N', 'C']) {
    assert.deepEqual(r.observations.find(o => o.component === 'plant/' + id).samples, old.observations.find(o => o.component === 'plant/' + id).samples);
    for (const s of r.observations.find(o => o.component === 'plant/' + id).samples) {
      const state = feedbackOracle(3), oracle = s.time <= 3 ? feedbackOracle(s.time) : schaeferOracle(state.N, state.C, 80, s.time - 3);
      near(s.value, oracle[id], id === 'N' ? .05 : .1);
    }
  }
  near(last(r, 'plant/N'), 174.22724507457158, 1e-9); near(last(r, 'plant/C'), 106.40507006405633, 1e-9);
});

test('8I contextual domain really contracts to one explicit hypothesis, with one member per action', async () => {
  const r = await run(dynamicUncertainty({ secondQ: [.0008] }), 'context');
  checkPlan(r, 1, [80, 150, 260], [.0008, .001], 20); checkPlan(r, 2, [80, 150], [.0008], 10);
  assert.equal(last(r, 'observer/decide/groups/count'), 1); assert.equal(last(r, 'applied'), 150);
});

test('8I both domains can change together; group 0 can carry action 150 instead of 80', async () => {
  const r = await run(dynamicUncertainty({ secondDomain: [150], secondQ: [.001] }), 'both-domains');
  checkPlan(r, 1, [80, 150, 260], [.0008, .001], 20); checkPlan(r, 2, [150], [.001], 10); assert.equal(last(r, 'applied'), 150); assert.equal(last(r, 'identity'), 0);
  const reverse = await run(dynamicUncertainty({ secondDomain: [150, 80] }), 'reordered-actions');
  checkPlan(reverse, 2, [150, 80], [.0008, .001], 10); assert.equal(last(reverse, 'applied'), 150);
});

test('8I unconstrained policy maximizes real robust future catch and changes the first action', async () => {
  const r = await run(dynamicUncertainty({ constrained: false }), 'unconstrained');
  assert.deepEqual(r.observations.find(o => o.component === 'plant/effort').samples.map(s => s.value), [260]);
  checkPlan(r, 1, [80, 150, 260], [.0008, .001], 20);
  checkPlan(r, 2, [80, 150, 260], [.0008, .001], 20, 1);
  assert.equal(last(r, 'applied'), 260); assert.ok(rows(r, 2, 7)[0].value[0] < 140);
});

test('8I ecological threshold and prospective horizon are ordinary editable native parameters', async () => {
  const m = dynamicUncertainty({ threshold: 0 }), r = await run(m, 'ecological-threshold'); assert.equal(last(r, 'applied'), 260);
  const h = parameter(dynamicUncertainty(), 'highHorizon', 'left', 5), hr = await run(h, 'horizon-5'); checkPlan(hr, 2, [80, 150], [.0008, .001], 5);
  const p = parameter(dynamicUncertainty(), 'less', 'right', 0), pr = await run(p, 'planning-threshold');
  assert.deepEqual(rows(pr, 1, 14).map(e => e.value), [[4, 2, 1]]); assert.deepEqual(rows(pr, 1, 13).map(e => e.value), [[4, 4, 1]]);
});

test('8I primary and fallback comparison directions change real selections without new code', async () => {
  const main = dynamicUncertainty(); def(main, 'ConditionalDecision').components.find(c => c.id === 'primary').parameters.direction = 1;
  const r = await run(main, 'primary-minimize'); assert.equal(last(r, 'applied'), 80);
  const fallback = dynamicUncertainty({ threshold: 1000 }); def(fallback, 'ConditionalDecision').components.find(c => c.id === 'secondary').parameters.direction = 1;
  const f = await run(fallback, 'fallback-minimize'); assert.equal(last(f, 'applied'), 260); assert.equal(last(f, 'primarySelected'), 0);
});

test('8I missing plan fields/cardinalities and required observations never inherit old values', async () => {
  for (const id of ['lowIdentity', 'lowVersion', 'lowHorizon', 'lowCount', 'lowContextCount0', 'lowContext0Value1', 'highContext0Value1']) await run(disconnect(dynamicUncertainty(), id), 'missing-' + id, true);
  const m = dynamicUncertainty(); m.model.connections = m.model.connections.filter(e => !(e.from.component === 'observer' && e.to.component === 'forecast' && e.to.port === 3));
  await run(m, 'missing-C0', true);
});

test('8I inconsistent cardinality, oversized H, premature seal and fields after seal reject', async () => {
  for (const [id, value] of [['lowCount', 2], ['lowContextCount0', 1], ['lowHorizon', 21], ['lowVersion', 0]]) await run(parameter(dynamicUncertainty(), id, 'left', value), 'invalid-' + id, true);
  const early = dynamicUncertainty(); source(early, 'forecast', 6, 0, 3, 1, .5); await run(early, 'premature-seal', true);
  for (const [port, value, identity] of [[5, .001, 1], [6, 0, 3], [1, 0, 0]]) {
    const late = dynamicUncertainty(); source(late, 'forecast', port, value, identity, 1, 1.5); await run(late, 'late-replay-' + port, true);
  }
});

test('8I unsealed plan waits; explicit run cannot start it; no observation produces no action', async () => {
  const m = disconnect(dynamicUncertainty(), 'lowSeal'); m.simulation.end = 2;
  const r = await run(m, 'unsealed'); assert.equal(r.resultEvents.length, 0); assert.equal(last(r, 'applied'), 260);
  source(m, 'forecast', 1, 0, 0, 1, 1.5); await run(m, 'unsealed-run', true);
  const no = dynamicUncertainty(); no.model.connections = no.model.connections.filter(e => !(e.from.component.startsWith('cycle') && e.to.component === 'observer'));
  const empty = await run(no, 'no-observations'); assert.equal(empty.resultEvents.length, 0); assert.equal(last(empty, 'applied'), 260);
});

test('8I delayed overlapping responses own their domains and campaign-specific results', async () => {
  const m = dynamicUncertainty({ delay: 4 }); m.simulation.end = 8;
  const r = await run(m, 'delayed-overlap');
  for (const c of [1, 2]) assert.deepEqual(rows(r, c, 13).map(e => [e.time, e.value]), [[c === 1 ? 5 : 7, [6, 6, c]]]);
  assert.notEqual(rows(r, 1, 7)[0].value[0], rows(r, 2, 7)[0].value[0]);
});

// Direct protocol tests stage two different multidimensional plans at known
// dates, independently of the observation-driven branch (no ordering epsilon).
function manual() {
  const m = dynamicUncertainty(); m.model.components = m.model.components.filter(c => c.id === 'forecast');
  m.model.definitions = m.model.definitions.filter(d => d.id === 'SchaeferProspect'); m.model.connections = []; m.model.observations = []; m.simulation.end = 8; return m;
}
function transmit(m, c, E, Q, H, at = 0) {
  for (const [p, v] of [[2, c === 1 ? 139 : 149], [3, c === 1 ? 37 : 81]]) source(m, 'forecast', p, v, 0, c, at);
  E.forEach((v, i) => source(m, 'forecast', 4, v, i, c, at)); Q.forEach((v, i) => source(m, 'forecast', 5, v, i, c, at));
  for (const [i, v] of [[0, c], [1, 1], [2, H], [7, E.length], [8, Q.length], [3, 0]]) source(m, 'forecast', 6, v, i, c, at);
}
test('8I overlapping different domains, init/seal confluence and cancellation preserve 8H transactions', async () => {
  const m = manual(); transmit(m, 1, [80, 150, 260], [.0008, .001], 20); transmit(m, 2, [150, 80], [.001], 10, 2);
  source(m, 'forecast', 1, 5, 0, 1, 1); source(m, 'forecast', 1, 0, 0, 2, 3);
  const r = await run(m, 'overlap-different'); checkPlan(r, 1, [80, 150, 260], [.0008, .001], 20); checkPlan(r, 2, [150, 80], [.001], 10);
  assert.equal(rows(r, 2, 13)[0].time, 3); assert.equal(rows(r, 1, 13)[0].time, 6);
  const confluent = manual(); transmit(confluent, 1, [80, 150, 260], [.0008, .001], 20); source(confluent, 'forecast', 0, 0, 0, 1); source(confluent, 'forecast', 1, 0, 0, 1);
  checkPlan(await run(confluent, 'init-seal-run-confluent'), 1, [80, 150, 260], [.0008, .001], 20);
  const cancel = manual(); transmit(cancel, 1, [80, 150, 260], [.0008, .001], 20); source(cancel, 'forecast', 6, 0, 4, 1, 1);
  const cr = await run(cancel, 'cancel-before-run'); assert.equal(rows(cr, 1, 13).length, 0);
  source(cancel, 'forecast', 1, 0, 0, 1, 2); await run(cancel, 'cancel-replay', true);
});

test('8I missing/duplicate result frames and false closes are parser failures, not native recovery claims', async () => {
  const m = dynamicUncertainty(), good = await run(m, 'parser-reference');
  for (const mutate of [
    r => r.resultEvents.splice(r.resultEvents.findIndex(e => e.port === 12), 1),
    r => { const i = r.resultEvents.findIndex(e => e.port === 12); r.resultEvents.splice(i, 0, structuredClone(r.resultEvents[i])); },
    r => { r.resultEvents.find(e => e.port === 13).value[1] = 4; },
    r => { r.resultEvents.find(e => e.port === 10).value[1] = 8; },
  ]) { const r = structuredClone(good); mutate(r); assert.throws(() => parseWrapperResult(r, m)); }
});

test('8I native numerical child failure rejects the whole campaign without a fabricated new action', async () => {
  const m = dynamicUncertainty(), d = def(m, 'SchaeferProspect'); d.components.push(atom('overflow', 'qss3_power', { n: 2000 })); d.connections.push(edge('E', 0, 'overflow', 0));
  m.model.components.find(c => c.id === 'forecast').experiment.selections[1].target = 'overflow';
  const r = await run(m, 'native-child-overflow', true); assert.equal(r.error.engineCategory, 3); assert.equal(r.error.engineCode, 67);
});

function synthetic() {
  const m = dynamicUncertainty();
  const d = document('grouped-results-protocol', [{ id: 'decide', type: 'coupled', definition: 'GroupedDecision', parameters: {} }, atom('receipt', 'value_memory', { initial: -999, emitOnWrite: 1 })],
    [edge('decide', 0, 'receipt', 0)], m.model.definitions.filter(d => ['ReceiveResults', 'AggregateActions', 'EvaluateGroups', 'GroupedDecision', 'ConditionalDecision'].includes(d.id)));
  d.model.observations = [{ component: 'receipt', samplingInterval: .1 }]; return d;
}
function member(m, sid, E, N, C, c = 1, at = 0) { for (const [p, v] of [[0, N], [1, C], [2, E], [3, 1], [8, 37]]) source(m, 'decide', p, v, sid, c, at); }
test('8I complete native groups subtract common C0 without changing ranking; ties are deterministic', async () => {
  const m = synthetic(); member(m, 0, 80, 138, 50); member(m, 2, 80, 138, 60); member(m, 1, 150, 138, 50); member(m, 3, 150, 138, 60);
  source(m, 'decide', 4, 4, 4, 1, .5);
  const r = await run(m, 'group-tie'); assert.equal(last(r, 'receipt'), 80);
});
test('8I absent, invalid or incomplete native groups cannot produce an action; duplicate members reject', async () => {
  const missing = synthetic(); member(missing, 0, 80, 150, 50); source(missing, 'decide', 4, 2, 2, 1, .5); source(missing, 'decide', 7, 0, 0, 1, 1);
  assert.equal(last(await run(missing, 'missing-group'), 'receipt'), -999);
  const invalid = synthetic(); source(invalid, 'decide', 3, 0, 0); source(invalid, 'decide', 4, 0, 1, 1, .5); source(invalid, 'decide', 7, 0, 0, 1, 1);
  assert.equal(last(await run(invalid, 'invalid-result'), 'receipt'), -999);
  const duplicate = synthetic(); member(duplicate, 0, 80, 150, 50); source(duplicate, 'decide', 2, 80, 0, 1, .2); await run(duplicate, 'duplicate-result', true);
});
