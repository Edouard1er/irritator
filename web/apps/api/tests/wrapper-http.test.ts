import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../src/app.js';
import { readConfig, type Config } from '../src/config/index.js';
import { ProcessEngine } from '../src/services/engine.js';
import { catalog, runnerCapabilities, wrapperCaps, validateRequest, parseWrapperResult, type RunRequest, type RunResultV2 } from '../../../packages/contracts/index.js';
import { wrapperAffine, wrapperCoupled, wrapperPair, wrapperBusy, experiment, edge, example } from './wrapper-fixtures.js';

const config = readConfig();
const logs = resolve(process.env.IRRITATOR_HTTP_EVIDENCE ?? '../build-web-test7d/Release/logs');
const path = '/api/v1/simulations/run';
const evidence: object[] = [];
function direct(m: RunRequest) {
  const p = spawnSync(config.runnerPath, [], { input: JSON.stringify(m), encoding: 'utf8', timeout: 10000, maxBuffer: config.maxStdoutBytes, windowsHide: true });
  assert.ifError(p.error); assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout);
}
function decision(r: RunResultV2, component: string, time: number, values: (number | number[])[]) {
  const events = r.resultEvents.filter(e => e.component === component && e.time === time);
  assert.equal(events.length, values.length);
  for (const [i, e] of events.entries()) {
    assert.equal(e.port, i); assert.ok(e.bag > 0);
    const expected = typeof values[i] === 'number' ? [values[i], 0, 0] : values[i] as number[];
    e.value.forEach((v, j) => assert.ok(Math.abs(v - expected[j]!) < 1e-9));
  }
}
async function httpApp(overrides: Partial<Config> = {}, engine?: ProcessEngine, port = 0) {
  const app = buildApp({ ...config, ...overrides }, engine);
  await app.listen({ host: '127.0.0.1', port });
  const send = async (m: unknown) => {
    const response = await fetch(`${app.listeningOrigin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof m === 'string' ? m : JSON.stringify(m) });
    return { status: response.status, result: await response.json() as Record<string, any> };
  };
  return { app, send };
}

test('7D real HTTP on port 3001: affine and complete v2 envelope equal direct C++', { timeout: 20000 }, async () => {
  const { app, send } = await httpApp({}, undefined, 3001);
  try {
    const h = await fetch(`${app.listeningOrigin}/api/v1/health`);
    assert.equal(h.status, 200); assert.deepEqual((await h.json() as any).runner.capabilities, runnerCapabilities);
    const c = await fetch(`${app.listeningOrigin}/api/v1/components`); assert.deepEqual(await c.json(), catalog);
    const m = wrapperAffine(), { status, result } = await send(m);
    assert.equal(status, 200, JSON.stringify(result)); assert.match(result.runId, /^[0-9a-f-]{36}$/);
    const { runId, ...native } = result; assert.deepEqual(native, direct(m));
    const r = parseWrapperResult(native, m); decision(r, 'decision', 1, [3, 1, 1]);
    assert.equal(r.status, 'completed'); assert.equal(r.schemaVersion, 2); assert.equal(r.resultEvents.length, 3);
    assert.equal(r.wrappers[0]!.scenarioCount, 3); assert.equal(r.wrappers[0]!.outputs.length, 3);
    assert.deepEqual(r.observations.map(o => o.samples.at(-1)!.value), [3, 1, 1]);
    mkdirSync(logs, { recursive: true });
    writeFileSync(resolve(logs, 'affine-http.json'), JSON.stringify({ url: `${app.listeningOrigin}${path}`, httpStatus: status, request: m, response: result, direct: native }, null, 2));
  } finally { await app.close(); }
});

test('7D HTTP native scientific cases, lossless experiments, paths, bags and triplets', { timeout: 60000 }, async () => {
  const { app, send } = await httpApp();
  const cases: [string, RunRequest, (r: RunResultV2) => void][] = [
    ['coupled', wrapperCoupled(), r => decision(r, 'decision', 1, [3, 1, 1])],
    ['two independent plans', wrapperPair(), r => { decision(r, 'left/decision', 2, [3, 1, 1]); decision(r, 'right/decision', 2, [5, 1, 2]); assert.deepEqual(r.wrappers.map(w => w.scenarioCount), [3, 2]); }],
    ['native reset', wrapperPair(true), r => { decision(r, 'left/decision', 2.75, [-3, -3, -2]); decision(r, 'right/decision', 2, [5, 1, 2]); assert.equal(r.resultEvents.length, 9); }]
  ];
  const unconnected = wrapperAffine(); unconnected.model.connections.length = 1; unconnected.model.components.length = 2; unconnected.model.observations = [];
  cases.push(['unconnected', unconnected, r => { decision(r, 'decision', 1, [3, 1, 1]); assert.equal((r.diagnostics as any).collectorModelCount, 3); }]);
  const empty = wrapperAffine(); empty.model.connections.shift();
  cases.push(['no command', empty, r => assert.deepEqual(r.resultEvents, [])]);
  const repeated = wrapperAffine(); repeated.model.components.push({ id: 'relay', type: 'qss1_sum_2', parameters: {} }); repeated.model.connections.push(edge('run', 0, 'relay', 0), edge('relay', 0, 'decision', 1));
  cases.push(['same-time bags', repeated, r => { const events = r.resultEvents.filter(e => e.time === 1); assert.ok(events.length >= 6); assert.ok(new Set(events.map(e => e.bag)).size >= 2); }]);
  const triplet = wrapperAffine(); experiment(triplet).selections.length = 1; experiment(triplet).factors.push({ id: 'initial', target: 'X', parameter: 'X', type: 'single', value: 2 });
  cases.push(['full parameter triplet', triplet, r => decision(r, 'decision', 1, [4, 1, [2, .01, 0]])]);
  try {
    for (const [name, m, check] of cases) {
      const { status, result } = await send(m); assert.equal(status, 200, `${name}: ${JSON.stringify(result)}`);
      const { runId, ...native } = result; assert.deepEqual(native, direct(m), name);
      check(parseWrapperResult(native, m)); evidence.push({ name, request: m, httpStatus: status, response: result });
    }
    // Preserve the entire legacy envelope and diagnostics, not just values.
    for (const name of ['sum3', 'hierarchy-sum', 'qss3-operators', 'qss3-operators-coupled']) {
      const m = example(name), { status, result } = await send(m); assert.equal(status, 200, JSON.stringify(result));
      const { runId, ...native } = result; assert.equal(native.schemaVersion, 1); assert.deepEqual(native, direct(m)); assert.equal(native.resultEvents, undefined);
    }
    const responses = await Promise.all([send(wrapperAffine()), send(wrapperCoupled())]);
    responses.forEach(r => assert.equal(r.status, 200, JSON.stringify(r.result)));
  } finally { mkdirSync(logs, { recursive: true }); writeFileSync(resolve(logs, 'wrapper-http-results.json'), JSON.stringify(evidence, null, 2)); await app.close(); }
});

test('7D HTTP validation, effective server/client caps and native failures', { timeout: 30000 }, async () => {
  const { app, send } = await httpApp();
  const invalid: [string, (m: RunRequest) => void, string][] = [
    ['schema', m => { (experiment(m) as any).run = 'bag'; }, 'INVALID_MODEL'],
    ['version', m => { (m as any).schemaVersion = 4; }, 'INVALID_MODEL'],
    ['prospective reference', m => { experiment(m).definition = 'absent'; }, 'DEFINITION_NOT_FOUND'],
    ['factor', m => { experiment(m).factors[0]!.target = 'absent'; }, 'INVALID_FACTOR'],
    ['criterion', m => { (experiment(m).selections[0] as any).criteria = 'mean'; }, 'INVALID_MODEL'],
    ['selection', m => { experiment(m).selections[0]!.target = 'absent'; }, 'INVALID_SELECTION'],
    ['ports', m => { m.model.connections[0]!.to.port = 3; }, 'INVALID_CONNECTION'],
    ['scenario count', m => { experiment(m).factors[0] = { id: 'rate', target: 'u', parameter: 'value', type: 'fixed', values: Array(129).fill(1) }; }, 'INVALID_MODEL']
  ];
  try {
    for (const [name, change, code] of invalid) { const m = wrapperAffine(); change(m); const r = await send(m); assert.equal(r.status, 400, name); assert.equal(r.result.status, 'failed'); assert.equal(r.result.error.code, code, name); }
    assert.equal((await send('{')).result.error.code, 'INVALID_JSON');
    for (const key of Object.keys(wrapperCaps) as (keyof typeof wrapperCaps)[]) {
      const m = wrapperAffine(); m.limits = { [key]: wrapperCaps[key] + 1 }; assert.equal((await send(m)).result.error.code, 'INVALID_MODEL', key);
    }
    for (const [key, value] of [['maxScenarios', 2], ['maxTotalScenarios', 2], ['maxTotalModels', 10], ['maxTotalConnections', 5], ['maxInternalPoints', 10]] as const) {
      const m = wrapperAffine(); m.limits = { [key]: value }; const r = await send(m); assert.equal(r.status, 400, key); assert.equal(r.result.error.code, 'LIMIT_EXCEEDED', key);
    }
    const pair = wrapperPair(); pair.limits = { maxWrappers: 1 }; assert.equal((await send(pair)).result.error.code, 'LIMIT_EXCEEDED');
    const run = wrapperAffine(); run.model.components[0]!.parameters.value = -1;
    const failure = await send(run); assert.equal(failure.status, 422); assert.equal(failure.result.error.code, 'EXECUTION_ERROR'); assert.equal(typeof failure.result.error.engineCode, 'number'); assert.equal(failure.result.resultEvents, undefined);
    const construction = wrapperAffine(); construction.model.definitions!.push({ id: 'Alias', name: 'Alias', inputs: [{ port: 0, name: 'a' }, { port: 1, name: 'b' }], outputs: [], components: [{ id: 'sink', type: 'qss1_sum_2', parameters: {} }], connections: [edge('$input', 0, 'sink', 0), edge('$input', 1, 'sink', 0)] });
    construction.model.components.push({ id: 'alias', type: 'coupled', definition: 'Alias', parameters: {} }); construction.model.connections.push(edge('run', 0, 'alias', 0), edge('run', 0, 'alias', 1));
    const native = await send(construction); assert.equal(native.status, 422); assert.equal(native.result.error.code, 'NATIVE_CONSTRUCTION_ERROR');
    const events = wrapperAffine(); events.limits = { maxResultEvents: 2 };
    const limited = await send(events); assert.equal(limited.status, 422); assert.equal(limited.result.error.code, 'LIMIT_EXCEEDED'); assert.equal(limited.result.status, 'failed'); assert.equal(limited.result.resultEvents, undefined);
    assert.equal((await send(wrapperAffine())).status, 200); // error paths release slots
  } finally { await app.close(); }
  // Clients cannot raise configured limits; coupled occurrences count too.
  for (const [m, limits, expectedStatus] of [[wrapperAffine(), { maxScenarios: 2 }, 400], [wrapperPair(), { maxWrappers: 1 }, 400], [wrapperAffine(), { maxResultEvents: 2 }, 422]] as const) {
    const { app, send } = await httpApp({ wrapperLimits: { ...config.wrapperLimits, ...limits } });
    try { const r = await send(m); assert.equal(r.status, expectedStatus); assert.equal(r.result.error.code, 'LIMIT_EXCEEDED'); } finally { await app.close(); }
  }
});

test('7D real old runner or absent binary cannot advertise or execute v3', { timeout: 15000 }, async () => {
  const old = resolve(process.env.IRRITATOR_LEGACY_RUNNER ?? '../build-web-test6-1/runner/irritator-runner.exe'); assert.ok(existsSync(old), 'Set IRRITATOR_LEGACY_RUNNER to a historical Test 4-6 runner');
  for (const runnerPath of [old, resolve('../missing-runner-7d.exe')]) {
    const { app, send } = await httpApp({ runnerPath });
    try {
      const r = await send(wrapperAffine()); assert.equal(r.status, runnerPath === old ? 502 : 503); assert.equal(r.result.error.code, runnerPath === old ? 'RUNNER_INCOMPATIBLE' : 'ENGINE_UNAVAILABLE'); assert.equal(r.result.status, 'failed');
      if (runnerPath === old) { const legacy = await send(example('sum3')); assert.equal(legacy.status, 200); assert.equal(legacy.result.schemaVersion, 1); }
      const h = await fetch(`${app.listeningOrigin}/api/v1/health`), health = await h.json() as any;
      assert.equal(health.runner.available, false); assert.equal(health.runner.capabilities, undefined);
    } finally { await app.close(); }
  }
});

test('7D real HTTP deadline bounds an internal child loop, despite parent run cap', { timeout: 15000 }, async () => {
  const children: ChildProcessWithoutNullStreams[] = [];
  const c = { ...config, timeoutMs: 500 };
  const engine = new ProcessEngine(c, (exe, args) => { const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); if (!args.length) children.push(child); return child; });
  const { app, send } = await httpApp(c, engine);
  try {
    validateRequest(wrapperBusy()); const r = await send(wrapperBusy()); assert.equal(r.status, 504, JSON.stringify(r)); assert.equal(r.result.error.code, 'ENGINE_TIMEOUT'); assert.equal(r.result.status, 'failed');
    assert.equal(children.length, 1); assert.ok(children[0]!.exitCode !== null || children[0]!.signalCode !== null);
    assert.equal((await send(wrapperAffine())).status, 200);
  } finally { await app.close(); }
});

test('7D real TCP disconnect, two occupied slots, busy rejection and slot reuse', { timeout: 20000 }, async () => {
  const c = { ...config, timeoutMs: 10000, maxConcurrent: 2 };
  const simulations: ChildProcessWithoutNullStreams[] = [];
  let ready!: () => void; const started = new Promise<void>(r => { ready = r; });
  const engine = new ProcessEngine(c, (exe, args) => { const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); if (!args.length) { simulations.push(child); if (simulations.length === 2) ready(); } return child; });
  const { app, send } = await httpApp(c, engine);
  const aborts = [new AbortController(), new AbortController()];
  const requests = aborts.map(controller => fetch(`${app.listeningOrigin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(wrapperBusy()), signal: controller.signal }).catch(() => undefined));
  try {
    await started; await delay(30);
    const busy = await send(wrapperAffine()); assert.equal(busy.status, 503); assert.equal(busy.result.error.code, 'ENGINE_BUSY');
    aborts.forEach(a => a.abort()); await Promise.all(requests);
    for (let i = 0; i < 100 && simulations.some(child => child.exitCode === null && child.signalCode === null); ++i) await delay(10);
    assert.equal(simulations.length, 2); assert.ok(simulations.every(child => child.exitCode !== null || child.signalCode !== null));
    assert.equal((await send(wrapperAffine())).status, 200);
  } finally { aborts.forEach(a => a.abort()); await app.close(); await Promise.all(requests); }
});
