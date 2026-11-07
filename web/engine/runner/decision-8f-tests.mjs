import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tstarSchaefer, periodicTstar } from './decision-8f-fixture.mjs';
import { schaeferFeedback } from './decision-8e-fixture.mjs';
import { schaeferOracle, feedbackOracle } from './decision-8e-oracle.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { source } from './decision-8c-fixture.mjs';
import { validateRequest, parseWrapperResult, parseResult } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER;
assert.ok(runner, 'Set IRRITATOR_RUNNER');
let app;
if (process.env.DECISION_8F_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
async function run(m, name, expected = 0) {
  validateRequest(m);
  const p = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(p.status, expected, p.stdout + p.stderr);
  const result = JSON.parse(p.stdout);
  if (!expected) { (m.schemaVersion === 3 ? parseWrapperResult : parseResult)(result, m); assert.equal(p.stderr, ''); }
  else assert.match(p.stderr, /^[A-Z_]+:/);
  if (app) {
    const res = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    const { runId, requestId, ...actual } = await res.json();
    assert.equal(res.status, expected ? 422 : 200); assert.ok(expected ? requestId : runId); assert.deepEqual(actual, result);
  }
  if (process.env.IRRITATOR_8F_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_8F_EVIDENCE, { recursive: true });
    writeFileSync(resolve(process.env.IRRITATOR_8F_EVIDENCE, name + '.json'), JSON.stringify({ request: m, result, exit: p.status, stderrBytes: Buffer.byteLength(p.stderr), httpEqualsNative: !!app }, null, 2));
  }
  return result;
}
const def = (m, id) => m.model.definitions.find(d => d.id === id);
const wrapper = m => m.model.components.find(c => c.id === 'forecast');
const cut = (m, fn) => m.model.connections = m.model.connections.filter(e => !fn(e));
const rows = (r, c, p) => r.resultEvents.filter(e => e.value[2] === c && e.port === p).sort((a, b) => a.value[1] - b.value[1]);
const last = (r, id) => r.observations.find(o => o.component === id).samples.at(-1).value;
const near = (a, b, tolerance = .05) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tolerance, `${a} != ${b} tol=${tolerance}`);
const science = r => r.resultEvents.map(({ port, time, value }) => ({ port, time, value }));

test('8F: delivered graph, reusable interfaces and scientific export/reimport', async () => {
  const m = tstarSchaefer(), saved = JSON.parse(readFileSync(new URL('../../examples/tstar-schaefer-three-coupled-v3.json', import.meta.url)));
  assert.deepEqual(saved, m);
  assert.deepEqual(def(m, 'SchaeferPlant'), def(schaeferFeedback(), 'SchaeferPlant'));
  assert.deepEqual(def(m, 'SchaeferProspect'), def(schaeferFeedback(), 'SchaeferProspect'));
  assert.deepEqual(m.model.components.filter(c => c.type === 'coupled').map(c => c.definition), ['SchaeferPlant', 'ObserverDecision']);
  assert.equal(wrapper(m).experiment.definition, 'SchaeferProspect');
  assert.ok(!def(m, 'ObserverDecision').components.some(c => c.type === 'simulation_wrapper'));
  assert.ok(m.model.connections.filter(e => e.to.component === 'plant' && e.to.port === 0).every(e => e.from.component === 'observer'));
  assert.equal(m.model.connections.filter(e => e.to.component === 'plant' && e.to.port === 0).length, 1);
  assert.deepEqual(await run(m, 'delivered'), await run(JSON.parse(JSON.stringify(saved)), 'roundtrip'));
});
test('8F: two cycles equal 8E native scenario results and trajectories exactly', async () => {
  const baseline = await run(schaeferFeedback(), 'baseline-8e'), r = await run(tstarSchaefer(), 'two-cycles');
  assert.deepEqual(science(r), science(baseline));
  for (const id of ['plant/N', 'plant/C', 'plant/effort', 'applied', 'identity', 'primarySelected', 'secondarySelected'])
    assert.deepEqual(r.observations.find(o => o.component === id), baseline.observations.find(o => o.component === id));
  for (const [c, t, N, C] of [[1, 1, 138.722797477662, 37.474201388035], [2, 3, 148.032956366218, 80.549582911628]]) {
    near(rows(r, c, 6)[0].value[0], N, 1e-10); near(rows(r, c, 7)[0].value[0], C, 1e-10);
    for (let i = 0; i < 3; ++i) {
      const E = [80, 150, 260][i], terminal = schaeferOracle(N, C, E, 20);
      near(rows(r, c, 6)[i].value[0], N, 1e-10); near(rows(r, c, 7)[i].value[0], C, 1e-10);
      assert.equal(rows(r, c, 8)[i].value[0], E); assert.equal(rows(r, c, 8)[i].time, t);
      near(rows(r, c, 9)[i].value[0], Math.min(N, terminal.N)); near(rows(r, c, 10)[i].value[0], terminal.C, .25);
    }
    assert.deepEqual(rows(r, c, 11).map(e => e.value), [[3, 3, c]]);
  }
  near(last(r, 'plant/N'), 155.007095478631, 1e-10); near(last(r, 'plant/C'), 126.058376506886, 1e-10);
  for (const id of ['N', 'C']) for (const s of r.observations.find(o => o.component === 'plant/' + id).samples) near(s.value, feedbackOracle(s.time)[id]);
});
test('8F: internally timed generic graph reproduces 1,3 and remains periodic at 5', async () => {
  const base = await run(tstarSchaefer(), 'external-timing'), m = periodicTstar();
  const r = await run(m, 'periodic-timing'); assert.deepEqual(science(r), science(base));
  near(last(r, 'plant/N'), last(base, 'plant/N'), 1e-10);
  m.simulation.end = 6;
  const extended = await run(m, 'periodic-extended');
  assert.deepEqual(extended.resultEvents.filter(e => e.port === 11).map(e => [e.time, e.value[2]]), [[1, 1], [3, 2], [5, 3]]);
});
test('8F: replacing B* with another definition changes policy without changing A*c or A**', async () => {
  const m = tstarSchaefer(), originalPlant = structuredClone(def(m, 'SchaeferPlant')), originalPlan = structuredClone(wrapper(m));
  const b = structuredClone(def(m, 'ObserverDecision')); b.id = 'ObserverConservative';
  const evaluate = structuredClone(def(m, 'EvaluateCandidates')); evaluate.id = 'EvaluateConservative';
  const choose = structuredClone(def(m, 'ConditionalDecision')); choose.id = 'SelectConservative';
  for (const c of choose.components) if (c.type === 'candidate_select') c.parameters.direction = 1;
  evaluate.components.find(c => c.id === 'choose').definition = choose.id;
  b.components.find(c => c.id === 'decide').definition = evaluate.id;
  m.model.definitions.push(choose, evaluate, b); m.model.components.find(c => c.id === 'observer').definition = b.id;
  const r = await run(m, 'replacement-policy');
  assert.equal(last(r, 'applied'), 260); assert.ok(last(r, 'plant/N') < 130);
  assert.deepEqual(def(m, 'SchaeferPlant'), originalPlant); assert.deepEqual(wrapper(m), originalPlan);
});
test('8F: changing a comparison threshold alone changes action and trajectory', async () => {
  const m = tstarSchaefer({ threshold: 0 }); const r = await run(m, 'threshold-zero');
  assert.equal(last(r, 'applied'), 260); assert.equal(last(r, 'primarySelected'), 1);
  near(last(r, 'plant/N'), schaeferOracle(150, 0, 260, 5).N);
});
test('8F: changed decision dates still equal the 8E graph', async () => {
  const options = { times: [.5, 2.5] }, r = await run(tstarSchaefer(options), 'different-times'), old = await run(schaeferFeedback(options), 'different-times-8e');
  assert.deepEqual(science(r), science(old)); near(last(r, 'plant/N'), last(old, 'plant/N'), 1e-10);
});
test('8F: absent observation or one missing state starts no campaign', async () => {
  for (const field of [null, 0, 1]) {
    const m = tstarSchaefer(field === null ? { times: [] } : {});
    if (field !== null) cut(m, e => e.from.component === 'plant' && e.from.port === field);
    const r = await run(m, 'missing-' + field); assert.equal(r.resultEvents.length, 0); assert.equal(last(r, 'applied'), 260);
  }
});
test('8F: missing native source reports missing rather than fabricating an observation', async () => {
  const m = tstarSchaefer(), p = def(m, 'SchaeferPlant');
  p.connections = p.connections.filter(e => !(e.from.component === 'C' && e.to.component === 'observeC'));
  const r = await run(m, 'missing-native-source'); assert.equal(r.resultEvents.length, 0); assert.equal(last(r, 'applied'), 260);
});
test('8F: incomplete prospective fields leave B* waiting rather than emitting an invented action', async () => {
  for (const port of [9, 10, 11]) {
    const m = tstarSchaefer(); cut(m, e => e.from.component === 'forecast' && e.from.port === port);
    const r = await run(m, 'missing-result-' + port); assert.equal(rows(r, 1, 6).length, 3); assert.equal(last(r, 'applied'), 260);
  }
});
test('8F: delayed C through causal bags still joins the same cycle', async () => {
  const m = tstarSchaefer(); cut(m, e => e.from.component === 'plant' && e.from.port === 1);
  for (let i = 0; i < 4; ++i) { m.model.components.push(atom('delay' + i, 'event_operator')); m.model.connections.push(edge(i ? 'delay' + (i - 1) : 'plant', i ? 0 : 1, 'delay' + i, 0)); }
  m.model.connections.push(edge('delay3', 0, 'observer', 2));
  const r = await run(m, 'delayed-observation'); near(last(r, 'plant/N'), feedbackOracle(5).N);
});
test('8F: a reset discards incomplete B* state, with a subsequent full campaign independent', async () => {
  const m = tstarSchaefer({ times: [] });
  source(m, 'observer', 0, 1, 0, 7, .5); source(m, 'observer', 1, 120, 0, 7, .5);
  source(m, 'observer', 8, 1, 0, 0, .7); source(m, 'observer', 2, 40, 0, 7, .8);
  for (const [p, v] of [[0, 1], [1, 160], [2, 80]]) source(m, 'observer', p, v, 0, 9, 1);
  // Isolate the state-join test from actual plant responses.
  cut(m, e => e.from.component === 'plant');
  const r = await run(m, 'reset-incomplete'); assert.equal(rows(r, 7, 6).length, 0);
  assert.equal(rows(r, 9, 6).length, 3); near(rows(r, 9, 6)[0].value[0], 160, 0);
});
test('8F: invalid or incomplete transactions fail explicitly at A**', async () => {
  for (const kind of ['missing', 'mismatch', 'conflict', 'stale']) {
    const m = tstarSchaefer({ times: kind === 'stale' ? [1] : [] });
    if (kind === 'stale') source(m, 'forecast', 2, 123, 0, 1, 2);
    else {
      source(m, 'forecast', 2, 120, 0, 7, 1);
      if (kind !== 'missing') source(m, 'forecast', 3, 40, 0, kind === 'mismatch' ? 8 : 7, 1);
      if (kind === 'conflict') source(m, 'forecast', 2, 121, 0, 7, 1);
      source(m, 'forecast', 1, 0, 0, 7, 1);
    }
    const r = await run(m, 'invalid-' + kind, 2); assert.notEqual(r.status, 'completed');
  }
});
test('8F: delayed prospect returns to B* at t+delay and is applied then', async () => {
  const r = await run(tstarSchaefer({ times: [1], delay: .5 }), 'delayed-response');
  assert.equal(rows(r, 1, 11)[0].time, 1.5); assert.equal(last(r, 'applied'), 150);
  const start = schaeferOracle(150, 0, 260, 1.5), final = schaeferOracle(start.N, start.C, 150, 3.5);
  near(last(r, 'plant/N'), final.N); near(last(r, 'plant/C'), final.C);
});
test('8F: init cancels a pending response, preserving the later campaign identity', async () => {
  const m = tstarSchaefer({ times: [1, 1.2], delay: 1 });
  const r = await run(m, 'cancel-pending'); assert.equal(rows(r, 1, 6).length, 0); assert.equal(rows(r, 2, 6).length, 3); assert.equal(rows(r, 2, 6)[0].time, 2.2);
});
test('8F: without init overlapping responses preserve captured fields and identities', async () => {
  const m = tstarSchaefer({ times: [1, 1.2], delay: 1 }); cut(m, e => e.to.component === 'forecast' && e.to.port === 0);
  const r = await run(m, 'overlapping');
  for (const [c, t] of [[1, 1], [2, 1.2]]) { near(rows(r, c, 6)[0].value[0], schaeferOracle(150, 0, 260, t).N); assert.equal(rows(r, c, 6)[0].time, t + 1); }
});
test('8F: restarting the same exported document resets state and campaign counters', async () => {
  const m = tstarSchaefer(); assert.deepEqual(await run(m, 'restart-1'), await run(m, 'restart-2'));
});
test('8F: six future E/q combinations reuse the B* interface while q stays contextual', async () => {
  const m = tstarSchaefer({ times: [1] });
  wrapper(m).experiment.factors.push({ id: 'qHypothesis', target: 'q', parameter: 'value', type: 'fixed', values: [.0008, .001] });
  const mapping = new Map([[9, 11], [10, 12], [7, 8], [8, 9], [11, 13]]);
  for (const e of m.model.connections) if (e.from.component === 'forecast' && e.to.component === 'observer') e.from.port = mapping.get(e.from.port);
  const r = await run(m, 'six-contextual-hypotheses');
  assert.deepEqual(rows(r, 1, 10).map(e => e.value[0]), [.0008, .0008, .0008, .001, .001, .001]);
  assert.deepEqual(rows(r, 1, 9).map(e => e.value[0]), [80, 150, 260, 80, 150, 260]);
  assert.equal(last(r, 'applied'), 150); assert.equal(def(m, 'SchaeferPlant').components.find(c => c.id === 'q').parameters.value, .001);
});
test('8F: native scheduler bounds accidental instantaneous loops', async () => {
  const m = tstarSchaefer(), b = def(m, 'ObserverDecision');
  b.components.push(atom('loop', 'value_memory', { emitOnWrite: 1 }), atom('loopTag', 'event_tag'));
  b.connections.push(edge('request', 0, 'loop', 0), edge('loop', 0, 'loopTag', 0), edge('loopTag', 0, 'loop', 0));
  m.limits = { maxRunCalls: 500 }; const r = await run(m, 'bounded-loop', 2); assert.equal(r.error.code, 'LIMIT_EXCEEDED');
});
test('8F: native coarse sampling works in flat N/C and full graphs, retaining scenario values', async () => {
  const baseline = await run(tstarSchaefer(), 'sampling-reference');
  for (const dt of [.1, .25, .5, 1, 2]) {
    const m = tstarSchaefer(); for (const o of m.model.observations) o.samplingInterval = dt;
    const r = await run(m, 'sampling-full-' + dt); assert.deepEqual(science(r), science(baseline));
    near(last(r, 'plant/N'), last(baseline, 'plant/N'), 1e-10); near(last(r, 'plant/C'), last(baseline, 'plant/C'), 1e-10);
    const p = structuredClone(def(m, 'SchaeferProspect'));
    p.components.find(c => c.id === 'N').parameters.X = 150; p.components.find(c => c.id === 'C').parameters.X = 0;
    const flat = { schemaVersion: 1, model: { id: 'sampling-flat', components: p.components, connections: p.connections, observations: ['N', 'C'].map(component => ({ component, samplingInterval: dt })) }, simulation: { start: 0, end: 5 } };
    const f = await run(flat, 'sampling-flat-' + dt); near(last(f, 'N'), schaeferOracle(150, 0, 260, 5).N);
    for (const o of [...r.observations, ...f.observations]) for (let i = 1; i < o.samples.length; ++i) assert.ok(o.samples[i].time > o.samples[i - 1].time);
  }
});
test('8F: too small an observation budget is rejected before native execution', () => {
  const m = tstarSchaefer(); m.limits = { maxPoints: 1 };
  assert.throws(() => validateRequest(m), /maxPoints/);
});
