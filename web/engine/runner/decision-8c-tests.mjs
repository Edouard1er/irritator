import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aggregation, normalization, fallback, schaeferCampaign, source, document, observe } from './decision-8c-fixture.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { validateRequest, parseWrapperResult } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER;
assert.ok(runner, 'Set IRRITATOR_RUNNER');
let app;
if (process.env.DECISION_8C_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
const last = (r, id) => r.observations.find(o => o.component === id).samples.at(-1).value;
async function run(m, name, expected = 0) {
  validateRequest(m);
  const p = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (process.env.IRRITATOR_8C_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_8C_EVIDENCE, { recursive: true });
    writeFileSync(resolve(process.env.IRRITATOR_8C_EVIDENCE, name + '.process.json'), JSON.stringify({ request: m, exit: p.status, stdout: p.stdout, stderr: p.stderr }, null, 2));
  }
  assert.equal(p.status, expected, p.stdout + p.stderr);
  const result = JSON.parse(p.stdout);
  if (!expected) parseWrapperResult(result, m);
  if (app) {
    const res = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    const json = await res.json(); assert.equal(res.status, expected ? 422 : 200, JSON.stringify(json));
    if (expected) { const { requestId, ...actual } = json; assert.ok(requestId); assert.deepEqual(actual, result); }
    else { const { runId, ...actual } = json; assert.ok(runId); assert.deepEqual(actual, result); }
  }
  if (process.env.IRRITATOR_8C_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_8C_EVIDENCE, { recursive: true });
    writeFileSync(resolve(process.env.IRRITATOR_8C_EVIDENCE, name + '.json'), JSON.stringify({ request: m, result, exit: p.status, stderrBytes: Buffer.byteLength(p.stderr), httpEqualsNative: !!app }, null, 2));
  }
  return result;
}
test('8C A: all five native reductions and variable population', async () => {
  for (const values of [[10, 20, 40], [7], [2, 4, 6, 8, 10]]) {
    const r = await run(aggregation(values), 'aggregate-' + values.length);
    const expected = [Math.min(...values), Math.max(...values), values.reduce((a, b) => a + b, 0), values.reduce((a, b) => a + b, 0) / values.length, values.length];
    ['min', 'max', 'sum', 'mean', 'count'].forEach((id, i) => { assert.equal(last(r, id + 'Result'), expected[i]); assert.equal(last(r, id + 'End'), 1); });
  }
});
test('8C A: empty set has explicit unavailable extrema/mean and zero sum/count', async () => {
  const r = await run(aggregation([]), 'aggregate-empty');
  for (const id of ['min', 'max', 'mean']) assert.equal(last(r, id + 'End'), 0);
  for (const id of ['sum', 'count']) { assert.equal(last(r, id + 'End'), 1); assert.equal(last(r, id + 'Result'), 0); }
});
test('8C A: replacements before closure count distinct candidates rather than messages', async () => {
  const m = aggregation();
  for (const id of ['min', 'max', 'sum', 'mean', 'count']) source(m, id, 0, 99, 0, 1, .01);
  const r = await run(m, 'aggregate-replacement');
  for (const [id, expected] of Object.entries({ minResult: 20, maxResult: 99, sumResult: 159, meanResult: 53, countResult: 3 })) assert.equal(last(r, id), expected);
});
test('8C B: normalize in a reusable coupled definition and retain keyed rows', async () => {
  const m = normalization(), r = await run(m, 'normalize'); assert.equal(last(r, 'ratioReceipt'), 1); assert.equal(last(r, 'end'), 3);
  for (const expected of [.25, .5, 1]) assert.ok(r.observations.find(o => o.component === 'ratioReceipt').samples.some(s => Math.abs(s.value - expected) < 1e-12));
  // Read each key in a separate request to inspect values without sampled FIFO collapse.
  for (const [i, expected] of [.25, .5, 1].entries()) {
    const copy = normalization();
    const reads = copy.model.connections.filter(e => e.to.component === 'scores' && e.to.port === 1);
    copy.model.connections = copy.model.connections.filter(e => !reads.includes(e) || e === reads[i]);
    assert.equal(last(await run(copy, 'normalize-key-' + i), 'ratioReceipt'), expected);
  }
});
test('8C B: zero maximum gives invalid division and no successful result', async () => {
  const r = await run(normalization([0, 0]), 'normalize-zero'); assert.equal(last(r, 'end'), 0);
});
test('8C B: shared coupled definition has independent campaign runtime per occurrence', async () => {
  const m = normalization();
  m.model.components.push({ id: 'other', type: 'coupled', parameters: {}, definition: 'NormalizeCampaign' }, atom('otherScores', 'value_memory'));
  [4, 8].forEach((v, i) => source(m, 'other', 0, v, i, 1)); source(m, 'other', 1, 2, 0, 1, .05);
  m.model.connections.push(edge('other', 0, 'otherScores', 0)); source(m, 'otherScores', 1, 0, 0, 1, 1.8); observe(m, 'otherScores', 0, 'otherRatio');
  const r = await run(m, 'shared-normalization'); assert.equal(last(r, 'ratioReceipt'), 1); assert.equal(last(r, 'otherRatio'), .5);
});
test('8C C: admissibility, lexicographic secondary and numeric identity ties', async () => {
  let r = await run(fallback(), 'primary'); assert.equal(last(r, 'action'), 300); assert.equal(last(r, 'identity'), 2); assert.equal(last(r, 'score'), 20); assert.equal(last(r, 'secondary'), 4); assert.equal(last(r, 'selected'), 1);
  r = await run(fallback([1, 1, 1], [5, 5, 5], [9, 9, 9], [20, 10, 30]), 'numeric-tie'); assert.equal(last(r, 'identity'), 10); assert.equal(last(r, 'action'), 1100);
  const m = fallback(); m.model.definitions[0].components.find(c => c.id === 'primary').parameters.secondaryDirection = 1;
  r = await run(m, 'secondary-min'); assert.equal(last(r, 'identity'), 1);
});
test('8C D: no admissible candidate chooses a real secondary candidate and original action', async () => {
  const r = await run(fallback([0, 0, 0]), 'real-fallback'); assert.equal(last(r, 'identity'), 0); assert.equal(last(r, 'action'), 100); assert.equal(last(r, 'selected'), 1); assert.equal(last(r, 'score'), 9); assert.equal(last(r, 'secondary'), 10);
});
test('8C D: configurable branch priority and empty branches', async () => {
  const m = fallback(); m.model.definitions[0].components.find(c => c.id === 'priority').parameters.primaryPriority = 2;
  const r = await run(m, 'priority-inverted'); assert.equal(last(r, 'identity'), 0);
  const empty = await run(fallback([], [], [], []), 'selection-empty'); assert.equal(last(empty, 'identity'), -1); assert.equal(last(empty, 'selected'), 0); assert.equal(last(empty, 'end'), 0);
});
test('8C E: overlapping campaigns with early end, delayed aggregate and reused candidate keys', async () => {
  const m = document('overlap', [atom('max', 'campaign_aggregate', { operation: 1, capacity: 4 }), atom('join', 'campaign_broadcast', { capacity: 4 }), atom('ratio', 'event_operator', { operation: 4, required: 3, capacity: 4 })], [edge('max', 0, 'join', 1), edge('max', 2, 'join', 3), edge('join', 0, 'ratio', 0), edge('join', 1, 'ratio', 1), edge('join', 2, 'ratio', 3)]);
  for (const campaign of [1, 2]) {
    for (const [i, v] of (campaign === 1 ? [10, 40] : [6, 12]).entries()) { source(m, 'max', 0, v, i, campaign, campaign === 1 ? .6 : .2); source(m, 'join', 0, v, i, campaign, .1); }
    source(m, 'max', 1, 2, 0, campaign); source(m, 'join', 2, 2, 0, campaign);
  }
  m.model.components.push(atom('memory', 'value_memory')); m.model.connections.push(edge('ratio', 0, 'memory', 0));
  source(m, 'memory', 1, 0, 0, 1, 1); source(m, 'memory', 1, 0, 0, 2, 1.5);
  observe(m, 'ratio', 2, 'end'); observe(m, 'memory', 0, 'value');
  const r = await run(m, 'overlap'); assert.equal(last(r, 'end'), 2); assert.equal(last(r, 'value'), .5);
});
test('8C: missing closure stays passive, capacity and incoherent counts fail', async () => {
  const missing = aggregation([10]); missing.model.connections = missing.model.connections.filter(e => !['min', 'max', 'sum', 'mean', 'count'].includes(e.to.component) || e.to.port !== 1);
  const r = await run(missing, 'missing-end'); assert.equal(last(r, 'sumResult'), 0); assert.equal(last(r, 'sumEnd'), 0);
  const m = aggregation(); m.model.components.find(c => c.id === 'max').parameters.capacity = 2; await run(m, 'capacity', 2);
  const incoherent = aggregation(); source(incoherent, 'max', 1, 2, 0, 1, 0); await run(incoherent, 'incoherent', 2);
});
test('8C: six Schaefer rows, relative weighted score, constraint and real fallback', async () => {
  for (const [weight, threshold] of [[.5, 140], [.5, 120], [1, 120], [0, 140], [.5, 160]]) {
    const m = schaeferCampaign({ weight, threshold }), r = await run(m, `schaefer-${weight}-${threshold}`);
    const source = JSON.parse(readFileSync(new URL('../../model-test/schaefer-six-scenarios.source.json', import.meta.url), 'utf8'));
    assert.deepEqual(m.model.definitions[0], source.model.definitions[0]);
    const rows = Array.from({ length: 6 }, (_, i) => Object.fromEntries([['action', 5], ['n', 7], ['ch', 8]].map(([name, port]) => [name, r.resultEvents.find(e => e.port === port && e.value[1] === i).value[0]])));
    const max = Math.max(...rows.map(row => row.ch));
    const ranked = rows.map((row, id) => ({ ...row, id, score: weight * row.ch / max + (1 - weight) * (row.n - 140) / 140 }));
    let accepted = ranked.filter(row => row.n >= threshold), winner;
    if (accepted.length) winner = accepted.sort((a, b) => b.score - a.score || b.n - a.n || a.id - b.id)[0];
    else winner = ranked.sort((a, b) => b.n - a.n || b.score - a.score || a.id - b.id)[0];
    assert.equal(last(r, 'identity'), winner.id); assert.equal(last(r, 'action'), winner.action); assert.equal(last(r, 'selected'), 1);
    assert.ok(Math.abs(last(r, 'score') - (accepted.length ? winner.score : winner.n)) < 1e-12);
  }
});
test('8C: JSON export/import produces identical results', async () => {
  for (const m of [aggregation(), normalization(), fallback(), schaeferCampaign()]) assert.deepEqual(await run(JSON.parse(JSON.stringify(m)), m.model.id + '-roundtrip'), await run(m, m.model.id + '-original'));
});
