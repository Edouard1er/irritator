import { expect, it } from 'vitest';
import { lakeDomain } from '../../../examples/logistic-grid';
import { clipLakeMesh } from '../../../examples/logistic-lake';
import { initialLakeView, lakeMapColor, lakeOutline, lakeSyntheticNotice, lakeTotalTonnes,
  type LakeDataset } from '@/lib/simulation/lake-exploration';
import { lakeViewSvg, type LakeViewSnapshot } from '@/lib/simulation/lake-view-export';

it('sérialise deux cartes autonomes avec la même découpe et les valeurs intactes', () => {
  const mesh = clipLakeMesh([[[0, 0], [1, 0], [0, 2]]], 3, 6);
  const { cells, parameters } = lakeDomain(mesh);
  function dataset(multiplier: number) {
    const trajectories = new Map(cells.map(cell => [cell.id, {
      ...parameters.simulation, cell, samples: [{ time: 0, value: cell.initial }, { time: 0.1, value: cell.initial * multiplier }],
      constant: false,
    }]));
    const totals = [0, 1].map(tick => [...trajectories.values()].reduce((sum, row) => sum + row.samples[tick]!.value, 0));
    return { cells: new Map(cells.map(cell => [cell.id, cell])), trajectories, totals, trace: {} as LakeDataset['trace'] };
  }
  const reference = dataset(1.1);
  const scenario = dataset(1.23456789);
  const cell = cells[0]!;
  const snapshot: LakeViewSnapshot = {
    mesh, cells, maps: [{ title: 'Homogène', dataset: reference }, { title: 'Gradient <α> & grille', dataset: scenario }],
    reference, display: 'difference', limits: [-12, 0, 12], adaptive: true, tick: 1, time: 0.1,
    view: { ...initialLakeView, zoom: 2 }, selected: cell.id, highlights: new Map([[cell.id, '#236aad']]),
  };
  const xml = lakeViewSvg(snapshot);
  expect(lakeViewSvg(snapshot)).toBe(xml);
  const svg = new DOMParser().parseFromString(xml, 'image/svg+xml');
  expect(svg.querySelector('parsererror')).toBeNull();
  expect(svg.querySelector('[href], [src], script')).toBeNull();
  expect(svg.documentElement.getAttribute('data-time')).toBe('0.1');
  expect(svg.querySelector('clipPath path')?.getAttribute('d')).toBe(lakeOutline(mesh));
  expect(svg.querySelector('clipPath path')?.getAttribute('clip-rule')).toBe('evenodd');
  const maps = [...svg.querySelectorAll('[data-map-total]')];
  expect(maps).toHaveLength(2);
  expect(maps[1]!.getAttribute('data-map-total')).toBe(String(scenario.totals[1]));
  expect(maps[1]!.textContent).toContain(lakeTotalTonnes(scenario.totals[1]));
  expect(maps[1]!.textContent).toContain('Gradient <α> & grille');
  const right = maps[1]!.querySelector(`[data-cell="${cell.id}"]`)!;
  const value = scenario.trajectories.get(cell.id)!.samples[1]!.value;
  const difference = (value / cell.capacity - reference.trajectories.get(cell.id)!.samples[1]!.value / cell.capacity) * 100;
  expect(right.getAttribute('data-wet-fraction')).toBe(String(cell.wetFraction));
  expect(right.getAttribute('data-biomass')).toBe(String(value));
  expect(right.getAttribute('data-map-value')).toBe(String(difference));
  expect(right.getAttribute('fill')).toBe(lakeMapColor(difference, snapshot.limits, 'difference'));
  expect(right.parentElement?.getAttribute('clip-path')).toBe('url(#lake-shore)');
  expect(svg.querySelector('[data-scale-unit]')?.textContent).toContain('+12 points de %');
  expect(svg.documentElement.textContent).toContain('Mois simulé 0,1');
  expect(svg.documentElement.textContent).toContain(lakeSyntheticNotice);
});
