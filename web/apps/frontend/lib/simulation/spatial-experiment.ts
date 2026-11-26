import { catalog, validateRequest, type RunRequest } from '@contracts';
import { ClientError, runSimulation, type HttpResult } from '@/lib/api/client';
import { spatialRequest, type SpatialDimension } from '../../../../examples/logistic-grid';

export { spatialRequest, type SpatialDimension };
export { constantDomain, constantDomainCell, lakeSurfaceAreaKm2, spatialDimensions, type LakeDomain, type SpatialMode } from '../../../../examples/logistic-grid';
export { clipLakeMesh, lakeDefaultGradientProfile, lakeDistributionId, lakeDistributionProfile, lakeGradientProfiles, lakeMaxAlpha,
  lakeMeshFromGeoJson, lakeResolutionId, lakeResolutions,
  type LakeDistribution, type LakeGradientProfile, type LakeMesh } from '../../../../examples/logistic-lake';
export { LakeRunError, runLakeBatches, type LakePlan, type LakeExchangePlan, type LakeFullNetworkPlan, type LakeNetworkPlan, type LakeRunTrace } from '../../../../examples/logistic-lake-run';
export { lakeExchangeIntensities, lakeExchangeResolutions, lakeExchangeFlux, type LakeExchange, type LakeExchangeInputs,
  type LakeExchangeIntensity } from '../../../../examples/logistic-lake-exchange';
export { lakeWetFrontier, type WetFrontier } from '../../../../examples/lake-wet-frontier';
export { lakeNetworkConnected, lakeNetworkSize, type LakeNetworkInputs } from '../../../../examples/logistic-lake-network';
export { lakeFullNetworkResolution, lakeFullTopology } from '../../../../examples/lake-full-topology';
export type { LakeFullNetworkInputs } from '../../../../examples/logistic-lake-full-network';

export async function runLakeBatch(request: RunRequest, signal: AbortSignal): Promise<HttpResult> {
  // ENGINE_BUSY is issued before the native process is started.
  for (const delay of [200, 400, 800, 1600]) {
    signal.throwIfAborted();
    try { return await runSimulation(request, signal); }
    catch (cause) {
      if (!(cause instanceof ClientError && cause.code === 'ENGINE_BUSY')) throw cause;
    }
    const wait = AbortSignal.any([signal, AbortSignal.timeout(delay)]);
    if (!wait.aborted) await new Promise<void>(resolve => wait.addEventListener('abort', () => resolve(), { once: true }));
  }
  signal.throwIfAborted();
  return runSimulation(request, signal);
}

type SpatialSample = HttpResult['observations'][number]['samples'][number];

export type SpatialCell = {
  id: string;
  component: string;
  row: number;
  column: number;
  initial: number;
  growth: number;
  capacity: number;
  quantum: number;
  samplingInterval: number;
};

export type SpatialTrajectory = {
  cell: SpatialCell;
  samples: readonly SpatialSample[];
  constant: boolean;
  start: number;
  end: number;
};

export type SpatialReading = SpatialSample & {
  ratio: number;
  source: 'native' | 'equilibrium';
};

export type SpatialTotal = { time: number; value: number | null };

export function spatialTotals(trajectories: readonly SpatialTrajectory[], timeline: readonly number[]): SpatialTotal[] {
  return timeline.map(time => {
    if (trajectories.length === 0) return { time, value: null };

    let value = 0;
    for (const trajectory of trajectories) {
      const reading = spatialReading(trajectory, time);
      if (!reading) return { time, value: null };
      value += reading.value;
    }
    return { time, value };
  });
}

export type SpatialDraft = { initial: string; growth: string; capacity: string };
export type SpatialDrafts = Record<string, SpatialDraft>;
export type SpatialDraftErrors = Record<string, Partial<Record<keyof SpatialDraft, string>>>;

type ApplyResult =
  | { ok: true; request: RunRequest; cells: SpatialCell[] }
  | { ok: false; errors: SpatialDraftErrors; message: string };

const atomParameters = {
  initial: { type: 'qss3_integrator', parameter: 'X', rangeError: 'La biomasse initiale doit être positive ou nulle.' },
  growth: { type: 'constant', parameter: 'value', rangeError: 'Le taux de croissance doit être strictement positif.' },
  capacity: { type: 'qss3_wsum_2', parameter: 'coeff-1', rangeError: 'La capacité doit être strictement positive.' },
};

function parseParameter(raw: string, field: keyof SpatialDraft): { value: number; encoded: number } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: 'Saisissez une valeur.' };
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    return { error: 'Saisissez un nombre fini.' };
  }

  const parsed = Number(text.replace(',', '.'));
  if (!Number.isFinite(parsed)) return { error: 'Saisissez un nombre fini.' };
  const value = parsed === 0 ? 0 : parsed;
  if (value === 0 && /[1-9]/.test(text.split(/e/i, 1)[0]!)) {
    return { error: 'La valeur est trop proche de zéro pour être représentée.' };
  }

  const { type, parameter, rangeError } = atomParameters[field];
  if (value < 0 || (field !== 'initial' && value === 0)) return { error: rangeError };
  const encoded = field === 'capacity' ? -1 / value : value;
  if (!Number.isFinite(encoded)) return { error: 'Le coefficient −1/K ne peut pas être représenté.' };
  const bounds = catalog.components.find(component => component.type === type)?.parameters[parameter];
  if (!bounds || encoded < bounds.minimum || encoded > bounds.maximum) {
    return { error: field === 'capacity'
      ? 'Le coefficient −1/K dépasse les limites du catalogue Irritator.'
      : 'La valeur dépasse les limites du catalogue Irritator.' };
  }
  return { value, encoded };
}

// The runner's grid accumulates the sampling interval in floating point.
function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) <= 32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

export function spatialCells(request: RunRequest): SpatialCell[] {
  const atoms = new Map(request.model.components.map(atom => [atom.id, atom.parameters]));
  return request.model.observations.map(({ component, samplingInterval }) => {
    const id = component.slice(0, -2);
    const initial = atoms.get(component)?.X;
    const quantum = atoms.get(component)?.dQ;
    const growth = atoms.get(`${id}-r`)?.value;
    const lossWeight = atoms.get(`${id}-sum`)?.['coeff-1'];
    if (!/^C[0-5][0-3]-N$/.test(component) || initial === undefined || quantum === undefined ||
        growth === undefined || lossWeight === undefined || lossWeight >= 0) {
      throw new Error(`Paramètres de la cellule ${component} indisponibles.`);
    }
    return { id, component, row: Number(id[1]), column: Number(id[2]), initial, growth,
      capacity: -1 / lossWeight, quantum, samplingInterval };
  });
}

export function spatialResize(base: RunRequest, baseCells: readonly SpatialCell[], dimension: SpatialDimension) {
  const request = spatialRequest(dimension);
  const previousParameters = new Map(base.model.components.map(atom => [atom.id, atom.parameters]));
  for (const atom of request.model.components) {
    const parameters = previousParameters.get(atom.id);
    if (parameters) atom.parameters = { ...parameters };
  }
  if (base.limits) request.limits = { ...base.limits };
  validateRequest(request);

  const previousCells = new Map(baseCells.map(cell => [cell.id, cell]));
  const cells = spatialCells(request).map(cell => ({
    ...cell,
    // Keep the declared capacity instead of introducing a second reciprocal rounding.
    capacity: previousCells.get(cell.id)?.capacity ?? cell.capacity,
  }));
  return { request, cells };
}

export function spatialDrafts(cells: readonly SpatialCell[]): SpatialDrafts {
  return Object.fromEntries(cells.map(({ id, initial, growth, capacity }) => [id, {
    initial: String(initial), growth: String(growth), capacity: String(capacity),
  }]));
}

export function spatialApply(base: RunRequest, drafts: SpatialDrafts, baseCells: readonly SpatialCell[] = spatialCells(base)): ApplyResult {
  const errors: SpatialDraftErrors = {};
  const patches = new Map<string, { parameter: string; value: number }>();
  const cells = baseCells.map(cell => {
    const draft = drafts[cell.id];
    if (!draft) return cell;

    const initial = parseParameter(draft.initial, 'initial');
    const growth = parseParameter(draft.growth, 'growth');
    const capacity = parseParameter(draft.capacity, 'capacity');
    if ('error' in initial || 'error' in growth || 'error' in capacity) {
      errors[cell.id] = {
        ...('error' in initial ? { initial: initial.error } : {}),
        ...('error' in growth ? { growth: growth.error } : {}),
        ...('error' in capacity ? { capacity: capacity.error } : {}),
      };
      return cell;
    }

    patches.set(cell.component, { parameter: 'X', value: initial.encoded });
    patches.set(`${cell.id}-r`, { parameter: 'value', value: growth.encoded });
    patches.set(`${cell.id}-sum`, { parameter: 'coeff-1', value: capacity.encoded });
    return { ...cell, initial: initial.value, growth: growth.value, capacity: capacity.value };
  });

  if (Object.keys(errors).length) {
    return { ok: false, errors, message: 'Corrigez les paramètres signalés avant de lancer la simulation.' };
  }

  const request = structuredClone(base);
  for (const atom of request.model.components) {
    const patch = patches.get(atom.id);
    if (patch) atom.parameters[patch.parameter] = patch.value;
  }
  try {
    validateRequest(request);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    return { ok: false, errors, message: `Le contrat Irritator a rejeté le modèle modifié.${detail}` };
  }
  return { ok: true, request, cells };
}

export function spatialTimeline(request: RunRequest): number[] {
  return samplingTimeline(request.simulation, request.model.observations[0]?.samplingInterval);
}

export function samplingTimeline({ start, end }: RunRequest['simulation'], interval?: number): number[] {
  if (interval === undefined) return [];

  const count = Math.ceil((end - start) / interval);
  const ticks = Array.from({ length: count }, (_, tick) => start + tick * interval);
  return [...ticks.filter(time => time < end && !sameTime(time, end)), end];
}

export function spatialTrajectories(request: RunRequest, result: HttpResult, cells: readonly SpatialCell[] = spatialCells(request)): SpatialTrajectory[] {
  const { start, finalTime: end } = result.simulation;
  const byComponent = new Map(result.observations.map(observation => [observation.component, observation.samples]));
  return cells.map(cell => {
    const samples = byComponent.get(cell.component) ?? [];
    const first = samples[0];
    // At a known equilibrium, the native observer omits repeated identical values.
    const constant = (cell.initial === 0 || cell.initial === cell.capacity) &&
      first !== undefined && sameTime(first.time, start) && samples.every(sample => sample.value === cell.initial);
    return { cell, samples, constant, start, end };
  });
}

export function spatialReading(trajectory: SpatialTrajectory, time: number): SpatialReading | null {
  if (!Number.isFinite(time) || time < trajectory.start || time > trajectory.end) return null;

  let left = 0;
  let right = trajectory.samples.length;
  let native: SpatialSample | undefined;
  while (left < right) {
    const index = Math.floor((left + right) / 2);
    const sample = trajectory.samples[index]!;
    if (sameTime(sample.time, time)) { native = sample; break; }
    if (sample.time < time) left = index + 1;
    else right = index;
  }
  const sample = native ?? (trajectory.constant ? trajectory.samples[0] : undefined);
  return sample ? { ...sample, ratio: sample.value / trajectory.cell.capacity,
    source: native ? 'native' : 'equilibrium' } : null;
}

export function spatialChartSamples(trajectory: SpatialTrajectory, end = trajectory.end): readonly SpatialSample[] {
  const last = trajectory.samples.at(-1);
  if (trajectory.constant && last && last.time < end && end <= trajectory.end && !sameTime(last.time, end)) {
    return [...trajectory.samples, { time: end, value: last.value }];
  }
  return trajectory.samples;
}
