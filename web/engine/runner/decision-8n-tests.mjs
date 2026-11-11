import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { adaptiveProspect } from './decision-8n-fixture.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { source } from './decision-8c-fixture.mjs';
import { validateRequest, parseWrapperResult, validateHierarchy } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER; assert.ok(runner, 'Set IRRITATOR_RUNNER');
const evidence = process.env.IRRITATOR_8N_EVIDENCE;
let app;
if (process.env.DECISION_8N_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
const events = (r, component, port = 0, campaign) => (r.modelEvents ?? []).filter(e => e.component === component && e.port === port && (campaign === undefined || e.value[2] === campaign));
const selected = r => events(r, 'observer/selector/selected').map(e => [e.time, ...e.value]);
const near = (a, b, tol = .002) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${a} != ${b}; tolerance ${tol}`);
const def = (m, id) => m.model.definitions.find(d => d.id === id);
const comp = (m, id) => m.model.components.find(c => c.id === id);
const typed = (r, path, kind, campaign) => r.resultEvents.filter(e => e.component === path && r.wrappers.find(w => w.component === path).outputs[e.port].kind === kind && (campaign === undefined || e.value[2] === campaign));
const observation = (r, path, t) => { const a = r.observations.find(o => o.component === path).samples; return a.reduce((best, p) => Math.abs(p.time - t) < Math.abs(best.time - t) ? p : best).value; };
const linear = (X, u, H, lambda = .5) => X * Math.exp(-lambda * H) + u / lambda * (1 - Math.exp(-lambda * H));
function schaefer(N, C, E, H, mortality = 0) {
  const a = .35 - .001 * E - mortality, b = .35 / 300, D = 1 + b * N * Math.expm1(a * H) / a;
  return { N: N * Math.exp(a * H) / D, C: C + .001 * E * Math.log(D) / b };
}
async function run(m, name, { error = false, native = false } = {}) {
  const start = performance.now();
  if (!error) validateRequest(m);
  const input = JSON.stringify(m), p = spawnSync(runner, [], { input, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const r = JSON.parse(p.stdout || 'null'), proof = { request: m, result: r, exit: p.status, stderr: p.stderr, elapsedMs: performance.now() - start, stdoutBytes: Buffer.byteLength(p.stdout ?? '') };
  const save = () => { if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(resolve(evidence, name + '.json'), JSON.stringify(proof, null, 2)); } }; save();
  assert.equal(p.status, error ? 2 : 0, p.stdout + p.stderr);
  if (!error) parseWrapperResult(r, m);
  if (app) {
    const response = await fetch(app.listeningOrigin + '/api/v1/simulations/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: input });
    const { runId, requestId, ...actual } = await response.json(); Object.assign(proof, { httpStatus: response.status, runId, requestId, httpResult: actual }); save();
    if (!error) { assert.equal(response.status, 200, JSON.stringify(actual)); assert.deepEqual(actual, r); }
    else assert.ok(response.status >= 400);
  }
  if (native && evidence) {
    const file = resolve(evidence, name + '-request.json'); writeFileSync(file, input);
    const p = spawnSync(resolve(dirname(runner), 'forecast-native.exe'), [file], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(resolve(evidence, name + '-native.log'), p.stdout + p.stderr);
    assert.equal(p.status, 0, p.stdout + p.stderr); assert.match(p.stdout, /NATIVE_FORECAST_RESET_PASS/);
    const nativeEvents = p.stdout.split('\n').filter(s => s.startsWith('MODEL_EVENT 0 ')).map(s => {
      const [, , bag, time, component, port, ...value] = s.trim().split(' '); return { component, time: +time, bag: +bag, port: +port, value: value.map(Number) };
    });
    assert.deepEqual(nativeEvents, r.modelEvents); proof.nativeEventsEqualJson = true; save();
  }
  return r;
}
function nextDecision(m, time = 5, campaign = 3) {
  source(m, 'observer', 0, campaign, 0, campaign, time); m.simulation.end = time + 2; return m;
}
function missing(m, model) { m.model.connections = m.model.connections.filter(e => !(e.to.component === model + 'Xpair' && e.to.port === 1)); return m; }

test('8N delivered documents roundtrip, obey existing capacities, replay identical native events after reset', async () => {
  for (const options of [{}, { adaptive: false }, { alternative: true }, { schaefer: true }]) {
    const m = adaptiveProspect(options), file = JSON.parse(readFileSync(new URL('../../examples/' + m.model.id + '-v3.json', import.meta.url), 'utf8'));
    assert.deepEqual(file, m); const size = validateHierarchy(m).get('$root'); assert.ok(size.atoms <= 128 && size.connections <= 512);
    const r = await run(m, m.model.id, { native: true }); assert.deepEqual(r, await run(JSON.parse(JSON.stringify(m)), m.model.id + '-roundtrip'));
  }
});
test('8N linear adaptation changes the actual command at t=3 and the plant trajectory, unlike fixed M2', async () => {
  for (const adaptive of [true, false]) {
    const r = await run(adaptiveProspect({ adaptive }), 'causal-' + adaptive, { native: true });
    assert.deepEqual(selected(r), [[1, 2, 0, 1], [3, adaptive ? 1 : 2, 0, 2]]);
    assert.deepEqual(events(r, 'plant/hold').map(e => [e.time, e.value[0]]), [[0, 0], [1, 1], [3, adaptive ? 0 : 1]]);
    near(observation(r, 'plant/X', 5), adaptive ? 1 : 3);
    near(events(r, 'M1Xpair', 0, 1)[0].value[0], 0); near(events(r, 'M2Xpair', 0, 1)[0].value[0], linear(-1, 1, 1));
    near(events(r, 'M1Xpair', 1, 1)[0].value[0], 0); near(events(r, 'M2XAE', 0, 1)[0].value[0], Math.abs(linear(-1, 1, 1)));
    assert.equal(events(r, 'M2XAE', 0, 1)[0].time, 2);
    for (const [campaign, model] of [[1, 2], [2, adaptive ? 1 : 2]]) {
      assert.equal(typed(r, 'forecast/M' + model, 'scenario-run-calls', campaign).length, 2);
      assert.equal(typed(r, 'forecast/M' + (3 - model), 'scenario-run-calls', campaign).length, 0);
      const path = 'forecast/M' + model, layout = r.wrappers.find(w => w.component === path);
      for (const prediction of typed(r, path, 'scenario-selection', campaign)) {
        const factors = Object.fromEntries(typed(r, path, 'scenario-factor', campaign).filter(e => e.value[1] === prediction.value[1]).map(e => [layout.outputs[e.port].id, e.value[0]]));
        near(factors.initial, campaign === 1 ? -1 : 1);
        near(prediction.value[0], model === 1 ? factors.initial + factors.control : linear(factors.initial, factors.control, 1));
      }
      for (const i of [1, 2]) assert.equal(typed(r, 'verificationM' + i, 'scenario-run-calls', campaign).length, 1);
    }
    near(events(r, 'observer/selector/M2lossRead', 0, 2)[0].value[0], events(r, 'M2XMAE', 0, 1)[0].value[0], 1e-14);
    assert.equal(events(r, 'observer/selector/M2lossRead', 0, 2)[0].time, 3);
    assert.equal(events(r, 'observer/selector/M2countRead', 0, 2)[0].value[0], 1);
    for (const e of typed(r, 'forecast/M1', 'scenario-horizon')) assert.equal(e.value[0], 1);
  }
});
test('8N alternative linear plant selects M2 using the identical native selection graph and independent oracle', async () => {
  const m = adaptiveProspect({ alternative: true }); assert.deepEqual(def(m, 'SelectProspective'), def(adaptiveProspect(), 'SelectProspective'));
  const r = await run(m, 'alternative-linear', { native: true }); assert.deepEqual(selected(r).map(e => e[1]), [2, 2]);
  const x1 = linear(-1, 0, 1), x2 = linear(x1, 1, 1), x3 = linear(x1, 1, 2);
  near(events(r, 'M1Xpair', 1, 1)[0].value[0], x2); near(events(r, 'M1Xpair', 0, 1)[0].value[0], x1 + 1);
  near(events(r, 'M1XAE', 0, 1)[0].value[0], Math.abs(x2 - x1 - 1)); near(events(r, 'M2XAE', 0, 1)[0].value[0], 0);
  near(observation(r, 'plant/X', 5), linear(x3, 1, 2));
});
test('8N nMin 1,2,3 use common windows and only sufficiently populated prior histories', async () => {
  for (const nMin of [1, 2, 3]) {
    const r = await run(nextDecision(nextDecision(adaptiveProspect({ nMin })), 7, 4), 'minimum-' + nMin);
    assert.deepEqual(selected(r).map(e => e[1]), [2, nMin === 1 ? 1 : 2, nMin <= 2 ? 1 : 2, 1]);
    assert.equal(events(r, 'observer/selector/M1countRead', 0, 4)[0].value[0], 3);
    for (const prefix of ['M1X', 'M2X']) {
      const ae = events(r, prefix + 'AE').slice(0, 2).map(e => e.value[0]);
      near(events(r, prefix + 'MAE', 0)[1].value[0], (ae[0] + ae[1]) / 2, 1e-14);
      assert.equal(events(r, prefix + 'MAE', 2)[1].value[0], 2); assert.equal(events(r, prefix + 'MAE', 0)[1].time, 4);
      assert.equal(events(r, 'observer/selector/' + prefix.slice(0, 2) + 'countRead', 0, 3)[0].value[0], 2);
    }
  }
});
test('8N missing or unpaired observations never create favorable performance', async () => {
  for (const absent of [['M1', 'M2'], ['M2']]) {
    let m = adaptiveProspect(); for (const id of absent) missing(m, id);
    const r = await run(m, 'missing-' + absent.join('-')); assert.deepEqual(selected(r).map(e => e[1]), [2, 2]);
    assert.equal(events(r, 'M1XMAE').length, 0); assert.equal(events(r, 'M2XMAE').length, 0);
    if (absent.length === 1) assert.equal(events(r, 'M1XAE').length, 2);
  }
});
test('8N distinct window keys prevent a paired conclusion while retaining valid diagnostics', async () => {
  const m = adaptiveProspect(); m.model.components.push(atom('incompatibleCohort', 'event_tag', { identity: 7, preserveCampaign: 1 }));
  m.model.connections = m.model.connections.filter(e => !(e.from.component === 'M2XAE' && e.to.component.endsWith('paired')));
  m.model.connections.push(edge('M2XAE', 0, 'incompatibleCohort', 0), edge('incompatibleCohort', 0, 'M1Xpaired', 1), edge('incompatibleCohort', 0, 'M2Xpaired', 0));
  const r = await run(m, 'incompatible-cohort'); assert.deepEqual(selected(r).map(e => e[1]), [2, 2]); assert.equal(events(r, 'M2XAE').length, 2); assert.equal(events(r, 'M1XMAE').length, 0);
});
test('8N a distinct declared cohort is archived separately and cannot feed the comparable history', async () => {
  const m = adaptiveProspect();
  m.model.forecastContracts.find(c => c.pair === 'M2Xpair').cohort = 'other-declared-context';
  m.model.components.push(atom('otherCohortArchive', 'campaign_aggregate', { operation: 3, streaming: 1 }));
  m.model.connections = m.model.connections.filter(e => !(e.from.component === 'M2XAE' && e.to.component.endsWith('paired')));
  m.model.connections.push(edge('M2XAE', 0, 'otherCohortArchive', 0));
  m.model.observations.push({ component: 'otherCohortArchive', samplingInterval: .1, eventPorts: [0, 2] });
  const r = await run(m, 'separate-cohort'); assert.deepEqual(selected(r).map(e => e[1]), [2, 2]);
  assert.equal(events(r, 'M1XMAE').length, 0); assert.equal(events(r, 'M2XMAE').length, 0);
  assert.equal(events(r, 'otherCohortArchive', 2).at(-1).value[0], 2);
});
test('8N changed applied action or cancelled evaluation cannot enter adaptive ranking', async () => {
  for (const cancel of [false, true]) {
    const m = adaptiveProspect(); source(m, cancel ? 'M2Xpair' : 'plant', cancel ? 6 : 1, 2, 0, 1, 1.5);
    const r = await run(m, cancel ? 'cancelled' : 'changed-command'); assert.deepEqual(selected(r).map(e => e[1]), [2, 2]);
    assert.equal(events(r, 'M2Xpair', 2, 1)[0].value[0], cancel ? 7 : 6); assert.equal(events(r, 'M1XMAE', 0, 1).length, 0);
  }
});
test('8N budget failures and nonfinite diagnostic predictions cannot make M2 or M1 admissible', async () => {
  for (const overflow of [false, true]) {
    const m = adaptiveProspect();
    if (overflow) {
      const d = def(m, 'DampedProspect'); d.components.push(atom('overflow', 'qss3_power', { n: 2000 })); d.connections.push(edge('lambda', 0, 'overflow', 0));
      d.components.find(c => c.id === 'lambda').parameters.value = 2; comp(m, 'verificationM2').experiment.selections[0].target = 'overflow';
    } else comp(m, 'verificationM2').experiment.execution.maxChildRunCalls = 1;
    const r = await run(m, overflow ? 'nonfinite-prediction' : 'child-budget'); assert.deepEqual(selected(r).map(e => e[1]), [2, 2]);
    assert.equal(events(r, 'M2Xpair', 2, 1)[0].value[0], 2); assert.equal(events(r, 'M1XMAE', 0, 1).length, 0);
  }
});
test('8N nonfinite metric never becomes zero loss or an admissible score', async () => {
  const m = adaptiveProspect(); m.model.components.push(atom('invalidMetric', 'event_operator', { operation: 4, right: 0 }));
  m.model.connections = m.model.connections.filter(e => !(e.from.component === 'M2XAE' && e.to.component.endsWith('paired')));
  m.model.connections.push(edge('M2XAE', 0, 'invalidMetric', 0), edge('invalidMetric', 0, 'M1Xpaired', 1), edge('invalidMetric', 0, 'M2Xpaired', 0));
  const r = await run(m, 'nonfinite-metric'); assert.equal(events(r, 'observer/selector/M2admissible', 0, 2)[0].value[0], 0);
  assert.equal(selected(r)[1][1], 2); assert.equal(events(r, 'M2XMAE').length, 0);
});
test('8N explicit initial model and refusal are configurable; ties are deterministic by local model identity', async () => {
  const initial = await run(missing(adaptiveProspect({ initial: 1 }), 'M2'), 'initial-one'); assert.deepEqual(selected(initial).map(e => e[1]), [1, 1]);
  const refused = await run(adaptiveProspect({ refuse: true }), 'refuse-no-history'); assert.equal(selected(refused).length, 0); assert.equal(refused.resultEvents.length, 0);
  const m = adaptiveProspect(); def(m, 'DampedProspect').components.find(c => c.id === 'lambda').parameters.value = 0;
  const r = await run(m, 'equal-loss'); assert.deepEqual(selected(r).map(e => e[1]), [2, 1]);
});
test('8N optional generic hysteresis distinguishes switching cost from numeric comparator tolerance', async () => {
  for (const [delta, expected] of [[0, 1], [.1, 1], [.3, 2]]) {
    const r = await run(adaptiveProspect({ delta }), 'hysteresis-' + delta); assert.equal(selected(r)[1][1], expected);
  }
  const m = adaptiveProspect({ delta: 0 }); def(m, 'DampedProspect').components.find(c => c.id === 'lambda').parameters.value = 0;
  const r = await run(m, 'hysteresis-tie'); assert.equal(selected(r)[1][1], 2);
});
test('8N late publication cannot alter t=3; a subsequent campaign can read the published history', async () => {
  const m = nextDecision(adaptiveProspect());
  // Retain original window identities and publish both losses/count on a
  // separate native calendar, 1.5 time units after verification.
  m.model.components.push(atom('publishDelay', 'event_operator', { left: 1.5, required: 0, automatic: 0 }), atom('publication', 'event_calendar', { relative: 1 }));
  m.model.observations.push({ component: 'publication', samplingInterval: .1, eventPorts: [0, 2] });
  m.model.connections.push(edge('M1XMAE', 2, 'publishDelay', 2), edge('publishDelay', 0, 'publication', 0));
  const feeds = m.model.connections.filter(e => /M[12]XMAE/.test(e.from.component) && e.to.component === 'observer');
  for (const [i, e] of feeds.entries()) {
    m.model.components.push(atom('publishMemory' + i, 'value_memory'));
    m.model.connections = m.model.connections.filter(c => c !== e);
    m.model.connections.push({ from: e.from, to: { component: 'publishMemory' + i, port: 0 } }, edge('publication', 0, 'publishMemory' + i, 1), { from: { component: 'publishMemory' + i, port: 0 }, to: e.to });
  }
  const r = await run(m, 'late-publication'); assert.deepEqual(selected(r).map(e => e[1]), [2, 2, 1]);
  assert.equal(events(r, 'publication', 0, 1)[0].time, 3.5);
  assert.equal(events(r, 'observer/selector/M1countRead', 0, 2)[0].value[0], 0);
  assert.equal(events(r, 'observer/selector/M1countRead', 0, 3)[0].value[0], 1);
});
test('8N observations coincident with the decision occur after its explicit snapshot boundary', async () => {
  const m = adaptiveProspect(); comp(m, 'read1').parameters.offset = 2;
  const r = await run(m, 'coincident-snapshot'); assert.deepEqual(selected(r).map(e => e[1]), [2, 2]);
  const snapshot = events(r, 'observer/selector/M1countRead', 0, 2)[0], verified = events(r, 'M1XMAE', 2, 1)[0];
  assert.equal(snapshot.time, verified.time); assert.ok(snapshot.bag < verified.bag); assert.equal(snapshot.value[0], 0);
});
test('8N overlapping diagnostic campaigns do not leak their pending forecasts into either decision', async () => {
  const m = adaptiveProspect(); comp(m, 'verificationHorizon').parameters.left = 3;
  for (const i of [1, 2]) comp(m, 'verificationM' + i).experiment.simulation.end = 3;
  m.simulation.end = 7;
  const r = await run(m, 'overlap'); assert.deepEqual(selected(r).map(e => e[1]), [2, 2]);
  assert.equal(events(r, 'observer/selector/M1countRead', 0, 2)[0].value[0], 0);
  assert.ok(events(r, 'M1Xpair', 4).some(e => e.value[0] === 2));
});
test('8N duplicate forecasts, bounded history exhaustion and invalid prototypes fail explicitly', async () => {
  const duplicate = adaptiveProspect(), e = duplicate.model.connections.find(e => e.to.component === 'M1Xpair' && e.to.port === 0);
  duplicate.model.connections.push(structuredClone(e)); await run(duplicate, 'duplicate-forecast', { error: true });
  const capacity = adaptiveProspect(); comp(capacity, 'M1XMAE').parameters.capacity = 1; await run(capacity, 'history-capacity', { error: true });
  const invalid = adaptiveProspect(), d = def(invalid, 'LinearProspect'); d.components.push(atom('bad', 'state_observer')); d.connections.push(edge('u', 0, 'bad', 0));
  await run(invalid, 'invalid-prototype', { error: true });
});
test('8N a late attempt to retract closed evidence fails before the next decision can reuse it', async () => {
  const m = adaptiveProspect(); source(m, 'M2Xpair', 6, 0, 0, 1, 2.5);
  await run(m, 'retract-closed-evidence', { error: true });
});
test('8N Schaefer uses only [3,4] biomass evidence at t=5; mortality plant reverses the native choice', async () => {
  for (const alternative of [false, true]) {
    const m = adaptiveProspect({ schaefer: true, alternative }); const r = await run(m, 'schaefer-' + alternative, { native: true });
    assert.deepEqual(def(m, 'SelectProspective'), def(adaptiveProspect({ schaefer: true }), 'SelectProspective'));
    assert.deepEqual(selected(r).map(e => e[1]), [2, 2, alternative ? 2 : 1]);
    for (const model of [1, 2]) {
      const factors = typed(r, 'verificationM' + model, 'scenario-factor', 2).map(e => e.value[0]);
      const predicted = schaefer(factors[0], factors[1], factors[2], 1, model === 2 ? .08 : 0);
      const actual = schaefer(factors[0], factors[1], factors[2], 1, alternative ? .08 : 0);
      near(events(r, 'M' + model + 'Npair', 0, 2)[0].value[0], predicted.N, .06);
      near(events(r, 'M' + model + 'Npair', 1, 2)[0].value[0], actual.N, .06);
      near(events(r, 'M' + model + 'NAE', 0, 2)[0].value[0], Math.abs(predicted.N - actual.N), .12);
      assert.equal(events(r, 'M' + model + 'NMAE', 0, 2)[0].time, 4);
      assert.equal(events(r, 'observer/selector/M' + model + 'countRead', 0, 2)[0].value[0], 0);
    }
    const chosen = alternative ? 2 : 1;
    assert.ok(typed(r, 'forecast/M' + chosen, 'scenario-run-calls', 3).length > 0);
    assert.equal(typed(r, 'forecast/M' + (3 - chosen), 'scenario-run-calls', 3).length, 0);
    assert.equal(events(r, 'plant/effort').at(-1).time, 5); assert.equal(events(r, 'plant/effort').at(-1).value[0], alternative ? 80 : 150);
  }
});
