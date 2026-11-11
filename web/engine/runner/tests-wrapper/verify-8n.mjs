// Evidence projection only: selections are read from native events, never
// recomputed or optimized in JavaScript.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
const root = resolve(process.argv[2] ?? 'build-web-test8n');
const events = (r, path, port = 0, campaign) => (r.modelEvents ?? []).filter(e => e.component === path && e.port === port && (campaign === undefined || e.value[2] === campaign));
const typed = (r, path, kind, campaign) => r.resultEvents.filter(e => e.component === path && r.wrappers.find(w => w.component === path).outputs[e.port].kind === kind && (campaign === undefined || e.value[2] === campaign));
function project(proof) {
  const { request, result: r } = proof;
  if (r.error) return { error: r.error };
  const library = request.model.definitions.find(d => d.id === 'ProspectiveLibrary');
  const campaigns = events(r, 'observer/selector/selected').map(selection => {
    const campaign = selection.value[2], localModelId = selection.value[0], occurrence = 'forecast/M' + localModelId;
    const experiment = library.components.find(c => c.id === 'M' + localModelId).experiment;
    const performance = [1, 2].map(i => {
      const prefix = 'M' + i + (request.model.id.includes('schaefer') ? 'N' : 'X');
      const loss = events(r, 'observer/selector/M' + i + 'lossRead', 0, campaign)[0];
      const count = events(r, 'observer/selector/M' + i + 'countRead', 0, campaign)[0];
      const admissible = events(r, 'observer/selector/M' + i + 'admissible', 0, campaign)[0];
      const history = events(r, prefix + 'MAE').filter(e => e.port === 0 && (e.time < loss.time || (e.time === loss.time && e.bag < loss.bag)));
      const verifiedWindows = events(r, prefix + 'pair', 2).filter(e => e.value[0] === 1 && (e.time < loss.time || (e.time === loss.time && e.bag < loss.bag)));
      assert.equal(verifiedWindows.length, count.value[0], 'Snapshot contains a different set of verified windows');
      for (const window of verifiedWindows) assert.ok(window.time < selection.time, 'Future or coincident observation used');
      if (count.value[0]) assert.equal(history.at(-1).value[0], loss.value[0], 'Historical loss was relabelled or changed');
      return { localModelId: i, contract: request.model.forecastContracts.find(c => c.pair === prefix + 'pair'),
        snapshotLoss: loss, snapshotCount: count, admissible,
        sourceAggregate: count?.value[0] ? history.at(-1) : null,
        verifiedWindows };
    });
    return { selection, decisionCampaign: campaign, localModelId, modelRef: { occurrence, definition: experiment.definition },
      experimentSha256: createHash('sha256').update(JSON.stringify(experiment)).digest('hex'), performance,
      selectionStatus: events(r, 'observer/selector/chooseModel', 3, campaign)[0],
      planReady: typed(r, occurrence, 'plan-ready', campaign),
      scenarios: r.resultEvents.filter(e => e.component === occurrence && e.value[2] === campaign),
      appliedCommand: events(r, request.model.id.includes('schaefer') ? 'plant/effort' : 'plant/hold').find(e => e.time === selection.time) };
  });
  return { resources: { ...r.diagnostics, elapsedMs: proof.elapsedMs, stdoutBytes: proof.stdoutBytes,
    childCalls: typed(r, 'forecast/M1', 'scenario-run-calls').concat(typed(r, 'forecast/M2', 'scenario-run-calls'), typed(r, 'verificationM1', 'scenario-run-calls'), typed(r, 'verificationM2', 'scenario-run-calls')).reduce((n, e) => n + e.value[0], 0),
    parentBagsObserved: Math.max(...r.resultEvents.map(e => e.bag), ...r.modelEvents.map(e => e.bag)) }, campaigns,
    trajectories: r.observations.filter(o => ['plant/X', 'plant/N', 'plant/C'].includes(o.component)) };
}
const summary = { configurations: {}, compared: 0, evidence: [] };
const captures = {};
function junit(path) {
  const xml = readFileSync(path, 'utf8');
  return { tests: +xml.match(/\btests="(\d+)"/)[1], failures: +xml.match(/\bfailures="(\d+)"/)[1],
    failed: [...xml.matchAll(/<testcase name="([^"]+)"[^>]*>([\s\S]*?)<\/testcase>/g)].filter(m => m[2].includes('<failure')).map(m => m[1]) };
}
for (const configuration of ['Release', 'Debug']) {
  const dir = join(root, configuration);
  const runs = readdirSync(dir).filter(s => s.startsWith('run-')).sort();
  const run = runs.at(-1), captureDir = join(dir, run, 'http-8n');
  const files = readdirSync(captureDir).filter(s => s.endsWith('.json') && !s.endsWith('-request.json'));
  captures[configuration] = new Map();
  for (const file of files) {
    const proof = JSON.parse(readFileSync(join(captureDir, file), 'utf8'));
    captures[configuration].set(file, proof); summary.evidence.push({ configuration, file, sha256: createHash('sha256').update(readFileSync(join(captureDir, file))).digest('hex') });
  }
  const exitCodes = JSON.parse(readFileSync(join(dir, run, 'exit-codes.json')));
  for (const [step, code] of Object.entries(exitCodes)) assert.equal(code, step === 'runner-tests' ? 8 : 0, configuration + ': unexpected failure in ' + step);
  const runnerTests = junit(join(dir, run, 'runner.xml'));
  assert.deepEqual(runnerTests.failed.sort(), ['runner-wrapper-7g', 'native-wrapper-schaefer-trajectories', 'native-wrapper-schaefer-pair'].sort());
  summary.configurations[configuration] = { run, exitCodes, junit: { runner: runnerTests, official: junit(join(dir, run, 'official.xml')), historical: junit(join(dir, run, 'historical.xml')) }, captures: files.length,
    examples: Object.fromEntries(['decision-adaptive-prospect-selection', 'decision-adaptive-prospect-baseline', 'decision-adaptive-prospect-alternative-plant', 'tstar-schaefer-adaptive-prospect', 'schaefer-true'].map(name => [name, project(captures[configuration].get(name + '.json'))])) };
}
for (const [file, r] of captures.Release) {
  const d = captures.Debug.get(file); assert.ok(d, 'Missing Debug evidence: ' + file);
  assert.deepEqual(r.request, d.request); assert.deepEqual(r.result, d.result);
  if (r.httpStatus === 200) { assert.deepEqual(r.httpResult, r.result); assert.deepEqual(d.httpResult, d.result); }
  summary.compared++;
}
assert.equal(captures.Release.size, captures.Debug.size);
const browser = {};
const withoutExecutionIds = ({ runId, requestId, ...result }) => result;
for (const configuration of ['Release', 'Debug']) {
  const prefix = 'playwright-' + configuration.toLowerCase() + '-';
  const dir = readdirSync(root).filter(s => s.startsWith(prefix)).sort().at(-1);
  const report = JSON.parse(readFileSync(join(root, dir, 'result.json')));
  assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.skipped, 0); assert.equal(report.stats.flaky, 0);
  browser[configuration] = { directory: dir, stats: report.stats, proofs: new Map() };
  for (const folder of ['8n', '8l', '8m']) for (const name of readdirSync(join(root, dir, folder)).filter(s => s.endsWith('.json'))) {
    const proof = JSON.parse(readFileSync(join(root, dir, folder, name)));
    if (proof.request && proof.result) browser[configuration].proofs.set(folder + '/' + name, proof);
  }
}
let comparedBrowser = 0;
for (const [name, r] of browser.Release.proofs) {
  const d = browser.Debug.proofs.get(name); assert.ok(d, 'Missing browser proof: ' + name);
  assert.deepEqual(r.request, d.request); assert.deepEqual(withoutExecutionIds(r.result), withoutExecutionIds(d.result)); comparedBrowser++;
}
assert.equal(browser.Release.proofs.size, browser.Debug.proofs.size);
summary.browser = { compared: comparedBrowser, configurations: Object.fromEntries(Object.entries(browser).map(([key, { directory, stats }]) => [key, { directory, stats }])) };
// Observe the actual plan payloads on an audit copy. The delivered documents
// keep their original observation budget. Verify that the different probes
// leave the native wrapper results, selection and applied actions unchanged.
const planDir = join(root, 'plan-traces'); mkdirSync(planDir, { recursive: true });
const scenariosWithoutBags = r => r.resultEvents.map(({ bag, ...e }) => e);
for (const [name, example] of Object.entries(summary.configurations.Release.examples)) {
  let reference;
  for (const configuration of ['Release', 'Debug']) {
    const { request, result: canonical } = captures[configuration].get(name + '.json');
    const instrumented = structuredClone(request);
    const planner = instrumented.model.definitions.find(d => d.id === 'BuildPlan');
    const decisionPaths = new Set(['observer/selector/selected', 'plant/hold', 'plant/effort']);
    instrumented.model.observations = instrumented.model.observations.filter(o => decisionPaths.has(o.component));
    for (const c of planner.components) instrumented.model.observations.push({ component: 'observer/planner/' + c.id, samplingInterval: .1, eventPorts: [0] });
    const runner = join(dirname(root), 'build-web-test8m', configuration, 'runner', 'irritator-runner.exe');
    const p = spawnSync(runner, [], { cwd: planDir, input: JSON.stringify(instrumented), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    const result = JSON.parse(p.stdout);
    assert.deepEqual(scenariosWithoutBags(result), scenariosWithoutBags(canonical));
    const decisions = r => r.modelEvents.filter(e => decisionPaths.has(e.component)).map(({ bag, ...e }) => e);
    assert.deepEqual(decisions(result), decisions(canonical));
    const trace = result.modelEvents.filter(e => e.component.startsWith('observer/planner/'));
    if (reference) assert.deepEqual(trace, reference); else reference = trace;
    const plans = summary.configurations[configuration].examples[name].campaigns.map(c => {
      const fields = trace.filter(e => e.value[2] === c.decisionCampaign);
      const branch = c.localModelId === 1 ? 'low' : 'high';
      assert.ok(fields.every(e => e.component.startsWith('observer/planner/' + branch)), 'Unselected branch sent plan payloads');
      const field = suffix => fields.find(e => e.component.endsWith(branch + suffix)).value[0];
      assert.equal(field('Identity'), c.planReady[0].value[1]);
      assert.equal(field('Version'), 1); assert.equal(field('Seal'), 0);
      assert.ok(typed(result, c.modelRef.occurrence, 'scenario-horizon', c.decisionCampaign).every(e => e.value[0] === field('Horizon')));
      return { campaign: c.decisionCampaign, occurrence: c.modelRef.occurrence, id: field('Identity'), version: field('Version'), horizon: field('Horizon'), fields };
    });
    for (const [i, plan] of plans.entries()) summary.configurations[configuration].examples[name].campaigns[i].transmittedPlan = plan;
    writeFileSync(join(planDir, configuration + '-' + name + '.json'), JSON.stringify({ request: instrumented, result, plans }, null, 2));
  }
}
writeFileSync(join(root, 'final-validation.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('8N_EVIDENCE_VERIFIED', summary.compared, 'BROWSER', comparedBrowser);
