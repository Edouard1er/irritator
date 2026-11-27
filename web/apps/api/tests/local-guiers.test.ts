import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';

const headers = { host: '127.0.0.1:3001', origin: 'http://localhost:3000' };
const url = '/local/guiers/reference';
const get = { method: 'GET' as const, url, headers, remoteAddress: '127.0.0.1' };

test('le référentiel local est désactivé hors développement', async () => {
  const app = buildApp(readConfig({ NODE_ENV: 'production', GUIERS_LOCAL_PROFILE: 'authorized' }));
  try { assert.equal((await app.inject(get)).statusCode, 404); }
  finally { await app.close(); }
});

test('le profil local refuse les fichiers non valides et un dossier hors de la racine SIG', async () => {
  const root = resolve('../local-sig-guiers');
  const folder = await mkdtemp(join(root, 'test-refus-'));
  const files = ['candidate-local-v2.json', 'mask-local.geojson', 'water-part-graphs.json'];
  try {
    for (const file of files) await writeFile(join(folder, file), '{}');
    const sha = createHash('sha256').update(await readFile(join(folder, files[0]!))).digest('hex');
    const config = readConfig({ NODE_ENV: 'development', GUIERS_LOCAL_PROFILE: 'synthetic', GUIERS_LOCAL_FOLDER: basename(folder),
      GUIERS_LOCAL_CANDIDATE_SHA: sha, GUIERS_LOCAL_GRAPH_SHA: sha, GUIERS_LOCAL_MASK_SHA: sha });
    assert.ok(config.localGuiers);
    const invalid = buildApp(config);
    try {
      assert.equal((await invalid.inject({ ...get, remoteAddress: '192.0.2.1' })).statusCode, 404);
      assert.equal((await invalid.inject({ ...get, headers: { ...headers, host: 'localhost:3001' } })).statusCode, 404);
      const response = await invalid.inject(get);
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().error.code, 'GUIERS_UNAVAILABLE');
      assert.ok(!response.body.includes(folder));
    } finally { await invalid.close(); }
    const outside = buildApp({ ...config, localGuiers: { ...config.localGuiers, folder: '../web' } });
    try { assert.equal((await outside.inject(get)).json().error.code, 'GUIERS_UNAVAILABLE'); }
    finally { await outside.close(); }
  } finally {
    await Promise.all(files.map(file => unlink(join(folder, file)).catch(() => {})));
    await rmdir(folder);
  }
});
