import { lakeDistributionId, type LakeDistribution, type LakeDomain, type LakeRunTrace, type SpatialTrajectory } from './spatial-experiment';

export type LakeInputs = { resolution: string; kind: LakeDistribution['kind']; alpha: number };
export type LakeCell = LakeDomain['cells'][number];
export type LakeDisplay = 'ratio' | 'density' | 'difference';
export type LakeScaleMode = 'fixed' | 'month';
export type LakeReading = { time: number; value: number; ratio: number; density: number };
export type LakeDataset = {
  cells: ReadonlyMap<string, LakeCell>;
  trajectories: ReadonlyMap<string, SpatialTrajectory>;
  totals: readonly number[];
  trace: LakeRunTrace;
};

export const lakeDatasetLimit = 3;
export const lakeComparisonMonths = [0, 10, 20];
export const lakePlaybackInterval = 90;
export const lakePlaybackSpeeds = [1, 2, 4] as const;
export const lakeDistributionOptions = [
  { kind: 'homogeneous', label: 'Distribution homogène' },
  { kind: 'gradient', label: 'Gradient nord-sud' },
  { kind: 'wet-gradient', label: 'Gradient pondéré par surface humide' },
] as const;

export const lakeDisplays = {
  ratio: { label: 'Biomasse / capacité', unit: '%', limits: [0, 50, 100], colors: ['#236795', '#e3f3ed', '#218877'] },
  density: { label: 'Densité de biomasse', unit: 't/km²', limits: [0, 150, 300], colors: ['#f0f4fa', '#75a3bf', '#17476b'] },
  difference: { label: 'Écart au scénario homogène', unit: 'points de %', limits: [0, 0, 0], colors: ['#a74a14', '#f6f3eb', '#69389b'] },
} as const;

const paletteSteps = 128;
type ColorStops = readonly [string, string, string];
const lakePalettes = new Map<ColorStops, readonly string[]>(Object.values(lakeDisplays).map(({ colors }) => {
  const channels = colors.map(color => [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16)));
  const palette = Array.from({ length: 2 * paletteSteps + 1 }, (_, index) => {
    const segment = index < paletteSteps ? 0 : 1;
    const weight = index / paletteSteps - segment;
    const rgb = channels[segment]!.map((base, channel) => Math.round(base + (channels[segment + 1]![channel]! - base) * weight));
    return `rgb(${rgb.join(', ')})`;
  });
  return [colors, palette];
}));

export const lakeKey = ({ resolution, kind, alpha }: LakeInputs) =>
  `${resolution}-${lakeDistributionId(kind === 'homogeneous' ? { kind } : { kind, alpha })}`;

export function retainLakeDataset(
  datasets: ReadonlyMap<string, LakeDataset>, key: string, dataset: LakeDataset, protectedKeys: readonly string[],
) {
  const next = new Map(datasets);
  next.delete(key);
  next.set(key, dataset);
  while (next.size > lakeDatasetLimit) {
    const oldest = [...next.keys()].find(id => !protectedKeys.includes(id)) ?? next.keys().next().value!;
    next.delete(oldest);
  }
  return next;
}

export function lakeReading(dataset: LakeDataset | undefined, id: string, tick: number): LakeReading | undefined {
  const cell = dataset?.cells.get(id);
  const sample = dataset?.trajectories.get(id)?.samples[tick];
  if (!cell || !sample) return undefined;
  return { ...sample, ratio: sample.value / cell.capacity, density: sample.value / cell.area };
}

export function lakeMapValue(display: LakeDisplay, reading?: LakeReading, reference?: LakeReading) {
  if (!reading) return undefined;
  if (display === 'ratio') return reading.ratio * 100;
  if (display === 'density') return reading.density;
  return reference ? (reading.ratio - reference.ratio) * 100 : undefined;
}

export function lakeDifferenceLimit(datasets: readonly (LakeDataset | undefined)[], reference?: LakeDataset, tick?: number) {
  if (!reference) return 0;
  let limit = 0;
  for (const dataset of datasets) {
    if (!dataset || dataset === reference) continue;
    for (const [id, trajectory] of dataset.trajectories) {
      const baseline = reference.trajectories.get(id);
      if (!baseline) continue;
      const first = tick ?? 0;
      const end = tick === undefined ? trajectory.samples.length : tick + 1;
      for (let index = first; index < end; index++) {
        const a = trajectory.samples[index];
        const b = baseline.samples[index];
        if (a && b) limit = Math.max(limit, Math.abs(a.value / trajectory.cell.capacity - b.value / baseline.cell.capacity) * 100);
      }
    }
  }
  return limit;
}

export function lakeMapColor(value: number, limits: readonly [number, number, number], display: LakeDisplay) {
  const [min, middle, max] = limits;
  const palette = lakePalettes.get(lakeDisplays[display].colors)!;
  const fraction = min === max ? 1 : value >= middle ? 1 + (value - middle) / (max - middle) : (value - min) / (middle - min);
  const index = Math.max(0, Math.min(palette.length - 1, Math.round(fraction * paletteSteps)));
  return palette[index]!;
}
