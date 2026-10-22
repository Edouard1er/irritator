import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog, runnerCapabilities } from '@contracts';
import { errorText, getHealth, runSimulation } from '@/lib/api/client';
import { affine, resultFixture } from './wrapper-fixtures';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
describe('transport v3 et négociation v2 — fixtures unitaires uniquement', () => {
  it.each([undefined, { ...runnerCapabilities, requestVersions: [1, 2] }, { ...runnerCapabilities, wrapper: { implementation: 'unknown' } }])('n’active pas le wrapper avec des capacités absentes ou incohérentes', async capabilities => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ schemaVersion: 1, status: 'ok', backend: 'fastify', runner: { available: true, engineVersion: catalog.engineVersion, adapterVersion: catalog.adapterVersion, capabilities } })));
    expect((await getHealth()).wrapperAvailable).toBe(false);
  });
  it('active le wrapper après correspondance complète du handshake 7D', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ schemaVersion: 1, status: 'ok', backend: 'fastify', runner: { available: true, engineVersion: catalog.engineVersion, adapterVersion: catalog.adapterVersion, capabilities: runnerCapabilities } })));
    expect((await getHealth()).wrapperAvailable).toBe(true);
  });
  it('valide et envoie le JSON v3 complet et conserve les événements à dates répétées', async () => {
    const result = resultFixture(); result.resultEvents.push({ ...result.resultEvents[0]!, bag: 4 });
    const body = { ...result, runId: 'unit-v3' }, fetcher = vi.fn().mockResolvedValue(json(body)); vi.stubGlobal('fetch', fetcher);
    expect(await runSimulation(affine())).toEqual(body); expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(affine());
  });
  it('rejette localement le document invalide avant tout POST', async () => {
    const r = affine(); r.model.components[1]!.experiment!.factors[0]!.parameter = 'dQ' as 'X'; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(runSimulation(r)).rejects.toMatchObject({ code: 'INVALID_MODEL' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { schemaVersion: 1 }, { status: 'failed' }, { runId: '' }, { resultEvents: [{ component: 'decision', time: 1, port: 0, bag: 3, value: [3] }] },
    { wrappers: [] }, { simulation: { start: 0, end: 3, finalTime: 3, runCalls: 0 } },
  ])('refuse une version, un statut ou une enveloppe de résultat incohérent : %j', async change => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...resultFixture(), runId: 'unit-v3', ...change }))); await expect(runSimulation(affine())).rejects.toMatchObject({ code: 'RUNNER_PROTOCOL_ERROR' });
  });
  it('expose les codes HTTP et diagnostics du moteur sans résultat synthétique', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ schemaVersion: 1, status: 'failed', error: { code: 'EXECUTION_ERROR', message: 'Native failure', engineCategory: 2, engineCode: 9 } }, 422)));
    const error = await runSimulation(affine()).catch(e => e); expect(errorText(error)).toBe('EXECUTION_ERROR · Native failure (moteur 2/9)');
  });
});
