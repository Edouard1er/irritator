import type { Trajectory, Point } from './trajectory';
const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 }).format(n);

/** Rank within this campaign only: labels are comparisons, never management thresholds. */
export function scenarioLabel(run: Trajectory, runs: Trajectory[], fisher: boolean): string {
  if (run.scenarioId === undefined) return run.label;
  const prefix = `Situation ${run.scenarioId + 1}`;
  const e = run.parameters.E, q = run.parameters.q;
  if (!fisher) return `${prefix} — ${e === undefined ? '' : `E = ${fmt(e)}`}${q === undefined ? '' : ` ; q = ${fmt(q)}`}`;
  if (e === undefined) return prefix;
  const group = runs.filter(r => r.group === run.group);
  const efforts = [...new Set(group.map(r => r.parameters.E).filter((n): n is number => n !== undefined))].sort((a,b) => a-b);
  const qs = [...new Set(group.map(r => r.parameters.q).filter((n): n is number => n !== undefined))].sort((a,b) => a-b);
  const rank = efforts.indexOf(e), ratio = efforts.length > 1 ? rank / (efforts.length - 1) : .5;
  const level = efforts.length === 1 ? 'unique' : ratio < 1/3 ? 'faible' : ratio > 2/3 ? 'élevée' : 'intermédiaire';
  const variant = q !== undefined && qs.length > 1 ? ` · variante ${letters(qs.indexOf(q))}` : '';
  return `${prefix} — Pêche ${level}${variant}`;
}
function letters(index: number): string { let s = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }

export type RollingCatch = { value?: number; reason: string; from?: number; to: number };
/** Snap only IEEE-754 roundoff (32 ulps). Never interpolate a cumulative observer. */
export function sampleAt(points: Point[], time: number): number | undefined {
  const tolerance = 32 * Number.EPSILON * Math.max(1, Math.abs(time));
  const point = points.findLast(p => Math.abs(p.time - time) <= tolerance);
  return point && Number.isFinite(point.value) ? point.value : undefined;
}
export function rollingCatch(points: Point[], time: number, timeUnit?: 'month' | 'year'): RollingCatch {
  if (!timeUnit) return { to: time, reason: 'Unité temporelle non déclarée' };
  const from = time - (timeUnit === 'month' ? 12 : 1);
  if (!points.length || from < points[0]!.time - 32 * Number.EPSILON * Math.max(1, Math.abs(time))) return { from, to: time, reason: '12 mois complets non encore disponibles' };
  const current = sampleAt(points, time), previous = sampleAt(points, from);
  if (current === undefined || previous === undefined) return { from, to: time, reason: 'Observation absente à une borne ; aucune interpolation' };
  if (points.some(p => p.time >= from && p.time <= time && (!Number.isFinite(p.value) || p.value < 0)) || points.some((p,i) => i > 0 && p.time > from && p.time <= time && p.value < points[i-1]!.value)) return { from, to: time, reason: 'Cumul incohérent dans la fenêtre' };
  return current >= previous ? { from, to: time, value: current - previous, reason: 'Fenêtre complète · bornes observées' } : { from, to: time, reason: 'Cumul décroissant' };
}

/** Nearest whole pictogram; underlying numeric biomass is never rounded. */
export const fishCount = (biomass?: number, unit?: string): number | undefined => unit === 't' && biomass !== undefined && Number.isFinite(biomass) && biomass >= 0 && Number.isSafeInteger(Math.round(biomass)) ? Math.round(biomass) : undefined;
