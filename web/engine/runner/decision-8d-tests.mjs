import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { feedback } from './decision-8d-fixture.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { validateRequest, parseWrapperResult, catalog } from '../../dist/packages/contracts/index.js';
const runner = process.env.IRRITATOR_RUNNER;
assert.ok(runner, 'Set IRRITATOR_RUNNER');
let app;
if (process.env.DECISION_8D_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
async function run(m, name, expected = 0) {
  validateRequest(m);
  const p = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(p.status, expected, p.stdout + p.stderr);
  const result = JSON.parse(p.stdout);
  if (!expected) { parseWrapperResult(result, m); assert.ok(result.simulation.runCalls < 10000, 'finite DEVS chain'); }
  if (!expected) assert.equal(p.stderr, '', 'scientific execution must not pollute stderr');
  else { assert.match(p.stderr, /^[A-Z_]+:/); assert.ok(Buffer.byteLength(p.stderr) < 1024, 'bounded error diagnostic'); }
  if (app) {
    const res = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    const json = await res.json(); assert.equal(res.status, expected ? 422 : 200, JSON.stringify(json));
    const { runId, requestId, ...actual } = json; assert.ok(expected ? requestId : runId); assert.deepEqual(actual, result);
  }
  if (process.env.IRRITATOR_8D_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_8D_EVIDENCE, { recursive: true });
    writeFileSync(resolve(process.env.IRRITATOR_8D_EVIDENCE, name + '.json'), JSON.stringify({ request: m, result, exit: p.status, stderrBytes: Buffer.byteLength(p.stderr), httpEqualsNative: !!app }, null, 2));
  }
  return result;
}
const wrapper = m => m.model.components.find(c => c.id === 'forecast');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const last = (r, id) => r.observations.find(o => o.component === id).samples.at(-1).value;
// Published histories are resampled and deduplicated, not a DEVS event log.
// Exact dates/actions are checked by native-wrapper-feedback-loop instead.
const contains = (r, id, value) => assert.ok(r.observations.find(o => o.component === id).samples.some(s => Math.abs(s.value - value) < 1e-9), `${id} never shows ${value}`);
const rows = (r, campaign, port) => r.resultEvents.filter(e => e.port === port && e.value[2] === campaign).sort((a, b) => a.value[1] - b.value[1]);
function checkCampaign(r, campaign, time, initial) {
  for (const e of rows(r, campaign, 4)) { close(e.time, time); close(e.value[0], initial); }
  assert.equal(rows(r, campaign, 4).length, 3);
  rows(r, campaign, 5).forEach((e, i) => close(e.value[0], [-1, 0, 1][i]));
  rows(r, campaign, 6).forEach((e, i) => close(e.value[0], initial + 2 * [-1, 0, 1][i]));
  assert.deepEqual(rows(r, campaign, 7).map(e => e.value), [[3, 3, campaign]]);
}
test('8D: exposed native ports, delivered JSON and export/import', async () => {
  assert.deepEqual(catalog.components.find(c => c.type === 'state_observer').inputs.map(p => p.name), ['source', 'read', 'reset']);
  assert.deepEqual(catalog.components.find(c => c.type === 'zero_order_hold').parameters, {});
  const m = feedback(), saved = JSON.parse(readFileSync(new URL('../../examples/decision-feedback-minimal-v3.json', import.meta.url), 'utf8'));
  assert.deepEqual(m, saved);
  assert.deepEqual(await run(m, 'delivered'), await run(JSON.parse(JSON.stringify(saved)), 'roundtrip'));
});
test('8D: two closed-loop decisions use real observed X, distinct campaigns and held actions', async () => {
  const r = await run(feedback(), 'two-decisions');
  checkCampaign(r, 1, 1, 12); checkCampaign(r, 2, 3, 10);
  contains(r, 'observation', 12); contains(r, 'observation', 10);
  contains(r, 'plant/hold', 2); contains(r, 'plant/hold', -1); close(last(r, 'plant/hold'), 0);
  close(last(r, 'plant/X'), 10); close(last(r, 'applied'), 0);
});
test('8D: a single selected action really changes dX/dt until the end', async () => {
  const r = await run(feedback({ times: [1] }), 'one-decision');
  checkCampaign(r, 1, 1, 12); close(last(r, 'plant/X'), 8); close(last(r, 'plant/hold'), -1);
  assert.equal(rows(r, 2, 4).length, 0);
});
test('8D: changing the main initial condition changes observations, campaigns and actions', async () => {
  const r = await run(feedback({ initial: 8 }), 'different-main-state');
  checkCampaign(r, 1, 1, 10); checkCampaign(r, 2, 3, 10);
  close(last(r, 'plant/hold'), 0); close(last(r, 'plant/X'), 10);
});
test('8D: complete mode reinitializes changed factors without an explicit init command', async () => {
  const m = feedback(); m.model.connections = m.model.connections.filter(e => !(e.to.component === 'forecast' && e.to.port === 0));
  const r = await run(m, 'no-explicit-init'); checkCampaign(r, 1, 1, 12); checkCampaign(r, 2, 3, 10); close(last(r, 'plant/X'), 10);
});
test('8D: fixed observation factor overrides each scenario, leaving rate and dQ intact', async () => {
  const m = feedback(), f = wrapper(m).experiment.factors[0]; delete f.value; Object.assign(f, { type: 'fixed', values: [-700, -600] });
  const r = await run(m, 'fixed-initial');
  for (const [campaign, initial] of [[1, 12], [2, 10]]) {
    const inputs = rows(r, campaign, 4); assert.equal(inputs.length, 6); inputs.forEach(e => close(e.value[0], initial));
    assert.deepEqual(rows(r, campaign, 5).map(e => e.value[0]), [-1, -1, 0, 0, 1, 1]);
  }
  assert.equal(m.model.definitions.find(d => d.id === 'Prospect').components[1].parameters.dQ, .01);
});
test('8D: factor, init and run in the same bag follow the native order', async () => {
  const m = feedback();
  // observation=0 makes the same scalar a valid state, init and zero-delay run.
  m.model.components = m.model.components.filter(c => !['initValue', 'runValue'].includes(c.id));
  m.model.definitions.find(d => d.id === 'Plant').components.find(c => c.id === 'X').parameters.X = -2;
  m.model.connections = m.model.connections.filter(e => !['initValue', 'runValue'].includes(e.from.component) && !['initValue', 'runValue'].includes(e.to.component));
  m.model.connections.push(edge('observation', 0, 'forecast', 0), edge('observation', 0, 'forecast', 1));
  m.model.components = m.model.components.filter(c => c.id !== 'read2'); m.model.connections = m.model.connections.filter(e => e.from.component !== 'read2');
  const r = await run(m, 'same-bag'); checkCampaign(r, 1, 1, 0);
});
test('8D: configurable response delay lets the main system continue evolving', async () => {
  const r = await run(feedback({ delay: .5 }), 'decision-delay');
  checkCampaign(r, 1, 1.5, 12); checkCampaign(r, 2, 3.5, 11.5);
  contains(r, 'plant/hold', 2); close(last(r, 'plant/hold'), -1); close(last(r, 'plant/X'), 9.5);
});
test('8D: init cancels an overlapping pending response; complete auto-init preserves snapshots', async () => {
  const m = feedback({ times: [1, 1.2], delay: 1 });
  const cancelled = await run(m, 'overlap-init-cancels'); assert.equal(rows(cancelled, 1, 4).length, 0); checkCampaign(cancelled, 2, 2.2, 12.4);
  m.model.connections = m.model.connections.filter(e => !(e.to.component === 'forecast' && e.to.port === 0));
  const r = await run(m, 'overlap-no-init'); checkCampaign(r, 1, 2, 12); checkCampaign(r, 2, 2.2, 12.4);
});
test('8D: missing read or missing prospective output stays passive without fabricated action', async () => {
  const m = feedback({ times: [] }), absent = await run(m, 'no-decision');
  assert.equal(absent.resultEvents.length, 0); close(last(absent, 'plant/X'), 20);
  const missing = feedback(); missing.model.connections = missing.model.connections.filter(e => !(e.from.component === 'forecast' && e.from.port === 6));
  const r = await run(missing, 'missing-terminal'); checkCampaign(r, 1, 1, 12); checkCampaign(r, 2, 3, 16);
  close(last(r, 'plant/X'), 20); close(last(r, 'applied'), 2);
});
test('8D: late init cancels responses instead of delivering stale decisions', async () => {
  const m = feedback({ times: [1], delay: 1 }); m.model.components.push(atom('lateInit', 'constant', { offset: 1.5 })); m.model.connections.push(edge('lateInit', 0, 'forecast', 0));
  const r = await run(m, 'late-init'); assert.equal(r.resultEvents.length, 0); close(last(r, 'plant/X'), 20);
});
test('8D: reusable coupled plants have independent source bindings and held commands', async () => {
  const m = feedback(); m.model.components.push({ id: 'other', type: 'coupled', parameters: {}, definition: 'Plant' }, atom('otherCommand', 'constant', { value: -3 }));
  m.model.connections.push(edge('otherCommand', 0, 'other', 1), edge('read1', 0, 'other', 0));
  m.model.observations.push({ component: 'other/X', samplingInterval: .1 }, { component: 'other/sample', samplingInterval: .1 });
  const r = await run(m, 'independent-plants'); close(last(r, 'other/X'), -5); close(last(r, 'other/sample'), 7); checkCampaign(r, 2, 3, 10);
});
test('8D: ambiguous observation bindings fail, and instantaneous cycles retain their run limit', async () => {
  const m = feedback(), d = m.model.definitions.find(d => d.id === 'Plant'); d.components.push(atom('second', 'qss3_integrator', { X: 0, dQ: .01 })); d.connections.push(edge('second', 0, 'sample', 0));
  await run(m, 'ambiguous-binding', 2);
  const loop = feedback({ times: [1] }); loop.model.connections.push(edge('applied', 0, 'appliedTag', 0), edge('appliedTag', 0, 'applied', 0)); loop.model.components.push(atom('appliedTag', 'event_tag')); loop.limits = { maxRunCalls: 500 };
  await run(loop, 'bounded-instantaneous-loop', 2);
});
