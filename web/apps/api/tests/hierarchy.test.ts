import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { validateRequest, catalog, type RunRequest, type RunResult } from '../../../packages/contracts/index.js';
const example = (name: string): RunRequest => JSON.parse(readFileSync(resolve(`examples/${name}.json`), 'utf8')) as RunRequest;
const invalid: [string, (r: RunRequest) => void, string][] = [
  ['missing definition', r => { r.model.components[3]!.definition = 'missing'; }, 'DEFINITION_NOT_FOUND'],
  ['interface direction', r => { r.model.definitions![0]!.connections[0]!.from.component = '$output'; }, 'INVALID_EXTERNAL_PORT'],
  ['interface index', r => { r.model.definitions![0]!.inputs[1]!.port = 0; }, 'INVALID_EXTERNAL_PORT'],
  ['scope', r => { r.model.definitions![0]!.connections[0]!.to.component = 'c1'; }, 'INVALID_SCOPE'],
  ['recursive dependency', r => { r.model.definitions![0]!.components.push({ id: 'self', type: 'coupled', definition: 'Sum2Block', parameters: {} }); }, 'RECURSIVE_DEFINITION'],
  ['instance budget', r => { r.limits = { maxInstances: 6 }; }, 'EXPANSION_LIMIT'],
  ['expanded atoms', r => { r.limits = { maxComponents: 4 }; }, 'EXPANSION_LIMIT'],
  ['expanded connections', r => { r.limits = { maxConnections: 3 }; }, 'EXPANSION_LIMIT'],
  ['missing observation', r => { r.model.observations[0]!.component = 'sumB/absent'; }, 'OBSERVATION_ERROR'],
  ['coupled observation', r => { r.model.observations[0]!.component = 'sumB'; }, 'OBSERVATION_ERROR'],
  ['duplicate definition', r => { r.model.definitions!.push(structuredClone(r.model.definitions![0]!)); }, 'INVALID_MODEL'],
  ['unmapped interface', r => { r.model.definitions![0]!.inputs.push({ port: 7, name: 'unused' }); }, 'INVALID_EXTERNAL_PORT'],
];
for (const [name, mutate, code] of invalid) test(`v2 contract and HTTP reject ${name} before launch`, async () => {
  const r = example('hierarchy-sum'); mutate(r);
  assert.throws(() => validateRequest(r), { code });
  let launches = 0;
  const app = buildApp(readConfig(), { describe: async () => catalog, run: async () => { launches++; throw Error('Must not launch'); }, close: async () => {} });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: r });
    assert.equal(response.statusCode, 400, response.body); assert.equal(response.json().error.code, code); assert.equal(launches, 0);
  } finally { await app.close(); }
});
test('v2 contract depth, DAG reuse and dependency cycles are distinct from connection cycles', () => {
  const r = example('hierarchy-nested'); validateRequest(r);
  r.limits = { maxDepth: 1 }; assert.throws(() => validateRequest(r), { code: 'HIERARCHY_DEPTH' });
  delete r.limits;
  r.model.definitions![0]!.components.push({ id: 'back', type: 'coupled', definition: 'CompositeBlock', parameters: {} });
  assert.throws(() => validateRequest(r), { code: 'RECURSIVE_DEFINITION' });
  const feedback = example('hierarchy-sum'); feedback.model.connections.push({ from: { component: 'sumB', port: 0 }, to: { component: 'sumA', port: 0 } }); validateRequest(feedback);
});
test('real TCP HTTP v2 scientific oracles, round trips and new atomic types', { timeout: 60000 }, async () => {
  const app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 });
  const evidence: unknown[] = [];
  async function run(r: RunRequest): Promise<RunResult> {
    const response = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) });
    const result = await response.json() as RunResult;
    assert.equal(response.status, 200, JSON.stringify(result)); evidence.push({ request: r, result }); return result;
  }
  try {
    const flat = await run(example('sum3'));
    for (const name of ['hierarchy-sum', 'hierarchy-nested']) {
      const r = example(name), result = await run(r);
      assert.deepEqual(result.observations[0]!.samples, flat.observations[0]!.samples);
      assert.deepEqual((await run(JSON.parse(JSON.stringify(r)) as RunRequest)).observations, result.observations);
    }
    const r = example('hierarchy-independent'), result = await run(r);
    for (const [i, rate] of [2, -3].entries()) {
      for (const s of result.observations[i]!.samples) assert.ok(Math.abs(s.value - (5 + rate * s.time)) <= .01 + 1e-12);
      const flat = example('qss1_integrator'); flat.model.components[1]!.type = 'qss2_integrator'; flat.model.components[0]!.parameters.value = rate;
      assert.deepEqual(result.observations[i]!.samples, (await run(flat)).observations[0]!.samples);
    }
    assert.deepEqual((await run(r)).observations, result.observations);
    const qss = example('qss1_integrator'); qss.model.components[1]!.type = 'qss2_integrator';
    for (const s of (await run(qss)).observations[0]!.samples) assert.ok(Math.abs(s.value - (5 + 2 * s.time)) <= .01 + 1e-12);
    const product = example('sum2'); product.model.components[2]!.type = 'qss1_multiplier';
    product.model.components[0]!.parameters = { value: 2, offset: 0 }; product.model.components[1]!.parameters = { value: 3, offset: 0 };
    assert.deepEqual((await run(product)).observations[0]!.samples, [{ time: 0, value: 6 }]);
    const feedback = example('hierarchy-sum'); feedback.model.connections.push({ from: { component: 'sumB', port: 0 }, to: { component: 'sumA', port: 0 } }); feedback.limits = { maxRunCalls: 20 };
    const failed = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: feedback }); assert.equal(failed.statusCode, 422); assert.equal(failed.json().error.code, 'LIMIT_EXCEEDED');
    const logdir=resolve(process.env.IRRITATOR_HTTP_EVIDENCE ? resolve(process.env.IRRITATOR_HTTP_EVIDENCE,'hierarchy') : '../build-web-test6/logs');
    mkdirSync(logdir, { recursive: true }); writeFileSync(resolve(logdir,'hierarchy-http.json'), JSON.stringify(evidence, null, 2));
  } finally { await app.close(); }
});
test('HTTP v2 process timeout retains existing error envelope', async () => {
  const app = buildApp({ ...readConfig(), timeoutMs: 10 });
  try { const r = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: example('hierarchy-sum') }); assert.equal(r.statusCode, 504); assert.equal(r.json().error.code, 'ENGINE_TIMEOUT'); }
  finally { await app.close(); }
});
test('v2 preflight counts interface fanout/fanin before launching', () => {
  const m = example('hierarchy-sum');
  const e = (a: string, ap: number, b: string, bp: number) => ({ from: { component: a, port: ap }, to: { component: b, port: bp } });
  const d = m.model.definitions![0]!; d.id = 'Fan'; d.inputs = [{ port: 0, name: 'in' }];
  d.components = ['x', 'y'].map(id => ({ id, type: 'qss1_sum_2', parameters: {} }));
  d.connections = [e('$input', 0, 'x', 0), e('$input', 0, 'y', 0), e('x', 0, '$output', 0), e('y', 0, '$output', 0)];
  m.model.components = [{ id: 'c', type: 'constant', parameters: { value: 2, offset: 0 } }, ...['a', 'b'].map(id => ({ id, type: 'coupled', definition: 'Fan', parameters: {} }))];
  m.model.connections = [e('c', 0, 'a', 0), e('a', 0, 'b', 0)]; m.model.observations = []; m.limits = { maxConnections: 5 };
  assert.throws(() => validateRequest(m), { code: 'EXPANSION_LIMIT' });
});
