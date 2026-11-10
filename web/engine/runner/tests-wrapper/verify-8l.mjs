// Verify evidence without rewriting any initial failure or retry log.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
const [release, debug, output, ...browserPaths] = process.argv.slice(2);
assert.ok(release && debug && output, 'Expected Release run, Debug run, output, optional browser directories');
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const runtime = json(resolve(dirname(output), 'runtime-node24.json'));
assert.match(runtime.version, /^v24\./);
const normalizedPath = p => p.replaceAll('\\', '/').toLowerCase();
const groups = [];
for (const group of ['8b', '8c', '8d', '8e', '8f', '8g', '8h', '8i', '8j', '8k', '8l']) {
  const rd = resolve(release, 'http-' + group), dd = resolve(debug, 'http-' + group); let pairs = 0, captures = 0;
  const names = readdirSync(rd).filter(n => n.endsWith('.json') && !n.endsWith('-request.json'));
  assert.deepEqual(readdirSync(dd).filter(n => n.endsWith('.json') && !n.endsWith('-request.json')).sort(), [...names].sort());
  for (const name of names) {
    const a = json(resolve(rd, name)), b = json(resolve(dd, name));
    if (name === 'scientific-results.json') { assert.deepEqual(a, b); continue; }
    assert.deepEqual(a.request, b.request, `${group}/${name} request`); assert.equal(a.exit, b.exit, `${group}/${name} exit`);
    assert.equal(a.httpStatus, b.httpStatus, `${group}/${name} HTTP`);
    if (name.endsWith('.process.json')) { assert.deepEqual(JSON.parse(a.stdout), JSON.parse(b.stdout)); assert.equal(a.stderr, b.stderr); ++captures; continue; }
    assert.ok(a.result && a.request, `${group}/${name} incomplete capture`);
    assert.deepEqual(a.result, b.result, `${group}/${name} native response`);
    if (a.result.status === 'failed') assert.equal(a.result.resultEvents, undefined);
    if (group === '8l') {
      assert.deepEqual(a.scientificReport, b.scientificReport, `${name} scientific provenance`);
      if (a.nativeTrace) { assert.equal(a.nativeTrace, b.nativeTrace, `${name} native trace`); assert.match(a.nativeTrace, /NATIVE_MODEL_SELECTION_RESET_PASS/); }
    }
    ++pairs;
  }
  groups.push({ group, pairs, captures });
}
const expectedFailures = ['native-wrapper-schaefer-pair', 'native-wrapper-schaefer-trajectories', 'runner-wrapper-7g'].sort();
const suites = [];
for (const root of [release, debug]) {
  const cache = readFileSync(resolve(root, '../../runner/CMakeCache.txt'), 'utf8');
  const node = cache.match(/^NODE_EXECUTABLE:FILEPATH=(.+)$/m)?.[1].trim();
  assert.equal(normalizedPath(node), normalizedPath(runtime.executable));
  const codes = json(resolve(root, 'exit-codes.json'));
  for (const [name, value] of Object.entries(codes)) assert.equal(value, name === 'runner-tests' ? 8 : 0, root + '/' + name);
  const cases = new Map();
  for (const name of ['runner.xml', 'runner-retries.xml']) if (existsSync(resolve(root, name))) {
    for (const match of readFileSync(resolve(root, name), 'utf8').matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const id = match[1].match(/name="([^"]*)"/)[1]; cases.set(id, !!match[2]?.includes('<failure'));
    }
  }
  assert.equal(cases.size, 59); assert.deepEqual([...cases].filter(([, failed]) => failed).map(([id]) => id).sort(), expectedFailures);
  suites.push({ root, executed: cases.size, passed: cases.size - expectedFailures.length, expectedMissingCsvFailures: expectedFailures });
}
const browserCases = new Map(), browsers = [];
for (const root of browserPaths) {
  const result = json(resolve(root, 'result.json'));
  assert.equal(normalizedPath(result.config.argv[0]), normalizedPath(runtime.executable), 'Browser must also use Node 24');
  const configuration = /playwright-debug-/.test(root) ? 'Debug' : 'Release';
  const cases = browserCases.get(configuration) ?? new Map(); browserCases.set(configuration, cases);
  function visit(suite) {
    for (const spec of suite.specs ?? []) for (const t of spec.tests) cases.set(`${spec.file}:${spec.line}:${spec.title}`, t.status === 'expected' && t.results.at(-1)?.status === 'passed');
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of result.suites) visit(suite);
  assert.equal(result.stats.skipped, 0); browsers.push({ root, configuration, ...result.stats });
}
const consolidatedBrowsers = [...browserCases].map(([configuration, cases]) => {
  assert.equal(cases.size, 80, configuration + ' browser case count');
  assert.ok([...cases.values()].every(Boolean), configuration + ' browser failures remain');
  return { configuration, passed: cases.size };
});
assert.equal(existsSync(new URL('../../../model-test/modelhalieutiquetest-points.csv', import.meta.url)), false);
const report = { runtime, groups, pairs: groups.reduce((n, g) => n + g.pairs, 0), processCaptures: groups.reduce((n, g) => n + g.captures, 0), suites, browsers, consolidatedBrowsers };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log('8L_EVIDENCE_VERIFIED', report.pairs, report.processCaptures);
