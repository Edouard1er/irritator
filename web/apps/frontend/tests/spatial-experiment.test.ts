import { describe, expect, it } from 'vitest';
import type { HttpResult } from '@/lib/api/client';
import {
  spatialCells, spatialChartSamples, spatialReading, spatialRequest, spatialTimeline, spatialTrajectories,
} from '@/lib/simulation/spatial-experiment';

const nativeSamples = [
  { component: 'C11-N', samplingInterval: 0.1, samples: [{ time: 0, value: 380 }, { time: 19.900000000000013, value: 300.05 }] },
  { component: 'C10-N', samplingInterval: 0.1, samples: [{ time: 0, value: 300 }] },
  { component: 'C01-N', samplingInterval: 0.1, samples: [{ time: 0, value: 60 }] },
  { component: 'C00-N', samplingInterval: 0.1, samples: [{ time: 0, value: 0 }] },
];

function nativeResult(observations = nativeSamples): HttpResult {
  return {
    status: 'completed', schemaVersion: 1, modelId: 'logistic-nine-cells', runId: 'lot-1.4', observations,
    simulation: { start: 0, end: 20, finalTime: 20, runCalls: 1777 },
    diagnostics: { engineVersion: '0.1.0', adapterVersion: '0.1.0', observationPolicy: 'engine-resampled-sealed-deduplicated' },
  };
}

describe('Expérience logistique spatiale', () => {
  it('prépare une requête indépendante et lit les neuf cellules dans l’ordre de la grille', () => {
    const request = spatialRequest();
    const cells = spatialCells(request);
    expect(cells.map(({ row, column }) => [row, column])).toEqual([
      [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2],
    ]);
    expect(cells.map(cell => cell.initial)).toEqual([0, 60, 150, 300, 380, 80, 220, 270, 50]);
    expect(cells.every(({ capacity, growth, quantum, samplingInterval }) =>
      capacity === 300 && growth === 0.35 && quantum === 0.01 && samplingInterval === 0.1)).toBe(true);
    request.model.components[0]!.parameters.X = 200;
    expect(spatialCells(spatialRequest())[0]!.initial).toBe(0);
  });

  it('produit les ticks d’observation jusqu’à la borne terminale', () => {
    const request = spatialRequest();
    const ticks = spatialTimeline(request);
    expect(ticks).toHaveLength(201);
    expect([ticks[0], ticks[1], ticks[199], ticks[200]]).toEqual([0, 0.1, 19.900000000000002, 20]);
    request.simulation.end = 0.25;
    expect(spatialTimeline(request)).toEqual([0, 0.1, 0.2, 0.25]);
  });

  it('associe les observations par identifiant et conserve leurs horodatages natifs', () => {
    const request = spatialRequest();
    const result = nativeResult();
    const trajectories = spatialTrajectories(request, result);
    const active = trajectories.find(({ cell }) => cell.id === 'C11')!;

    expect(active.samples).toBe(result.observations[0]!.samples);
    expect(spatialReading(active, 0)).toEqual({ time: 0, value: 380, ratio: 380 / 300, source: 'native' });
    expect(spatialReading(active, 19.9)).toEqual({
      time: 19.900000000000013, value: 300.05, ratio: 300.05 / 300, source: 'native',
    });
    expect(spatialReading(active, 19.8)).toBeNull();
    expect(spatialReading(active, 20)).toBeNull();
    expect(spatialChartSamples(active)).toBe(active.samples);
  });

  it('prolonge les équilibres confirmés seulement à l’intérieur de l’horizon simulé', () => {
    const trajectories = spatialTrajectories(spatialRequest(), nativeResult());
    for (const [id, expected] of [['C00', 0], ['C10', 300]] as const) {
      const steady = trajectories.find(({ cell }) => cell.id === id)!;
      expect(steady.constant).toBe(true);
      expect(spatialReading(steady, 0)?.source).toBe('native');
      expect(spatialReading(steady, 20)).toEqual({ time: 0, value: expected, ratio: expected / 300, source: 'equilibrium' });
      expect(spatialReading(steady, 20.1)).toBeNull();
      expect(spatialReading(steady, -0.1)).toBeNull();
      expect(spatialChartSamples(steady)).toEqual([{ time: 0, value: expected }, { time: 20, value: expected }]);
      expect(steady.samples).toHaveLength(1);
    }
    const active = trajectories.find(({ cell }) => cell.id === 'C01')!;
    expect(spatialReading(active, 0.1)).toBeNull();
  });

  it('laisse une lacune si l’observation d’équilibre est absente ou contredite', () => {
    const result = nativeResult([
      { component: 'C00-N', samplingInterval: 0.1, samples: [{ time: 0, value: 0 }, { time: 0.1, value: 1 }] },
    ]);
    const trajectories = spatialTrajectories(spatialRequest(), result);
    for (const id of ['C00', 'C10']) {
      const steady = trajectories.find(({ cell }) => cell.id === id)!;
      expect(steady.constant).toBe(false);
      expect(spatialReading(steady, 20)).toBeNull();
      expect(spatialChartSamples(steady)).toBe(steady.samples);
    }
  });
});
