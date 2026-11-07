import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve('build-web-test8f');
const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const directory = c => resolve(root, c, 'logs/http-8f');
const names = readdirSync(directory('Release')).filter(n => n.endsWith('.json')).sort();
assert.equal(names.length, 42);
assert.deepEqual(names, readdirSync(directory('Debug')).filter(n => n.endsWith('.json')).sort());
for (const name of names) {
  const release = read(resolve(directory('Release'), name)), debug = read(resolve(directory('Debug'), name));
  assert.deepEqual(release, debug, `Cross configuration ${name}`);
  assert.equal(release.httpEqualsNative, true);
  if (release.exit === 0) assert.equal(release.stderrBytes, 0);
}
const historical8eNames = readdirSync(resolve(root, 'Release/logs/http-8e')).filter(n => n.endsWith('.json')).sort();
assert.equal(historical8eNames.length, 36);
assert.deepEqual(historical8eNames, readdirSync(resolve(root, 'Debug/logs/http-8e')).filter(n => n.endsWith('.json')).sort());
for (const name of historical8eNames) assert.deepEqual(read(resolve(root, 'Release/logs/http-8e', name)), read(resolve(root, 'Debug/logs/http-8e', name)), `Historical 8E ${name}`);
const r = read(resolve(directory('Release'), 'two-cycles.json')).result;
const baseline = read(resolve(directory('Release'), 'baseline-8e.json')).result;
const science = r => r.resultEvents.map(({ port, time, value }) => ({ port, time, value }));
assert.deepEqual(science(r), science(baseline));
const expectedFailures = ['native-wrapper-schaefer-pair', 'native-wrapper-schaefer-trajectories', 'runner-wrapper-7g'];
const configurations = ['Release', 'Debug'].map(c => {
  const exits = read(resolve(root, c, 'logs/exit-codes.json'));
  for (const [step, code] of Object.entries(exits)) {
    if (step === 'api-tests' && code === 1) {
      const initial = readFileSync(resolve(root, c, 'logs/api-tests.log'), 'utf8');
      assert.match(initial, /pass 93/); assert.match(initial, /fail 1/); assert.match(initial, /422 !== 502/);
      assert.match(readFileSync(resolve(root, c, 'logs/api-qss-corrected.log'), 'utf8'), /fail 0/);
    } else assert.equal(code, step === 'runner-tests' ? 8 : 0, `${c} ${step}`);
  }
  const junit = readFileSync(resolve(root, c, 'logs/runner.xml'), 'utf8');
  const initialFailed = [...junit.matchAll(/<testcase\b([^>]+)>([\s\S]*?)<\/testcase>/g)].filter(m => m[2].includes('<failure')).map(m => m[1].match(/name="([^"]+)"/)[1]).sort();
  if (initialFailed.includes('runner-contract')) {
    const retry = readFileSync(resolve(root, c, 'logs/contract-isolated.xml'), 'utf8');
    assert.match(retry, /tests="1"/); assert.match(retry, /failures="0"/);
  }
  assert.deepEqual(initialFailed.filter(n => n !== 'runner-contract'), expectedFailures);
  const ninja = readFileSync(resolve(root, c, 'engine/build.ninja'), 'utf8');
  if (c === 'Debug') { assert.match(ninja, /IRRITATOR_ENABLE_DEBUG/); assert.doesNotMatch(ninja, /-DNDEBUG|\/DNDEBUG/); }
  const browser = read(resolve(root, `playwright-${c.toLowerCase()}.json`));
  assert.equal(browser.stats.expected, 66);
  assert.equal(browser.stats.unexpected, 0); assert.equal(browser.stats.skipped, 0); assert.equal(browser.stats.flaky, 0);
  return { configuration: c, exits, initialFailed, runner: hash(resolve(root, c, 'runner/irritator-runner.exe')), engine: hash(resolve(root, c, 'engine/lib/irritators-0.1.lib')), browser: browser.stats };
});
const trace = readFileSync(resolve(root, 'Release/logs/native-composition.log'), 'utf8');
assert.match(trace, /NATIVE_SCHAEFER_FEEDBACK_PASS/);
assert.equal(trace, readFileSync(resolve(root, 'Debug/logs/native-composition.log'), 'utf8'));
const stages = [['request', 'observer/request', 0], ['observeN', 'plant/observeN', 0], ['observeC', 'plant/observeC', 0], ['memoryN', 'observer/synchronize/memoryN', 0], ['factorN', 'observer/synchronize/pairN', 0], ['initSent', 'observer/synchronize/initValue', 0], ['runSent', 'observer/synchronize/runValue', 0], ['action', 'observer/decide/choose/priority', 0], ['taggedAction', 'observer/decide/choose/priority', 4]];
const events = [...trace.matchAll(/^EVENT (\d+) (\S+) (\S+):(\d+) \[([^\]]+)\]$/gm)].map(m => ({ bag: +m[1], time: +m[2], path: m[3], port: +m[4], value: m[5].split(',').map(Number) }));
const rows = (c, p) => r.resultEvents.filter(e => e.value[2] === c && e.port === p).sort((a, b) => a.value[1] - b.value[1]);
const campaigns = [1, 2].map(c => {
  const time = c === 1 ? 1 : 3, N = rows(c, 6)[0].value[0], C = rows(c, 7)[0].value[0];
  const bags = Object.fromEntries(stages.map(([name, path, port]) => [name, events.find(e => e.time === time && e.path === path && e.port === port && (name === 'action' || e.value[2] === c))?.bag]));
  for (const bag of Object.values(bags)) assert.ok(bag);
  const childInit = [...trace.matchAll(/^CHILD_INIT (\d+) (\S+) (\d+) (\d+) (\S+) (\S+) (\S+)$/gm)].filter(m => +m[3] === c).map(m => ({ bag: +m[1], time: +m[2], scenario: +m[4], N: +m[5], C: +m[6], E: +m[7] }));
  assert.equal(childInit.length, 3); for (const child of childInit) { assert.equal(child.N, N); assert.equal(child.C, C); }
  const applied = events.find(e => e.path === 'plant/effort' && e.time === time);
  assert.equal(applied.value[0], 150); assert.ok(bags.request < bags.observeN && bags.initSent < childInit[0].bag && childInit[0].bag < bags.runSent && bags.runSent < bags.action && bags.action < applied.bag);
  return { campaign: c, time, N, C, bags, childInit, applied, scenarios: rows(c, 8).map((e, i) => ({ id: i, E: e.value[0], Nmin: rows(c, 9)[i].value[0], CH: rows(c, 10)[i].value[0], deltaC: rows(c, 10)[i].value[0] - C })) };
});
const summary = { comparedCases: names.length, comparedHistorical8eCases: historical8eNames.length, configurations, campaigns, final: Object.fromEntries(['N', 'C'].map(id => [id, r.observations.find(o => o.component === 'plant/' + id).samples.at(-1).value])) };
writeFileSync(resolve(root, 'cross-configuration.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
