import type { RunResult } from '@contracts';
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export function resultCsv(result: Pick<RunResult, 'observations'>): string {
  return ['component,time,value', ...result.observations.flatMap(o => o.samples.map(s => `${quote(o.component)},${s.time},${s.value}`))].join('\r\n') + '\r\n';
}
