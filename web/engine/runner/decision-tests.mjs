import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { atom, edge, memory, comparison, selection, prospective } from './decision-fixtures.mjs';
import { validateRequest, parseWrapperResult, wrapperOutputs } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER;
assert.ok(runner, 'Set IRRITATOR_RUNNER to the newly compiled executable');
export function run(m) {
  validateRequest(m);
  const r = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const result = JSON.parse(r.stdout);
  if (m.schemaVersion === 3) parseWrapperResult(result, m);
  return result;
}
const last = (r, id) => r.observations.find(o => o.component === id).samples.at(-1).value;
test('A: write, delayed read and periodic observation requests are native events', () => {
  const m = memory(), r = run(m);
  assert.equal(last(r, 'received'), 42);
  m.model.components.find(c => c.id === 'read').type = 'generator';
  m.model.components.find(c => c.id === 'read').parameters = { period: 0.5, value: 0 };
  assert.equal(last(run(m), 'received'), 42);
});
for (const b of [3, 5, 7]) test(`B: comparisons >, <, == against ${b}`, () => {
  const m = comparison(); m.model.components[1].parameters.value = b;
  assert.deepEqual(run(m).observations.map(o => o.samples.at(-1).value), [Number(5 > b), Number(5 < b), Number(5 === b)]);
});
test('C: candidate identities/actions remain joined; lowest identity wins ties', () => {
  const m = selection(); assert.equal(last(run(m), 'received0'), 100);
  m.model.definitions[0].components.find(c => c.id === 'filter').parameters.required = 2;
  assert.equal(last(run(m), 'received0'), 100); // score is implicitly required
  m.model.components.reverse(); m.model.connections.reverse();
  assert.equal(last(run(m), 'received0'), 100);
});
test('D: condition, filtering and fallback are composed in a coupled definition', () => {
  assert.equal(last(run(selection(8)), 'received0'), 100);
  assert.equal(last(run(selection(10)), 'received0'), -7);
});
test('filter uses final admissibility at end, including a condition changed before closure', () => {
  const m = selection(0);
  m.model.components.find(c => c.id === 'end').parameters.offset = 1.5;
  const d = m.model.definitions[0];
  d.components = d.components.filter(c => c.id !== 'condition');
  d.connections = d.connections.filter(e => e.from.component !== 'condition' && e.to.component !== 'condition');
  d.components.push(atom('initial', 'constant', { value: 1 }), atom('changed', 'constant', { value: 0, offset: 1 }));
  for (let i = 0; i < 3; ++i) {
    d.components.push(atom('cond' + i, 'event_tag', { identity: [20, 10, 30][i] }));
    d.connections.push(edge('initial', 0, 'cond' + i, 0), edge('changed', 0, 'cond' + i, 0), edge('cond' + i, 0, 'filter', 2));
  }
  assert.equal(last(run(m), 'received0'), -7);
});
test('F: two coupled decision models share the inputs and produce different actions', () => {
  const r = run(selection(undefined, true)); assert.equal(last(r, 'received0'), 100); assert.equal(last(r, 'received1'), 200);
});
test('E: external parent selects the opposite action from all raw prospective rows', () => {
  const m = prospective(), r = run(m), outputs = wrapperOutputs(m.model.components[1].experiment);
  assert.equal(last(r, 'rate'), 1); assert.equal(last(r, 'action'), -1);
  for (const p of outputs.filter(p => p.kind.startsWith('scenario-'))) {
    const events = r.resultEvents.filter(e => e.port === p.port);
    assert.equal(events.length, 3); assert.deepEqual(events.map(e => e.value[1]), [0, 1, 2]);
    assert.ok(events.every(e => e.time === 1 && e.value[2] === 1));
  }
  assert.deepEqual(r.resultEvents.at(-1).value, [3, 3, 1]);
  assert.ok(r.resultEvents.filter(e => e.port >= 3).every((e, i, a) => i === 0 || e.bag > a[i - 1].bag));
});
test('raw rows stay raw under weighted-sum and the legacy optimum stays normalized', () => {
  const m = prospective(); m.model.components[1].experiment.objective = { method: 'weighted-sum', type: 'maximize', weights: [1, 0], types: ['maximize', 'maximize'], norm: 'min-max' };
  const r = run(m); assert.equal(r.resultEvents.find(e => e.port === 0).value[0], 1);
  assert.deepEqual(r.resultEvents.filter(e => e.port === 5).map(e => e.value[0]), [-1, 1, 3]);
  assert.equal(last(r, 'action'), -1);
});
test('external decision still receives all rows when the internal optimizer rejects every candidate', () => {
  const m = prospective(); m.model.components[1].experiment.objective = { method: 'epsilon-constrained', type: 'maximize', primary: 'terminal', epsilons: [0, 1000], operations: ['greater-equal', 'greater-equal'] };
  const r = run(m); assert.equal(r.resultEvents.filter(e => e.port < 3).length, 0); assert.equal(last(r, 'action'), -1);
});
test('result contract rejects lost rows, corrupted identities and inconsistent end counts', () => {
  const m = prospective(), r = run(m);
  for (const mutate of [r => { r.resultEvents.find(e => e.port === 5).value[1] = 100; }, r => { r.resultEvents.at(-1).value[0] = 2; }, r => { r.resultEvents.splice(r.resultEvents.findIndex(e => e.port === 4), 1); }]) {
    const corrupt = structuredClone(r); mutate(corrupt); assert.throws(() => parseWrapperResult(corrupt, m));
  }
});
test('more than six scenarios, repeated campaigns and delayed immutable snapshots', () => {
  const m = prospective(), wrapper = m.model.components[1]; wrapper.experiment.factors[0].values = Array.from({ length: 9 }, (_, i) => i - 4);
  m.model.components.push(atom('again', 'constant', { offset: 1.5, value: 0 })); m.model.connections.push(edge('again', 0, 'decision', 1));
  const r = run(m), ends = r.resultEvents.filter(e => e.port === 7);
  assert.deepEqual(ends.map(e => e.value), [[9, 9, 1], [9, 9, 2]]); assert.equal(last(r, 'action'), -4);
  const delayed = prospective(); delayed.model.components[0].parameters.value = 0.5;
  const d = run(delayed); assert.ok(d.resultEvents.every(e => e.time === 1.5));
});
test('overlapping responses retain their own actual factors and criteria', () => {
  const m = prospective(); m.model.components[0].parameters.value = 1;
  m.model.components.push(atom('override', 'constant', { value: 7, offset: 1.2 }), atom('again', 'constant', { value: 0, offset: 1.3 }));
  m.model.connections.push(edge('override', 0, 'decision', 2), edge('again', 0, 'decision', 1));
  const r = run(m), factors = campaign => r.resultEvents.filter(e => e.port === 4 && e.value[2] === campaign);
  assert.deepEqual(factors(1).map(e => e.value[0]), [-1, 0, 1]); assert.ok(factors(1).every(e => e.time === 2));
  assert.deepEqual(factors(2).map(e => e.value[0]), [7, 7, 7]); assert.ok(factors(2).every(e => e.time === 1.3));
  assert.equal(last(r, 'action'), -1);
});
test('completed campaigns release keyed storage for subsequent campaigns', () => {
  const m = prospective();
  for (let i = 1; i < 50; ++i) { m.model.components.push(atom('run' + i, 'constant', { offset: 1 + i * 0.03 })); m.model.connections.push(edge('run' + i, 0, 'decision', 1)); }
  const r = run(m); assert.equal(r.resultEvents.filter(e => e.port === 7).length, 50); assert.equal(last(r, 'action'), -1);
});
test('safe division excludes invalid results and causes fallback through an empty barrier', () => {
  const m = prospective(), op = m.model.components.find(c => c.id === 'score'); op.parameters.operation = 4; op.parameters.right = 0;
  assert.equal(last(run(m), 'action'), -7);
});
test('numeric operations, logic, extrema and normalization run in the native engine', () => {
  const cases = [[0, 6], [1, 8], [2, 4], [3, 12], [4, 3], [5, 2], [6, 6], [7, 1], [8, 0], [9, 0], [10, 1], [11, 0], [12, 1], [13, 1], [14, 1], [15, 0], [16, 6], [17, 36], [18, Math.sqrt(6)], [19, Math.log(6)], [20, Math.exp(6)], [21, -1]];
  // This JavaScript table is only an oracle, never a production evaluator.
  const m = comparison();
  m.model.components = [atom('a', 'constant', { value: 6 }), atom('b', 'constant', { value: 2 }), ...cases.map(([operation], i) => atom('op' + i, 'event_operator', { operation, left: 4, required: 3 }))];
  m.model.connections = cases.flatMap((_, i) => [edge('a', 0, 'op' + i, 0), edge('b', 0, 'op' + i, 1)]);
  m.model.observations = cases.map((_, i) => ({ component: 'op' + i, samplingInterval: 0.1 }));
  const r = run(m);
  for (const [i, [, expected]] of cases.entries()) assert.ok(Math.abs(last(r, 'op' + i) - expected) < 1e-9);
});
test('memory replaces values and reset restores initial state; computation can wait for a command', () => {
  const m = memory();
  m.model.components.push(atom('replace', 'constant', { value: 7, offset: 0.5 }), atom('reset', 'constant', { offset: 1.5 }), atom('readAgain', 'constant', { offset: 2 }));
  m.model.connections.push(edge('replace', 0, 'memory', 0), edge('reset', 0, 'memory', 2), edge('readAgain', 0, 'memory', 1));
  assert.equal(last(run(m), 'received'), 0);
  const c = comparison(); const op = c.model.components[2]; op.parameters.automatic = 0;
  c.model.components.push(atom('command', 'constant', { offset: 1 })); c.model.connections.push(edge('command', 0, 'greater', 2));
  assert.equal(last(run(c), 'greater'), 1);
});
test('JSON validators reject fractional modes and capacities in every version', () => {
  for (const schemaVersion of [1, 2, 3]) {
    const m = memory(); m.schemaVersion = schemaVersion; if (schemaVersion > 1) m.model.definitions = [];
    m.model.components[2].parameters.capacity = 1.5;
    assert.throws(() => validateRequest(m));
    const r = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true });
    assert.notEqual(r.status, 0); assert.equal(JSON.parse(r.stdout).error.code, 'INVALID_PARAMETER');
  }
});
test('integral numeric parameters accept JSON decimal and exponent representations without narrowing assertions', () => {
  const m = memory(); validateRequest(m);
  const input = JSON.stringify(m).replace('"capacity":128', '"capacity":1.28e2').replace('"emitOnWrite":0', '"emitOnWrite":0.0');
  const r = spawnSync(runner, [], { input, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(last(JSON.parse(r.stdout), 'received'), 42);
});
test('all delivered examples roundtrip through JSON and native execution', () => {
  for (const name of ['memory', 'comparison', 'selection', 'constraint', 'fallback', 'reuse', 'prospective']) {
    const m = JSON.parse(readFileSync(new URL(`../../examples/decision-${name}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(run(m), run(JSON.parse(JSON.stringify(m))));
  }
});
