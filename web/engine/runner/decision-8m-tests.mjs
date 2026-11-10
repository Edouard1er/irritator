import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { forecastValidation } from './decision-8m-fixture.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { validateRequest, parseWrapperResult, validateHierarchy } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER; assert.ok(runner, 'Set IRRITATOR_RUNNER');
const evidence = process.env.IRRITATOR_8M_EVIDENCE;
let app;
if (process.env.DECISION_8M_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js'); const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
const events = (r, component, port = 0, campaign) => (r.modelEvents ?? []).filter(e => e.component === component && e.port === port && (campaign === undefined || e.value[2] === campaign));
const near = (a, b, tol) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${a} != ${b}; tolerance ${tol}`);
const definition = (m, id) => m.model.definitions.find(d => d.id === id);
const component = (m, id) => m.model.components.find(c => c.id === id);
// Evidence projection only: no prediction, error or metric is calculated here.
// Model/variable correspondence comes from explicit source edges, never names.
function records(request, result, runId) {
  const rows = [];
  for (const pair of request.model.components.filter(c => c.type === 'temporal_pair')) {
    const source = request.model.connections.find(e => e.to.component === pair.id && e.to.port === 0).from;
    const wrapper = component(request, source.component), experiment = wrapper.experiment;
    const layout = result.wrappers.find(w => w.component === wrapper.id), selected = layout.outputs[source.port];
    const read = (kind, campaign, id, key) => result.resultEvents.find(e => e.component === wrapper.id && layout.outputs[e.port].kind === kind && e.value[2] === campaign && (id === undefined || layout.outputs[e.port].id === id) && (key === undefined || e.value[1] === key))?.value[0] ?? null;
    for (const status of events(result, pair.id, 2)) {
      const key = status.value[1], campaign = status.value[2];
      const date = events(result, 'calendar', 2, campaign).find(e => e.value[1] === key);
      const pred = events(result, pair.id, 0, campaign).find(e => e.value[1] === key), obs = events(result, pair.id, 1, campaign).find(e => e.value[1] === key);
      const criterion = experiment.selections.find(s => s.id === selected.id), contract = request.model.forecastContracts.find(c => c.pair === pair.id);
      rows.push({ runId, campaignId: campaign, forecastId: [wrapper.id, campaign, key],
        modelRef: { occurrence: wrapper.id, definition: experiment.definition },
        contract, plan: { id: contract.planId, version: contract.planVersion, configurationSha256: createHash('sha256').update(JSON.stringify(experiment)).digest('hex') },
        origin: date?.time ?? null, verificationTime: date?.value[0] ?? null,
        nativeHorizon: read('scenario-horizon', campaign, undefined, key),
        initialState: contract.stateFactors.map(id => ({ factor: id, value: read('scenario-factor', campaign, id, key) })),
        assumedAction: read('scenario-factor', campaign, contract.commandFactor, key),
        context: contract.contextFactors.map(id => ({ factor: id, value: read('scenario-factor', campaign, id, key) })),
        appliedFactors: experiment.factors.map(f => ({ id: f.id, contract: f.name ?? null, target: f.target, parameter: f.parameter, value: read('scenario-factor', campaign, f.id, key) })),
        variable: { ...criterion, pairOccurrence: pair.id, observationSource: request.model.connections.find(e => e.to.component === pair.id && e.to.port === 1)?.from ?? null },
        prediction: pred?.value[0] ?? read('scenario-selection', campaign, selected.id, key), observation: obs?.value[0] ?? (() => {
          const endpoint = request.model.connections.find(e => e.to.component === pair.id && e.to.port === 1)?.from;
          return endpoint ? events(result, endpoint.component, endpoint.port, campaign).find(e => e.value[1] === key)?.value[0] ?? null : null;
        })(),
        simulationStatus: read('scenario-outcome', campaign, undefined, key), verificationStatus: status.value[0],
        commandTrajectory: (result.modelEvents ?? []).filter(e => ['plant/hold', 'plant/effort'].includes(e.component)).map(e => ({ time: e.time, value: e.value[0] })),
        childRunCalls: read('scenario-run-calls', campaign, undefined, key), campaignRunCalls: read('campaign-run-calls', campaign),
        errors: Object.fromEntries(['error', 'AE', 'SE', 'MAE', 'RMSE'].map(suffix => [suffix, events(result, pair.id.slice(0, -4) + suffix, 0, campaign).find(e => e.value[1] === key)?.value[0] ?? null])) });
    }
  }
  return rows;
}
async function run(m, name, { error = false, native = false } = {}) {
  if (!error) validateRequest(m);
  const input = JSON.stringify(m), p = spawnSync(runner, [], { input, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const r = JSON.parse(p.stdout || 'null'), proof = { runId: randomUUID(), request: m, result: r, exit: p.status, stderr: p.stderr };
  const save = () => { if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(resolve(evidence, name + '.json'), JSON.stringify(proof, null, 2)); } }; save();
  assert.equal(p.status, error ? 2 : 0, p.stdout + p.stderr);
  if (!error) { parseWrapperResult(r, m); proof.forecastRecords = records(m, r, proof.runId); save(); }
  if (app) {
    const res = await fetch(app.listeningOrigin + '/api/v1/simulations/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: input });
    const { runId, requestId, ...actual } = await res.json(); proof.httpStatus = res.status; proof.httpRunId = runId; proof.httpRequestId = requestId; proof.httpResult = actual; save();
    if (!error) { assert.equal(res.status, 200); assert.deepEqual(actual, r); } else { assert.ok(res.status >= 400); assert.equal(actual.error.code, r.error.code); }
  }
  if (native && evidence) {
    const file = resolve(evidence, name + '-request.json'); writeFileSync(file, input);
    const n = spawnSync(resolve(dirname(runner), 'forecast-native.exe'), [file], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(resolve(evidence, name + '-native.log'), n.stdout + n.stderr); proof.nativeTrace = n.stdout; save();
    assert.equal(n.status, 0, n.stdout + n.stderr); assert.match(n.stdout, /NATIVE_FORECAST_RESET_PASS/);
    const nativeEvents = n.stdout.split('\n').filter(s => s.startsWith('MODEL_EVENT 0 ')).map(s => {
      const [, , bag, time, component, port, ...value] = s.trim().split(' '); return { component, time: +time, bag: +bag, port: +port, value: value.map(Number) };
    });
    assert.deepEqual(nativeEvents, r.modelEvents); proof.nativeEventsEqualJson = true; save();
  }
  return r;
}
// Independent analytic reference: never imported into document construction.
export function schaeferOracle(N0, C0, E, H, m = 0, r = .35, K = 300, q = .001, a = 1) {
  const alpha = r - q * a * E - m, beta = r / K;
  const D = 1 + beta * N0 * (Math.abs(alpha) < 1e-14 ? H : Math.expm1(alpha * H) / alpha);
  return { N: N0 * Math.exp(alpha * H) / D, C: C0 + q * a * E * Math.log(D) / beta };
}
function assertMetrics(r, prefix, expected, campaign, tol = .002) {
  const pair = events(r, prefix + 'pair', 0, campaign)[0], obs = events(r, prefix + 'pair', 1, campaign)[0];
  assert.ok(pair && obs); assert.equal(pair.time, obs.time);
  near(pair.value[0], expected, tol);
  const e = events(r, prefix + 'error', 0, campaign)[0].value[0];
  near(e, obs.value[0] - pair.value[0], 1e-12);
  near(events(r, prefix + 'AE', 0, campaign)[0].value[0], Math.abs(e), 1e-12);
  near(events(r, prefix + 'SE', 0, campaign)[0].value[0], e * e, 1e-12);
  assert.equal(events(r, prefix + 'pair', 2, campaign)[0].value[0], 1);
}
test('8M delivered graphs roundtrip; native records agree with JSON and HTTP; reset is repeatable', async () => {
  for (const [name, opt] of [['decision-forecast-validation-minimal', {}], ['decision-forecast-comparison', { diagnostic: true }], ['tstar-schaefer-forecast-validation', { diagnostic: true, schaefer: true }]]) {
    const m = forecastValidation(opt), file = JSON.parse(readFileSync(new URL('../../examples/' + name + '-v3.json', import.meta.url), 'utf8'));
    assert.deepEqual(file, m); assert.ok(validateHierarchy(m).get('$root').atoms <= 128);
    const r = await run(m, name, { native: true }); assert.deepEqual(r, await run(JSON.parse(JSON.stringify(m)), name + '-roundtrip'));
  }
});
test('8M selected operational M2 forecast is verified at t=4, preserving the 8L exclusive decisions', async () => {
  const r = await run(forecastValidation(), 'linear-operational', { native: true });
  assertMetrics(r, 'M2X', Math.exp(-.5), 2); near(events(r, 'M2Xpair', 1, 2)[0].value[0], 1, .002);
  near(events(r, 'M2XAE', 0, 2)[0].value[0], 1 - Math.exp(-.5), .002);
  assert.equal(events(r, 'M2Xpair', 2).length, 1); assert.equal(events(r, 'M2Xpair', 2)[0].time, 4);
  assert.deepEqual(r.resultEvents.filter(e => e.component === 'verificationM2' && r.wrappers.find(w => w.component === e.component).outputs[e.port].kind === 'scenario-run-calls').map(e => e.value[2]), [2]);
  for (const [c, model] of [[1, 'M1'], [2, 'M2']]) {
    const wrong = r.wrappers.find(w => w.component === 'forecast/' + (model === 'M1' ? 'M2' : 'M1'));
    assert.equal(r.resultEvents.filter(e => e.component === wrong.component && wrong.outputs[e.port].kind === 'scenario-run-calls' && e.value[2] === c).length, 0);
  }
});
test('8M diagnostic M1/M2 use identical observed initial states and actual controls; MAE and RMSE span retained windows', async () => {
  const r = await run(forecastValidation({ diagnostic: true }), 'linear-diagnostic', { native: true });
  assertMetrics(r, 'M1X', 1, 2); assertMetrics(r, 'M2X', Math.exp(-.5), 2);
  near(events(r, 'M1XAE', 0, 2)[0].value[0], 0, .002);
  for (const prefix of ['M1X', 'M2X']) {
    const ae = events(r, prefix + 'AE').map(e => e.value[0]), se = events(r, prefix + 'SE').map(e => e.value[0]);
    near(events(r, prefix + 'MAE').at(-1).value[0], ae.reduce((a, b) => a + b) / ae.length, 1e-12);
    near(events(r, prefix + 'RMSE').at(-1).value[0], Math.sqrt(se.reduce((a, b) => a + b) / se.length), 1e-12);
    assert.equal(events(r, prefix + 'pair', 3).at(-1).value[0], 2); assert.equal(events(r, prefix + 'pair', 4).at(-1).value[0], 0);
  }
  const wrappers = ['verificationM1', 'verificationM2'].map(path => {
    const w = r.wrappers.find(w => w.component === path); return r.resultEvents.filter(e => e.component === path && ['scenario-factor', 'scenario-horizon'].includes(w.outputs[e.port].kind)).map(({ value }) => value);
  }); assert.deepEqual(wrappers[0], wrappers[1]);
});
test('8M lambda=1 changes native prediction and error', async () => {
  const r = await run(forecastValidation({ lambda: 1 }), 'linear-lambda-one'); assertMetrics(r, 'M2X', Math.exp(-1), 2);
});
test('8M a coherently edited verification horizon changes both forecast and scheduled native observation', async () => {
  const r = await run(forecastValidation({ horizon: .5 }), 'half-horizon');
  assertMetrics(r, 'M2X', Math.exp(-.25), 2); assert.equal(events(r, 'M2Xpair', 2)[0].time, 3.5);
});
test('8M Schaefer terminal N/C are compared to independent analytic oracles, separately by unit', async () => {
  const r = await run(forecastValidation({ schaefer: true, diagnostic: true }), 'schaefer-diagnostic', { native: true });
  for (const [model, m] of [[1, 0], [2, .08]]) {
    const w = r.wrappers.find(w => w.component === 'verificationM' + model);
    const factors = r.resultEvents.filter(e => e.component === w.component && w.outputs[e.port].kind === 'scenario-factor' && e.value[2] === 2).map(e => e.value[0]);
    near(factors[0], 148.032956366218, .05); near(factors[1], 80.549582911628, .10); assert.deepEqual(factors.slice(2), [80, .001]);
    const ref = schaeferOracle(factors[0], factors[1], factors[2], 1, m);
    assertMetrics(r, 'M' + model + 'N', ref.N, 2, .06); assertMetrics(r, 'M' + model + 'C', ref.C, 2, .10);
    const plant = schaeferOracle(factors[0], factors[1], factors[2], 1, 0);
    near(events(r, 'M' + model + 'Npair', 1, 2)[0].value[0], plant.N, .06);
    near(events(r, 'M' + model + 'Cpair', 1, 2)[0].value[0], plant.C, .10);
    // Endpoint error bounds add when comparing two independently approximated
    // trajectories; they are numerical tolerances, not biological uncertainty.
    near(events(r, 'M' + model + 'NAE', 0, 2)[0].value[0], Math.abs(plant.N - ref.N), .12);
    near(events(r, 'M' + model + 'CAE', 0, 2)[0].value[0], Math.abs(plant.C - ref.C), .20);
  }
  near(events(r, 'M1Npair', 1, 2)[0].value[0], 161.83179, .06); near(events(r, 'M1Cpair', 1, 2)[0].value[0], 92.95261, .10);
  assert.ok(events(r, 'M2NAE', 0, 2)[0].value[0] > 11); assert.ok(events(r, 'M2CAE', 0, 2)[0].value[0] > .3);
});
test('8M analytic alpha=0 limit is finite and continuous', () => {
  const a = schaeferOracle(150, 80, 80, 1, .27), b = schaeferOracle(150, 80, 80, 1, .27 + 1e-10);
  near(a.N, b.N, 1e-7); near(a.C, b.C, 1e-7);
});
test('8M missing observation emits status 4 with no numerical error or metric', async () => {
  const m = forecastValidation(); m.model.connections = m.model.connections.filter(e => !(e.from.component === 'plant' && e.to.component === 'futureState'));
  const r = await run(m, 'missing-observation'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 4); assert.equal(events(r, 'M2XAE').length, 0);
});
test('8M disconnected observation remains pending until an explicit seal', async () => {
  const m = forecastValidation(); m.model.connections = m.model.connections.filter(e => !(e.to.component === 'M2Xpair' && [1, 7].includes(e.to.port)));
  let r = await run(m, 'pending-observation'); assert.equal(events(r, 'M2Xpair', 4).at(-1).value[0], 1); assert.equal(events(r, 'M2XAE').length, 0);
  m.model.components.push(atom('seal', 'constant', { offset: 4.5 }), atom('sealTag', 'event_tag', { campaign: 2 }));
  m.model.connections.push(edge('seal', 0, 'sealTag', 0), edge('sealTag', 0, 'M2Xpair', 7));
  r = await run(m, 'sealed-missing'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 4); assert.equal(events(r, 'M2XAE').length, 0);
});
test('8M no verification date cannot produce an error', async () => {
  const m = forecastValidation(); m.model.connections = m.model.connections.filter(e => !(e.from.component === 'calendar' && e.from.port === 2 && e.to.component === 'M2Xpair'));
  const r = await run(m, 'missing-date'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 5); assert.equal(events(r, 'M2XAE').length, 0);
});
test('8M a calendar inconsistent with the actual native forecast horizon is rejected', async () => {
  const m = forecastValidation(); component(m, 'verificationHorizon').parameters.left = .5;
  const r = await run(m, 'horizon-mismatch'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 5); assert.equal(events(r, 'M2XAE').length, 0);
});
test('8M changed action inside the window marks conditions incompatible; a change at tv is excluded', async () => {
  for (const time of [3.5, 4]) {
    const m = forecastValidation(); m.model.components.push(atom('changedAction', 'constant', { value: 2, offset: time })); m.model.connections.push(edge('changedAction', 0, 'plant', 1));
    const r = await run(m, 'changed-action-' + time); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], time === 4 ? 1 : 6); assert.equal(events(r, 'M2XAE').length, time === 4 ? 1 : 0);
  }
});
test('8M overlapping campaigns retain both different deadlines and exclude only the changed-control window', async () => {
  const m = forecastValidation({ diagnostic: true, horizon: 3 }); m.simulation.end = 7;
  const r = await run(m, 'overlap-deadlines');
  for (const prefix of ['M1X', 'M2X']) {
    assert.deepEqual(events(r, prefix + 'pair', 2).map(e => [e.time, e.value[2], e.value[0]]), [[4, 1, 6], [6, 2, 1]]);
    assert.ok(events(r, prefix + 'pair', 4).some(e => e.time === 3 && e.value[0] === 2));
    assert.equal(events(r, prefix + 'pair', 3).at(-1).value[0], 1);
    assert.equal(events(r, prefix + 'pair', 4).at(-1).value[0], 0);
    assert.equal(events(r, prefix + 'pair', 5).at(-1).value[0], 1);
    assert.equal(events(r, prefix + 'AE', 0, 1).length, 0);
    assert.equal(events(r, prefix + 'MAE', 2).at(-1).value[0], 1);
  }
  assertMetrics(r, 'M1X', 1, 2); assertMetrics(r, 'M2X', Math.exp(-1.5), 2);
});
test('8M counterfactual assumption cannot be labelled empirically verified', async () => {
  const m = forecastValidation(); m.model.components.push(atom('counterfactual', 'event_operator', { operation: 1, right: 2 }));
  m.model.connections = m.model.connections.filter(e => !(e.to.component === 'M2Xpair' && e.to.port === 3) && !(e.to.component === 'verificationM2' && e.to.port === 3));
  m.model.connections.push(edge('windowOnly', 0, 'counterfactual', 0), edge('counterfactual', 0, 'M2Xpair', 3), edge('counterfactual', 0, 'verificationM2', 3));
  const r = await run(m, 'counterfactual'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 6); assert.equal(events(r, 'M2XAE').length, 0);
  const w = r.wrappers.find(w => w.component === 'verificationM2');
  assert.equal(r.resultEvents.find(e => e.component === w.component && w.outputs[e.port].kind === 'scenario-factor' && w.outputs[e.port].id === 'control').value[0], 2);
});
test('8M late native prediction is rejected even when its terminal value is finite', async () => {
  const m = forecastValidation(); component(m, 'verificationRun').parameters.left = .5;
  const r = await run(m, 'late-prediction'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 5); assert.equal(events(r, 'M2XAE').length, 0);
});
test('8M cancellation prevents empirical scores', async () => {
  const m = forecastValidation(); m.model.components.push(atom('cancel', 'constant', { offset: 3.5 }), atom('cancelTag', 'event_tag', { campaign: 2 })); m.model.connections.push(edge('cancel', 0, 'cancelTag', 0), edge('cancelTag', 0, 'M2Xpair', 6));
  const r = await run(m, 'cancelled-prediction'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 7); assert.equal(events(r, 'M2XAE').length, 0);
});
test('8M budget exceeded yields no criterion or fictitious zero error', async () => {
  const m = forecastValidation(); component(m, 'verificationM2').experiment.execution.maxChildRunCalls = 1;
  const r = await run(m, 'budget-exceeded'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 2); assert.equal(events(r, 'M2XAE').length, 0);
});
test('8M numeric overflow remains invalid through the pairing graph', async () => {
  const m = forecastValidation(), d = definition(m, 'DampedProspect'); d.components.push(atom('overflow', 'qss3_power', { n: 2000 })); d.connections.push(edge('lambda', 0, 'overflow', 0)); d.components.find(c => c.id === 'lambda').parameters.value = 2;
  component(m, 'verificationM2').experiment.selections[0].target = 'overflow';
  const r = await run(m, 'nonfinite-prediction'); assert.equal(events(r, 'M2Xpair', 2)[0].value[0], 2); assert.equal(events(r, 'M2XAE').length, 0);
});
test('8M duplicate observation is a native protocol rejection', async () => {
  const m = forecastValidation(); m.model.connections.push(edge('futureState', 0, 'M2Xpair', 1)); await run(m, 'duplicate-observation', { error: true });
});
test('8M memory capacity cannot silently discard pending forecasts', async () => {
  const m = forecastValidation({ diagnostic: true }); component(m, 'calendar').parameters.capacity = 1; await run(m, 'capacity-exceeded', { error: true });
});
test('8M structural rejection includes a never-executed prospective definition', async () => {
  const m = forecastValidation(), d = structuredClone(definition(m, 'LinearProspect')); d.id = 'UnusedInvalidForecast';
  d.components.push(atom('invalidObserver', 'state_observer')); d.connections.push(edge('u', 0, 'invalidObserver', 0)); m.model.definitions.push(d);
  await run(m, 'structurally-invalid', { error: true });
});
test('8M event metrics can drive ordinary comparison/memory/selection without changing operational wiring', async () => {
  const m = forecastValidation(); m.model.components.push(atom('metricBelow', 'event_operator', { operation: 8, right: .5 }), atom('metricMemory', 'value_memory', { emitOnWrite: 1 }),
    atom('modelIdentity', 'event_operator', { left: 2, required: 0, automatic: 0 }), atom('cohortEnd', 'event_operator', { left: 1, required: 0, automatic: 0 }), atom('metricSelection', 'candidate_select', { emitFallback: 0 }));
  m.model.connections.push(edge('M2XMAE', 0, 'metricBelow', 0), edge('metricBelow', 0, 'metricMemory', 0),
    edge('M2XMAE', 0, 'metricSelection', 0), edge('M2XMAE', 0, 'modelIdentity', 2), edge('modelIdentity', 0, 'metricSelection', 1), edge('M2XMAE', 0, 'cohortEnd', 2), edge('cohortEnd', 0, 'metricSelection', 2));
  m.model.observations.push({ component: 'metricMemory', samplingInterval: .1, eventPorts: [0] }, { component: 'metricSelection', samplingInterval: .1, eventPorts: [0, 4] });
  const r = await run(m, 'metric-decision-input'); assert.equal(events(r, 'metricMemory')[0].value[0], 1); assert.equal(events(r, 'metricSelection')[0].value[0], 2);
  assert.equal(events(r, 'M2XMAE', 2).at(-1).value[0], 1); assert.equal(events(r, 'M2Xpair', 2).at(-1).value[0], 1);
});
