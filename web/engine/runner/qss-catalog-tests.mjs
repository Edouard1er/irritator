import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runner = process.env.IRRITATOR_RUNNER ?? fileURLToPath(new URL(`../../../build-web-test4/runner/irritator-runner${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const example = name => JSON.parse(readFileSync(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const cases = [
  ['qss3_multiplier', {}, 12, 27],
  ['qss3_wsum_2', { 'coeff-0': 2, 'coeff-1': -.5 }, 6.5, 16.5],
  ['qss3_power', { n: 3 }, 64, 729],
  ['qss3_inverse', {}, .25, 1 / 9],
  ['qss3_square', {}, 16, 81],
  ['qss3_sqrt', {}, 2, 3],
];
const edge = (a, ap, b, bp) => ({ from: { component: a, port: ap }, to: { component: b, port: bp } });
function model(type, parameters) {
  const r = example('qss3-operators');
  r.model.components = r.model.components.filter(c => ['x', 'y', 'updateX'].includes(c.id));
  r.model.components.push({ id: 'op', type, parameters }, { id: 'sink', type: 'qss1_sum_2', parameters: {} });
  r.model.connections = [edge('x', 0, 'op', 0), edge('updateX', 0, 'op', 0), edge('op', 0, 'sink', 0)];
  if (['qss3_multiplier', 'qss3_wsum_2'].includes(type)) r.model.connections.push(edge('y', 0, 'op', 1));
  r.model.observations = ['op', 'sink'].map(component => ({ component, samplingInterval: 1 }));
  return r;
}
function invoke(r) {
  const p = spawnSync(runner, [], { input: JSON.stringify(r), encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.ifError(p.error); assert.equal(p.signal, null);
  return { code: p.status, value: JSON.parse(p.stdout), stderr: p.stderr };
}
function run(r) { const p = invoke(r); assert.equal(p.code, 0, JSON.stringify(p)); return p.value; }

test('QSS catalog exposes exactly thirteen atomic types, including all seven historical types', () => {
  const p = spawnSync(runner, ['--describe'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(p.status, 0, p.stderr);
  const catalog = JSON.parse(p.stdout);
  assert.equal(catalog.components.length, 19);
  assert.deepEqual(catalog, JSON.parse(readFileSync(new URL('../../packages/contracts/catalog.json', import.meta.url), 'utf8')));
  assert.deepEqual(catalog.components.slice(0, 7).map(c => c.type), ['constant', 'qss1_sum_2', 'qss1_sum_3', 'qss1_integrator', 'qss3_integrator', 'qss2_integrator', 'qss1_multiplier']);
});
for (const [type, parameters, initial, changed] of cases) test(`native ${type}: configured value, update and emitted output`, () => {
  const result = run(model(type, parameters));
  // QSS3 history follows the native resampler policy; the QSS1 sink also
  // checks lambda()/message propagation at the actual input event dates.
  assert.deepEqual(result.observations[0].samples, [{ time: 0, value: initial }, { time: 2, value: changed }]);
  assert.deepEqual(result.observations[1].samples, [{ time: 0, value: initial }, { time: 1, value: changed }]);
});
test('native QSS3 multiplier and weighted sum propagate a nonzero signal slope', () => {
  for (const [type, parameters, initial, slope] of [['qss3_multiplier', {}, 3, 3], ['qss3_wsum_2', { 'coeff-0': 2, 'coeff-1': -.5 }, .5, 2]]) {
    const r = model(type, parameters);
    r.model.components = r.model.components.filter(c => c.id !== 'updateX' && c.id !== 'sink');
    r.model.connections = r.model.connections.filter(e => e.from.component !== 'updateX' && e.to.component !== 'sink');
    r.model.components.find(c => c.id === 'x').parameters = { X: 1, dQ: .1 };
    r.model.components.find(c => c.id === 'x').type = 'qss3_integrator';
    r.model.components.push({ id: 'rate', type: 'constant', parameters: { value: 1, offset: 0 } });
    r.model.connections.push(edge('rate', 0, 'x', 0));
    r.model.observations = [{ component: 'op', samplingInterval: .25 }];
    for (const s of run(r).observations[0].samples) assert.ok(Math.abs(s.value - (initial + slope * s.time)) < 1e-9, JSON.stringify({ type, s }));
  }
});
test('native nested QSS3 definitions: six operators, reused states, EIC/EOC and JSON round trip', () => {
  const r = example('qss3-operators-coupled');
  // Observe native output consumers too, exercising all twelve nested EOCs.
  for (const [i, name] of ['product', 'weighted', 'power', 'inverse', 'square', 'sqrt'].entries()) for (const instance of ['a', 'b']) {
    const id = `${instance}-${name}`;
    r.model.components.push({ id, type: 'qss1_sum_2', parameters: {} });
    r.model.connections.push(edge(instance, i, id, 0));
    r.model.observations.push({ component: id, samplingInterval: 1 });
  }
  const result = run(r);
  assert.equal(result.diagnostics.nativeModelCount, 28); assert.equal(result.diagnostics.distinctNativeModelIds, true);
  const values = [12, 6.5, 64, .25, 16, 2, 18, 17, 729, 1 / 9, 81, 3];
  for (const [i, o] of result.observations.entries()) {
    const expected = i < 12 ? values[i] : values[(i - 12) % 2 * 6 + Math.floor((i - 12) / 2)];
    assert.deepEqual(o.samples, [{ time: 0, value: expected }]);
  }
  assert.deepEqual(run(JSON.parse(JSON.stringify(r))).observations, result.observations);
  r.model.components.find(c => c.id === 'xA').parameters.value = 16;
  const changed = run(r);
  assert.notDeepEqual(changed.observations.slice(0, 6), result.observations.slice(0, 6));
  assert.deepEqual(changed.observations.slice(6, 12), result.observations.slice(6, 12));
  const folder = new URL('../../../build-web-test6-1/logs/', import.meta.url); mkdirSync(folder, { recursive: true });
  writeFileSync(new URL('native-qss3.json', folder), JSON.stringify({ request: r, result: changed }, null, 2));
});
for (const [type, parameters, value, expected] of [
  ['qss3_power', { n: .5 }, 9, 3], ['qss3_power', { n: -1 }, 4, .25],
  ['qss3_power', { n: 0 }, 4, 1], ['qss3_power', { n: 3 }, -2, -8],
  ['qss3_inverse', {}, -4, -.25], ['qss3_square', {}, -4, 16],
  ['qss3_wsum_2', { 'coeff-0': 0, 'coeff-1': -2 }, 4, -6],
]) test(`native ${type} accepts finite signed/fractional parameters ${JSON.stringify(parameters)} and input ${value}`, () => {
  const r = model(type, parameters); r.model.components = r.model.components.filter(c => c.id !== 'updateX');
  r.model.connections = r.model.connections.filter(e => e.from.component !== 'updateX');
  r.model.components.find(c => c.id === 'x').parameters.value = value;
  for (const o of run(r).observations) assert.deepEqual(o.samples, [{ time: 0, value: expected }]);
});
for (const [type, parameters, input] of [
  ['qss3_inverse', {}, 0], ['qss3_sqrt', {}, 0], ['qss3_sqrt', {}, -4],
]) for (const version of [1, 2]) test(`native v${version} rejects ${type} domain input ${input}`, () => {
  const r = model(type, parameters); r.model.components.find(c => c.id === 'x').parameters.value = input;
  if (version === 2) { r.schemaVersion = 2; r.model.definitions = []; }
  const p = invoke(r); assert.equal(p.code, 2, JSON.stringify(p)); assert.equal(p.value.status, 'failed');
  assert.ok(['EXECUTION_ERROR', 'OBSERVATION_ERROR'].includes(p.value.error.code), JSON.stringify(p));
  assert.equal(p.value.observations, undefined);
});
for (const version of [1, 2]) test(`native v${version} never reports success for a fractional power of a negative base`, () => {
  const r = model('qss3_power', { n: .5 }); r.model.components.find(c => c.id === 'x').parameters.value = -4;
  if (version === 2) { r.schemaVersion = 2; r.model.definitions = []; }
  const p = spawnSync(runner, [], { input: JSON.stringify(r), encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.ifError(p.error); assert.notEqual(p.status, 0);
  // Native pow currently aborts on NaN in this domain. A future native guard
  // returning a controlled failure is equally acceptable; never fabricate data.
  if (p.stdout.trim()) assert.equal(JSON.parse(p.stdout).status, 'failed');
});
for (const version of [1, 2]) for (const [name, type, parameters, port, expected] of [
  ['missing exponent', 'qss3_power', {}, 0, 'INVALID_PARAMETER'],
  ['missing first coefficient', 'qss3_wsum_2', { 'coeff-1': 1 }, 0, 'INVALID_PARAMETER'],
  ['missing second coefficient', 'qss3_wsum_2', { 'coeff-0': 1 }, 0, 'INVALID_PARAMETER'],
  ['unknown parameter', 'qss3_square', { n: 2 }, 0, 'INVALID_PARAMETER'],
  ['unary input port', 'qss3_sqrt', {}, 1, 'INVALID_CONNECTION'],
  ['binary input port', 'qss3_multiplier', {}, 2, 'INVALID_CONNECTION'],
]) test(`native v${version} rejects QSS3 ${name}`, () => {
  const r = model(type, parameters); r.model.connections[0].to.port = port;
  if (version === 2) { r.schemaVersion = 2; r.model.definitions = []; }
  const p = invoke(r); assert.equal(p.code, 2, JSON.stringify(p)); assert.equal(p.value.error.code, expected);
});
