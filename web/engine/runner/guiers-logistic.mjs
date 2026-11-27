import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { parseArgs } from 'node:util';

export function runGuiersNative(runner, request) {
  return new Promise((resolve, reject) => {
    const child = execFile(runner, [], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr.trim() || error.message));
        try { resolve(JSON.parse(stdout)); } catch (cause) { reject(cause); }
      });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(request));
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    config: { type: 'string', default: 'H' }, resolution: { type: 'string', default: '1000' },
    candidate: { type: 'string' }, out: { type: 'string' },
  } });
  const runner = process.env.IRRITATOR_RUNNER;
  const resolution = Number(values.resolution);
  const config = values.config;
  if (!runner || !values.out || !['H', 'E', 'H_PLUS', 'HP_PLUS'].includes(config) || ![500, 1000].includes(resolution) ||
    (config !== 'H' && !values.candidate)) {
    throw new Error('IRRITATOR_RUNNER et --out requis. Configurations H, E, H_PLUS ou HP_PLUS, résolutions 500 ou 1000. E/H_PLUS/HP_PLUS exigent --candidate.');
  }
  const localDir = fileURLToPath(new URL('../../../local-sig-guiers/', import.meta.url));
  const parent = await realpath(dirname(resolve(values.out)));
  const subpath = relative(localDir, parent);
  if (isAbsolute(subpath) || subpath === '..' || subpath.startsWith(`..${sep}`)) {
    throw new Error('Écrire le résultat sous local-sig-guiers.');
  }
  const file = resolve(parent, basename(values.out));
  const dist = process.env.IRRITATOR_WEB_DIST ? pathToFileURL(resolve(process.env.IRRITATOR_WEB_DIST) + '/') :
    new URL('../../dist/', import.meta.url);
  const { guiersIdentity, guiersGrid, maxGuiersCandidateBytes, parseGuiersCandidate } =
    await import(new URL('packages/contracts/guiers-spatial.js', dist));
  const { guiersLogisticDefaults, runGuiersLogistic } = await import(new URL('examples/guiers-logistic.js', dist));
  const reference = JSON.parse(await readFile(new URL('../../apps/frontend/data/geography/guiers-metric-reference.json', import.meta.url), 'utf8'));
  let raw;
  if (config !== 'H') {
    if ((await stat(values.candidate)).size > maxGuiersCandidateBytes) throw new Error('Fichier SIG trop volumineux (5 Mio maximum).');
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(values.candidate));
  }
  const candidate = raw ? parseGuiersCandidate(raw, reference) : undefined;
  const grid = guiersGrid(reference, config, resolution, candidate);
  if (!grid) throw new Error('Configuration indisponible dans ce fichier candidat.');
  const identity = guiersIdentity(config, resolution, reference.hydroSha256, raw ? createHash('sha256').update(raw).digest('hex') : undefined);
  const result = await runGuiersLogistic(grid, identity, guiersLogisticDefaults, request => runGuiersNative(runner, request));
  await writeFile(file, JSON.stringify(result)+'\n', { flag: 'wx' });
  console.log(`${config} · ${resolution} m · ${result.cells.length} trajectoires QSS3 en kg (temps en jours)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
