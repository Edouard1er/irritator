import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { catalog, validateRequest, type RunRequest, type RunResult } from '../../../packages/contracts/index.js';

const example = (version: 1 | 2): RunRequest => JSON.parse(readFileSync(resolve(`examples/qss3-operators${version === 2 ? '-coupled' : ''}.json`), 'utf8')) as RunRequest;
const atoms = (r: RunRequest) => r.schemaVersion === 1 ? r.model.components : r.model.definitions![0]!.components;
const component = (r: RunRequest, type: string) => atoms(r).find(c => c.type === type)!;
const invalid: [string, (r: RunRequest) => void, string][] = [
  ['missing n', r => { delete component(r, 'qss3_power').parameters.n; }, 'INVALID_PARAMETER'],
  ['missing coeff-0', r => { delete component(r, 'qss3_wsum_2').parameters['coeff-0']; }, 'INVALID_PARAMETER'],
  ['missing coeff-1', r => { delete component(r, 'qss3_wsum_2').parameters['coeff-1']; }, 'INVALID_PARAMETER'],
  ...['qss3_multiplier', 'qss3_inverse', 'qss3_square', 'qss3_sqrt'].map(type => [`extra parameter ${type}`, (r: RunRequest) => { component(r, type).parameters.n = 1; }, 'INVALID_PARAMETER'] as [string, (r: RunRequest) => void, string]),
  ['out of bounds n', r => { component(r, 'qss3_power').parameters.n = 1e13; }, 'INVALID_MODEL'],
  ['out of bounds coefficient', r => { component(r, 'qss3_wsum_2').parameters['coeff-1'] = -1e13; }, 'INVALID_MODEL'],
  ['unary input port', r => { const scope = r.schemaVersion === 1 ? r.model : r.model.definitions![0]!; scope.connections.find(e => e.to.component === 'sqrt')!.to.port = 1; }, 'INVALID_CONNECTION'],
  ['binary input port', r => { const scope = r.schemaVersion === 1 ? r.model : r.model.definitions![0]!; scope.connections.find(e => e.to.component === 'product')!.to.port = 2; }, 'INVALID_CONNECTION'],
];
for (const version of [1, 2] as const) for (const [name, mutate, code] of invalid) test(`QSS3 v${version}: contract and HTTP reject ${name} before process launch`, async () => {
  const r = example(version); mutate(r); assert.throws(() => validateRequest(r), { code });
  let launches = 0;
  const app = buildApp(readConfig(), { describe: async () => catalog, run: async () => { launches++; throw Error('Unexpected native launch'); }, close: async () => {} });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: r });
    assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().error.code, code); assert.equal(launches, 0);
  } finally { await app.close(); }
});
test('QSS3 v1/v2 reject nonfinite exponents and coefficients without coercion or default insertion', () => {
  for (const version of [1, 2] as const) for (const value of [NaN, Infinity, -Infinity]) for (const [type, key] of [['qss3_power', 'n'], ['qss3_wsum_2', 'coeff-0']]) {
    const r = example(version); component(r, type!).parameters[key!] = value;
    assert.throws(() => validateRequest(r), { code: 'INVALID_MODEL' });
  }
});

test('real TCP HTTP: thirteen types, all six QSS3 operators, v1/v2, parameters and import/export', { timeout: 60000 }, async () => {
  const app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 });
  const evidence: unknown[] = [];
  async function run(r: RunRequest): Promise<RunResult> {
    const response = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) });
    const result = await response.json() as RunResult;
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.status, 'completed');
    assert.equal(result.simulation.finalTime, r.simulation.end); evidence.push({ request: structuredClone(r), result }); return result;
  }
  try {
    const response = await fetch(`${app.listeningOrigin}/api/v1/components`);
    assert.equal(response.status, 200); const received = await response.json() as typeof catalog;
    assert.deepEqual(received, catalog); assert.equal(received.components.length, 25);
    const expected = [[12, 27, 18], [6.5, 16.5, 17], [64, 729], [.25, 1 / 9], [16, 81], [2, 3]];
    const flat = await run(example(1));
    for (const [i, o] of flat.observations.entries()) assert.deepEqual(o.samples.map(s => s.value), expected[i]);
    assert.deepEqual((await run(JSON.parse(JSON.stringify(example(1))) as RunRequest)).observations, flat.observations);
    const request = example(2), nested = await run(request);
    for (const [i, o] of nested.observations.entries()) assert.deepEqual(o.samples, [{ time: 0, value: expected[i % 6]![i < 6 ? 0 : expected[i % 6]!.length - 1] }]);
    assert.deepEqual((await run(JSON.parse(JSON.stringify(request)) as RunRequest)).observations, nested.observations);
    component(request, 'qss3_power').parameters.n = 2;
    component(request, 'qss3_wsum_2').parameters = { 'coeff-0': 4, 'coeff-1': -.25 };
    const changed = await run(request);
    assert.deepEqual(changed.observations[1]!.samples, [{ time: 0, value: 15.25 }]);
    assert.deepEqual(changed.observations[2]!.samples, [{ time: 0, value: 16 }]);
    assert.deepEqual(changed.observations[7]!.samples, [{ time: 0, value: 35.5 }]);
    assert.deepEqual(changed.observations[8]!.samples, [{ time: 0, value: 81 }]);
    // Exercise controlled native failures (422) and the existing isolation of
    // non-finite observations (422). Validation must not throw through the
    // noexcept history reader and turn a numeric-domain error into an abort.
    // No successful partial data is returned.
    for (const version of [1, 2] as const) for (const [type, input] of [['qss3_inverse', 0], ['qss3_sqrt', 0], ['qss3_sqrt', -4], ['qss3_power', -4]] as const) {
      const r = example(1); const op = component(r, type); if (type === 'qss3_power') op.parameters.n = .5;
      r.model.components = [r.model.components[0]!, op]; r.model.components[0]!.parameters.value = input;
      r.model.connections = [{ from: { component: 'x', port: 0 }, to: { component: op.id, port: 0 } }];
      r.model.observations = [{ component: op.id, samplingInterval: 1 }];
      if (version === 2) { r.schemaVersion = 2; r.model.definitions = []; }
      const response = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) });
      const error = await response.json() as { status: string; error: { code: string }; observations?: unknown };
      assert.equal(response.status, 422, JSON.stringify(error)); assert.equal(error.status, 'failed');
      assert.ok((type === 'qss3_power' ? ['OBSERVATION_ERROR'] : ['EXECUTION_ERROR', 'OBSERVATION_ERROR']).includes(error.error.code)); assert.equal(error.observations, undefined);
      evidence.push({ request: r, httpStatus: response.status, result: error });
    }
    assert.deepEqual((await run(example(2))).observations, nested.observations);
    mkdirSync(resolve('../build-web-test6-1/logs'), { recursive: true });
    writeFileSync(resolve('../build-web-test6-1/logs/qss3-http.json'), JSON.stringify(evidence, null, 2));
  } finally { await app.close(); }
});
