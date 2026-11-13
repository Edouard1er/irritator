import { wrapperOccurrences, type Component, type RunRequest } from '@contracts';
import type { HttpResult } from '@/lib/api/client';
import reference from '../../../../examples/wrapper-schaefer-v3.json';

export type Point = { time: number; value: number };
export type SeriesKind = 'biomass_total' | 'catch_cumulative' | 'catch_rate' | 'catch_interval' | 'other';
export type Series = { id: string; kind: SeriesKind; unit: string; points: Point[] };
export type Trajectory = {
  id: string; runId: string; label: string; model: string; timeUnit: string;
  series: Series[]; parameters: Record<string, number>; warnings: string[]; status: string;
  provenance: string; isDemo: false;
};
export type Mapping = { biomass?: string; capture?: string; captureKind?: Exclude<SeriesKind, 'biomass_total' | 'other'> };
export type AlertConfig = { bCrit?: number; proximityRatio: number; slopeTolerance: number };
export type BiomassStatus = 'critical_crossed' | 'near_threshold' | 'declining' | 'favorable' | 'unknown';
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export const modelUnit = 'unité du modèle';

export function classifyBiomassStatus(biomass: number | undefined, trend: number | undefined, config: AlertConfig): BiomassStatus {
  const { bCrit, proximityRatio, slopeTolerance } = config;
  if (!finite(biomass) || !finite(bCrit) || bCrit <= 0 || !finite(proximityRatio) || proximityRatio < 0 || !finite(slopeTolerance) || slopeTolerance < 0) return 'unknown';
  if (!finite(bCrit * (1 + proximityRatio))) return 'unknown';
  if (biomass <= bCrit) return 'critical_crossed';
  if (biomass <= bCrit * (1 + proximityRatio)) return 'near_threshold';
  if (!finite(trend)) return 'unknown';
  return trend < -slopeTolerance ? 'declining' : 'favorable';
}

export const statusInfo: Record<BiomassStatus, { title: string; icon: string; explanation: string; color: string }> = {
  favorable: { title: 'ÉVOLUTION FAVORABLE', icon: '↗', explanation: 'La quantité simulée est au-dessus de la zone d’alerte et ne diminue pas.', color: '#137449' },
  declining: { title: 'BAISSE À SURVEILLER', icon: '↘', explanation: 'La quantité simulée diminue, même si elle reste éloignée du seuil choisi.', color: '#946200' },
  near_threshold: { title: 'ALERTE : SEUIL APPROCHÉ', icon: '⚠', explanation: 'La quantité simulée est dans la zone d’alerte pédagogique.', color: '#a34908' },
  critical_crossed: { title: 'DANGER : SEUIL FRANCHI', icon: '×', explanation: 'La quantité simulée est au niveau du seuil choisi pour l’atelier ou en dessous, même si elle remonte.', color: '#b52b3b' },
  unknown: { title: 'LECTURE À COMPLÉTER', icon: '—', explanation: 'Biomasse, seuil ou tendance non disponible. Aucune alarme ne peut être déduite.', color: '#526676' },
};

/** Stable sort retains simultaneous DEVS observations in source order. Invalid values are gaps. */
export function normalizePoints(points: Point[], warnings: string[]): Point[] {
  const validTimes = points.filter(p => finite(p.time));
  if (validTimes.length !== points.length || points.some(p => !finite(p.value))) warnings.push('Observations non finies : valeurs invalides exclues de la lecture et conservées comme lacunes graphiques.');
  if (validTimes.some((p, i) => i > 0 && p.time < validTimes[i - 1]!.time)) warnings.push('Observations remises dans l’ordre du temps simulé.');
  const sorted = validTimes.map(p => ({ ...p })).sort((a, b) => a.time - b.time);
  if (sorted.some((p, i) => i > 0 && p.time === sorted[i - 1]!.time)) warnings.push('Instants répétés conservés dans l’ordre des observations ; pente indisponible à ces instants.');
  return sorted;
}
export function trendAt(points: Point[], index: number): number | undefined {
  const a = points[index - 1], b = points[index];
  if (!a || !b || !finite(a.value) || !finite(b.value) || b.time <= a.time) return undefined;
  const slope = (b.value - a.value) / (b.time - a.time);
  return finite(slope) ? slope : undefined;
}
export function catchIncrement(points: Point[], index: number): number | undefined {
  const a = points[index - 1], b = points[index];
  if (!a || !b || b.time <= a.time || !finite(a.value) || !finite(b.value) || b.value < a.value) return undefined;
  return b.value - a.value;
}
/** No interpolation: only an observation at exactly the selected instant is shown. */
export function observationAt(points: Point[], time?: number): { point: Point; index: number } | undefined {
  if (time === undefined) return undefined;
  let low = 0, high = points.length;
  while (low < high) { const mid = (low + high) >>> 1; if (points[mid]!.time <= time) low = mid + 1; else high = mid; }
  const index = low - 1, point = points[index];
  return point?.time === time && finite(point.value) ? { point, index } : undefined;
}
export function convertQuantity(value: number, from: string, to: string): number | undefined {
  if (!finite(value)) return undefined;
  if (from === to) return value;
  if (from === 'kg' && to === 't') return value / 1000;
  if (from === 't' && to === 'kg') return value * 1000;
  return undefined;
}
export function convertTime(value: number, from: string, to: string, explicitOrigin: boolean): number | undefined {
  if (!finite(value)) return undefined;
  if (from === to) return value;
  if (!explicitOrigin) return undefined;
  if (from === 'month' && to === 'year') return value / 12;
  if (from === 'year' && to === 'month') return value * 12;
  return undefined;
}

type Scope = Pick<RunRequest['model'], 'components' | 'connections'>;
const canonical = reference.model.definitions[0]!;
const edgeKey = (e: Scope['connections'][number]) => `${e.from.component}:${e.from.port}>${e.to.component}:${e.to.port}`;
/** Recognize the shipped Schaefer graph, never just an atom named N or C. */
function isSchaefer(scope?: Scope): boolean {
  if (!scope || scope.components.length !== canonical.components.length || scope.connections.length !== canonical.connections.length) return false;
  return canonical.components.every(c => scope.components.some(a => a.id === c.id && a.type === c.type &&
    Object.entries(c.parameters).filter(([k]) => k.startsWith('coeff-')).every(([k, v]) => a.parameters[k] === v))) &&
    canonical.connections.every(e => scope.connections.some(a => edgeKey(a) === edgeKey(e)));
}
function parameters(scope?: Scope): Record<string, number> {
  const p: Record<string, number> = {};
  for (const c of scope?.components ?? []) {
    const value = c.id === 'N' ? c.parameters.X : c.parameters.value;
    if (['N', 'r', 'q', 'E', 'a', 'InvK'].includes(c.id) && finite(value)) p[c.id === 'N' ? 'B0/N0' : c.id] = value;
  }
  if (p.InvK !== undefined && p.InvK > 0) { p.K = 1 / p.InvK; delete p.InvK; }
  return p;
}
function scopeAt(request: RunRequest, path: string): Scope | undefined {
  let scope: Scope | undefined = request.model;
  for (const id of path.split('/').filter(Boolean)) {
    const c: Component | undefined = scope?.components.find(c => c.id === id);
    const definition: string | undefined = c?.definition ?? (c?.type.startsWith('coupled:') ? c.type.slice(8) : undefined);
    scope = request.model.definitions?.find(d => d.id === definition);
  }
  return scope;
}
export function normalizeRun(result: HttpResult, request: RunRequest): Trajectory[] {
  const make = (id: string, label: string, observations: HttpResult['observations'], scope: Scope | undefined, status: string, params?: Record<string, number>): Trajectory => {
    const warnings: string[] = [];
    const series = observations.map(o => {
      const parts = o.component.split('/'); const atom = parts.pop()!;
      const known = isSchaefer(scope ?? scopeAt(request, parts.join('/')));
      const kind: SeriesKind = known ? atom === 'N' ? 'biomass_total' : atom === 'C' ? 'catch_cumulative' : atom === 'qaEN' ? 'catch_rate' : 'other' : 'other';
      const points = normalizePoints(o.samples, warnings);
      if (kind === 'biomass_total' && points.some(p => p.value <= 0)) warnings.push('Biomasse nulle ou négative observée : vérifier les hypothèses du modèle.');
      if (kind.startsWith('catch_') && points.some((p, i) => p.value < 0 || (kind === 'catch_cumulative' && i > 0 && p.value < points[i - 1]!.value))) warnings.push('Anomalie de capture : valeur négative ou cumul décroissant.');
      return { id: o.component, kind, unit: modelUnit, points };
    });
    return { id, runId: result.runId, label, model: result.modelId, timeUnit: modelUnit, series, parameters: params ?? {}, warnings: [...new Set(warnings)], status, provenance: `${result.diagnostics.engineVersion} / ${result.diagnostics.adapterVersion}`, isDemo: false };
  };
  const runs: Trajectory[] = [];
  // Separate coupled occurrences: never pair lake A's N with lake B's C.
  const groups = new Map<string, HttpResult['observations']>();
  for (const observation of result.observations) {
    const prefix = observation.component.split('/').slice(0, -1).join('/');
    const group = groups.get(prefix) ?? []; group.push(observation); groups.set(prefix, group);
  }
  for (const [prefix, observations] of groups) {
    const scope = scopeAt(request, prefix);
    runs.push(make(prefix ? `root:${prefix}` : 'root', `Exécution principale${prefix ? ` · ${prefix}` : ''}`, observations, scope, result.status, isSchaefer(scope) ? parameters(scope) : {}));
  }
  if (result.schemaVersion === 2) {
    const occurrences = wrapperOccurrences(request);
    for (const row of result.scenarioTrajectories ?? []) {
      const experiment = occurrences.find(o => o.component === row.wrapperId)?.experiment;
      const scope = request.model.definitions?.find(d => d.id === experiment?.definition);
      const params = isSchaefer(scope) ? parameters(scope) : {};
      for (const factor of experiment?.factors ?? []) { const value = row.factors[factor.id]; if (finite(value)) params[factor.target === 'N' ? 'B0/N0' : factor.target] = value; }
      if (params.InvK !== undefined && params.InvK > 0) { params.K = 1 / params.InvK; delete params.InvK; }
      runs.push(make(`${row.wrapperId}:${row.campaignId}:${row.scenarioId}`, `${row.wrapperId} · campagne ${row.campaignId} · situation ${row.scenarioId + 1} — ${Object.entries(row.factors).map(([k, v]) => `${k}=${v}`).join(', ')}`, row.observations, scope, row.status, params));
    }
  }
  return runs;
}
export function applyMapping(run: Trajectory, mapping?: Mapping): Trajectory {
  if (!mapping) return run;
  const series: Series[] = run.series.map(s => ({ ...s, kind: s.id === mapping.biomass ? 'biomass_total' : s.id === mapping.capture ? mapping.captureKind ?? 'catch_cumulative' : 'other' }));
  const warnings = [...run.warnings];
  for (const s of series) {
    if (s.kind === 'biomass_total' && s.points.some(p => p.value <= 0)) warnings.push('Biomasse nulle ou négative observée : vérifier les hypothèses du modèle.');
    if (s.kind.startsWith('catch_') && s.points.some((p, i) => p.value < 0 || (s.kind === 'catch_cumulative' && i > 0 && p.value < s.points[i - 1]!.value))) warnings.push('Anomalie de capture : valeur négative ou cumul décroissant.');
  }
  return { ...run, series, warnings: [...new Set(warnings)] };
}
