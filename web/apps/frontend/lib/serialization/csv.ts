import type { RunResult, ScenarioTrajectory } from '@contracts';
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export function resultCsv(result: Pick<RunResult, 'observations'>): string {
  const units = result.observations.some(o => o.unit || o.timeUnit);
  return [`component,time,value${units ? ',timeUnit,unit' : ''}`, ...result.observations.flatMap(o => o.samples.map(s => `${quote(o.component)},${s.time},${s.value}${units ? `,${quote(o.timeUnit ?? '')},${quote(o.unit ?? '')}` : ''}`))].join('\r\n') + '\r\n';
}

export function scenarioTrajectoryCsv(rows: ScenarioTrajectory[]): string {
  const units = rows.some(r => r.observations.some(o => o.unit || o.timeUnit));
  return [`wrapperId,campaignId,scenarioId,status,factors,component,time,value${units ? ',timeUnit,unit' : ''}`, ...rows.flatMap(r => r.observations.flatMap(o => o.samples.map(s => [quote(r.wrapperId), r.campaignId, r.scenarioId, quote(r.status), quote(JSON.stringify(r.factors)), quote(o.component), s.time, s.value, ...(units ? [quote(o.timeUnit ?? ''),quote(o.unit ?? '')] : [])].join(','))))].join('\r\n') + '\r\n';
}
