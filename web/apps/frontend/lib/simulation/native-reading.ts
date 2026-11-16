import type { HttpResult } from '@/lib/api/client';
import type { RunRequest } from '@contracts';
import { scientificFingerprint } from '@/lib/modeling/model';
import { modelUnit, normalizeRun, observationAt, type Trajectory } from './trajectory';

export type NativeReading = {
  source: 'irritator-native-run'; runId: string; trajectoryId: string; modelId: string;
  observationIndex: number; time: number; timeUnit: string;
  biomass: { value: number; unit: string; sourceSeriesId: string };
  cumulativeCatch?: { value: number; unit: string; sourceSeriesId: string };
  relativeToStart?: { ratio: number; delta: number; baseline: number };
  status: string; warnings: string[];
};
export type NativeProjection = { kind: 'unavailable'; reason: string } | { kind: 'ready'; reading: NativeReading };

/** Pure projection of ONE normalized trajectory and ONE existing biomass sample. */
export function nativeReadingAt(run: Trajectory, index: number): NativeProjection {
  const biomass = run.series.find(s => s.kind === 'biomass_total');
  const point = biomass?.points[index];
  if (!run.runId || !run.id || !run.model || !['completed','partial'].includes(run.status) || !Number.isInteger(index) || index < 0 || !point || !Number.isFinite(point.time) || !Number.isFinite(point.value))
    return {kind:'unavailable',reason:'Pas de biomasse observée valide à cet instant. Nous pouvons en parler sans calcul.'};
  const capture = run.series.find(s => s.kind === 'catch_cumulative');
  const caught = capture && observationAt(capture.points, point.time);
  const first = biomass!.points.find(p => Number.isFinite(p.time) && Number.isFinite(p.value));
  const ratio = first && point.value / first.value, delta = first && point.value - first.value;
  const relative = first && first.value > 0 && point.value >= 0 && ['t','kg'].includes(biomass!.unit) && Number.isFinite(ratio) && Number.isFinite(delta);
  return {kind:'ready',reading:{
    source:'irritator-native-run',runId:run.runId,trajectoryId:run.id,modelId:run.model,observationIndex:index,
    time:point.time,timeUnit:run.timeUnit || modelUnit,
    biomass:{value:point.value,unit:biomass!.unit || modelUnit,sourceSeriesId:biomass!.id},
    ...(caught ? {cumulativeCatch:{value:caught.point.value,unit:capture!.unit || modelUnit,sourceSeriesId:capture!.id}} : {}),
    ...(relative ? {relativeToStart:{ratio:ratio!,delta:delta!,baseline:first!.value}} : {}),
    status:run.status,warnings:[...run.warnings,
      ...(point.value<0?['Valeur négative : lecture relative indisponible.']:[]),
      ...(run.status==='partial'?['Le calcul s’arrête ici ; aucune valeur au-delà du dernier point livré.']:[])]
  }};
}

export function nativeResultCurrent(result: HttpResult | undefined, executed: RunRequest | undefined, current: RunRequest, blocked = false): boolean {
  if (blocked || !result?.runId || !executed || executed.schemaVersion !== 3 || !executed.temporal || result.modelId !== executed.model.id || scientificFingerprint(executed) !== scientificFingerprint(current)) return false;
  return normalizeRun(result,executed).some(run => run.series.find(s=>s.kind==='biomass_total')?.points.some((_,i)=>nativeReadingAt(run,i).kind==='ready'));
}
