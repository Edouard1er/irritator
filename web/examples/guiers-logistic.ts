import { caps, parseResult, requestSchema, type RunRequest } from '../packages/contracts/index.js';
import type { GuiersGrid } from '../packages/contracts/guiers-spatial.js';
import { buildRequest } from './logistic-grid.js';
import single from './logistic-single-v1.json' with { type: 'json' };

export const guiersLogisticDefaults = { initialKgM2: 0.0005, capacityKgM2: 0.001, growthPerDay: 0.035, days: 20 };
export type GuiersLogisticParams = typeof guiersLogisticDefaults;
export interface GuiersLogisticResult {
  kind: 'irritator.guiers.autonomous-result'; version: 1; identity: string;
  parameters: GuiersLogisticParams;
  cells: { id: string; samples: { time: number; value: number }[] }[];
}

/** Use the existing QSS3 graph and request limits. Model time is days, biomass is kg. */
export function guiersLogisticPlan(grid: GuiersGrid, parameters: GuiersLogisticParams) {
  const { initialKgM2, capacityKgM2, growthPerDay, days } = parameters;
  if (![initialKgM2, capacityKgM2, growthPerDay, days].every(Number.isFinite) ||
    initialKgM2 < 0 || initialKgM2 > capacityKgM2 || capacityKgM2 <= 0 || growthPerDay < 0 ||
    days < 1 || days > 365 || !Number.isInteger(days)) throw new RangeError('Paramètres logistiques invalides.');
  const cells = grid.cells.map(cell => {
    const capacity = capacityKgM2 * cell.waterAreaM2;
    return { cellId: cell.id, id: cell.id.replaceAll(':', '_'), initial: initialKgM2 * cell.waterAreaM2,
      capacity, quantum: Math.max(1e-9, capacity * 3e-7), growth: growthPerDay };
  });
  const samplingInterval = single.model.observations[0]!.samplingInterval;
  const perCell = Math.ceil(days / samplingInterval) + 2;
  const batchSize = Math.min(Math.floor(caps.maxComponents / single.model.components.length),
    Math.floor(caps.maxConnections / single.model.connections.length),
    requestSchema.properties.model.properties.observations.maxItems, Math.floor(caps.maxPoints / perCell));
  if (batchSize < 1) throw new RangeError('Horizon trop grand pour les limites du runner.');
  const batches = [];
  for (let offset = 0; offset < cells.length; offset += batchSize) {
    const members = cells.slice(offset, offset + batchSize);
    batches.push({ members, request: buildRequest(`guiers-autonomous-${grid.resolutionM}-${batches.length+1}`,
      members, { start: 0, end: days }) });
  }
  return batches;
}

export async function runGuiersLogistic(grid: GuiersGrid, identity: string, parameters: GuiersLogisticParams,
  run: (request: RunRequest) => Promise<unknown>): Promise<GuiersLogisticResult> {
  const cells: GuiersLogisticResult['cells'] = [];
  for (const { members, request } of guiersLogisticPlan(grid, parameters)) {
    const result = parseResult(await run(request), request);
    for (const [i, observation] of result.observations.entries()) {
      const c = members[i]!;
      const samples = observation.samples;
      if (samples[0]!.time !== 0 || Math.abs(samples[0]!.value - c.initial) > 1e-9 * Math.max(1, c.initial) ||
        samples.some(s => s.value < 0 || s.value > c.capacity + Math.max(1e-9, 5 * c.quantum))) {
        throw new Error(`Trajectoire native incohérente pour ${c.cellId}.`);
      }
      cells.push({ id: c.cellId, samples });
    }
  }
  return { kind: 'irritator.guiers.autonomous-result', version: 1, identity, parameters, cells };
}
