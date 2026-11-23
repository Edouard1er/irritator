import { attachResultUnits, catalog, runnerCapabilities, parseResult, parseWrapperResult, validateRequest, type RunRequest, type RunResult, type RunResultV2, type StructuralDiagnostic } from '@contracts';
import type { Catalog } from '@/lib/modeling/model';

export class ClientError extends Error {
  constructor(public code: string, message: string, public httpStatus = 0, public engine?: { engineCategory?: number; engineCode?: number }, public diagnostics?: StructuralDiagnostic[]) { super(message); }
}
export type HttpResult = (RunResult | RunResultV2) & { runId: string };
function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : v;
  return JSON.stringify(normalize(value));
}
export async function apiJson(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(`/api/v1/${path}`, { ...init, cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(65000) }); }
  catch (e) {
    if (e && typeof e === 'object' && 'name' in e && e.name === 'TimeoutError') throw new ClientError('ENGINE_TIMEOUT', 'Le délai de réponse HTTP est dépassé.');
    throw new ClientError('ENGINE_UNAVAILABLE', 'Fastify est inaccessible. Vérifiez le serveur local sur le port 3001.');
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ClientError(response.ok ? 'RUNNER_PROTOCOL_ERROR' : 'ENGINE_UNAVAILABLE', `Réponse HTTP ${response.status} sans document JSON valide.`, response.status); }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; engineCategory?: number; engineCode?: number; diagnostics?: StructuralDiagnostic[] } } | null)?.error;
    throw new ClientError(error?.code ?? 'HTTP_ERROR', error?.message ?? `Erreur HTTP ${response.status}.`, response.status, error, error?.diagnostics);
  }
  return body;
}
export async function getHealth(): Promise<{ engineVersion: string; adapterVersion: string; wrapperAvailable: boolean }> {
  const body = await apiJson('health') as { schemaVersion?: number; status?: string; backend?: string; runner?: { available?: boolean; engineVersion?: string; adapterVersion?: string; capabilities?: unknown } } | null;
  if (body?.schemaVersion !== 1 || body.status !== 'ok' || body.backend !== 'fastify' || body.runner?.available !== true || body.runner.engineVersion !== catalog.engineVersion || body.runner.adapterVersion !== catalog.adapterVersion) throw new ClientError('ENGINE_UNAVAILABLE', 'Le handshake du moteur n’a pas été confirmé.');
  return { engineVersion: body.runner.engineVersion, adapterVersion: body.runner.adapterVersion, wrapperAvailable: canonicalJson(body.runner.capabilities) === canonicalJson(runnerCapabilities) };
}
export async function getCatalog(): Promise<Catalog> {
  const body = await apiJson('components');
  // The shared Test 4 contract is the only metadata definition. No UI fallback catalogue.
  if (canonicalJson(body) !== canonicalJson(catalog)) throw new ClientError('RUNNER_PROTOCOL_ERROR', 'Le catalogue reçu ne correspond pas au contrat v1 partagé.');
  return body as Catalog;
}
export async function runSimulation(request: RunRequest, signal?: AbortSignal): Promise<HttpResult> {
  validateRequest(request);
  const body = await apiJson('simulations/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    ...(signal ? { signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]) } : {}) });
  try {
    const result = request.schemaVersion === 3 ? parseWrapperResult(body, request) : parseResult(body, request);
    const runId = (body as { runId?: unknown }).runId;
    if (typeof runId !== 'string' || !runId) throw new Error('runId');
    return { ...attachResultUnits(result, request), runId };
  } catch { throw new ClientError('RUNNER_PROTOCOL_ERROR', 'Les trajectoires reçues sont incohérentes avec la requête.'); }
}
export function errorText(error: unknown): string {
  if (error instanceof ClientError) return `${error.code} · ${error.message}${error.engine?.engineCode !== undefined ? ` (moteur ${error.engine.engineCategory}/${error.engine.engineCode})` : ''}`;
  if (error instanceof Error) return `${'code' in error ? `${String(error.code)} · ` : ''}${error.message}`;
  return 'Erreur inconnue.';
}
