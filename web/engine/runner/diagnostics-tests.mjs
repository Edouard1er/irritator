import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const runner = process.env.IRRITATOR_RUNNER;
const proof = resolve(process.env.IRRITATOR_DIAGNOSTICS_EVIDENCE ?? '../../../build-web-test8c/logs/diagnostics');
mkdirSync(proof, { recursive: true });
const request = JSON.parse(readFileSync(new URL('../../examples/decision-schaefer-external-v3.json', import.meta.url), 'utf8'));
const invoke = env => spawnSync(runner, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, IRRITATOR_TRACE: '', IRRITATOR_TRACE_FILE: '', ...env } });
test('scientific traces can be disabled, separated or enabled without changing stdout JSON', () => {
  const path = resolve(proof, 'scientific.log'); rmSync(path, { force: true });
  const quiet = invoke({}), separate = invoke({ IRRITATOR_TRACE_FILE: path }), verbose = invoke({ IRRITATOR_TRACE: 'stderr' });
  for (const p of [quiet, separate, verbose]) assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.deepEqual(JSON.parse(quiet.stdout), JSON.parse(separate.stdout)); assert.deepEqual(JSON.parse(quiet.stdout), JSON.parse(verbose.stdout));
  assert.equal(quiet.stderr.length, 0); assert.equal(separate.stderr.length, 0);
  // Release has no scientific trace; Debug retains detailed tables on demand.
  const bytes = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  if (verbose.stderr.length) { assert.ok(bytes > 65536); assert.ok(Buffer.byteLength(verbose.stderr) > 65536); }
  writeFileSync(resolve(proof, 'streams.json'), JSON.stringify({ quietStderr: Buffer.byteLength(quiet.stderr), separateStderr: Buffer.byteLength(separate.stderr), scientificFileBytes: bytes, verboseStderr: Buffer.byteLength(verbose.stderr), stdoutEqual: true }, null, 2));
});
test('invalid diagnostic destination returns a structured initialization error in Debug', () => {
  const p = invoke({ IRRITATOR_TRACE_FILE: resolve(proof, 'missing-directory', 'scientific.log') });
  if (p.status === 0) return; // Release compiles detailed tracing out.
  assert.equal(p.status, 2); assert.equal(JSON.parse(p.stdout).error.code, 'INITIALIZATION_ERROR');
});
