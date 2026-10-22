import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRequest, parseResult, parseWrapperResult } from '../../dist/packages/contracts/index.js';

const runner = process.env.IRRITATOR_RUNNER ?? fileURLToPath(new URL('../../../build-web-test7c/Release/runner/irritator-runner.exe', import.meta.url));
const example = name => JSON.parse(readFileSync(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const affine = () => example('wrapper-affine-v3');
const experiment = m => m.model.components.find(c => c.type === 'simulation_wrapper').experiment;
const edge = (a, ap, b, bp) => ({ from: { component: a, port: ap }, to: { component: b, port: bp } });
const constant = (id, value, offset) => ({ id, type: 'constant', parameters: { value, offset } });
function invoke(input) {
  const p = spawnSync(runner, [], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  assert.ifError(p.error); assert.ok(p.stdout, p.stderr);
  return { ...p, result: JSON.parse(p.stdout) };
}
function run(m) { validateRequest(m); const p = invoke(m); assert.equal(p.status, 0, p.stderr); return parseWrapperResult(p.result, m); }
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function decision(r, component, time, expected) {
  const events = r.resultEvents.filter(e => e.component === component && e.time === time);
  assert.equal(events.length, expected.length);
  for (const [i, e] of events.entries()) { assert.equal(e.port, i); const value = Array.isArray(expected[i]) ? expected[i] : [expected[i], 0, 0]; e.value.forEach((v, j) => near(v, value[j])); assert.ok(e.bag > 0); }
}
function coupled() {
  const m = affine(), system = m.model.definitions[0]; system.id = 'System';
  system.outputs = [{ port: 0, name: 'state' }]; system.connections.push(edge('X', 0, '$output', 0));
  m.model.definitions.push({ id: 'Prospectif', name: 'Coupled prospective', inputs: [], outputs: [], components: [{ id: 'system', type: 'coupled', definition: 'System', parameters: {} }, { id: 'monitor', type: 'qss1_sum_2', parameters: {} }], connections: [edge('system', 0, 'monitor', 0)] });
  const e = experiment(m); e.factors[0].target = 'system/u'; for (const s of e.selections) s.target = 'system/X';
  return m;
}
function pair(reset = false) {
  const m = coupled(), wrapper = m.model.components.find(c => c.type === 'simulation_wrapper');
  const cell = { id: 'Cell', name: 'Shared wrapper definition', inputs: [0, 1, 2].map(port => ({ port, name: `in${port}` })), outputs: [0, 1, 2].map(port => ({ port, name: `out${port}` })), components: [wrapper], connections: [...[0, 1, 2].map(p => edge('$input', p, 'decision', p)), ...[0, 1, 2].map(p => edge('decision', p, '$output', p))] };
  m.model.definitions.push(cell);
  m.model.components = [constant('leftRun', 1, 1), constant('rightRun', .5, 1.5), { id: 'left', type: 'coupled', definition: 'Cell', parameters: {} }, { id: 'right', type: 'coupled', definition: 'Cell', parameters: {}, experimentOverrides: [{ target: 'decision', factors: [{ id: 'rate', type: 'fixed', values: [-2, 2] }] }] }];
  m.model.connections = [edge('leftRun', 0, 'left', 1), edge('rightRun', 0, 'right', 1)]; m.model.observations = []; m.simulation.end = 4;
  if (reset) for (const [id, value, at, port] of [['factor', -2, 2.25, 2], ['init', 0, 2.5, 0], ['again', 0, 2.75, 1]]) { m.model.components.push(constant(id, value, at)); m.model.connections.push(edge(id, 0, 'left', port)); }
  return m;
}
test('v3 affine JSON: native 7B oracle, parent observations, ordered 3/3 layout', () => {
  const m = affine(), r = run(m); decision(r, 'decision', 1, [3, 1, 1]);
  assert.equal(r.schemaVersion, 2); assert.equal(r.simulation.finalTime, 3); assert.equal(r.resultEvents.length, 3);
  assert.equal(r.wrappers[0].inputs, 3); assert.deepEqual(r.wrappers[0].outputs.map(o => o.id), ['terminal', 'minimum', 'rate']); assert.equal(r.wrappers[0].scenarioCount, 3);
  r.observations.forEach((o, i) => near(o.samples.at(-1).value, [3, 1, 1][i]));
  assert.deepEqual(run(JSON.parse(JSON.stringify(m))), r);
});
test('v3 coupled prospective resolves system/u and system/X and preserves native interface', () => { const r = run(coupled()); decision(r, 'decision', 1, [3, 1, 1]); });
test('v3 prospective root may itself declare boundary ports', () => {
  const m = affine(), d = m.model.definitions[0]; d.outputs = [{ port: 7, name: 'state' }]; d.connections.push(edge('X', 0, '$output', 7));
  decision(run(m), 'decision', 1, [3, 1, 1]);
});
test('v3 unconnected outputs are collected through native private receivers', () => {
  const m = affine(); m.model.connections.length = 1; m.model.components.length = 2; m.model.observations = [];
  const r = run(m); decision(r, 'decision', 1, [3, 1, 1]); assert.equal(r.diagnostics.collectorModelCount, 3);
});
test('v3 one atomic prospective is not a hard-coded affine model', () => {
  const m = affine(), d = m.model.definitions[0]; d.components.length = 1; d.connections = [];
  for (const s of experiment(m).selections) s.target = 'u'; decision(run(m), 'decision', 1, [1, 1, 1]);
});
test('v3 independent occurrences, distinct fixed plans and simultaneous due dates match 7B', () => {
  const m = pair(), r = run(m); decision(r, 'left/decision', 2, [3, 1, 1]); decision(r, 'right/decision', 2, [5, 1, 2]);
  assert.equal(r.resultEvents.length, 6); assert.deepEqual(r.wrappers.map(w => w.scenarioCount), [3, 2]);
});
test('v3 reset with catalogue constants preserves the other occurrence (7B oracle)', () => {
  const r = run(pair(true)); decision(r, 'left/decision', 2, [3, 1, 1]); decision(r, 'right/decision', 2, [5, 1, 2]); decision(r, 'left/decision', 2.75, [-3, -3, -2]); assert.equal(r.resultEvents.length, 9);
});
test('v3 single, changed horizon/initial state/primary/direction and all criteria', () => {
  const m = affine(), e = experiment(m); e.factors[0] = { id: 'rate', target: 'u', parameter: 'value', type: 'single', value: 2 }; decision(run(m), 'decision', 1, [5, 1, 2]);
  e.simulation.end = 4; m.model.definitions[0].components[1].parameters.X = 3; decision(run(m), 'decision', 1, [11, 3, 2]);
  const n = affine(), f = experiment(n); f.selections[0].criteria = 'min-last'; f.selections[1].criteria = 'max'; f.objective.type = 'minimize'; decision(run(n), 'decision', 1, [-1, 1, -1]);
  f.objective.primary = 'minimum'; f.objective.type = 'maximize'; decision(run(n), 'decision', 1, [3, 3, 1]);
});
test('v3 output port upper limit F=2 S=10 and X factor maps to reals[0]', () => {
  const m = affine(), e = experiment(m); e.factors.push({ id: 'initial', target: 'X', parameter: 'X', type: 'fixed', values: [1, 2] });
  while (e.selections.length < 10) e.selections.push({ id: `extra${e.selections.length}`, target: 'X', criteria: 'max-last' });
  m.model.connections.length = 1; m.model.observations = [];
  const r = run(m); decision(r, 'decision', 1, [4, 2, 4, 4, 4, 4, 4, 4, 4, 4, 1, [2, .01, 0]]); assert.equal(r.wrappers[0].inputs, 4);
});
test('v3 input port upper limit F=10 S=2 produces 12/12 ports', () => {
  const m = affine(), e = experiment(m), d = m.model.definitions[0];
  for (let i = 1; i < 10; ++i) { d.components.push(constant(`u${i}`, i, 0)); e.factors.push({ id: `f${i}`, target: `u${i}`, parameter: 'value', type: 'single', value: i }); }
  m.model.connections.length = 1; m.model.connections.push(edge('run', 0, 'decision', 11)); m.model.observations = [];
  const r = run(m); assert.equal(r.wrappers[0].inputs, 12); decision(r, 'decision', 1, [3, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 0]);
});
test('v3 lower selection limit F=2 S=1 and full parameter triplets', () => {
  const m = affine(), e = experiment(m); e.selections.length = 1; e.factors.push({ id: 'initial', target: 'X', parameter: 'X', type: 'single', value: 2 });
  decision(run(m), 'decision', 1, [4, 1, [2, .01, 0]]);
});
test('v3 eight different wrapper declarations build separate prototypes and resources', () => {
  const m = affine(), base = m.model.components[1]; m.model.components.length = 1; m.model.observations = []; m.model.connections = [];
  for (let i = 0; i < 8; ++i) {
    const c = structuredClone(base); c.id = `decision${i}`; c.experiment.factors[0].values = [i];
    m.model.components.push(c); m.model.connections.push(edge('run', 0, c.id, 1));
  }
  const r = run(m); for (let i = 0; i < 8; ++i) decision(r, `decision${i}`, 1, [1 + 2 * i, 1, i]); assert.equal(r.resultEvents.length, 24);
});
test('v3 JSON ids of 64 chars keep distinct native paths despite native name_str size', () => {
  const m = affine(), d = m.model.definitions[0], old = d.components[0].id, id = 'a'.repeat(64); d.components[0].id = id; d.connections[0].from.component = id; experiment(m).factors[0].target = id;
  assert.equal(old, 'u'); decision(run(m), 'decision', 1, [3, 1, 1]);
});
test('v3 pure v1/v2 graphs preserve observations and use explicit result v2', () => {
  for (const name of ['sum3', 'hierarchy-sum', 'qss3-operators-coupled']) { const m = example(name), before = invoke(m); assert.equal(before.status, 0); assert.equal(before.result.schemaVersion, 1); parseResult(before.result, m); m.schemaVersion = 3; m.model.definitions ??= []; const after = run(m); assert.deepEqual(after.observations, before.result.observations); assert.deepEqual(after.resultEvents, []); }
});
const invalid = [
  ['empty fixed list', m => { experiment(m).factors[0].values = []; }, 'INVALID_MODEL'],
  ['unsupported random', m => { experiment(m).factors[0].type = 'random'; }, 'INVALID_MODEL'],
  ['unsupported add', m => { experiment(m).factors[0].type = 'fixed-add'; }, 'INVALID_MODEL'],
  ['unsupported method', m => { experiment(m).objective.method = 'weighted-sum'; }, 'INVALID_MODEL'],
  ['unsupported constrained method', m => { experiment(m).objective.method = 'epsilon-constrained'; }, 'INVALID_MODEL'],
  ['unsupported mode', m => { experiment(m).run = 'bag'; }, 'INVALID_MODEL'],
  ['missing prospective definition', m => { experiment(m).definition = 'absent'; }, 'DEFINITION_NOT_FOUND'],
  ['factor path', m => { experiment(m).factors[0].target = 'absent'; }, 'INVALID_FACTOR'],
  ['traverse atom', m => { experiment(m).factors[0].target = 'X/u'; }, 'INVALID_FACTOR'],
  ['factor offset', m => { experiment(m).factors[0].parameter = 'offset'; }, 'INVALID_MODEL'],
  ['factor dQ', m => { experiment(m).factors[0].parameter = 'dQ'; }, 'INVALID_MODEL'],
  ['wrong real-zero parameter', m => { experiment(m).factors[0].parameter = 'X'; }, 'INVALID_FACTOR'],
  ['unsupported factor atom', m => { experiment(m).factors[0].target = 'X'; experiment(m).factors[0].parameter = 'value'; }, 'INVALID_FACTOR'],
  ['duplicate factor target', m => { experiment(m).factors.push({ ...experiment(m).factors[0], id: 'duplicate' }); }, 'INVALID_FACTOR'],
  ['duplicate factor id', m => { experiment(m).factors.push({ ...experiment(m).factors[0], target: 'X', parameter: 'X' }); }, 'INVALID_FACTOR'],
  ['no factors', m => { experiment(m).factors = []; }, 'INVALID_MODEL'],
  ['no selections', m => { experiment(m).selections = []; }, 'INVALID_MODEL'],
  ['too few outputs', m => { experiment(m).selections.length = 1; }, 'INVALID_EXPERIMENT'],
  ['too many outputs', m => { const e = experiment(m); e.factors.push({ id: 'x', target: 'X', parameter: 'X', type: 'single', value: 1 }); while (e.selections.length < 11) e.selections.push({ ...e.selections[0], id: `s${e.selections.length}` }); }, 'INVALID_EXPERIMENT'],
  ['too many factors', m => { while (experiment(m).factors.length < 11) experiment(m).factors.push({ ...experiment(m).factors[0] }); }, 'INVALID_MODEL'],
  ['selection path', m => { experiment(m).selections[0].target = 'absent'; }, 'INVALID_SELECTION'],
  ['selection duplicate id', m => { experiment(m).selections[1].id = 'terminal'; }, 'INVALID_SELECTION'],
  ['selection criteria', m => { experiment(m).selections[0].criteria = 'average'; }, 'INVALID_MODEL'],
  ['unknown primary', m => { experiment(m).objective.primary = 'absent'; }, 'INVALID_SELECTION'],
  ['non-finite factor serialized as null', m => { experiment(m).factors[0].values[0] = null; }, 'INVALID_MODEL'],
  ['prospective horizon', m => { experiment(m).simulation.end = 0; }, 'INVALID_TIME'],
  ['unbounded prospective grid', m => { experiment(m).simulation.end = 1e8; }, 'LIMIT_EXCEEDED'],
  ['cartesian product', m => { experiment(m).factors.push({ id: 'initial', target: 'X', parameter: 'X', type: 'fixed', values: Array(50).fill(1) }); }, 'LIMIT_EXCEEDED'],
  ['lowered scenario cap', m => { m.limits = { maxScenarios: 2 }; }, 'LIMIT_EXCEEDED'],
  ['lowered total scenario cap', m => { m.limits = { maxTotalScenarios: 2 }; }, 'LIMIT_EXCEEDED'],
  ['lowered total model cap', m => { m.limits = { maxTotalModels: 10 }; }, 'LIMIT_EXCEEDED'],
  ['lowered total connection cap', m => { m.limits = { maxTotalConnections: 5 }; }, 'LIMIT_EXCEEDED'],
  ['lowered internal point cap', m => { m.limits = { maxInternalPoints: 10 }; }, 'LIMIT_EXCEEDED'],
  ['port F+2', m => { m.model.connections[0].to.port = 3; }, 'INVALID_CONNECTION'],
  ['port S+F', m => { m.model.connections[1].from.port = 3; }, 'INVALID_CONNECTION'],
  ['observe wrapper', m => { m.model.observations[0].component = 'decision'; }, 'OBSERVATION_ERROR'],
  ['duplicate definition', m => { m.model.definitions.push(structuredClone(m.model.definitions[0])); }, 'INVALID_MODEL'],
  ['duplicate atom', m => { m.model.definitions[0].components[1].id = 'u'; }, 'INVALID_MODEL'],
  ['recursive prospective reference', m => { m.model.definitions[0].components.push(structuredClone(m.model.components[1])); }, 'RECURSIVE_DEFINITION'],
  ['unvalidated deeper wrapper', m => { const outer = structuredClone(m.model.definitions[0]); outer.id = 'Outer'; outer.components = [structuredClone(m.model.components[1])]; outer.connections = []; m.model.definitions.push(outer); experiment(m).definition = 'Outer'; }, 'UNSUPPORTED_EXPERIMENT'],
  ['long factor id', m => { experiment(m).factors[0].id = 'a'.repeat(32); }, 'INVALID_MODEL'],
  ['wrapper parameters', m => { m.model.components[1].parameters.value = 1; }, 'INVALID_PARAMETER'],
];
for (const [name, mutate, code] of invalid) test(`v3 both validators reject ${name} before native allocation`, () => {
  const m = affine(); mutate(m); assert.throws(() => validateRequest(m), e => e.code === code, name);
  const p = invoke(m); assert.equal(p.status, 2, p.stderr); assert.equal(p.result.error.code, code, p.stdout); assert.equal(p.result.resultEvents, undefined);
});
for (const [name, mutate, code] of [
  ['unknown override', m => { m.model.components[3].experimentOverrides[0].target = 'missing'; }, 'INVALID_REFERENCE'],
  ['override id', m => { m.model.components[3].experimentOverrides[0].factors[0].id = 'bad'; }, 'INVALID_FACTOR'],
  ['override dimensions', m => { m.model.components[3].experimentOverrides[0].factors.push({ id: 'new', type: 'single', value: 1 }); }, 'INVALID_FACTOR'],
  ['duplicate override', m => { m.model.components[3].experimentOverrides.push(structuredClone(m.model.components[3].experimentOverrides[0])); }, 'INVALID_EXPERIMENT'],
  ['override resource cap', m => { m.limits = { maxTotalScenarios: 4 }; }, 'LIMIT_EXCEEDED'],
  ['wrapper occurrence cap', m => { m.limits = { maxWrappers: 1 }; }, 'LIMIT_EXCEEDED'],
]) test(`v3 both validators reject ${name}`, () => {
  const m = pair(); mutate(m); assert.throws(() => validateRequest(m), e => e.code === code);
  const p = invoke(m); assert.equal(p.status, 2, p.stderr); assert.equal(p.result.error.code, code, p.stdout);
});
test('v3 DEVS feedback is legal and scheduler calls are bounded', () => {
  const m = affine(); m.model.connections.push(edge('terminal', 0, 'minimum', 1), edge('minimum', 0, 'terminal', 1)); m.limits = { maxRunCalls: 20 }; validateRequest(m);
  const p = invoke(m); assert.equal(p.result.error.code, 'LIMIT_EXCEEDED');
});
test('v3 native construction failure: different interfaces expand to the same native edge', () => {
  const m = affine();
  m.model.definitions.push({ id: 'Alias', name: 'Aliased inputs', inputs: [{ port: 0, name: 'a' }, { port: 1, name: 'b' }], outputs: [], components: [{ id: 'sink', type: 'qss1_sum_2', parameters: {} }], connections: [edge('$input', 0, 'sink', 0), edge('$input', 1, 'sink', 0)] });
  m.model.components.push({ id: 'alias', type: 'coupled', definition: 'Alias', parameters: {} }); m.model.connections.push(edge('run', 0, 'alias', 0), edge('run', 0, 'alias', 1)); validateRequest(m);
  const p = invoke(m); assert.equal(p.status, 2, p.stdout); assert.equal(p.result.error.code, 'NATIVE_CONSTRUCTION_ERROR');
});
test('v3 local self edges and native execution errors retain the proper failure envelope', () => {
  const m = affine(); m.model.connections.push(edge('decision', 0, 'decision', 1));
  // Local self edges are rejected by the contract, not sent to project::set.
  assert.throws(() => validateRequest(m), e => e.code === 'INVALID_CONNECTION'); assert.equal(invoke(m).result.error.code, 'INVALID_CONNECTION');
  const n = affine(); n.model.components[0].parameters.value = -1;
  const p = invoke(n); assert.equal(p.status, 2); assert.equal(p.result.error.code, 'EXECUTION_ERROR'); assert.equal(typeof p.result.error.engineCategory, 'number'); assert.equal(typeof p.result.error.engineCode, 'number');
});
test('v3 event cap fails without publishing partial success', () => { const m = affine(); m.limits = { maxResultEvents: 2 }; validateRequest(m); const p = invoke(m); assert.equal(p.status, 2); assert.equal(p.result.error.code, 'LIMIT_EXCEEDED'); assert.equal(p.result.resultEvents, undefined); });
test('v3 no run command yields no invented decision', () => { const m = affine(); m.model.connections.shift(); const r = run(m); assert.deepEqual(r.resultEvents, []); });
test('v3 repeated same-time requests preserve separate bags', () => {
  const m = affine(); m.model.components.push({ id: 'relay', type: 'qss1_sum_2', parameters: {} }); m.model.connections.push(edge('run', 0, 'relay', 0), edge('relay', 0, 'decision', 1));
  const r = run(m), atOne = r.resultEvents.filter(e => e.time === 1); assert.ok(atOne.length >= 6); assert.ok(new Set(atOne.map(e => e.bag)).size >= 2);
});
test('v3 explicit result parser rejects malformed events and legacy reinterpretation', () => {
  const m = affine(), r = run(m); assert.throws(() => parseResult(r, m), e => e.code === 'RUNNER_PROTOCOL_ERROR');
  for (const change of [x => { x.schemaVersion = 1; }, x => { x.resultEvents[0].value = [3]; }, x => { x.resultEvents[0].component = 'absent'; }, x => { x.resultEvents[0].time = 3; }, x => { x.resultEvents[0].bag = 0; }, x => { x.resultEvents[0].port = 3; }, x => { x.resultEvents.push(x.resultEvents[0]); }, x => { x.wrappers[0].scenarioCount = 7; }]) { const x = structuredClone(r); change(x); assert.throws(() => parseWrapperResult(x, m), e => e.code === 'RUNNER_PROTOCOL_ERROR'); }
});
test('v3 nonfinite literals, duplicate keys, unknown fields and v1/v2 wrapper rejection', () => {
  const text = JSON.stringify(affine()); assert.equal(invoke(text.replace('"start":0', '"start":1e999')).result.error.code, 'INVALID_JSON');
  assert.equal(invoke(text.replace('"schemaVersion":3', '"schemaVersion":3,"schemaVersion":3')).result.error.code, 'INVALID_JSON');
  for (const version of [1, 2]) { const m = affine(); m.schemaVersion = version; assert.throws(() => validateRequest(m)); assert.equal(invoke(m).status, 2); }
  const m = affine(); experiment(m).trigger = 1; assert.throws(() => validateRequest(m)); assert.equal(invoke(m).result.error.code, 'INVALID_MODEL');
});
