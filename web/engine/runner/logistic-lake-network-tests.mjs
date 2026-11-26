import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { caps, parseResult } from '../../dist/packages/contracts/index.js';
import { lakeDomain } from '../../dist/examples/logistic-grid.js';
import { lakeWetFrontier } from '../../dist/examples/lake-wet-frontier.js';
import { lakeExchangeFlux } from '../../dist/examples/logistic-lake-exchange.js';
import { lakeNetworkDomain } from '../../dist/examples/logistic-lake-network.js';
import { runLakeBatches } from '../../dist/examples/logistic-lake-run.js';
import { lakeMeshFromGeoJson, lakeResolutions } from '../../dist/examples/logistic-lake.js';

const source = JSON.parse(readFileSync(new URL('../../apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson', import.meta.url)));
const meshes = [lakeResolutions[0], lakeResolutions[2]].map(size => lakeMeshFromGeoJson(source, size));
const distribution = { kind: 'wet-gradient', alpha: 0.6, profile: 'sigmoid-v2' };
const cycle = ['C5_3', 'C5_4', 'C6_3', 'C6_4'];
const examples = [
  [meshes[0], ['C01', 'C11', 'C21']],
  [meshes[1], ['C4_4', 'C5_4', 'C6_4']],
  [meshes[1], ['C5_3', 'C5_4', 'C6_3']],
  [meshes[1], cycle],
  [meshes[1], [...cycle, 'C7_3']],
  [meshes[1], [...cycle, 'C7_3', 'C7_4']],
];
const total = values => values.reduce((sum, value) => sum + value, 0);
const growth = (cell, value) => cell.growth * value * (1 - value / cell.capacity);

function native(request) {
  assert.ok(process.env.IRRITATOR_RUNNER, 'Définir IRRITATOR_RUNNER vers le binaire du runner.');
  const child = spawnSync(process.env.IRRITATOR_RUNNER, [], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return parseResult(JSON.parse(child.stdout), request);
}

function inputs(mesh, domain, ids, mu) {
  const members = domain.cells.filter(cell => ids.includes(cell.id));
  return { cells: ids, mu, edges: members.flatMap((a, index) => members.slice(index + 1)
    .filter(b => lakeWetFrontier(mesh, a, b)).map(b => [a.id, b.id])) };
}

function localResult({ observations }, cells) {
  const indexed = new Map(observations.map(({ component, samples }) => [component, samples]));
  const series = cells.map(cell => indexed.get(cell.component));
  for (const samples of series) {
    assert.equal(samples.length, 201);
    samples.forEach(({ value, time }, tick) => {
      assert.ok(Number.isFinite(value) && value >= 0);
      assert.ok(Math.abs(time - tick / 10) <= 32 * Number.EPSILON * Math.max(1, time));
    });
  }
  return Array.from({ length: 201 }, (_, tick) => series.map(samples => samples[tick].value));
}

function derivatives(cells, edges, mu, values) {
  const rate = cells.map((cell, index) => growth(cell, values[index]));
  for (const [a, b] of edges) {
    const area = cells[a].area * cells[b].area / (cells[a].area + cells[b].area);
    const flux = mu * area * (values[a] / cells[a].area - values[b] / cells[b].area);
    rate[a] -= flux;
    rate[b] += flux;
  }
  return rate;
}

// Reference integration with ten RK4 steps per native sample interval.
function reference(cells, edges, mu) {
  const dt = 0.01;
  let values = cells.map(cell => cell.initial);
  const samples = [values];
  for (let step = 1; step <= 2000; step++) {
    const rates = state => derivatives(cells, edges, mu, state);
    const shifted = (slope, fraction) => values.map((value, i) => value + dt * fraction * slope[i]);
    const k1 = rates(values);
    const k2 = rates(shifted(k1, 0.5));
    const k3 = rates(shifted(k2, 0.5));
    const k4 = rates(shifted(k3, 1));
    values = values.map((value, i) => value + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    if (step % 10 === 0) samples.push(values);
  }
  return samples;
}

function indexedEdges(network, cells) {
  return network.edges.map(({ a, b }) => [cells.findIndex(cell => cell.id === a), cells.findIndex(cell => cell.id === b)]);
}

test('les chaînes et cycles partagent leurs arêtes signées dans une requête native déterministe', () => {
  for (const [mesh, ids] of examples) {
    const domain = lakeDomain(mesh, 'proportional', distribution);
    const topology = inputs(mesh, domain, ids, 0.5);
    const plan = lakeNetworkDomain(mesh, domain, topology);
    const [{ request, cells }, ...outside] = plan.batches;
    const { components, connections, observations } = request.model;
    const budget = { components: components.length, connections: connections.length,
      observations: observations.length, points: observations.length * 202 };
    assert.deepEqual(budget, plan.network.budget);
    assert.equal(budget.components, 7 * ids.length + 3 * topology.edges.length);
    assert.equal(budget.connections, 9 * ids.length + 6 * topology.edges.length);
    assert.ok(outside.every(batch => batch.cells.every(cell => !ids.includes(cell.id))));
    assert.equal(outside.flatMap(batch => batch.cells).length + cells.length, domain.cells.length);
    assert.deepEqual(lakeNetworkDomain(mesh, domain, {
      ...topology, cells: ids.toReversed(), edges: topology.edges.toReversed().map(edge => edge.toReversed()),
    }).batches[0].request, request);
    if (ids.length === 4) {
      const tree = lakeNetworkDomain(mesh, domain, { ...topology, edges: topology.edges.slice(1) });
      assert.equal(tree.network.edges.length, 3);
      assert.notEqual(tree.batches[0].request.model.id, request.model.id);
    }
    for (const [index, { a, b }] of plan.network.edges.entries()) {
      const outputs = connections.filter(({ from }) => from.component === `network-flux-${index + 1}`);
      assert.equal(outputs.length, 2);
      for (const [id, sign] of [[a, -1], [b, 1]]) {
        const { to } = outputs.find(({ to }) => to.component.startsWith(`${id}-derivative-`));
        assert.equal(to.port, 1);
        assert.equal(components.find(atom => atom.id === to.component).parameters['coeff-1'], sign);
      }
    }
  }
});

test('sans croissance, les 201 instants conservent la biomasse et relaxent vers la densité moyenne pondérée', t => {
  for (const [mesh, ids] of examples) {
    const domain = lakeDomain(mesh, 'proportional', distribution);
    domain.cells = domain.cells.map(cell => ({ ...cell, growth: 0 }));
    for (const mu of [0.25, 0.5]) {
      const { batches: [{ cells, request }], network } = lakeNetworkDomain(mesh, domain, inputs(mesh, domain, ids, mu));
      const result = native(request);
      const actual = localResult(result, cells);
      const exact = reference(cells, indexedEdges(network, cells), mu);
      const start = total(actual[0]);
      const mean = start / total(cells.map(cell => cell.area));
      const spread = values => Math.sqrt(total(values.map((value, i) => cells[i].area * (value / cells[i].area - mean) ** 2)));
      const spread0 = spread(actual[0]);
      let drift = 0;
      let densityError = 0;
      let previousSpread = spread0;
      for (const [tick, values] of actual.entries()) {
        drift = Math.max(drift, Math.abs(total(values) - start));
        for (const [index, cell] of cells.entries()) {
          densityError = Math.max(densityError, Math.abs(values[index] - exact[tick][index]) / cell.area);
        }
        const nextSpread = spread(values);
        assert.ok(nextSpread <= previousSpread + 1e-5 * spread0);
        previousSpread = nextSpread;
      }
      const remaining = previousSpread / spread0;
      assert.ok(remaining < 1, `Dispersion résiduelle : ${remaining}`);
      assert.ok(drift <= 1e-6 * start, `Conservation : ${drift} t`);
      assert.ok(densityError <= 0.003, `Écart de densité à RK4 : ${densityError} t/km²`);
      t.diagnostic(JSON.stringify({ ids, mu, mean, drift, densityError, remaining, runCalls: result.simulation.runCalls }));
    }
  }
});

test('scénarios synchronisés, bilan local à chaque instant et trajectoires extérieures identiques', async t => {
  assert.equal(lakeExchangeFlux(0.5, 2, 6, 20, 10), 7.5); // (mois⁻¹ × km² × t/km²)
  let worstActiveBalance = 0;
  let worstDisabledBalance = 0;
  let worstActiveSolver = 0;
  for (const [mesh, ids] of examples) {
    const domain = lakeDomain(mesh, 'proportional', distribution);
    const baseline = await runLakeBatches(domain, undefined, async request => native(request));
    for (const mu of [0, 0.25, 0.5]) {
      const plan = lakeNetworkDomain(mesh, domain, inputs(mesh, domain, ids, mu));
      const { cells, request } = plan.batches[0];
      const scenarioB = await runLakeBatches(plan, undefined, async request => native(request));
      assert.equal(scenarioB.trace.points, domain.cells.length * 201);
      assert.ok(scenarioB.trace.batches.every(batch => batch.runCalls <= caps.maxRunCalls));
      const repeated = native(request);
      assert.deepEqual(repeated.observations, scenarioB.observations.filter(series => ids.includes(series.component.slice(0, -2))));
      assert.equal(repeated.simulation.runCalls, scenarioB.trace.batches[0].runCalls);
      const unchanged = baseline.observations.filter(series => !ids.includes(series.component.slice(0, -2)));
      assert.deepEqual(scenarioB.observations.filter(series => !ids.includes(series.component.slice(0, -2))), unchanged);
      const actual = localResult(scenarioB, cells);
      const control = localResult(baseline, cells);
      const edges = indexedEdges(plan.network, cells);
      const exact = reference(cells, edges, mu);
      assert.deepEqual(actual[0], control[0]);
      assert.equal(plan.cells, domain.cells);
      assert.equal(plan.parameters, domain.parameters);
      const rates = actual.map((values, tick) => {
        const net = cells.map(() => 0);
        for (const [a, b] of edges) {
          const left = values[a] / cells[a].area;
          const right = values[b] / cells[b].area;
          const flux = lakeExchangeFlux(mu, cells[a].area, cells[b].area, left, right);
          const reverse = lakeExchangeFlux(mu, cells[b].area, cells[a].area, right, left);
          assert.equal(flux || 0, -reverse || 0);
          net[a] -= flux;
          net[b] += flux;
        }
        assert.ok(Math.abs(total(net)) <= 8 * Number.EPSILON * Math.max(1, ...net.map(Math.abs)));
        return cells.map((cell, index) => {
          if (mu === 0) assert.ok(Math.abs(values[index] - control[tick][index]) <= 1e-5 * cell.capacity);
          return growth(cell, values[index]) + net[index];
        });
      });
      let balanceError = 0;
      let simpsonError = 0;
      let solverError = 0;
      let disabledError = 0;
      let balanceFraction = 0;
      let solverFraction = 0;
      let disabledFraction = 0;
      for (const [i, cell] of cells.entries()) {
        let trapezoids = 0;
        let simpson = 0;
        for (let tick = 1; tick < actual.length; tick++) {
          const variation = actual[tick][i] - actual[0][i];
          trapezoids += 0.1 * (rates[tick - 1][i] + rates[tick][i]) / 2;
          if (tick % 2 === 0) {
            simpson += 0.1 * (rates[tick - 2][i] + 4 * rates[tick - 1][i] + rates[tick][i]) / 3;
            simpsonError = Math.max(simpsonError, Math.abs(variation - simpson));
          }
          const residual = Math.abs(variation - trapezoids);
          balanceError = Math.max(balanceError, residual);
          balanceFraction = Math.max(balanceFraction, residual / cell.capacity);
          const error = Math.abs(actual[tick][i] - exact[tick][i]);
          solverError = Math.max(solverError, error);
          solverFraction = Math.max(solverFraction, error / cell.capacity);
          if (mu === 0) {
            const difference = Math.abs(actual[tick][i] - control[tick][i]);
            disabledError = Math.max(disabledError, difference);
            disabledFraction = Math.max(disabledFraction, difference / cell.capacity);
          }
        }
      }
      if (mu === 0) {
        worstDisabledBalance = Math.max(worstDisabledBalance, balanceFraction);
      } else {
        worstActiveBalance = Math.max(worstActiveBalance, balanceFraction);
        worstActiveSolver = Math.max(worstActiveSolver, solverFraction);
      }
      t.diagnostic(JSON.stringify({ ids, mu, balanceError, balanceFraction, simpsonError, solverError, solverFraction,
        disabledError, disabledFraction, runCalls: scenarioB.trace.batches[0].runCalls,
        maxRunCalls: Math.max(...[...baseline.trace.batches, ...scenarioB.trace.batches].map(batch => batch.runCalls)) }));
      if (mu === 0.5 && ids.length === 3 && ids.includes('C5_3')) {
        const fluxesAt = tick => edges.map(([a, b]) => lakeExchangeFlux(mu, cells[a].area, cells[b].area,
          actual[tick][a] / cells[a].area, actual[tick][b] / cells[b].area));
        assert.ok(fluxesAt(0)[0] > 0 && fluxesAt(1)[0] < 0);
        t.diagnostic(JSON.stringify([0, 5, 10, 20].map(month => {
          const tick = month * 10;
          return { month, control: control[tick], coupled: actual[tick], fluxes: fluxesAt(tick) };
        })));
      }
    }
  }
  assert.ok(worstActiveBalance <= 1e-4, `Résidu du bilan local rapporté à K, échange actif : ${worstActiveBalance}`);
  // At μ = 0 the matching independent trajectories already exhibit the larger QSS3 residual.
  assert.ok(worstDisabledBalance <= 5e-4, `Résidu du bilan local rapporté à K, échange nul : ${worstDisabledBalance}`);
  assert.ok(worstActiveSolver <= 3e-5, `Écart à RK4 rapporté à K en échange actif : ${worstActiveSolver}`);
});
