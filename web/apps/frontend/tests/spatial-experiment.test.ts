import { describe, expect, it } from 'vitest';
import type { HttpResult } from '@/lib/api/client';
import reference from '../../../examples/logistic-nine-cells-v1.json';
import {
  spatialApply, spatialCells, spatialChartSamples, spatialDrafts, spatialReading, spatialRequest, spatialResize,
  spatialTimeline, spatialTotals, spatialTrajectories, type SpatialDimension, type SpatialDraft,
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
  it.each([
    [2, 28, 36, ['C00', 'C01', 'C10', 'C11']],
    [3, 63, 81, ['C00', 'C01', 'C02', 'C10', 'C11', 'C12', 'C20', 'C21', 'C22']],
    [4, 112, 144, ['C00', 'C01', 'C02', 'C03', 'C10', 'C11', 'C12', 'C13', 'C20', 'C21', 'C22', 'C23', 'C30', 'C31', 'C32', 'C33']],
  ] as const)('construit la grille de côté %i avec des identifiants stables', (dimension, atoms, connections, ids) => {
    const request = spatialRequest(dimension);
    expect(request.model.components).toHaveLength(atoms);
    expect(request.model.connections).toHaveLength(connections);
    expect(request.model.observations.map(({ component }) => component)).toEqual(ids.map(id => `${id}-N`));
    expect(spatialCells(request).map(({ id }) => id)).toEqual(ids);
    expect(request.model.connections.every(({ from, to }) =>
      from.component.split('-')[0] === to.component.split('-')[0])).toBe(true);
    expect(request).toEqual(spatialRequest(dimension));
    expect(request).not.toHaveProperty('limits');
  });

  it('reproduit exactement la requête de référence des neuf cellules', () => {
    expect(spatialRequest(3)).toEqual(reference);
  });

  it('refuse les dimensions hors domaine et les grilles qui dépasseraient le budget du runner', () => {
    expect(() => spatialRequest(1 as SpatialDimension)).toThrow(/2 × 2, 3 × 3 ou 4 × 4/);
    expect(() => spatialRequest(5 as SpatialDimension)).toThrow(/dépasse le budget de taille du runner/);
  });

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

  it('additionne uniquement les observations de toutes les cellules au même instant', () => {
    const request = spatialRequest(2, 'constant');
    const cells = spatialCells(request);
    const observations = cells.map(({ component, samplingInterval, initial }, index) => ({
      component, samplingInterval, samples: [
        { time: 0, value: initial },
        { time: 0.30000000000000004, value: 340 + index },
        ...(index === 0 ? [] : [{ time: 0.4, value: 350 + index }]),
      ],
    })).reverse();
    const trajectories = spatialTrajectories(request, nativeResult(observations));
    expect(spatialTotals(trajectories, [0, 0.3, 0.4, 20])).toEqual([
      { time: 0, value: 1350 }, { time: 0.3, value: 1366 },
      { time: 0.4, value: null }, { time: 20, value: null },
    ]);
    expect(spatialTotals([], [0])).toEqual([{ time: 0, value: null }]);
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

describe('Paramètres individuels de l’expérience logistique', () => {
  it('préserve les paramètres communs à chaque redimensionnement et réinitialise les cellules réintroduites', () => {
    const applied = spatialApply(spatialRequest(4), {
      C01: { initial: '49', growth: '0.27', capacity: '49' },
      C33: { initial: '88', growth: '0.2', capacity: '240' },
    });
    if (!applied.ok) throw new Error(applied.message);

    const small = spatialResize(applied.request, applied.cells, 2);
    expect(small.cells.map(({ id }) => id)).toEqual(['C00', 'C01', 'C10', 'C11']);
    expect(small.cells.find(({ id }) => id === 'C01')).toMatchObject({ initial: 49, growth: 0.27, capacity: 49 });
    const large = spatialResize(small.request, small.cells, 4);
    expect(large.cells.find(({ id }) => id === 'C01')).toEqual(small.cells.find(({ id }) => id === 'C01'));
    expect(large.cells.find(({ id }) => id === 'C33')).toMatchObject({ initial: 270, growth: 0.35, capacity: 300 });
    expect(large.request.model.components.find(({ id }) => id === 'C01-sum')?.parameters).toEqual({
      'coeff-0': 1, 'coeff-1': -1 / 49,
    });
    expect(applied.cells.find(({ id }) => id === 'C33')).toMatchObject({ initial: 88, growth: 0.2, capacity: 240 });
  });

  it('applique et contrôle les budgets de la requête après le changement de dimension', () => {
    const base = spatialRequest(2);
    base.limits = { maxComponents: 63, maxPoints: 1818 };
    const cells = spatialCells(base);
    expect(spatialResize(base, cells, 3).request.limits).toEqual(base.limits);
    expect(() => spatialResize(base, cells, 4)).toThrow(/Model size budget exceeded/);
  });

  it('applique les trois valeurs à la seule cellule choisie sans modifier la requête d’origine', () => {
    const base = spatialRequest();
    const cells = spatialCells(base);
    expect(spatialDrafts(cells).C10).toEqual({ initial: '300', growth: '0.35', capacity: '300' });
    const applied = spatialApply(base, { C01: { initial: '90,5', growth: ' 2.7e-1 ', capacity: '260,4' } }, cells);
    if (!applied.ok) throw new Error(applied.message);

    const expected = structuredClone(base);
    expected.model.components.find(atom => atom.id === 'C01-N')!.parameters.X = 90.5;
    expected.model.components.find(atom => atom.id === 'C01-r')!.parameters.value = 0.27;
    expected.model.components.find(atom => atom.id === 'C01-sum')!.parameters['coeff-1'] = -1 / 260.4;
    expect(applied.request).toEqual(expected);
    expect(base).toEqual(spatialRequest());
    expect(applied.cells.find(cell => cell.id === 'C01')).toMatchObject({ initial: 90.5, growth: 0.27, capacity: 260.4 });
    expect(applied.cells[0]).toBe(cells[0]);
  });

  it('conserve la capacité saisie malgré la conversion du coefficient puis les modifications d’une autre cellule', () => {
    const first = spatialApply(spatialRequest(), { C10: { initial: '49', growth: ',35', capacity: '49' } });
    if (!first.ok) throw new Error(first.message);
    expect(spatialCells(first.request).find(cell => cell.id === 'C10')!.capacity).toBe(49.00000000000001);
    const second = spatialApply(first.request, { C01: { initial: '60', growth: '0.2', capacity: '240' } }, first.cells);
    if (!second.ok) throw new Error(second.message);
    expect(spatialDrafts(second.cells).C10!.capacity).toBe('49');

    const constant = nativeResult([{ component: 'C10-N', samplingInterval: 0.1, samples: [{ time: 0, value: 49 }] }]);
    const steady = spatialTrajectories(second.request, constant, second.cells).find(({ cell }) => cell.id === 'C10')!;
    expect(spatialReading(steady, 20)).toEqual({ time: 0, value: 49, ratio: 1, source: 'equilibrium' });

    const nativeEnd = 49.00000000000007;
    const drift = nativeResult([{ component: 'C10-N', samplingInterval: 0.1, samples: [{ time: 0, value: 49 }, { time: 20, value: nativeEnd }] }]);
    const varying = spatialTrajectories(second.request, drift, second.cells).find(({ cell }) => cell.id === 'C10')!;
    expect(spatialReading(varying, 10)).toBeNull();
    expect(spatialReading(varying, 20)).toEqual({ time: 20, value: nativeEnd, ratio: nativeEnd / 49, source: 'native' });
  });

  it.each<[keyof SpatialDraft, string, RegExp]>([
    ['initial', '  ', /Saisissez une valeur/],
    ['initial', '-0,1', /positive ou nulle/],
    ['growth', '0', /strictement positif/],
    ['growth', '0x10', /nombre fini/],
    ['growth', '1e309', /nombre fini/],
    ['growth', 'Infinity', /nombre fini/],
    ['initial', '1e-999', /trop proche de zéro/],
    ['initial', '1e13', /limites du catalogue/],
    ['growth', '1e13', /limites du catalogue/],
    ['capacity', '0', /strictement positive/],
    ['capacity', '-50', /strictement positive/],
    ['capacity', '5e-324', /coefficient −1\/K ne peut pas être représenté/],
    ['capacity', '1e-13', /coefficient −1\/K dépasse les limites du catalogue/],
    ['capacity', '2,5.1', /nombre fini/],
  ])('refuse %s = %s avec le diagnostic du champ', (field, text, message) => {
    const base = spatialRequest();
    const draft = { ...spatialDrafts(spatialCells(base)).C01!, [field]: text };
    const result = spatialApply(base, { C01: draft });
    expect(result).toMatchObject({ ok: false, errors: { C01: { [field]: expect.stringMatching(message) } } });
    expect(result).not.toHaveProperty('request');
  });

  it('respecte les bornes du catalogue sans plafond artificiel de capacité', () => {
    const base = spatialRequest();
    const minimum = spatialApply(base, { C01: { initial: '1e12', growth: '1e12', capacity: '1e-12' } });
    const large = spatialApply(base, { C00: { initial: '-0', growth: '0.35', capacity: String(Number.MAX_VALUE) } });
    expect(minimum.ok).toBe(true);
    expect(large.ok).toBe(true);
    if (large.ok) expect(large.cells[0]).toMatchObject({ initial: 0, capacity: Number.MAX_VALUE });
  });

  it('soumet la requête reconstruite à la validation du contrat partagé', () => {
    const base = spatialRequest();
    base.model.components.push(structuredClone(base.model.components[0]!));
    const result = spatialApply(base, {});
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('Le contrat Irritator a rejeté') });
  });
});
