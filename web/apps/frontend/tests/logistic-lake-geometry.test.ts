import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { clipLakeMesh, lakeColumns, lakeMeshFromGeoJson, lakeResolutions, lakeRows } from '../../../examples/logistic-lake';
import { lakeDomain, lakeSurfaceAreaKm2 } from '../../../examples/logistic-grid';

const rectangle = (left: number, top: number, right: number, bottom: number) =>
  [[left, top], [right, top], [right, bottom], [left, bottom]] as const;

test.each([
  { name: 'rectangle', rings: [rectangle(0.2, 0.1, 0.8, 0.5)], area: 0.24, x: 0.5, y: 0.3 },
  { name: 'triangle', rings: [[[0, 0], [1, 0], [0, 1]]], area: 0.5, x: 1 / 3, y: 1 / 3 },
  { name: 'contour concave', rings: [[[0, 0], [1, 0], [1, 0.25], [0.25, 0.25], [0.25, 1], [0, 1]]],
    area: 7 / 16, x: 19 / 56, y: 19 / 56 },
  { name: 'île intérieure', rings: [rectangle(0, 0, 1, 1), rectangle(0.125, 0.25, 0.375, 0.5)],
    area: 15 / 16, x: 31 / 60, y: 61 / 120 },
] as const)('calcule l’aire et le centroïde humides pour $name', ({ rings, area, x, y }) => {
  for (const input of [[...rings], rings.map(ring => [...ring].reverse())]) {
    const { cells } = clipLakeMesh(input, 3, 6);
    expect(cells).toHaveLength(1);
    expect(cells[0]!.wetFraction).toBeCloseTo(area, 13);
    expect(cells[0]!.wetCentroid[0]).toBeCloseTo(x, 13);
    expect(cells[0]!.wetCentroid[1]).toBeCloseTo(y, 13);
  }
});

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
    [0.7, 0.4], [0.9, 0.4], [0.9, 1.5], [0.1, 1.5]]], 3, 6);
  expect(mesh.cells.map(cell => cell.id)).toEqual(['C00', 'C10']);
  expect(mesh.cells[0]!.wetFraction).toBeCloseTo(0.3, 13);
  expect(mesh.cells[0]!.wetCentroid[0]).toBeCloseTo(0.44, 13);
  expect(mesh.cells[0]!.wetCentroid[1]).toBeCloseTo(0.61, 13);
  expect(mesh.cells[1]!.wetFraction).toBeCloseTo(0.32, 13);
});

test('pondère la biomasse par les centroïdes des fragments humides retenus', () => {
  const mesh = clipLakeMesh([[[0, 0], [1, 0], [0, 2]]], 3, 6);
  const { cells } = lakeDomain(mesh, 'proportional', { kind: 'wet-gradient', alpha: 0.6 });
  // The lower triangle has area 1/4 and centroid y = 4/3. The upper
  // trapezoid has area 3/4 and centroid y = 4/9 by subtraction.
  const weights = [225 * (1 + 0.6 * (0.5 - (4 / 9) / 6)), 75 * (1 + 0.6 * (0.5 - (4 / 3) / 6))];
  expect(cells.map(cell => cell.area)).toEqual([225, 75]);
  expect(cells[0]!.initial).toBeCloseTo(45_000 * weights[0]! / (weights[0]! + weights[1]!), 9);
  expect(cells.reduce((sum, cell) => sum + cell.initial, 0)).toBe(45_000);
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
  expect(lakeDomain(mesh).cells[0]!.area).toBe(lakeSurfaceAreaKm2);
});

test.each([
  [lakeResolutions[0], 13], [lakeResolutions[1], 35], [lakeResolutions[2], 65],
  [lakeResolutions[3], 101], [lakeResolutions[4], 184], [lakeResolutions[5], 296],
] as const)
('conserve les anneaux, les surfaces et les cellules de la grille %j', (resolution, expected) => {
  const data = JSON.parse(readFileSync(resolve('data/geography/lac-de-guiers.hydrolakes.geojson'), 'utf8'));
  const mesh = lakeMeshFromGeoJson(data, resolution);
  expect(mesh.rings).toHaveLength(14);
  expect(mesh.rings.map(ring => ring.length)).toEqual(data.features[0].geometry.coordinates.map((ring: unknown[]) => ring.length - 1));
  expect(mesh.discardedWetFraction).toBeLessThan(1e-12);
  expect(mesh.cells).toHaveLength(expected);
  expect(new Set(mesh.cells.map(cell => cell.id)).size).toBe(expected);
  expect(mesh.cells.some(({ wetFraction }) => wetFraction < 1)).toBe(true);
  expect(clipLakeMesh(mesh.rings, mesh.width, mesh.height, mesh).cells).toEqual(mesh.cells);
  const sum = mesh.cells.reduce((total, cell) => total + cell.wetFraction, 0);
  // Green's theorem using edge trapezoids on the uncut projected rings.
  const areas = mesh.rings.map(ring => Math.abs(ring.reduce((area, [x, y], index) => {
    const [nx, ny] = ring[(index + 1) % ring.length]!;
    return area + (nx - x) * (ny + y) / 2;
  }, 0)));
  const net = areas.slice(1).reduce((area, hole) => area - hole, areas[0]!);
  const cellArea = mesh.width * mesh.height / (mesh.rows * mesh.columns);
  expect(Math.abs(sum * cellArea - net)).toBeLessThan(1e-12);
  // Independently integrate the latitude moment over the uncut contour.
  const moments = mesh.rings.map(ring => Math.abs(ring.reduce((moment, [x, y], index) => {
    const [nx, ny] = ring[(index + 1) % ring.length]!;
    return moment + (nx - x) * (y * y + y * ny + ny * ny) / 6;
  }, 0)));
  const northSouthMoment = moments.slice(1).reduce((moment, hole) => moment - hole, moments[0]!);
  const tiledMoment = mesh.cells.reduce((moment, cell) => moment + cell.wetFraction * cell.wetCentroid[1], 0);
  expect(Math.abs(tiledMoment * cellArea - northSouthMoment)).toBeLessThan(1e-12);
  expect(mesh.cells.some(cell => Math.abs(cell.wetCentroid[1] - (cell.y + cell.height / 2)) > 0.01 * cell.height)).toBe(true);
  for (const { x, y, width, height, wetCentroid: [cx, cy] } of mesh.cells) {
    expect(cx).toBeGreaterThanOrEqual(x);
    expect(cx).toBeLessThanOrEqual(x + width);
    expect(cy).toBeGreaterThanOrEqual(y);
    expect(cy).toBeLessThanOrEqual(y + height);
  }
  expect(mesh.cells.every(({ wetFraction }) => wetFraction > 0 && wetFraction <= 1)).toBe(true);
  const domain = lakeDomain(mesh);
  for (const cell of domain.cells) expect(Math.abs(cell.area / lakeSurfaceAreaKm2 - cell.wetFraction / sum)).toBeLessThan(1e-12);
  expect(domain.cells.reduce((total, cell) => total + cell.area, 0)).toBeCloseTo(300, 10);
  expect(domain.cells.reduce((total, cell) => total + cell.initial, 0)).toBeCloseTo(45_000, 8);
  expect(domain.cells.reduce((total, cell) => total + cell.capacity, 0)).toBeCloseTo(90_000, 8);
});
