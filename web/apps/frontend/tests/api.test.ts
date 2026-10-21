import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '@contracts';
import sum from '../../../examples/sum3.json';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { apiJson, getCatalog, getHealth, runSimulation } from '@/lib/api/client';

afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
describe('Client API — réponses mockées, sans calcul scientifique', () => {
  it('charge les métadonnées du contrat depuis la route', async () => { const fetcher = vi.fn().mockResolvedValue(json(catalog)); vi.stubGlobal('fetch', fetcher); expect(await getCatalog()).toEqual(catalog); expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/components'); });
  it('refuse un catalogue inconnu', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...catalog, components: [] }))); await expect(getCatalog()).rejects.toMatchObject({ code: 'RUNNER_PROTOCOL_ERROR' }); });
  it('accepte les propriétés du même catalogue dans un ordre différent', async () => { const reordered = Object.fromEntries(Object.entries(catalog).reverse()); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(reordered))); await expect(getCatalog()).resolves.toEqual(catalog); });
  it('interprète le handshake du moteur', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ schemaVersion: 1, status: 'ok', backend: 'fastify', runner: { available: true, engineVersion: '0.1.0', adapterVersion: '0.1.0' } }))); await expect(getHealth()).resolves.toMatchObject({ engineVersion: '0.1.0' }); });
  it('une réponse 200 seule ne prouve pas que le moteur fonctionne', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ status: 'ok', runner: { available: false } }))); await expect(getHealth()).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' }); });
  it('signale une connexion HTTP impossible', async () => { vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed'))); await expect(getHealth()).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' }); });
  it.each(['INVALID_MODEL', 'INVALID_CONNECTION', 'INVALID_PARAMETER', 'ENGINE_TIMEOUT', 'LIMIT_EXCEEDED', 'EXECUTION_ERROR', 'INTERNAL_ERROR'])('préserve le code structuré %s', async code => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ status: 'failed', error: { code, message: 'Détail serveur', engineCategory: 2, engineCode: 3 } }, 422)));
    await expect(apiJson('simulations/run')).rejects.toMatchObject({ code, message: 'Détail serveur', engine: { engineCode: 3 } });
  });
  it('identifie un timeout de transport', async () => { vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'))); await expect(apiJson('health')).rejects.toMatchObject({ code: 'ENGINE_TIMEOUT' }); });
  it('rejette une réponse HTML du proxy', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html/>', { status: 502 }))); await expect(apiJson('health')).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' }); });
  it('vérifie la réponse et conserve strictement les timestamps du moteur', async () => {
    const request = serializeModel(deserializeModel(sum));
    const body = { schemaVersion: 1, status: 'completed', modelId: 'test-sum', runId: 'id-test', simulation: { start: 0, end: 3, finalTime: 3, runCalls: 10 }, observations: [{ component: 'sum', samplingInterval: 1, samples: [{ time: 0, value: 10 }, { time: 1, value: 110 }, { time: 2, value: 1110 }] }], diagnostics: { engineVersion: '0.1.0', adapterVersion: '0.1.0', observationPolicy: 'engine-resampled-sealed-deduplicated' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body))); expect(await runSimulation(request)).toEqual(body);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...body, modelId: 'wrong' }))); await expect(runSimulation(request)).rejects.toMatchObject({ code: 'RUNNER_PROTOCOL_ERROR' });
  });
});
