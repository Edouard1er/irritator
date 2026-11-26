import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { caps, parseResult, requestSchema, validateRequest } from '../../dist/packages/contracts/index.js';
import { lakeDomain } from '../../dist/examples/logistic-grid.js';
import { lakeWetFrontier } from '../../dist/examples/lake-wet-frontier.js';
import { runLakeSimulation } from '../../dist/examples/logistic-lake-analysis.js';
import {
  lakeExchangeDomain, lakeExchangeFlux, lakeExchangeIntensities, lakeExchangeResolutions, lakePairRequest,
} from '../../dist/examples/logistic-lake-exchange.js';
import { runLakeBatches } from '../../dist/examples/logistic-lake-run.js';
import { clipLakeMesh, lakeMeshFromGeoJson, lakeResolutionId } from '../../dist/examples/logistic-lake.js';

const source = JSON.parse(readFileSync(new URL('../../apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson', import.meta.url)));
const distribution = { kind: 'wet-gradient', alpha: 0.6, profile: 'sigmoid-v2' };
const pilots = lakeExchangeResolutions.map((resolution, index) => {
  const mesh = lakeMeshFromGeoJson(source, resolution);
  const domain = lakeDomain(mesh, 'proportional', distribution);
  const ids = index === 0 ? ['C11', 'C21'] : ['C5_4', 'C6_4'];
  return { mesh, domain, pair: ids.map(id => domain.cells.find(cell => cell.id === id)) };
});
const exactGrowth = (biomass, { growth, capacity }) => growth * biomass * (1 - biomass / capacity);

function native(request) {
  assert.ok(process.env.IRRITATOR_RUNNER, 'Définir IRRITATOR_RUNNER vers le binaire du runner.');
  const child = spawnSync(process.env.IRRITATOR_RUNNER, [], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return parseResult(JSON.parse(child.stdout), request);
}

function complete(result, interval = 0.1) {
  for (const { samples } of result.observations) {
    assert.equal(samples.length, 201);
    samples.forEach(({ time, value }, tick) => {
      assert.ok(Math.abs(time - tick * interval) <= 32 * Number.EPSILON * Math.max(1, time));
      assert.ok(Number.isFinite(value) && value >= 0);
    });
  }
}

test('Adjacence humide stricte, coins, îles et segments de rive alignés', () => {
  const outer = [[0.25, 0.25], [2.75, 0.25], [2.75, 5.75], [0.25, 5.75]];
  const hole = (left, low, high) => [[left, low], [1.25, low], [1.25, high], [left, high]];
  const frontier = (rings, a = 'C10', b = 'C11') => {
    const mesh = clipLakeMesh(rings, 3, 6);
    const cells = [a, b].map(id => mesh.cells.find(cell => cell.id === id));
    assert.ok(cells.every(cell => cell?.wetFraction > 0));
    return lakeWetFrontier(mesh, ...cells);
  };
  assert.deepEqual(frontier([outer]), { axis: 0, boundary: 1, direction: 1, segments: [{ start: 1, end: 2 }] });
  assert.deepEqual(frontier([outer], 'C11', 'C10')?.direction, -1);
  assert.equal(frontier([outer], 'C10', 'C21'), undefined);
  assert.equal(frontier([outer], 'C10', 'C10'), undefined);
  assert.equal(frontier([outer, hole(0.75, 0.75, 2.25)]), undefined);
  assert.equal(frontier([outer, hole(1, 0.75, 2.25)]), undefined);
  assert.deepEqual(frontier([outer.toReversed(), hole(0.75, 1.25, 1.75).toReversed()])?.segments,
    [{ start: 1, end: 1.25 }, { start: 1.75, end: 2 }]);
  const [pilot] = pilots;
  assert.throws(() => lakeExchangeDomain(pilot.mesh, pilot.domain, { a: 'C00', b: 'C01', mu: 0.5 }), RangeError);
  assert.throws(() => lakeExchangeDomain(pilot.mesh, pilot.domain, { a: 'C10', b: 'C21', mu: 0.5 }), RangeError);
});

test('Dimensions du flux et densités initiales égales pour deux surfaces différentes', () => {
  // (km² × km² / km²) × (t/km²) × mois⁻¹ = t/mois.
  const flux = lakeExchangeFlux(0.5, 2, 6, 20, 10);
  assert.equal(flux, 7.5);
  assert.equal(lakeExchangeFlux(0.5, 6, 2, 10, 20), -flux);
  assert.equal(lakeExchangeFlux(0.5, 2, 6, 20, 20), 0);
  assert.equal(lakeExchangeFlux(0.5, 2, 6, 150, 150.00000000000003), 0);
  assert.equal(lakeExchangeFlux(0, 2, 6, 20, 10), 0);
  const [{ pair, domain }] = pilots;
  const homogeneous = pair.map(cell => ({ ...cell, initial: 150 * cell.area }));
  const request = lakePairRequest('equal-density', homogeneous, 0.5, domain.parameters.simulation);
  const result = native(request);
  complete(result);
  const [a, b] = result.observations.map(({ samples }) => samples[0].value);
  assert.notEqual(a, b);
  assert.equal(lakeExchangeFlux(0.5, homogeneous[0].area, homogeneous[1].area,
    a / homogeneous[0].area, b / homogeneous[1].area), 0);
});

test('Conservation et relaxation exponentielle natives sans croissance sur des surfaces inégales', t => {
  for (const { mesh, domain, pair } of pilots) {
    const [a, b] = pair.map(cell => ({ ...cell, growth: 0 }));
    assert.notEqual(a.area, b.area);
    const total0 = a.initial + b.initial;
    const difference0 = a.initial / a.area - b.initial / b.area;
    for (const mu of lakeExchangeIntensities.filter(value => value > 0)) {
      const request = lakePairRequest('conservation', [a, b], mu, domain.parameters.simulation);
      const result = native(request);
      complete(result);
      let massError = 0;
      let densityError = 0;
      for (const [tick, { time, value }] of result.observations[0].samples.entries()) {
        const other = result.observations[1].samples[tick].value;
        massError = Math.max(massError, Math.abs(value + other - total0));
        const expected = difference0 * Math.exp(-mu * time);
        densityError = Math.max(densityError, Math.abs(value / a.area - other / b.area - expected));
      }
      assert.ok(massError <= 1e-6 * total0, `Conservation : ${massError} t`);
      assert.ok(densityError <= 5e-5 * Math.abs(difference0), `Relaxation : ${densityError} t/km²`);
      t.diagnostic(JSON.stringify({ grid: lakeResolutionId(mesh), mu, massError, densityError, runCalls: result.simulation.runCalls }));
    }
  }
});

test('Comparaison de scénarios, bilan intégré, réordonnancement des lots et reproductibilité', async t => {
  for (const { mesh, domain, pair: [a, b] } of pilots) {
    const baseline = await runLakeSimulation(domain, async request => native(request));
    assert.equal(baseline.trace.points, domain.cells.length * 201);
    const selected = new Set([a.component, b.component]);
    const maps = new Map(baseline.observations.map(row => [row.component, row]));
    for (const mu of lakeExchangeIntensities) {
      const coupled = lakeExchangeDomain(mesh, domain, { a: a.id, b: b.id, mu });
      const [{ request, cells }, ...independent] = coupled.batches;
      const { components, connections, observations } = request.model;
      validateRequest(request);
      assert.deepEqual(cells, [a, b]);
      assert.equal(components.length, 17);
      assert.equal(connections.length, 24);
      assert.deepEqual(observations.map(row => row.component), [a.component, b.component]);
      assert.ok(observations.length <= requestSchema.properties.model.properties.observations.maxItems);
      assert.ok(observations.length * 202 <= caps.maxPoints);
      assert.ok(independent.every(batch => batch.cells.every(cell => !selected.has(cell.component))));
      assert.equal(coupled.batches.flatMap(batch => batch.cells).length, domain.cells.length);
      assert.equal(coupled.cells, domain.cells);
      assert.equal(coupled.parameters, domain.parameters);
      const baselineComponents = new Map(domain.batches.flatMap(batch => batch.request.model.components.map(atom => [atom.id, atom])));
      for (const atom of components.filter(atom => baselineComponents.has(atom.id))) {
        assert.deepEqual(atom, baselineComponents.get(atom.id));
      }

      const actual = await runLakeBatches(coupled, undefined, async request => native(request));
      const repeat = await runLakeBatches(coupled, undefined, async request => native(request));
      assert.deepEqual(repeat.observations, actual.observations);
      assert.deepEqual(repeat.trace.batches.map(batch => batch.runCalls), actual.trace.batches.map(batch => batch.runCalls));
      assert.equal(actual.trace.points, baseline.trace.points);
      assert.ok(actual.trace.batches.every(batch => batch.runCalls <= caps.maxRunCalls));
      assert.deepEqual(actual.observations.map(row => row.component), baseline.observations.map(row => row.component));
      complete(actual);
      for (const row of actual.observations) {
        if (!selected.has(row.component)) assert.deepEqual(row, maps.get(row.component));
      }

      const i = actual.observations.find(row => row.component === a.component).samples;
      const j = actual.observations.find(row => row.component === b.component).samples;
      let integral = 0;
      let balanceError = 0;
      let disabledError = 0;
      for (let k = 0; k < i.length; k++) {
        const growth = index => exactGrowth(i[index].value, a) + exactGrowth(j[index].value, b);
        if (k > 0) integral += (i[k].time - i[k - 1].time) * (growth(k - 1) + growth(k)) / 2;
        balanceError = Math.max(balanceError, Math.abs(i[k].value + j[k].value - i[0].value - j[0].value - integral));
        if (mu === 0) for (const [cell, samples] of [[a, i], [b, j]]) {
          const reference = maps.get(cell.component).samples[k].value;
          const error = Math.abs(samples[k].value - reference);
          disabledError = Math.max(disabledError, error);
          assert.ok(error <= 1e-5 * cell.capacity, `μ = 0 : ${cell.id} écart ${error} t`);
        }
      }
      assert.ok(balanceError <= 3e-4 * (a.capacity + b.capacity), `Bilan intégré : ${balanceError} t`);
      if (mu > 0) {
        assert.ok(i[50].value < maps.get(a.component).samples[50].value);
        assert.ok(j[50].value > maps.get(b.component).samples[50].value);
      }
      t.diagnostic(JSON.stringify({ grid: lakeResolutionId(mesh), mu, batches: actual.trace.batches.length, balanceError, disabledError,
        pairRunCalls: actual.trace.batches[0].runCalls, maxRunCalls: Math.max(...actual.trace.batches.map(batch => batch.runCalls)) }));
      if (mesh.rows === 6 && mu === 0.5) t.diagnostic(JSON.stringify([0, 5, 10, 20].map(month => {
        const tick = month * 10;
        const control = [maps.get(a.component).samples[tick].value, maps.get(b.component).samples[tick].value];
        const exchange = [i[tick].value, j[tick].value];
        return { month, control, exchange, flux: lakeExchangeFlux(mu, a.area, b.area, exchange[0] / a.area, exchange[1] / b.area) };
      })));
    }
  }
});

test('Toutes les paires admissibles des deux maillages restent dans le budget du runner', t => {
  for (const { mesh, domain } of pilots) {
    let pairs = 0;
    let maxRunCalls = 0;
    for (const [index, a] of domain.cells.entries()) {
      for (const b of domain.cells.slice(index + 1)) {
        if (!lakeWetFrontier(mesh, a, b)) continue;
        const request = lakePairRequest('budget-pair', [a, b], 0.5, domain.parameters.simulation);
        const result = native(request);
        complete(result);
        maxRunCalls = Math.max(maxRunCalls, result.simulation.runCalls);
        pairs++;
      }
    }
    assert.equal(pairs, mesh.rows === 6 ? 14 : 90);
    assert.ok(maxRunCalls <= caps.maxRunCalls);
    t.diagnostic(JSON.stringify({ grid: lakeResolutionId(mesh), pairs, maxRunCalls }));
  }
});
