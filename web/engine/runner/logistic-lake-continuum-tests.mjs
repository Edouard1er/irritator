import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { lakeDomain } from '../../dist/examples/logistic-grid.js';
import { lakeReference } from '../../dist/examples/logistic-lake-analysis.js';
import { lakeContinuumFromGeoJson, lakeContinuumParameters } from '../../dist/examples/logistic-lake-continuum.js';
import { lakeMeshFromGeoJson, lakeResolutions } from '../../dist/examples/logistic-lake.js';
import { compareLakeMeshes, lakeContour } from './logistic-lake-continuum-measure.mjs';

const source = JSON.parse(readFileSync(lakeContour));
const { areaKm2, initialTonnes, capacityTonnes, growthPerMonth, horizonMonths, samplingIntervalMonths } = lakeContinuumParameters;
const massTolerance = 2e-9;
const homogeneous = time => capacityTonnes / (1 + Math.exp(-growthPerMonth * time));
const rectangle = [[-2, -1], [2, -1], [2, 1], [-2, 1], [-2, -1]];
const polygon = (...coordinates) => ({ type: 'FeatureCollection', features: [{ geometry: { type: 'Polygon', coordinates } }] });
function close(actual, expected, tolerance, context) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${context}: ${actual} vs ${expected} (±${tolerance})`);
}

test('P1.12 — Intègre les sections d’un rectangle, d’un triangle et d’un contour avec île', () => {
  const triangle = [[-2, 1], [2, 1], [-2, -1], [-2, 1]];
  const island = [[-1, 0], [1, 0], [1, 0.5], [-1, 0.5], [-1, 0]];
  const cases = [
    [polygon(rectangle), 2, 1],
    [polygon(triangle), 1, 1 / 3],
    [polygon(rectangle, island), 1.75, 1 - 0.25 * 0.375],
    [polygon([...rectangle].reverse(), island), 1.75, 1 - 0.25 * 0.375],
    [polygon(rectangle, [...island].reverse()), 1.75, 1 - 0.25 * 0.375],
  ];
  for (const [data, area, moment] of cases) {
    const geometry = lakeContinuumFromGeoJson(data);
    close(geometry.projectedArea, area, 1e-14, 'Aire');
    close(geometry.projectedNorthSouthMoment, moment, 1e-14, 'Moment nord-sud');
  }
});

test('P1.12 — Aire et premier moment HydroLAKES concordent avec les intégrales de contour', () => {
  const geometry = lakeContinuumFromGeoJson(source);
  const rings = source.features[0].geometry.coordinates;
  const [exterior] = rings;
  const west = Math.min(...exterior.map(([longitude]) => longitude));
  const south = Math.min(...exterior.map(([, latitude]) => latitude));
  const north = Math.max(...exterior.map(([, latitude]) => latitude));
  const height = north - south;
  const scale = Math.cos((south + north) * Math.PI / 360);
  let area = 0;
  let moment = 0;
  for (const [index, ring] of rings.entries()) {
    const points = ring.map(([longitude, latitude]) => [(longitude - west) / height * scale, (north - latitude) / height]);
    let doubleArea = 0;
    let sextupleMoment = 0;
    for (let i = 1; i < points.length; i++) {
      const [x, y] = points[i - 1];
      const [nextX, nextY] = points[i];
      const cross = x * nextY - y * nextX;
      doubleArea += cross;
      sextupleMoment += (y + nextY) * cross;
    }
    const sign = index === 0 ? 1 : -1;
    area += sign * Math.abs(doubleArea) / 2;
    moment += sign * Math.abs(sextupleMoment) / 6;
  }
  assert.equal(geometry.ringCount, 14);
  close(geometry.projectedArea, area, 1e-12, 'Aire HydroLAKES');
  close(geometry.projectedNorthSouthMoment, moment, 1e-12, 'Moment HydroLAKES');
  close(geometry.meanY, moment / area, 1e-12, 'Latitude normalisée du centroïde');
});

test('P1.12 — La quadrature retrouve la primitive du gradient sur un rectangle', () => {
  const time = 4;
  const alpha = 0.6;
  const { totalsTonnes: [biomass], refinements } = lakeContinuumFromGeoJson(polygon(rectangle)).trajectory(alpha, [time]);
  // Initial B/K is uniform in [low, high] on this shape. Integrate
  // x / (q + (1 - q)x) over that interval using its logarithmic primitive.
  const low = 0.5 * (1 - alpha / 2);
  const high = 0.5 * (1 + alpha / 2);
  const q = Math.exp(-growthPerMonth * time);
  const d = 1 - q;
  const exact = capacityTonnes * (1 / d - q / (d ** 2 * (high - low)) * Math.log((q + d * high) / (q + d * low)));
  close(biomass, exact, 1e-8, 'Primitive de la solution locale');
  assert.ok(refinements[1].maxDifferenceTonnes > 1, 'Le premier raffinement doit détecter l’erreur.');
  assert.ok(refinements.at(-2).maxDifferenceTonnes <= 1e-8 && refinements.at(-1).maxDifferenceTonnes <= 1e-8);
});

const campaign = compareLakeMeshes(source);

test('P1.12 — Normalisation, trajectoire homogène, limite et stabilité sur les 201 dates', () => {
  const geometry = lakeContinuumFromGeoJson(source);
  assert.equal(campaign.dates.length, 201);
  assert.equal(campaign.dates[0], 0);
  assert.equal(campaign.dates[200], horizonMonths);
  assert.deepEqual(campaign.intensities.map(({ alpha }) => alpha), [0, 0.3, 0.6]);
  for (const { alpha, continuum } of campaign.intensities) {
    const { totalsTonnes, refinements, toleranceTonnes, standardToleranceTonnes, maxDifferenceFromStandardTonnes } = continuum;
    close(totalsTonnes[0], initialTonnes, massTolerance, `Masse initiale α=${alpha}`);
    const late = geometry.trajectory(alpha, [horizonMonths, 100, Infinity]).totalsTonnes;
    assert.ok(late[0] < late[1]);
    close(late[1], capacityTonnes, massTolerance, `Capacité à t=100 α=${alpha}`);
    close(late[2], capacityTonnes, massTolerance, `Capacité limite α=${alpha}`);
    assert.equal(refinements[0].panelsPerBand, 1);
    assert.equal(refinements[0].maxDifferenceTonnes, null);
    assert.ok(refinements.length >= 3);
    for (const [index, { panelsPerBand }] of refinements.entries()) assert.equal(panelsPerBand, 2 ** index);
    assert.ok(toleranceTonnes < standardToleranceTonnes);
    assert.ok(refinements.slice(-2).every(step => step.maxDifferenceTonnes <= toleranceTonnes));
    assert.ok(maxDifferenceFromStandardTonnes <= standardToleranceTonnes);
    for (const [index, time] of campaign.dates.entries()) {
      if (alpha === 0) close(totalsTonnes[index], homogeneous(time), massTolerance, `Homogène t=${time}`);
      else if (time > 0) assert.ok(totalsTonnes[index] < homogeneous(time), `Jensen continu, α=${alpha}, t=${time}`);
    }
  }
});

test('P1.12 — Maximum et rapport par distribution et grille sur toutes les dates', () => {
  for (const { alpha, continuum, resolutions } of campaign.intensities) {
    assert.deepEqual(resolutions.map(({ grid }) => grid), ['6x3', '12x6', '18x9', '24x12', '36x18', '48x24']);
    const previous = new Map();
    for (const { grid, cases } of resolutions) {
      assert.deepEqual(cases.map(entry => entry.distribution), alpha === 0 ? ['homogeneous'] : ['gradient', 'wet-gradient']);
      for (const { domain, reference, distribution, spatial } of cases) {
        assert.equal(domain.parameters.areaKm2, areaKm2);
        assert.equal(domain.parameters.initialTonnes, initialTonnes);
        assert.equal(domain.parameters.capacityDensity * areaKm2, capacityTonnes);
        assert.equal(domain.parameters.growth, growthPerMonth);
        assert.equal(domain.parameters.samplingInterval, samplingIntervalMonths);
        assert.deepEqual(domain.parameters.simulation, { start: 0, end: horizonMonths });
        const label = `${grid} ${distribution}, α=${alpha}`;
        let peak = { magnitude: -1, index: -1, signed: 0 };
        let maxRelative = 0;
        const signedCheckpoints = [];
        for (const [i, time] of campaign.dates.entries()) {
          let total = 0;
          for (const cell of domain.cells) {
            total += cell.capacity / (1 + (cell.capacity / cell.initial - 1) * Math.exp(-cell.growth * time));
          }
          close(reference.total[i], total, massTolerance, `${label}, t=${time}`);
          const observed = reference.total[i];
          const expected = continuum.totalsTonnes[i];
          const signed = observed - expected;
          const magnitude = Math.abs(signed);
          if (magnitude > peak.magnitude) peak = { magnitude, index: i, signed };
          maxRelative = Math.max(maxRelative, magnitude / expected);
          if (campaign.checkpointsMonths.includes(time)) signedCheckpoints.push(signed);
          if (time === 0) close(observed, initialTonnes, massTolerance, label);
          if (alpha === 0) close(observed, homogeneous(time), massTolerance, label);
          if (alpha > 0 && time > 0) {
            assert.ok(observed < homogeneous(time), `Jensen du maillage, ${label}, t=${time}`);
            // Jensen also applies within each cell when its value is the wet mean.
            if (distribution === 'wet-gradient') assert.ok(signed >= -massTolerance, `Jensen local, ${label}, t=${time}`);
          }
        }
        assert.equal(spatial.maxAbsoluteTonnes, peak.magnitude);
        assert.equal(spatial.monthOfMaxAbsolute, peak.index / 10);
        assert.equal(spatial.signedTonnesAtMaxAbsolute, peak.signed);
        assert.equal(spatial.maxRelative, maxRelative);
        assert.deepEqual(spatial.signedTonnesAtCheckpoints, signedCheckpoints);
        assert.equal(spatial.previousMaxAbsoluteOverCurrent,
          alpha === 0 || !previous.has(distribution) ? null : previous.get(distribution) / peak.magnitude);
        previous.set(distribution, peak.magnitude);
        if (alpha > 0) assert.ok(spatial.maxAbsoluteTonnes > 1e-3, label);
      }
    }
  }
});

test('P1.12 — À α=0, les trois distributions ont les mêmes requêtes et solutions locales', () => {
  for (const resolution of lakeResolutions) {
    const mesh = lakeMeshFromGeoJson(source, resolution);
    const baseline = lakeDomain(mesh);
    const exact = lakeReference(baseline);
    for (const kind of ['gradient', 'wet-gradient']) {
      const domain = lakeDomain(mesh, 'proportional', { kind, alpha: 0 });
      assert.deepEqual(domain.batches, baseline.batches);
      assert.deepEqual(lakeReference(domain), exact);
    }
  }
});
