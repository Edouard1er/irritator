import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const runner = process.env.IRRITATOR_RUNNER ?? fileURLToPath(new URL('../../../build-web-test4/runner/irritator-runner.exe', import.meta.url));
const example = name => JSON.parse(readFileSync(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const invoke = r => {
  const p = spawnSync(runner, [], { input: JSON.stringify(r), encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.ifError(p.error); assert.ok(p.stdout, p.stderr);
  return { ...p, result: JSON.parse(p.stdout) };
};
const run = r => { const p = invoke(r); assert.equal(p.status, 0, p.stderr); return p.result; };
const values = r => r.observations[0].samples;
// Native QSS2 uses Hermite resampling. Its initial derivative changes at t=0;
// the first interpolation segment includes the initial zero derivative.
// For X=5, |rate|=2, dQ=.25, dt=.1 the measured maximum error is .008.
// Keep a .01 analytic bound, require 1e-9 at reference times and exact flat parity.
const affine = (samples, rate) => {
  for (const s of samples) {
    assert.ok(Math.abs(s.value - (5 + rate * s.time)) <= .01 + 1e-12, JSON.stringify(s));
    if (s.time === 0 || s.time >= 1) assert.ok(Math.abs(s.value - (5 + rate * s.time)) <= 1e-9, JSON.stringify(s));
  }
};
for (const name of ['hierarchy-sum', 'hierarchy-nested']) test(`C++ project::set: ${name}, native interfaces and flat oracle`, () => {
  const model = example(name), result = run(model), flat = run(example('sum3'));
  assert.deepEqual(values(result), values(flat));
  assert.deepEqual(values(result), [{ time: 0, value: 10 }, { time: 1, value: 110 }, { time: 2, value: 1110 }]);
  assert.equal(result.simulation.runCalls, 14);
  assert.equal(result.diagnostics.nativeModelCount, 5);
  assert.equal(result.diagnostics.distinctNativeModelIds, true);
  assert.deepEqual(run(JSON.parse(JSON.stringify(model))).observations, result.observations);
});
test('C++ project::set: independent QSS2 states and reproducible initialization', () => {
  const model = example('hierarchy-independent'), result = run(model);
  for (const [i, rate] of [2, -3].entries()) {
    affine(result.observations[i].samples, rate);
    const flat = example('qss1_integrator'); flat.model.components[1].type = 'qss2_integrator'; flat.model.components[0].parameters.value = rate;
    assert.deepEqual(result.observations[i].samples, values(run(flat)));
  }
  assert.equal(result.observations[0].component, 'up/state'); assert.equal(result.observations[1].component, 'down/state');
  assert.deepEqual(run(model).observations, result.observations);
  // Change one input only. The other trajectory must remain identical.
  model.model.components[0].parameters.value = 7;
  assert.deepEqual(run(model).observations[1], result.observations[1]);
});
for (const rate of [-2, 0, 2]) test(`C++ catalogue QSS2: X=5+${rate}t`, () => {
  const m = example('qss1_integrator'); m.model.components.find(c => c.type.includes('integrator')).type = 'qss2_integrator';
  m.model.components.find(c => c.type === 'constant').parameters.value = rate;
  affine(values(run(m)), rate);
});
test('C++ catalogue multiplier: two held native inputs, product 6 then 10', () => {
  const m = example('sum2'); m.model.components.find(c => c.type.includes('sum')).type = 'qss1_multiplier';
  const constants = m.model.components.filter(c => c.type === 'constant'); constants[0].parameters = { value: 2, offset: 0 }; constants[1].parameters = { value: 3, offset: 0 };
  m.model.components.push({ id: 'update', type: 'constant', parameters: { value: 5, offset: 1 } });
  m.model.connections.push({ from: { component: 'update', port: 0 }, to: { component: 'sum', port: 1 } });
  assert.deepEqual(values(run(m)), [{ time: 0, value: 6 }, { time: 1, value: 10 }]);
});
const invalid = [
  ['missing definition', m => { m.model.components[3].definition = 'absent'; }, 'DEFINITION_NOT_FOUND'],
  ['external port', m => { m.model.definitions[0].connections[0].from.port = 9; }, 'INVALID_EXTERNAL_PORT'],
  ['scope', m => { m.model.definitions[0].connections[0].to.component = 'c1'; }, 'INVALID_SCOPE'],
  ['duplicate child', m => { m.model.components[1].id = 'c1'; }, 'INVALID_MODEL'],
  ['recursive definition', m => { m.model.definitions[0].components.push({ id: 'self', type: 'coupled', definition: 'Sum2Block', parameters: {} }); }, 'RECURSIVE_DEFINITION'],
  ['depth', m => { m.limits = { maxDepth: 1 }; m.model.definitions.push({ id: 'outer', name: 'outer', inputs: [], outputs: [], components: [{ id: 'inner', type: 'coupled', definition: 'Sum2Block', parameters: {} }], connections: [] }); }, 'HIERARCHY_DEPTH'],
  ['instances', m => { m.limits = { maxInstances: 6 }; }, 'EXPANSION_LIMIT'],
  ['expanded atoms', m => { m.limits = { maxComponents: 4 }; }, 'EXPANSION_LIMIT'],
  ['expanded connections', m => { m.limits = { maxConnections: 3 }; }, 'EXPANSION_LIMIT'],
  ['observation path', m => { m.model.observations[0].component = 'sumB/absent'; }, 'OBSERVATION_ERROR'],
  ['observe coupled', m => { m.model.observations[0].component = 'sumB'; }, 'OBSERVATION_ERROR'],
  ['root interface', m => { m.model.connections[0].from.component = '$input'; }, 'INVALID_EXTERNAL_PORT'],
  ['unmapped interface', m => { m.model.definitions[0].inputs.push({ port: 7, name: 'unused' }); }, 'INVALID_EXTERNAL_PORT'],
];
for (const [name, mutate, code] of invalid) test(`C++ hierarchy rejects ${name} before native allocation`, () => {
  const m = example('hierarchy-sum'); mutate(m); const p = invoke(m);
  assert.equal(p.status, 2, p.stderr); assert.equal(p.result.error.code, code, p.stdout);
});
test('C++ hierarchy permits DEVS feedback and enforces scheduler budget', () => {
  const m = example('hierarchy-sum');
  m.model.connections.push({ from: { component: 'sumB', port: 0 }, to: { component: 'sumA', port: 0 } }); m.limits = { maxRunCalls: 20 };
  const p = invoke(m); assert.equal(p.status, 2); assert.equal(p.result.error.code, 'LIMIT_EXCEEDED');
});
test('C++ hierarchy budgets the Cartesian product of interface fanout/fanin', () => {
  const m = example('hierarchy-sum');
  const e = (a, ap, b, bp) => ({ from: { component: a, port: ap }, to: { component: b, port: bp } });
  const d = m.model.definitions[0]; d.id = 'Fan'; d.inputs = [{ port: 0, name: 'in' }];
  d.components = ['x', 'y'].map(id => ({ id, type: 'qss1_sum_2', parameters: {} }));
  d.connections = [e('$input', 0, 'x', 0), e('$input', 0, 'y', 0), e('x', 0, '$output', 0), e('y', 0, '$output', 0)];
  m.model.components = [{ id: 'c', type: 'constant', parameters: { value: 2, offset: 0 } }, ...['a', 'b'].map(id => ({ id, type: 'coupled', definition: 'Fan', parameters: {} }))];
  m.model.connections = [e('c', 0, 'a', 0), e('a', 0, 'b', 0)]; m.model.observations = []; m.limits = { maxConnections: 5 };
  // Only two root edges, but 2 + 2*2 = 6 executable edges.
  assert.equal(invoke(m).result.error.code, 'EXPANSION_LIMIT');
});
