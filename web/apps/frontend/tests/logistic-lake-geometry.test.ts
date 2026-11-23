import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { clipLakeMesh, lakeColumns, lakeMeshFromGeoJson, lakeRows } from '../../../examples/logistic-lake';
import { lakeDomain } from '../../../examples/logistic-grid';

const rectangle = (left: number, top: number, right: number, bottom: number) =>
  [[left, top], [right, top], [right, bottom], [left, bottom]] as const;

test('soustrait les îles qui traversent une limite et exclut une case couverte par une île', () => {
  const outer = rectangle(0, 0, 3, 6);
  const crossing = rectangle(0.25, 0.25, 1.25, 0.75);
  const full = rectangle(1, 2, 2, 3);
  const mesh = clipLakeMesh([outer, crossing, full], 3, 6);
  const fractions = Object.fromEntries(mesh.cells.map(cell => [cell.id, cell.wetFraction]));
  expect(mesh.cells).toHaveLength(lakeRows * lakeColumns - 1);
  expect(fractions).toMatchObject({ C00: 0.625, C01: 0.875, C10: 1, C22: 1 });
  expect(fractions.C21).toBeUndefined();
  expect(clipLakeMesh([outer, [...crossing].reverse(), [...full].reverse()], 3, 6).cells).toEqual(mesh.cells);
});

test('additionne les deux fragments disjoints d’une case qui coupe un contour concave', () => {
  const mesh = clipLakeMesh([[[0.1, 0.1], [0.3, 0.1], [0.3, 1.2], [0.7, 1.2],
    [0.7, 0.1], [0.9, 0.1], [0.9, 1.5], [0.1, 1.5]]], 3, 6);
  expect(mesh.cells.map(cell => cell.id)).toEqual(['C00', 'C10']);
  expect(mesh.cells[0]!.wetFraction).toBeCloseTo(0.36, 13);
  expect(mesh.cells[1]!.wetFraction).toBeCloseTo(0.32, 13);
});

test('conserve un fragment résolu et comptabilise le résidu sous le seuil', () => {
  const tiny = 1e-14;
  const mesh = clipLakeMesh([rectangle(0, 0, 1 + tiny, 1)], 3, 6);
  expect(mesh.cells.map(cell => cell.id)).toEqual(['C00']);
  expect(mesh.discardedWetFraction).toBeGreaterThan(0);
  expect(mesh.discardedWetFraction).toBeLessThan(mesh.fractionTolerance);
  const retained = clipLakeMesh([rectangle(0, 0, 1 + 1e-9, 1)], 3, 6);
  expect(retained.cells.map(cell => cell.id)).toEqual(['C00', 'C01']);
  expect(retained.discardedWetFraction).toBe(0);
  expect(lakeDomain(mesh.cells).cells[0]!.area).toBe(9);
});

test('conserve les anneaux HydroLAKES et retrouve la surface plane par deux calculs', () => {
  const data = JSON.parse(readFileSync(resolve('data/geography/lac-de-guiers.hydrolakes.geojson'), 'utf8'));
  const mesh = lakeMeshFromGeoJson(data);
  expect(mesh.rings).toHaveLength(14);
  expect(mesh.rings.map(ring => ring.length)).toEqual(data.features[0].geometry.coordinates.map((ring: unknown[]) => ring.length - 1));
  expect(mesh.discardedWetFraction).toBe(0);
  const sum = mesh.cells.reduce((total, cell) => total + cell.wetFraction, 0);
  // Green's theorem using edge trapezoids on the uncut projected rings.
  const areas = mesh.rings.map(ring => Math.abs(ring.reduce((area, [x, y], index) => {
    const [nx, ny] = ring[(index + 1) % ring.length]!;
    return area + (nx - x) * (ny + y) / 2;
  }, 0)));
  const net = areas.slice(1).reduce((area, hole) => area - hole, areas[0]!);
  expect(Math.abs(sum * mesh.width * mesh.height / (lakeRows * lakeColumns) - net)).toBeLessThan(1e-12);
  expect(mesh.cells.every(({ wetFraction }) => wetFraction > 0 && wetFraction <= 1)).toBe(true);
  const domain = lakeDomain(mesh.cells);
  for (const cell of domain.cells) expect(Math.abs(cell.area / 9 - cell.wetFraction / sum)).toBeLessThan(1e-12);
});
