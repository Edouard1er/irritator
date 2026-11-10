import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { selectMinimal, selectSchaefer } from './decision-8l-fixture.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { source } from './decision-8c-fixture.mjs';
import { validateRequest, parseWrapperResult, wrapperOccurrences, inspectStructure, validateHierarchy } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER; assert.ok(runner, 'Set IRRITATOR_RUNNER');
const dir = process.env.IRRITATOR_8L_EVIDENCE;
let app;
if (process.env.DECISION_8L_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js'); const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
async function run(m, name, error = false, native = false) {
  if (!error) validateRequest(m);
  const input = JSON.stringify(m), p = spawnSync(runner, [], { input, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const r = JSON.parse(p.stdout || 'null'), proof = { request: m, result: r, exit: p.status, stderr: p.stderr };
  const save = () => { if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, name + '.json'), JSON.stringify(proof, null, 2)); } }; save();
  assert.equal(p.status, error ? 2 : 0, p.stdout + p.stderr);
  if (!error) parseWrapperResult(r, m); else assert.equal(r.resultEvents, undefined);
  if (app) {
    const res = await fetch(app.listeningOrigin + '/api/v1/simulations/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: input });
    const { runId, requestId, ...actual } = await res.json(); proof.httpStatus = res.status; proof.httpResult = actual;
    proof.httpRunId = runId ?? null; proof.httpRequestId = requestId ?? null; save();
    assert.equal(res.status, error ? (r.error.code === 'EXECUTION_ERROR' || r.error.code === 'STRUCTURAL_INCOMPATIBILITY' ? 422 : 400) : 200);
    if (!error || ['EXECUTION_ERROR', 'STRUCTURAL_INCOMPATIBILITY'].includes(r.error.code)) assert.deepEqual(actual, r);
    else assert.equal(actual.error.code, r.error.code);
    proof.httpEqualsNative = !error || JSON.stringify(actual) === JSON.stringify(r); save();
  }
  if (native && dir) {
    const file = resolve(dir, name + '-request.json'); writeFileSync(file, input);
    const n = spawnSync(resolve(dirname(runner), 'model-selection-native.exe'), [file], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(resolve(dir, name + '-native.log'), n.stdout + n.stderr); assert.equal(n.status, 0, n.stdout + n.stderr);
    assert.match(n.stdout, /NATIVE_MODEL_SELECTION_RESET_PASS/);
    proof.nativeTrace = n.stdout;
    proof.scientificReport = scientificReport(m, r, n.stdout); save();
  }
  return r;
}
const def = (m, id) => m.model.definitions.find(d => d.id === id);
const env = m => def(m, 'ProspectiveLibrary');
const events = (r, model, kind, c) => {
  const w = r.wrappers.find(w => w.component === 'forecast/' + model);
  const ports = w.outputs.filter(p => p.kind === kind).map(p => p.port);
  return r.resultEvents.filter(e => e.component === w.component && ports.includes(e.port) && (c === undefined || e.value[2] === c));
};
const last = (r, path) => r.observations.find(o => o.component === path).samples.at(-1).value;
const near = (a, b, tol) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);
// Reporting only: join the native manifest, actual parameters, outcomes, and
// sealed PLAN trace. No criterion or action is recomputed in this projection.
function scientificReport(m, r, trace) {
  const wrappers = wrapperOccurrences(m), scenarios = [];
  for (const w of wrappers) {
    const layout = r.wrappers.find(x => x.component === w.component);
    const matching = r.resultEvents.filter(e => e.component === w.component);
    const read = (kind, id, c, s) => matching.find(e => layout.outputs[e.port].kind === kind
      && (id === undefined || layout.outputs[e.port].id === id) && e.value[2] === c && (s === undefined || e.value[1] === s))?.value[0];
    for (const e of matching.filter(e => layout.outputs[e.port].kind === 'scenario-outcome')) {
      const c = e.value[2], s = e.value[1];
      const plan = trace.match(new RegExp(`^PLAN 0 campaign=${c} model=${w.component} id=(\\S+) version=(\\S+)`, 'm'));
      assert.ok(plan, 'A scientific row requires the actual sealed native plan');
      scenarios.push({ campaign: c, modelRef: { occurrence: w.component, definition: w.experiment.definition },
        validation: 'native-structural-preflight-passed', plan: { id: Number(plan[1]), version: Number(plan[2]) }, scenario: s,
        factors: w.experiment.factors.map(f => ({ id: f.id, target: f.target, parameter: f.parameter, contract: f.name, value: read('scenario-factor', f.id, c, s) })),
        horizon: read('scenario-horizon', undefined, c, s),
        criteria: w.experiment.selections.map(v => ({ id: v.id, target: v.target, reduction: v.criteria, contract: v.name, value: read('scenario-selection', v.id, c, s) ?? null })),
        status: e.value[0], runCalls: read('scenario-run-calls', undefined, c, s), campaignRunCalls: read('campaign-run-calls', undefined, c), execution: w.experiment.execution });
    }
  }
  return { definitions: m.model.definitions.filter(d => wrappers.some(w => w.experiment.definition === d.id)), scenarios };
}
function linearOracle(x, u, h, lambda = 0) { return lambda ? x * Math.exp(-lambda * h) + u / lambda * -Math.expm1(-lambda * h) : x + u * h; }
// Independent closed-form solution of the logistic ODE with extra mortality.
export function mortalityOracle(N, C, E, h, q = .001, m = 0) {
  const alpha = .35 - q * E - m, beta = .35 / 300;
  const D = 1 + beta * N * (Math.abs(alpha) < 1e-14 ? h : Math.expm1(alpha * h) / alpha);
  return { N: N * Math.exp(alpha * h) / D, C: C + q * E * Math.log(D) / beta };
}
function verifyLinear(r, lambda = .5, controlled = false) {
  for (const [c, model, x, us, h] of [[1, 'M1', -1, [-1, 0, 1], 2], [2, 'M2', 1, [-1, 0], 1]]) {
    assert.equal(events(r, model === 'M1' ? 'M2' : 'M1', 'scenario-run-calls', c).length, 0);
    const factors = events(r, model, 'scenario-factor', c), criteria = events(r, model, 'scenario-selection', c);
    assert.equal(criteria.length, us.length);
    criteria.forEach((e, i) => near(e.value[0], linearOracle(x, us[i], h, model === 'M2' ? lambda : 0), .002));
    assert.deepEqual(factors.filter(e => e.port === 4).map(e => e.value[0]), us.map(() => x));
    assert.deepEqual(factors.filter(e => e.port === 5).map(e => e.value[0]), us);
    assert.ok(events(r, model, 'scenario-run-calls', c).every(e => e.value[0] > 0));
    assert.deepEqual(events(r, model, 'scenario-horizon', c).map(e => e.value[0]), us.map(() => h));
    assert.ok(events(r, model, 'plan-ready', c)[0].bag < criteria[0].bag);
  }
  if (!controlled) { near(last(r, 'plant/X'), 1, .002); assert.equal(last(r, 'plant/hold'), 0); }
}

test('8L delivered library graphs roundtrip without changing any scientific settings', async () => {
  for (const [file, create] of [['decision-select-prospect-model', selectMinimal], ['tstar-schaefer-select-prospect', selectSchaefer]]) {
    const m = JSON.parse(readFileSync(new URL('../../examples/' + file + '-v3.json', import.meta.url), 'utf8'));
    assert.deepEqual(m, create()); assert.deepEqual(inspectStructure(m), []);
    assert.deepEqual(wrapperOccurrences(m).map(w => [w.component, w.experiment.definition]), [['forecast/M1', file.startsWith('decision') ? 'LinearProspect' : 'SchaeferProspect'], ['forecast/M2', file.startsWith('decision') ? 'DampedProspect' : 'SchaeferMortality']]);
    assert.deepEqual(await run(m, file, false, true), await run(JSON.parse(JSON.stringify(m)), file + '-roundtrip'));
    const sizes = validateHierarchy(m).get('$root'); assert.ok(sizes.atoms <= 128 && sizes.connections <= 512);
  }
});
test('8L known observations impose M1 then M2; QSS terminal criteria match independent formulas', async () => {
  verifyLinear(await run(selectMinimal({ controlled: true }), 'linear-controlled', false, true), .5, true);
});
test('8L real dynamic main system observes -1 then 1 and executes distinct topologies', async () => {
  const m = selectMinimal(), r = await run(m, 'linear-feedback', false, true); verifyLinear(r);
  assert.equal(def(m, 'LinearProspect').components.length, 2); assert.equal(def(m, 'DampedProspect').components.length, 5);
});
test('8L changing graphical lambda changes executed M2 equations and criteria', async () => {
  const r = await run(selectMinimal({ lambda: 1 }), 'lambda-edited'); verifyLinear(r, 1);
});
test('8L Schaefer chooses M1 then M2 from actual N and recomputes both actions independently', async () => {
  const m = selectSchaefer(), r = await run(m, 'schaefer-feedback', false, true);
  const campaigns = [], actions = []; let state = { N: 150, C: 0 }, effort = 260, at = 0;
  for (const c of [1, 2]) {
    const time = c === 1 ? 1 : 3; state = mortalityOracle(state.N, state.C, effort, time - at); at = time;
    const model = state.N < 140 ? 'M1' : 'M2', Es = model === 'M1' ? [80, 150, 260] : [80, 150], H = model === 'M1' ? 20 : 10;
    assert.equal(model, c === 1 ? 'M1' : 'M2');
    const raw = events(r, model, 'scenario-selection', c), factors = events(r, model, 'scenario-factor', c);
    const scenario = [];
    for (const q of [.0008, .001]) for (const E of Es) {
      const o = mortalityOracle(state.N, state.C, E, H, q, model === 'M2' ? .08 : 0), id = scenario.length;
      const n = Math.min(state.N, o.N); near(raw.find(e => e.port === 11 && e.value[1] === id).value[0], n, .06);
      near(raw.find(e => e.port === 12 && e.value[1] === id).value[0], o.C, .3);
      for (const [p, value, tol] of [[7, state.N, .05], [8, state.C, .1], [9, E, 0], [10, q, 0]]) near(factors.find(e => e.port === p && e.value[1] === id).value[0], value, tol);
      scenario.push({ id, E, q, Nmin: n, capture: o.C - state.C });
    }
    const groups = Es.map(E => ({ E, Nmin: Math.min(...scenario.filter(s => s.E === E).map(s => s.Nmin)), capture: Math.min(...scenario.filter(s => s.E === E).map(s => s.capture)) }));
    const feasible = groups.filter(g => g.Nmin >= 140);
    const best = [...(feasible.length ? feasible : groups)].sort((a, b) => feasible.length
      ? b.capture - a.capture || b.Nmin - a.Nmin : b.Nmin - a.Nmin || b.capture - a.capture)[0];
    effort = best.E; actions.push({ time, effort }); campaigns.push({ campaign: c, model, state: { ...state }, H, scenario, groups, action: effort });
    assert.equal(events(r, model === 'M1' ? 'M2' : 'M1', 'scenario-run-calls', c).length, 0);
  }
  assert.deepEqual(actions, [{ time: 1, effort: 150 }, { time: 3, effort: 80 }]);
  for (const variable of ['N', 'C']) for (const s of r.observations.find(o => o.component === 'plant/' + variable).samples) {
    let actual = mortalityOracle(150, 0, 260, Math.min(s.time, 1));
    if (s.time > 1) actual = mortalityOracle(actual.N, actual.C, 150, Math.min(s.time, 3) - 1);
    if (s.time > 3) actual = mortalityOracle(actual.N, actual.C, 80, s.time - 3);
    near(s.value, actual[variable], variable === 'N' ? .05 : .1);
  }
  assert.equal(last(r, 'plant/effort'), effort);
  if (dir) writeFileSync(resolve(dir, 'scientific-results.json'), JSON.stringify({ campaigns, actions, terminal: { N: last(r, 'plant/N'), C: last(r, 'plant/C') }, expectedTerminal: mortalityOracle(state.N, state.C, effort, 2) }, null, 2));
});
test('8L threshold is editable and may select only one model over multiple campaigns', async () => {
  const r = await run(selectMinimal({ threshold: -2 }), 'only-M2', false, true);
  assert.equal(events(r, 'M1', 'scenario-run-calls').length, 0);
  assert.deepEqual(events(r, 'M2', 'campaign-end').map(e => e.value[2]), [1, 2]);
});
test('8L overlapping delayed campaigns with different selected models retain immutable provenance', async () => {
  const m = selectMinimal({ controlled: true, delay: 4 }); m.simulation.end = 8;
  const r = await run(m, 'overlap-distinct-models', false, true); verifyLinear(r, .5, true);
  assert.equal(events(r, 'M1', 'campaign-end', 1)[0].time, 5); assert.equal(events(r, 'M2', 'campaign-end', 2)[0].time, 7);
});
test('8L a model can be reused in a later campaign after another model', async () => {
  const m = selectMinimal({ controlled: true }); m.simulation.end = 7; source(m, 'observer', 1, -2, 0, 3, 5);
  const r = await run(m, 'reuse-M1', false, true);
  assert.deepEqual(events(r, 'M1', 'campaign-end').map(e => e.value[2]), [1, 3]);
  events(r, 'M1', 'scenario-selection', 3).forEach((e, i) => near(e.value[0], -2 + [-1, 0, 1][i] * 2, .002));
});
test('8L absent observation selects and executes no prospective', async () => {
  const m = selectMinimal(); m.model.connections = m.model.connections.filter(e => !(e.from.component === 'plant' && e.to.component === 'observer' && e.to.port === 1));
  assert.equal((await run(m, 'no-selection')).resultEvents.length, 0);
});
test('8L duplicate, contradictory, and post-seal selections are rejected by the singleton barrier', async () => {
  for (const [name, value, time] of [['duplicate', -1, 1], ['contradictory', 1, 1], ['late', 1, 1.5]]) {
    const m = selectMinimal({ controlled: true }); source(m, 'observer', 1, value, 0, 1, time);
    const r = await run(m, 'selection-' + name, true); assert.equal(r.error.code, 'EXECUTION_ERROR'); assert.equal(r.error.engineCode, 70);
  }
});
test('8L an incomplete second plan cannot reuse an old model or initial state', async () => {
  for (const missing of ['initial', 'domain']) {
    const m = selectMinimal(); const b = def(m, 'LinearDecision');
    b.connections = b.connections.filter(e => !(e.to.component === '$output' && e.to.port === (missing === 'initial' ? 6 : 7)));
    // Keep the external endpoint declared: disconnect upstream, preserving a
    // well-formed interface and reaching the native dynamicPlan transaction.
    if (missing === 'initial') { b.components.push(atom('never', 'event_operator')); b.connections.push(edge('never', 0, '$output', 6)); }
    else { b.components.push(atom('never', 'event_operator')); b.connections.push(edge('never', 0, '$output', 7)); }
    const r = await run(m, 'missing-' + missing, true); assert.equal(r.error.engineCode, 70);
  }
});
test('8L all declarations are prevalidated, including the never-selected branch and unused models', async () => {
  for (const [name, mutate, code] of [
    ['unknown-model', m => { env(m).components.find(c => c.id === 'M2').experiment.definition = 'Absent'; }, 'DEFINITION_NOT_FOUND'],
    ['missing-model', m => { m.model.definitions = m.model.definitions.filter(d => d.id !== 'DampedProspect'); }, 'DEFINITION_NOT_FOUND'],
    ['invalid-factor', m => { env(m).components.find(c => c.id === 'M2').experiment.factors[0].target = 'Missing'; }, 'TARGET_NOT_FOUND'],
    ['invalid-criterion', m => { env(m).components.find(c => c.id === 'M2').experiment.selections[0].target = 'Missing'; }, 'TARGET_NOT_FOUND'],
    ['invalid-structure', m => { const d = def(m, 'DampedProspect'); d.components.push(atom('badRead', 'state_observer')); d.connections.push(edge('lambda', 0, 'badRead', 0)); }, 'STATE_OBSERVER_SOURCE_TYPE'],
    ['unused-invalid', m => { m.model.definitions.push({ id: 'Unused', name: 'Invalid unused definition', inputs: [], outputs: [], components: [atom('a', 'constant'), atom('b', 'state_observer')], connections: [edge('a', 0, 'b', 0)] }); }, 'STATE_OBSERVER_SOURCE_TYPE']
  ]) {
    const m = selectMinimal({ threshold: 100 }); m.simulation.end = 2; mutate(m);
    assert.equal(inspectStructure(m)[0].code, code); const r = await run(m, name, true); assert.equal(r.error.diagnostics[0].code, code);
  }
});
test('8L explicit criterion adapter is required; removing it cannot fabricate a decision', async () => {
  const m = selectMinimal(); const b = def(m, 'LinearDecision');
  b.connections = b.connections.filter(e => !(e.from.component === '$input' && e.to.component === 'targetDistance' && e.to.port === 0));
  b.components.push(atom('unused', 'value_memory')); b.connections.push(edge('$input', 3, 'unused', 0));
  const r = await run(m, 'missing-criterion-adapter', false, true); assert.equal(last(r, 'plant/hold'), 0); near(last(r, 'plant/X'), -1, .002);
  if (dir) {
    const trace = readFileSync(resolve(dir, 'missing-criterion-adapter-native.log'), 'utf8');
    // The initial command at t=0 is the only physical action, even though both
    // prospective campaigns finish. A fabricated action 0 could hide in hold.
    assert.equal([...trace.matchAll(/^EVENT 0 \d+ \S+ plant\/hold:0 /gm)].length, 1);
    assert.match(trace, /^EVENT 0 \d+ 0 plant\/hold:0 \[0,0,0\]$/m);
  }
});
test('8L selected numerically failing model uses 8J policies without fictitious criteria', async () => {
  const make = () => { const m = selectMinimal({ controlled: true }), d = def(m, 'DampedProspect'); d.components.push(atom('fault', 'qss3_power', { n: 2000 })); d.connections.push(edge('u', 0, 'fault', 0)); env(m).components.find(c => c.id === 'M2').experiment.selections[0].target = 'fault'; def(m, 'BuildPlan').components.find(c => c.id === 'highValue0').parameters.left = .5; def(m, 'BuildPlan').components.find(c => c.id === 'highValue1').parameters.left = 2; return m; };
  const m = make(); assert.deepEqual(inspectStructure(m), []); const r = await run(m, 'numerical-isolate');
  assert.deepEqual(events(r, 'M2', 'scenario-outcome', 2).map(e => e.value[0]), [1, 2]); assert.equal(events(r, 'M2', 'scenario-selection', 2).length, 1);
  const fast = make(); env(fast).components.find(c => c.id === 'M2').experiment.execution.failurePolicy = 'fail-fast'; assert.equal((await run(fast, 'numerical-fail-fast', true)).error.engineCode, 67);
});
test('8L selected branch obeys child and campaign budgets; inactive branch remains idle', async () => {
  const m = selectMinimal(); env(m).components.find(c => c.id === 'M2').experiment.execution.maxChildRunCalls = 1;
  const r = await run(m, 'child-budget'); assert.deepEqual(events(r, 'M2', 'scenario-outcome', 2).map(e => e.value[0]), [3, 3]);
  assert.deepEqual(events(r, 'M2', 'scenario-selection', 2), []); assert.equal(events(r, 'M1', 'scenario-run-calls', 2).length, 0);
  const n = selectMinimal(); env(n).components.find(c => c.id === 'M1').experiment.execution.maxCampaignRunCalls = 1;
  const s = await run(n, 'campaign-budget'); assert.deepEqual(events(s, 'M1', 'scenario-run-calls', 1).map(e => e.value[0]), [1, 0, 0]);
  assert.equal(events(s, 'M1', 'scenario-selection', 1).length, 0);
});

function manual() {
  const m = selectMinimal(); m.model.components = m.model.components.filter(c => c.id === 'forecast'); m.model.connections = []; m.model.observations = [];
  m.model.definitions = m.model.definitions.filter(d => ['LinearProspect', 'DampedProspect', 'ProspectiveLibrary'].includes(d.id));
  // Explicitly control run/init in this protocol fixture, instead of auto-run.
  env(m).connections = env(m).connections.filter(e => !(e.to.component.startsWith('execute') || e.from.component.startsWith('runTag')));
  return m;
}
function transmit(m, c, branch = 0, at = 0) {
  const k = branch * 5; source(m, 'forecast', k + 2, 7, 0, c, at); [-1, 0].forEach((u, i) => source(m, 'forecast', k + 3, u, i, c, at));
  for (const [field, value] of [[0, 1], [1, 1], [2, 1], [6, 2], [3, 0]]) source(m, 'forecast', k + 4, value, field, c, at);
}
test('8L cancellation closes a selected plan and rejects its later run', async () => {
  const m = manual(); transmit(m, 1); source(m, 'forecast', 4, 0, 4, 1, 1);
  assert.equal(events(await run(m, 'cancel-selected-plan'), 'M1', 'campaign-end', 1).length, 0);
  source(m, 'forecast', 1, 0, 0, 1, 2); assert.equal((await run(m, 'cancel-replay', true)).error.engineCode, 70);
});
test('8L cancellation of M1 delayed response does not cancel M2 response', async () => {
  const m = manual(); m.simulation.end = 8; transmit(m, 1); transmit(m, 2, 1, 2); transmit(m, 3, 0, 2);
  source(m, 'forecast', 1, 5, 0, 1, 1); source(m, 'forecast', 6, 0, 0, 2, 3); source(m, 'forecast', 0, 0, 0, 3, 3);
  const r = await run(m, 'cancel-response-local'); assert.equal(events(r, 'M1', 'campaign-end', 1).length, 0); assert.equal(events(r, 'M2', 'campaign-end', 2).length, 1);
});
