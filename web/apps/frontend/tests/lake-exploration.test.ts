import { expect, it } from 'vitest';
import { lakeDifferenceLimit, lakeMapColor, lakeMapValue, lakeReading, retainLakeDataset,
  type LakeDataset } from '@/lib/simulation/lake-exploration';

it('sépare les unités cartographiques et conserve les points manquants', () => {
  const reading = { time: 10, value: 40, ratio: 0.4, density: 80 };
  const reference = { time: 10, value: 50, ratio: 0.5, density: 100 };
  expect(lakeMapValue('ratio', reading)).toBe(40);
  expect(lakeMapValue('density', reading)).toBe(80);
  expect(lakeMapValue('difference', reading, reference)).toBeCloseTo(-10);
  expect(lakeMapValue('difference', reading)).toBeUndefined();
  expect(lakeReading(undefined, 'C01', 0)).toBeUndefined();
  expect(lakeDifferenceLimit([], undefined)).toBe(0);
});

it('centre la palette des écarts sur zéro, y compris quand tous les écarts sont nuls', () => {
  expect(lakeMapColor(0, [0, 0, 0], 'difference')).toBe('rgb(246, 243, 235)');
  expect(lakeMapColor(-2, [-2, 0, 2], 'difference')).toBe('rgb(167, 74, 20)');
  expect(lakeMapColor(0, [-2, 0, 2], 'difference')).toBe('rgb(246, 243, 235)');
  expect(lakeMapColor(2, [-2, 0, 2], 'difference')).toBe('rgb(105, 56, 155)');
});

it('borne les séries de la session et conserve les scénarios consultés', () => {
  const scenario = {} as LakeDataset;
  const before = new Map([['homogène', scenario], ['ancien gradient', scenario], ['gradient affiché', scenario]]);
  const after = retainLakeDataset(before, 'comparaison', scenario, ['homogène', 'gradient affiché', 'comparaison']);
  expect([...after.keys()]).toEqual(['homogène', 'gradient affiché', 'comparaison']);
  expect(before.has('ancien gradient')).toBe(true);
});
