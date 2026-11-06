import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { parseWrapperResult, validateRequest, type RunRequest } from '../../../packages/contracts/index.js';
const config = readConfig();
test('8A real TCP HTTP: seven generic examples exactly reproduce the native runner', { timeout: 60000 }, async () => {
  const app = buildApp(config); await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    for (const name of ['memory', 'comparison', 'selection', 'constraint', 'fallback', 'reuse', 'prospective']) {
      const m = JSON.parse(readFileSync(resolve('examples', `decision-${name}.json`), 'utf8')) as RunRequest;
      validateRequest(m);
      const response = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
      const json = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 200, JSON.stringify(json)); assert.ok(json.runId);
      const { runId, ...result } = json;
      const native = spawnSync(config.runnerPath, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 15000 });
      assert.equal(native.status, 0, native.stdout + native.stderr);
      assert.deepEqual(result, JSON.parse(native.stdout));
      if (m.schemaVersion === 3) parseWrapperResult(result, m);
    }
  } finally { await app.close(); }
});
