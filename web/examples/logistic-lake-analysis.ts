import type { LakeDomain } from './logistic-grid.js';
import { runLakeBatches, type LakeReference } from './logistic-lake-run.js';

export function lakeReference({ parameters, cells }: LakeDomain): LakeReference {
  const { start, end } = parameters.simulation;
  const ticks = Math.round((end - start) / parameters.samplingInterval) + 1;
  const distribution = parameters.distribution;
  if (distribution.kind === 'homogeneous' || distribution.alpha === 0) {
    // Keep the historical floating-point order for homogeneous trace diagnostics.
    const ratios = Array.from({ length: ticks }, (_, tick) =>
      1 / (1 + (parameters.capacityDensity / parameters.initialDensity - 1) * Math.exp(-parameters.growth * tick * parameters.samplingInterval)));
    const capacity = parameters.areaKm2 * parameters.capacityDensity;
    return { local: cells.map(cell => ratios.map(ratio => cell.capacity * ratio)),
      total: ratios.map(ratio => capacity * ratio) };
  }

  const total = Array<number>(ticks).fill(0);
  const local = cells.map(({ initial, capacity, growth }) => Array.from({ length: ticks }, (_, tick) => {
    const time = tick * parameters.samplingInterval;
    const value = capacity / (1 + (capacity / initial - 1) * Math.exp(-growth * time));
    total[tick] = total[tick]! + value;
    return value;
  }));
  return { local, total };
}

export function runLakeSimulation(domain: LakeDomain, execute: Parameters<typeof runLakeBatches>[2],
  options?: Parameters<typeof runLakeBatches>[3]) {
  return runLakeBatches(domain, lakeReference(domain), execute, options);
}
