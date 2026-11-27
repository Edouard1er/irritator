import { createHash } from 'node:crypto';
import { open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { guiersGrid, guiersIdentity, maxGuiersCandidateBytes, parseGuiersCandidate, type GuiersConfiguration,
  type GuiersReference, type GuiersWaterParts } from '../../../../packages/contracts/guiers-spatial.js';
import { ApiError } from '../../../../packages/contracts/index.js';
import { validateAtlasGeometry } from '../../../../packages/contracts/geo-atlas.js';
import { guiersLogisticPlan, runGuiersLogistic, type GuiersLogisticParams } from '../../../../examples/guiers-logistic.js';
import type { Config } from '../config/index.js';
import type { Engine } from '../services/engine.js';

const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const prefix = '/local/guiers';
const origins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const pinnedCommit = 'e17bc25f18b11d7fa6074ec411749ad606767a76';
const pinnedMask = '28202b428c088032e10d8b9e4c186490ac65aa5ed2daf834481ae0ca97356abf';
const syntheticProof = 'Jeu synthétique V2.1';
type Profile = NonNullable<Config['localGuiers']>;

async function pinnedFile(folder: string, name: string, sha: string, limit: number) {
  const path = resolve(folder, name);
  if (await realpath(path) !== path || !/^[a-f0-9]{64}$/.test(sha)) throw new Error('Fichier hors profil.');
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    const { size } = info;
    if (!info.isFile() || size > limit) throw new Error('Type ou taille du fichier hors limites.');
    const bytes = Buffer.alloc(size);
    const { bytesRead } = await file.read(bytes, 0, size, 0);
    if (bytesRead !== size || createHash('sha256').update(bytes).digest('hex') !== sha)
      throw new Error('Empreinte du fichier différente.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally { await file.close(); }
}

async function loadProfile(profile: Profile) {
  const localRoot = resolve(repo, 'local-sig-guiers');
  if (await realpath(localRoot) !== localRoot) throw new Error('Racine SIG locale redirigée.');
  const folder = await realpath(resolve(localRoot, profile.folder));
  const subpath = relative(localRoot, folder);
  if (!subpath || subpath === '..' || subpath.startsWith('..' + sep) || isAbsolute(subpath))
    throw new Error('Dossier SIG hors de la racine locale.');
  const [raw, h, graphText, maskText] = await Promise.all([
    pinnedFile(folder, 'candidate-local-v2.json', profile.candidateSha, maxGuiersCandidateBytes),
    readFile(resolve(repo, 'web/apps/frontend/data/geography/guiers-metric-reference.json'), 'utf8'),
    pinnedFile(folder, 'water-part-graphs.json', profile.graphSha, 20 * 1024 * 1024),
    pinnedFile(folder, 'mask-local.geojson', profile.maskSha, 256 * 1024),
  ]);
  const reference = JSON.parse(h) as GuiersReference;
  const candidate = parseGuiersCandidate(raw, reference);
  const domain = candidate.fishingDomain;
  const sources = Object.values(candidate.sources);
  const proof = profile.synthetic ? syntheticProof : profile.proof;
  if (candidate.version !== 2 || !domain || sources.length !== 4 || !proof ||
    domain.mask.id !== (profile.synthetic ? 'researcher_polygon_v1' : 'south_cut_min_northing_E_v1') ||
    (!profile.synthetic && domain.mask.maskSha256 !== pinnedMask) ||
    !sources.every(s => s.rightsEvidence === proof && s.version === (profile.synthetic ? '1'.repeat(40) : pinnedCommit))) {
    throw new Error('Version, provenance ou autorisation locale incompatible.');
  }
  const mask = JSON.parse(maskText);
  const graphs = JSON.parse(graphText);
  if (mask.type !== 'Feature' || mask.geometry?.type !== 'Polygon' || mask.properties?.maskSha256 !== domain.mask.maskSha256 ||
    graphs.version !== 1 || graphs.status !== 'local_geometry_audit' || graphs.hydroSha256 !== reference.hydroSha256 ||
    graphs.maskSha256 !== domain.mask.maskSha256) throw new Error('Graphe ou masque étranger au référentiel.');
  validateAtlasGeometry(mask.geometry);
  for (const configuration of ['H', 'E', 'HP_PLUS'] as const) for (const resolution of [1000, 500] as const) {
    const key = `${configuration}_${resolution}` as const;
    const summary = candidate.connectivity?.[key]?.parts;
    const grid = guiersGrid(reference, configuration, resolution, candidate);
    const parts: GuiersWaterParts = graphs.graphs?.[key]?.parts;
    if (!grid || !summary || parts?.version !== 'water_parts_v1' ||
      parts.nodes?.length !== summary.nodes || parts.edges?.length !== summary.edges) throw new Error('Graphe incomplet.');
    const cells = new Map(grid.cells.map(c => [c.id, c]));
    const ids = new Set(parts.nodes.map(n => n.id));
    if (ids.size !== parts.nodes.length || parts.nodes.some(n => !cells.has(n.cellId) ||
      !Number.isFinite(n.waterAreaM2) || n.waterAreaM2 <= 0 || n.geometry?.type !== 'Polygon' ||
      !Array.isArray(n.labelPoint) || n.labelPoint.length !== 2 || !n.labelPoint.every(Number.isFinite) ||
      !Array.isArray(n.neighbors) || !n.neighbors.every(id => ids.has(id))) ||
      parts.edges.some(e => !ids.has(e.a) || !ids.has(e.b) || !Number.isFinite(e.interfaceLengthM) || e.interfaceLengthM <= 0))
      throw new Error('Parties aquatiques incohérentes.');
    for (const node of parts.nodes) validateAtlasGeometry(node.geometry, undefined, true);
  }
  return { raw, reference, candidate, mask: mask.geometry, graphs: graphs.graphs as Record<string, { parts: GuiersWaterParts }> };
}

export function localGuiersRoutes(app: FastifyInstance, profile: Profile, engine: Engine) {
  let available: ReturnType<typeof loadProfile> | undefined;
  function bundle() {
    available ??= loadProfile(profile).catch((error: unknown) => {
      const detail = error instanceof Error ? ('code' in error ? error.code : error.message) : String(error);
      console.warn('Référentiel SIG local refusé.', detail);
      throw new ApiError('GUIERS_UNAVAILABLE', 'Référentiel local absent ou incompatible avec le profil autorisé.', 503);
    });
    return available;
  }
  const selection = (input: { configuration?: unknown; resolution?: unknown; sha?: unknown } | null) => {
    const configuration = (['H', 'E', 'H_PLUS', 'HP_PLUS'] as const).find(c => c === input?.configuration);
    const resolution = ([1000, 500] as const).find(r => r === input?.resolution || String(r) === input?.resolution);
    if (!configuration || !resolution || input?.sha !== profile.candidateSha)
      throw new ApiError('GUIERS_SELECTION', 'Configuration, résolution ou empreinte locale incompatible.', 400);
    return { configuration, resolution };
  };
  app.register(async local => {
    local.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      if (request.raw.socket.remoteAddress !== '127.0.0.1' ||
        request.headers.host !== '127.0.0.1:3001' || !origin || !origins.includes(origin))
        return reply.code(404).send();
      reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin')
        .header('Cache-Control', 'no-store').header('Cross-Origin-Resource-Policy', 'same-site')
        .header('X-Content-Type-Options', 'nosniff');
    });
    local.options('/run', (_request, reply) => reply.code(204)
      .header('Access-Control-Allow-Methods', 'POST').header('Access-Control-Allow-Headers', 'Content-Type').send());
    local.get('/reference', async () => {
      const { raw, mask } = await bundle();
      return { raw, mask, sha: profile.candidateSha, synthetic: profile.synthetic };
    });
    local.get<{ Querystring: { configuration?: string; resolution?: string; sha?: string } }>('/graph', async request => {
      const { configuration, resolution } = selection(request.query);
      const { graphs } = await bundle();
      return graphs[`${configuration === 'H_PLUS' ? 'H' : configuration}_${resolution}`]!.parts;
    });
    let running = false;
    local.post<{ Body: { configuration?: GuiersConfiguration; resolution?: number; sha?: string; parameters?: GuiersLogisticParams } }>(
      '/run', { bodyLimit: 2048 }, async (request, reply) => {
        const { configuration, resolution } = selection(request.body);
        const parameters = request.body?.parameters;
        if (!parameters || Object.keys(parameters).length !== 4 ||
          Object.values(parameters).some(value => typeof value !== 'number'))
          throw new ApiError('GUIERS_PARAMETERS', 'Quatre paramètres numériques sont requis.', 400);
        const { reference, candidate } = await bundle();
        const grid = guiersGrid(reference, configuration, resolution, candidate)!;
        try { guiersLogisticPlan(grid, parameters, 1); }
        catch (error) {
          if (!(error instanceof RangeError)) throw error;
          throw new ApiError('GUIERS_PARAMETERS', error.message, 400);
        }
        if (running) throw new ApiError('ENGINE_BUSY', 'Une simulation SIG locale est en cours.', 503);
        const controller = new AbortController();
        const close = () => { if (!reply.raw.writableEnded) controller.abort(); };
        reply.raw.once('close', close);
        running = true;
        try {
          return await runGuiersLogistic(grid, guiersIdentity(configuration, resolution, reference.hydroSha256, profile.candidateSha),
            parameters, batch => engine.run(batch, controller.signal), 1);
        } finally {
          running = false;
          reply.raw.removeListener('close', close);
        }
      });
  }, { prefix });
}
