import type { RunResult, ScenarioTrajectory } from '@contracts';
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export function resultCsv(result: Pick<RunResult, 'observations'>): string {
  return ['component,time,value', ...result.observations.flatMap(o => o.samples.map(s => `${quote(o.component)},${s.time},${s.value}`))].join('\r\n') + '\r\n';
}

export function scenarioTrajectoryCsv(rows: ScenarioTrajectory[]): string {
  return ['wrapperId,campaignId,scenarioId,status,factors,component,time,value', ...rows.flatMap(r => r.observations.flatMap(o => o.samples.map(s => [quote(r.wrapperId), r.campaignId, r.scenarioId, quote(r.status), quote(JSON.stringify(r.factors)), quote(o.component), s.time, s.value].join(','))))].join('\r\n') + '\r\n';
}
