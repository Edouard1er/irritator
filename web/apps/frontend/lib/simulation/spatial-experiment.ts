import { validateRequest, type RunRequest } from '@contracts';
import type { HttpResult } from '@/lib/api/client';
import fixture from '../../../../examples/logistic-nine-cells-v1.json';

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

// The runner's grid accumulates the sampling interval in floating point.
function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) <= 32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

export function spatialRequest(): RunRequest {
  const request: unknown = structuredClone(fixture);
  validateRequest(request);
  return request;
}

export function spatialCells(request: RunRequest): SpatialCell[] {
  const atoms = new Map(request.model.components.map(atom => [atom.id, atom.parameters]));
  return request.model.observations.map(({ component, samplingInterval }) => {
    const id = component.slice(0, -2);
    const initial = atoms.get(component)?.X;
    const quantum = atoms.get(component)?.dQ;
    const growth = atoms.get(`${id}-r`)?.value;
    const lossWeight = atoms.get(`${id}-sum`)?.['coeff-1'];
    if (!/^C[0-2][0-2]-N$/.test(component) || initial === undefined || quantum === undefined ||
        growth === undefined || lossWeight === undefined || lossWeight >= 0) {
      throw new Error(`Paramètres de la cellule ${component} indisponibles.`);
    }
    return { id, component, row: Number(id[1]), column: Number(id[2]), initial, growth,
      capacity: -1 / lossWeight, quantum, samplingInterval };
  });
}

export function spatialTimeline(request: RunRequest): number[] {
  const { start, end } = request.simulation;
  const interval = request.model.observations[0]?.samplingInterval;
  if (interval === undefined) return [];

  const count = Math.ceil((end - start) / interval);
  const ticks = Array.from({ length: count }, (_, tick) => start + tick * interval);
  return [...ticks.filter(time => time < end && !sameTime(time, end)), end];
}

export function spatialTrajectories(request: RunRequest, result: HttpResult): SpatialTrajectory[] {
  const { start, finalTime: end } = result.simulation;
  const byComponent = new Map(result.observations.map(observation => [observation.component, observation.samples]));
  return spatialCells(request).map(cell => {
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

  const native = trajectory.samples.find(sample => sameTime(sample.time, time));
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
