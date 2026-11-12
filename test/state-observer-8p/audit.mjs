import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'build-web-test8p/audit');
mkdirSync(out, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32*1024*1024 }).replaceAll('\r\n', '\n');
const sha = text => createHash('sha256').update(text).digest('hex');
const hold = text => {
  const start = text.indexOf('struct zero_order_hold {');
  if (start < 0) return null;
  const end = text.indexOf('\n};', start) + 3;
  return text.slice(start, end);
};
const head = git('rev-parse', 'HEAD').trim();
const master = git('rev-parse', 'master').trim();
const core = 'lib/include/irritator/core.hpp';
const current = readFileSync(resolve(root, core), 'utf8').replaceAll('\r\n', '\n');
const historical = git('show', `master:${core}`);
const initial = git('show', `HEAD:${core}`);
const files = git('ls-files', 'lib', 'app', 'test', 'web/engine/runner', 'web/apps/frontend').trim().split('\n').filter(Boolean);
const manifest = files.map(path => ({ path, sha256: sha(readFileSync(resolve(root, path))) }));
const result = {
  head, master, branch: git('branch', '--show-current').trim(),
  zeroOrderHold: {
    master: sha(hold(historical)), initialHead: sha(hold(initial)), current: sha(hold(current)),
    equalsMaster: hold(historical) === hold(current), equalsInitial: hold(initial) === hold(current)
  },
  productionDiff: git('diff', 'HEAD', '--', 'lib', 'app', 'web/engine/runner', 'web/apps/frontend'),
  allTrackedChangedPaths: git('diff', 'HEAD', '--name-only').trim().split('\n').filter(Boolean),
  manifest
};
const originalAudit = resolve(out, 'source-audit-initial.json');
if (existsSync(originalAudit)) {
  const original = new Map(JSON.parse(readFileSync(originalAudit, 'utf8')).manifest.map(f => [f.path, f.sha256]));
  result.changedSinceInitial = manifest.filter(f => original.get(f.path) !== f.sha256).map(f => f.path);
}
const fixture = resolve(root, 'web/model-test/modelhalieutiquetest-points.csv');
if (existsSync(fixture)) result.fixtureSha256 = sha(readFileSync(fixture));
result.diagnosticSources = readdirSync(import.meta.dirname).map(path => ({
  path: `test/state-observer-8p/${path}`, sha256: sha(readFileSync(resolve(import.meta.dirname, path)))
}));
writeFileSync(resolve(out, 'source-audit.json'), JSON.stringify(result, null, 2)+'\n');
writeFileSync(resolve(out, 'zero-order-hold-master.cpp.txt'), hold(historical)+'\n');
writeFileSync(resolve(out, 'zero-order-hold-head.cpp.txt'), hold(initial)+'\n');
writeFileSync(resolve(out, 'master-event.diff'), git('diff', 'master', 'HEAD', '--', 'lib/src/event.cpp', 'lib/include/irritator/event.hpp'));
console.log(JSON.stringify({ head, master, branch: result.branch, zeroOrderHold: result.zeroOrderHold,
  productionDiffEmpty: !result.productionDiff, allTrackedChangedPaths: result.allTrackedChangedPaths,
  changedSinceInitial: result.changedSinceInitial, fixtureSha256: result.fixtureSha256,
  trackedFilesHashed: manifest.length }, null, 2));
