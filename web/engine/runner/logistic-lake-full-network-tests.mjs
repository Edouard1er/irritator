import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { caps, parseResult, requestSchema } from '../../dist/packages/contracts/index.js';
import { lakeFullTopology } from '../../dist/examples/lake-full-topology.js';
import { lakeWetFrontier } from '../../dist/examples/lake-wet-frontier.js';
import { buildCompactLogisticRequest } from '../../dist/examples/logistic-compact.js';
import { lakeDomain } from '../../dist/examples/logistic-grid.js';
import { lakeExchangeFlux } from '../../dist/examples/logistic-lake-exchange.js';
import { lakeFullNetworkDomain } from '../../dist/examples/logistic-lake-full-network.js';
import { runLakeBatches } from '../../dist/examples/logistic-lake-run.js';
import { lakeMeshFromGeoJson, lakeResolutions } from '../../dist/examples/logistic-lake.js';

const source = JSON.parse(readFileSync(new URL('../../apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson', import.meta.url)));
const mesh = lakeMeshFromGeoJson(source);
const distributions = [
  { kind: 'homogeneous' },
  { kind: 'gradient', alpha: 0.6, profile: 'linear-v1' },
  { kind: 'wet-gradient', alpha: 0.6, profile: 'sigmoid-v2' },
];
const intensities = [0, 0.25, 0.5];
const dtNative = 0.1;
const sum = values => values.reduce((total, value) => total + value, 0);
const growth = (cell, biomass) => cell.growth * biomass * (1 - biomass / cell.capacity);
const full = (domain, mu) => lakeFullNetworkDomain(mesh, domain, { mode: 'full-network', mu });
const indexedEdges = (domain) => domain.fullNetwork.edges.map(({ a, b }) =>
  [domain.cells.findIndex(cell => cell.id === a), domain.cells.findIndex(cell => cell.id === b)]);

function execute(request) {
  assert.ok(process.env.IRRITATOR_RUNNER, 'Définir IRRITATOR_RUNNER vers le binaire du runner.');
  const input = JSON.stringify(request);
  assert.ok(Buffer.byteLength(input) <= 1_048_576);
  const child = spawnSync(process.env.IRRITATOR_RUNNER, [], {
    input, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.ok(Buffer.byteLength(child.stdout) <= 4 * 1024 * 1024);
  const raw = JSON.parse(child.stdout);
  parseResult(raw, request);
  return raw;
}

function samples({ observations }) {
  for (const { samples } of observations) {
    assert.equal(samples.length, 201);
    samples.forEach(({ time, value }, tick) => {
      assert.ok(Number.isFinite(value) && value >= 0);
      assert.ok(Math.abs(time - tick / 10) <= 32 * Number.EPSILON * Math.max(1, time));
    });
  }
  return Array.from({ length: 201 }, (_, tick) => observations.map(series => series.samples[tick].value));
}

function dispersion(cells, values, ids = cells.map((_, index) => index)) {
  const mean = sum(ids.map(i => values[i])) / sum(ids.map(i => cells[i].area));
  return sum(ids.map(i => cells[i].area * (values[i] / cells[i].area - mean) ** 2));
}

function netFlows(cells, edges, mu, values, check = false) {
  const net = cells.map(() => 0);
  for (const [i, j] of edges) {
    const { area: a } = cells[i];
    const { area: b } = cells[j];
    const left = values[i] / a;
    const right = values[j] / b;
    // The reference uses the density law directly, independently of native assembly.
    const rate = mu * (a * b / (a + b)) * (left - right);
    if (check) {
      const flux = lakeExchangeFlux(mu, a, b, left, right);
      const reverse = lakeExchangeFlux(mu, b, a, right, left);
      assert.equal(flux || 0, -reverse || 0);
      assert.ok(Math.abs(rate - flux) < 1e-9);
    }
    net[i] -= rate;
    net[j] += rate;
  }
  return net;
}

function rk4(cells, edges, mu, stepsPerSample) {
  const dt = dtNative / stepsPerSample;
  let values = cells.map(cell => cell.initial);
  const rates = state => netFlows(cells, edges, mu, state).map((net, i) => growth(cells[i], state[i]) + net);
  const series = [values];
  for (let step = 1; step <= 200 * stepsPerSample; step++) {
    const shifted = (slope, weight) => values.map((value, i) => value + dt * weight * slope[i]);
    const k1 = rates(values);
    const k2 = rates(shifted(k1, 0.5));
    const k3 = rates(shifted(k2, 0.5));
    const k4 = rates(shifted(k3, 1));
    values = values.map((value, i) => value + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    if (step % stepsPerSample === 0) series.push(values);
  }
  return series;
}

function errors(cells, actual, reference) {
  let tonnes = 0;
  let fractionK = 0;
  let density = 0;
  let worst;
  for (const [tick, states] of actual.entries()) for (const [i, observed] of states.entries()) {
    const absolute = Math.abs(observed - reference[tick][i]);
    tonnes = Math.max(tonnes, absolute);
    if (absolute / cells[i].capacity > fractionK) {
      fractionK = absolute / cells[i].capacity;
      worst = { cell: cells[i].id, month: tick / 10, observed, reference: reference[tick][i] };
    }
    density = Math.max(density, absolute / cells[i].area);
  }
  return { tonnes, fractionK, density, worst };
}

test('la topologie exhaustive, les signes natifs et les plafonds de la requête sont vérifiés', t => {
  const domain = lakeDomain(mesh, 'proportional', distributions[2]);
  const { fullNetwork, batches } = full(domain, 0.5);
  assert.equal(batches.length, 1);
  const { cells, request } = batches[0];
  const { model } = request;
  const { components, connections, observations } = model;
  assert.equal(cells.length, 13);
  assert.equal(fullNetwork.edges.length, 14);
  assert.deepEqual(fullNetwork.components, [fullNetwork.cells]);
  assert.equal(fullNetwork.mode, 'full-network');
  assert.deepEqual(fullNetwork.budget, { components: components.length, connections: connections.length,
    observations: observations.length, points: observations.length * 202, requestBytes: Buffer.byteLength(JSON.stringify(request)) });
  assert.equal(components.length, 107);
  assert.equal(connections.length, 175);
  assert.equal(observations.length, 13);
  assert.ok(components.length <= caps.maxComponents && connections.length <= caps.maxConnections);
  assert.ok(observations.length <= requestSchema.properties.model.properties.observations.maxItems);
  assert.ok(fullNetwork.budget.points <= caps.maxPoints);
  assert.equal(model.id.length <= 64, true);
  assert.deepEqual(request, full(domain, 0.5).batches[0].request);
  assert.notEqual(model.id, full(domain, 0.25).batches[0].request.model.id);
  assert.notEqual(model.id, full(lakeDomain(mesh, 'proportional', distributions[1]), 0.5).batches[0].request.model.id);
  for (const [index, { a, b, frontier }] of fullNetwork.edges.entries()) {
    const id = `full-flux-${index + 1}`;
    const left = cells.find(cell => cell.id === a);
    const right = cells.find(cell => cell.id === b);
    assert.deepEqual(frontier, lakeWetFrontier(mesh, left, right));
    assert.ok(frontier.segments.every(segment => segment.end > segment.start));
    const inputs = connections.filter(({ to }) => to.component === id);
    assert.deepEqual(inputs.map(({ from, to }) => [from.component, to.port]), [[left.component, 0], [right.component, 1]]);
    const parameters = components.find(atom => atom.id === id).parameters;
    assert.equal(parameters['coeff-0'], 0.5 * (right.area / (left.area + right.area)));
    assert.equal(parameters['coeff-1'], -0.5 * (left.area / (left.area + right.area)));
    const outputs = connections.filter(({ from }) => from.component === id);
    assert.deepEqual(outputs.map(({ to }) => [to.component, to.port]), [[`${a}-derivative-${index + 1}`, 1], [`${b}-derivative-${index + 1}`, 1]]);
    assert.deepEqual(outputs.map(({ to }) => components.find(atom => atom.id === to.component).parameters['coeff-1']), [-1, 1]);
  }
  const active = new Set(fullNetwork.edges.map(({ a, b }) => `${a} ${b}`));
  for (const a of cells) for (const b of cells.filter(cell => cell.id > a.id)) {
    assert.equal(active.has(`${a.id} ${b.id}`), !!lakeWetFrontier(mesh, a, b));
  }
  assert.ok(!active.has('C21 C31') && !active.has('C01 C12'));

  // A rectangular island occupies the entire common side of two wet cells.
  const wet = [{ id: 'A', row: 2, column: 0, wetFraction: 0.6 }, { id: 'B', row: 2, column: 1, wetFraction: 0.6 }];
  const island = [[0.8, 2], [1.2, 2], [1.2, 3], [0.8, 3]];
  const plain = { width: 3, height: 6, rows: 6, columns: 3, cells: wet,
    rings: [[[0, 0], [3, 0], [3, 6], [0, 6]]] };
  const wetSide = lakeFullTopology(plain);
  const dryMesh = { ...plain, rings: [...plain.rings, island] };
  const drySide = lakeFullTopology(dryMesh);
  assert.equal(wetSide.edges.length, 1);
  assert.deepEqual(drySide, { cells: ['A', 'B'], edges: [], components: [['A'], ['B']] });
  const artificial = { ...domain, cells: wet.map((cell, i) => ({ ...domain.cells[i], ...cell, component: `${cell.id}-N` })) };
  const disconnected = lakeFullNetworkDomain(dryMesh, artificial, { mode: 'full-network', mu: 0.5 });
  assert.equal(disconnected.batches.length, 1);
  assert.deepEqual(disconnected.fullNetwork.components, drySide.components);
  assert.equal(disconnected.batches[0].request.model.connections.length, 14);
  assert.notEqual(disconnected.batches[0].request.model.id,
    lakeFullNetworkDomain(plain, artificial, { mode: 'full-network', mu: 0.5 }).batches[0].request.model.id);

  for (const resolution of [lakeResolutions[2], lakeResolutions[5]]) {
    const larger = lakeMeshFromGeoJson(source, resolution);
    const topology = lakeFullTopology(larger);
    const n = topology.cells.length;
    const m = topology.edges.length;
    assert.equal(topology.components.length, 1);
    t.diagnostic(JSON.stringify({ resolution, n, m, components: 5 * n + 3 * m, connections: 7 * n + 6 * m, points: 202 * n }));
    assert.throws(() => lakeFullNetworkDomain(larger, lakeDomain(larger), { mode: 'full-network', mu: 0.5 }), /6 × 3/);
  }
});

test('le bloc compact reproduit la solution logistique et caractérise la chronologie observable', t => {
  for (const distribution of distributions) {
    const domain = lakeDomain(mesh, 'proportional', distribution);
    const { cells } = domain;
    const historical = domain.batches[0].request;
    const compact = buildCompactLogisticRequest('lake-compact-test', cells, historical.simulation);
    assert.equal(compact.model.components.length, 5 * cells.length);
    assert.equal(compact.model.connections.length, 7 * cells.length);
    const before = execute(historical);
    const after = execute(compact);
    const actual = samples(after);
    const analytical = actual.map((_, tick) => cells.map(({ capacity, initial, growth }) =>
      capacity / (1 + (capacity / initial - 1) * Math.exp(-growth * tick / 10))));
    const compactError = errors(cells, actual, analytical);
    const historicalError = errors(cells, samples(before), analytical);
    const change = errors(cells, actual, samples(before));
    const chronology = [0.000001, 0.1, 1, 5, 10, 20].map(end => ({
      end, calls: [historical, compact].map(request => execute({ ...request, simulation: { start: 0, end } }).simulation.runCalls),
    }));
    t.diagnostic(JSON.stringify({ distribution, compactError, historicalError, change, chronology }));
    assert.ok(compactError.fractionK <= 5e-5);
    assert.ok(change.fractionK <= 1e-5);
  }
});

test('le réseau QSS3 suit RK4 raffiné et ferme les bilans instantané et locaux aux 201 dates', async t => {
  const ids = new Set();
  for (const distribution of distributions) {
    const domain = lakeDomain(mesh, 'proportional', distribution);
    const control = samples(execute(domain.batches[0].request));
    const { cells } = domain;
    for (const [property, expected] of [['area', 300], ['initial', 45_000], ['capacity', 90_000]]) {
      assert.ok(Math.abs(sum(cells.map(cell => cell[property])) - expected) < 1e-8);
    }
    for (const mu of intensities) {
      const plan = full(domain, mu);
      const { request } = plan.batches[0];
      assert.ok(!ids.has(request.model.id));
      ids.add(request.model.id);
      const results = await runLakeBatches(plan, undefined, async request => execute(request));
      assert.deepEqual(results.trace.fullNetwork, plan.fullNetwork);
      const { runCalls, points, resultBytes } = results.trace.batches[0];
      assert.ok(runCalls <= caps.maxRunCalls);
      assert.equal(points, 2613);
      const repeat = execute(request);
      assert.deepEqual(repeat.observations, results.observations);
      assert.equal(repeat.simulation.runCalls, runCalls);
      const actual = samples(results);
      assert.deepEqual(actual[0], control[0]);
      const edges = indexedEdges(plan);
      const fine = rk4(cells, edges, mu, 20);
      const refinement = errors(cells, rk4(cells, edges, mu, 10), fine);
      const nativeError = errors(cells, actual, fine);
      const deviationA = errors(cells, actual, control);
      assert.ok(refinement.tonnes < 1e-5);

      const localRates = actual.map(values => {
        const net = netFlows(cells, edges, mu, values, true);
        assert.ok(Math.abs(sum(net)) < 1e-9);
        return net.map((value, i) => value + growth(cells[i], values[i]));
      });
      const integrated = cells.map(() => 0);
      const trapezoids = cells.map(() => 0);
      let simpsonResidual = 0;
      let relativeResidual = 0;
      let relativeTrapezoidResidual = 0;
      for (let tick = 1; tick < actual.length; tick++) for (const [i, cell] of cells.entries()) {
        trapezoids[i] += dtNative / 2 * (localRates[tick - 1][i] + localRates[tick][i]);
        const residual = Math.abs(actual[tick][i] - actual[0][i] - trapezoids[i]);
        relativeTrapezoidResidual = Math.max(relativeTrapezoidResidual, residual / cell.capacity);
      }
      for (let tick = 2; tick < actual.length; tick += 2) for (const [i, cell] of cells.entries()) {
        integrated[i] += dtNative / 3 * (localRates[tick - 2][i] + 4 * localRates[tick - 1][i] + localRates[tick][i]);
        const residual = Math.abs(actual[tick][i] - actual[0][i] - integrated[i]);
        simpsonResidual = Math.max(simpsonResidual, residual);
        relativeResidual = Math.max(relativeResidual, residual / cell.capacity);
      }
      t.diagnostic(JSON.stringify({ distribution, mu, runCalls, resultBytes, requestBytes: plan.fullNetwork.budget.requestBytes,
        refinement, nativeError, deviationA, simpsonResidual, relativeResidual, relativeTrapezoidResidual }));
      assert.ok(nativeError.fractionK <= 5e-5);
      if (mu === 0 || distribution.kind === 'homogeneous') assert.ok(deviationA.fractionK <= 1e-5);
      assert.ok(relativeResidual <= 5e-5);
      assert.ok(relativeTrapezoidResidual <= 1e-4);
      if (distribution.profile === 'sigmoid-v2' && mu === 0.5) {
        const fluxAt = (i, j, tick) => lakeExchangeFlux(mu, cells[i].area, cells[j].area,
          actual[tick][i] / cells[i].area, actual[tick][j] / cells[j].area);
        const reversals = edges.map(([i, j]) => {
          const sign = Math.sign(fluxAt(i, j, 0));
          const tick = actual.findIndex((_, tick) => sign * fluxAt(i, j, tick) < 0);
          return { a: cells[i].id, b: cells[j].id, firstInverseMonth: tick / 10, initialFlux: fluxAt(i, j, 0),
            inverseFlux: tick > 0 ? fluxAt(i, j, tick) : 0 };
        }).filter(({ firstInverseMonth }) => firstInverseMonth > 0);
        assert.ok(reversals.length > 0);
        t.diagnostic(JSON.stringify({ reversals, demo: [0, 5, 10, 20].map(month => ({
          month, totalA: sum(control[month * 10]), totalB: sum(actual[month * 10]),
          dispersionA: dispersion(cells, control[month * 10]), dispersionB: dispersion(cells, actual[month * 10]),
        })) }));
      }
    }
  }
});

test('sans croissance, la masse se conserve et la dispersion décroît avec échange', async t => {
  for (const distribution of distributions) {
    const nominal = lakeDomain(mesh, 'proportional', distribution);
    const domain = { ...nominal, cells: nominal.cells.map(cell => ({ ...cell, growth: 0 })) };
    for (const mu of intensities) {
      const plan = full(domain, mu);
      const { request, cells } = plan.batches[0];
      const raw = execute(request);
      assert.ok(raw.simulation.runCalls <= caps.maxRunCalls);
      const restored = await runLakeBatches(plan, undefined, async () => raw);
      const actual = samples(restored);
      const published = sum(raw.observations.map(({ samples }) => samples.length));
      assert.equal(restored.trace.points, published);
      assert.equal(restored.trace.batches[0].deduplicatedPoints ?? 0, 2613 - published);
      for (const [i, series] of raw.observations.entries()) {
        const values = new Map(series.samples.map(({ time, value }) => [Math.round(time / dtNative), value]));
        let last;
        for (const [tick, states] of actual.entries()) {
          last = values.get(tick) ?? last;
          assert.equal(states[i], last);
        }
      }
      if (mu === 0 || distribution.kind === 'homogeneous') {
        for (const [i, { samples }] of raw.observations.entries()) {
          // The runner can stop at the first point for a strict equilibrium.
          assert.ok(samples.length > 0 && samples.length <= 201);
          if (mu === 0) assert.equal(samples.length, 1);
          assert.equal(samples[0].time, 0);
          for (const point of samples) assert.ok(Math.abs(point.value - cells[i].initial) <= 1e-9);
        }
        t.diagnostic(JSON.stringify({ distribution, mu, stationarySamples: raw.observations.map(series => series.samples.length),
          runCalls: raw.simulation.runCalls }));
        continue;
      }
      const edges = indexedEdges(plan);
      const refined = rk4(cells, edges, mu, 20);
      const refinement = errors(cells, rk4(cells, edges, mu, 10), refined);
      const nativeError = errors(cells, actual, refined);
      assert.ok(refinement.tonnes < 1e-5);
      const initialMass = sum(actual[0]);
      const drift = Math.max(...actual.map(values => Math.abs(sum(values) - initialMass)));
      const groups = plan.fullNetwork.components.map(group => group.map(id => cells.findIndex(cell => cell.id === id)));
      let remaining = 0;
      for (const group of groups) {
        const spreads = actual.map(values => dispersion(cells, values, group));
        assert.ok(spreads.every((spread, tick) => tick === 0 || spread <= spreads[tick - 1] + 1e-8 * spreads[0]));
        remaining = Math.max(remaining, spreads.at(-1) / spreads[0]);
      }
      assert.ok(remaining < 1);
      t.diagnostic(JSON.stringify({ distribution, mu, drift, refinement, nativeError, remaining, runCalls: raw.simulation.runCalls,
        published, deduplicated: 2613 - published }));
      assert.ok(nativeError.density < 0.003);
      assert.ok(drift < 1e-6 * initialMass);
    }
  }
});
