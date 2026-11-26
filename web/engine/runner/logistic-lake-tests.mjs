import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { caps, parseResult } from '../../dist/packages/contracts/index.js';
import { lakeDomain } from '../../dist/examples/logistic-grid.js';
import { lakeMeshFromGeoJson, lakeResolutions } from '../../dist/examples/logistic-lake.js';
import { lakeReference, runLakeSimulation } from '../../dist/examples/logistic-lake-analysis.js';
import { LakeRunError } from '../../dist/examples/logistic-lake-run.js';

const geojson = readFileSync(new URL('../../apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson', import.meta.url));
const source = JSON.parse(geojson);
const { batches: [{ request }], cells } = lakeDomain(lakeMeshFromGeoJson(source), 'absolute');
const exact = (time, initial, capacity, growth = 0.35) => capacity / (1 + (capacity / initial - 1) * Math.exp(-growth * time));
const tolerance = value => 0.15 + 0.002 * Math.abs(value);

test('P1.8 — Paramètres, cellules sèches et limites du runner', () => {
  const wetIds = cells.map(cell => cell.id);
  const dryIds = ['C00', 'C22', 'C32', 'C41', 'C42'];
  const { components, connections, observations } = request.model;
  assert.equal(wetIds.length, 13);
  assert.equal(components.length, 7 * wetIds.length);
  assert.equal(connections.length, 9 * wetIds.length);
  assert.ok(components.length <= caps.maxComponents);
  assert.ok(connections.length <= caps.maxConnections);
  assert.ok(observations.length * 202 <= caps.maxPoints);
  assert.deepEqual(request.simulation, { start: 0, end: 20 });
  assert.deepEqual(observations.map(({ component }) => component), wetIds.map(id => `${id}-N`));
  assert.ok(dryIds.every(id => !components.some(atom => atom.id.startsWith(id + '-'))));
  assert.ok(connections.every(({ from, to }) => from.component.split('-')[0] === to.component.split('-')[0]));

  let initial = 0;
  let capacity = 0;
  const atoms = new Map(components.map(atom => [atom.id, atom]));
  for (const cell of cells) {
    const integrator = atoms.get(`${cell.id}-N`);
    assert.equal(integrator.type, 'qss3_integrator');
    assert.deepEqual(integrator.parameters, { X: 150 * cell.area, dQ: 0.01 });
    assert.equal(atoms.get(`${cell.id}-r`).parameters.value, 0.35);
    const coefficient = atoms.get(`${cell.id}-sum`).parameters['coeff-1'];
    assert.equal(coefficient, -1 / (300 * cell.area));
    initial += integrator.parameters.X;
    capacity -= 1 / coefficient;
  }
  assert.ok(observations.every(({ samplingInterval }) => samplingInterval === 0.1));
  assert.ok(Math.abs(cells.reduce((sum, cell) => sum + cell.area, 0) - 300) < 1e-12);
  assert.ok(Math.abs(initial - 45_000) < 1e-10);
  assert.ok(Math.abs(capacity - 90_000) < 1e-10);
});

function runNative(input, stdoutBytes) {
  const runner = process.env.IRRITATOR_RUNNER;
  assert.ok(runner, 'Définir IRRITATOR_RUNNER avec le chemin du runner C++ compilé.');
  const native = spawnSync(runner, [], { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(native.error);
  assert.equal(native.status, 0, native.stderr || native.stdout);
  stdoutBytes?.push(Buffer.byteLength(native.stdout));
  return parseResult(JSON.parse(native.stdout), input);
}

test('P1.8 — Trajectoires QSS3 locales, agrégation analytique et indépendance', t => {
  const result = runNative(request);
  const totals = Array.from({ length: 201 }, () => 0);
  let worstLocal = { error: 0 };
  let worstTotal = { error: 0 };
  assert.equal(result.simulation.finalTime, 20);
  assert.deepEqual(result.observations.map(({ component }) => component), cells.map(cell => `${cell.id}-N`));
  for (const [index, { component, samples }] of result.observations.entries()) {
    const { initial, capacity } = cells[index];
    assert.equal(samples.length, totals.length);
    assert.equal(samples[0].time, 0);
    assert.ok(Math.abs(samples[0].value - initial) < 1e-10);
    assert.equal(samples.at(-1).time, 20);
    for (const [tick, { time, value }] of samples.entries()) {
      assert.ok(Math.abs(time - tick * 0.1) < 1e-12);
      const expected = exact(time, initial, capacity);
      const error = Math.abs(value - expected);
      assert.ok(error <= tolerance(expected), `${component}, t=${time} : ${error} t`);
      totals[tick] += value;
      if (error > worstLocal.error) worstLocal = { error, time, component };
    }
  }
  for (const [tick, value] of totals.entries()) {
    const time = tick * 0.1;
    const expected = exact(time, 45_000, 90_000);
    const analyticalSum = cells.reduce((sum, cell) => sum + exact(time, cell.initial, cell.capacity), 0);
    assert.ok(Math.abs(analyticalSum - expected) < 1e-10);
    const error = Math.abs(value - expected);
    assert.ok(error <= 0.15 * cells.length + 0.002 * expected, `t=${time} : ${error} t`);
    if (error > worstTotal.error) worstTotal = { error, time };
  }

  const variant = structuredClone(request);
  const changed = 'C11-N';
  variant.model.components.find(atom => atom.id === 'C11-r').parameters.value = 0.28;
  const altered = runNative(variant);
  const unaffected = series => series.component !== changed;
  assert.deepEqual(altered.observations.filter(unaffected), result.observations.filter(unaffected));
  const { initial, capacity } = cells.find(cell => cell.id === 'C11');
  const changedSample = altered.observations.find(series => series.component === changed).samples[50];
  const expected = exact(changedSample.time, initial, capacity, 0.28);
  assert.ok(Math.abs(changedSample.value - expected) <= tolerance(expected));
  assert.notEqual(changedSample.value, result.observations.find(series => series.component === changed).samples[50].value);
  t.diagnostic(JSON.stringify({ worstLocal, worstTotal, at0: totals[0], at10: totals[100], at20: totals[200],
    points: cells.length * totals.length, runCalls: result.simulation.runCalls }));
});

test('P1.9 — Compare les quanta sur les six grilles et vérifie chaque trajectoire native', async t => {
  const referenceTotals = [];
  const runs = [];
  for (const [index, resolution] of lakeResolutions.entries()) {
    const mesh = lakeMeshFromGeoJson(source, resolution);
    const expectedCells = [13, 35, 65, 101, 184, 296][index];
    const expectedBatches = [1, 2, 4, 6, 11, 17][index];
    const domain = lakeDomain(mesh);
    assert.equal(domain.cells.length, expectedCells);
    assert.equal(domain.batches.length, expectedBatches);
    const observedIds = [];
    for (const { request, cells } of domain.batches) {
      const { components, connections, observations } = request.model;
      assert.equal(components.length, 7 * cells.length);
      assert.equal(connections.length, 9 * cells.length);
      assert.ok(components.length <= caps.maxComponents);
      assert.ok(connections.length <= caps.maxConnections);
      assert.ok(observations.length <= 32 && observations.length * 202 <= caps.maxPoints);
      const wetIds = new Set(cells.map(cell => cell.id));
      const cellId = component => component.slice(0, component.lastIndexOf('-'));
      assert.ok(components.every(atom => wetIds.has(cellId(atom.id))));
      assert.ok(connections.every(({ from, to }) => cellId(from.component) === cellId(to.component)));
      observedIds.push(...observations.map(observation => observation.component));
      for (const cell of cells) {
        assert.deepEqual(components.find(atom => atom.id === cell.component).parameters, { X: cell.initial, dQ: cell.quantum });
        assert.equal(cell.quantum, Math.max(1e-9, cell.capacity * 3e-7));
      }
    }
    assert.deepEqual(observedIds, mesh.cells.map(cell => `${cell.id}-N`));

    const progress = [];
    const stdoutBytes = [];
    const { observations, trace } = await runLakeSimulation(domain, async request => runNative(request, stdoutBytes), {
      onProgress: count => progress.push(count),
    });
    assert.deepEqual(progress, Array.from({ length: expectedBatches }, (_, i) => i + 1));
    assert.deepEqual(observations.map(observation => observation.component), observedIds);
    const totals = Array(201).fill(0);
    for (const [cellIndex, { component, samples }] of observations.entries()) {
      const { initial, capacity, growth, quantum } = domain.cells[cellIndex];
      assert.equal(samples.length, 201);
      for (const [tick, { time, value }] of samples.entries()) {
        const analytical = exact(time, initial, capacity, growth);
        assert.ok(Math.abs(time - tick / 10) < 1e-12);
        const floorAllowance = quantum === 1e-9 ? 1e-7 : 0;
        assert.ok(Math.abs(value - analytical) <= 2e-6 * analytical + floorAllowance, `${component}, ${time} mois`);
        totals[tick] += value;
      }
    }
    for (const [tick, value] of totals.entries()) {
      const analytical = exact(tick / 10, 45_000, 90_000);
      assert.ok(Math.abs(value - analytical) <= 2e-6 * analytical);
      if (index === 0) referenceTotals.push(value);
      else assert.ok(Math.abs(value - referenceTotals[tick]) < 1e-7, `Total à ${tick / 10} mois`);
    }
    assert.equal(trace.points, expectedCells * 201);
    assert.ok(trace.resultBytes > 0 && trace.elapsedMs > 0);
    const atMonths = [totals[0], totals[100], totals[200]];
    runs.push({ ...trace, stdoutBytes, atMonths, minCapacity: Math.min(...domain.cells.map(cell => cell.capacity)),
      minQuantum: Math.min(...domain.cells.map(cell => cell.quantum)), maxQuantum: Math.max(...domain.cells.map(cell => cell.quantum)),
      quantumFloorCells: domain.cells.filter(cell => cell.quantum === 1e-9).map(({ id, capacity, quantum }) => ({ id, capacity, quantum })) });

    const absolute = lakeDomain(mesh, 'absolute');
    const fixedBytes = [];
    try {
      const fixed = await runLakeSimulation(absolute, async request => runNative(request, fixedBytes));
      assert.ok(index < 3, 'Une série incomplète était attendue avec le quantum fixe.');
      runs.push({ ...fixed.trace, stdoutBytes: fixedBytes });
    } catch (error) {
      assert.ok(index >= 3 && error instanceof LakeRunError, String(error));
      assert.match(error.message, /Série incomplète/);
      runs.push({ ...error.trace, stdoutBytes: fixedBytes });
    }

    if (expectedCells === 65) {
      const repeat = await runLakeSimulation(domain, async request => runNative(request));
      assert.deepEqual(repeat.observations, observations);
      const batch = domain.batches[1];
      const variant = structuredClone(batch.request);
      const changed = batch.cells[4];
      variant.model.components.find(atom => atom.id === `${changed.id}-r`).parameters.value = 0.28;
      const unaffected = observation => observation.component !== changed.component;
      const altered = runNative(variant).observations;
      const original = observations.filter(observation => batch.cells.some(cell => cell.component === observation.component));
      assert.deepEqual(altered.filter(unaffected), original.filter(unaffected));
      const sample = altered.find(observation => !unaffected(observation)).samples[50];
      assert.ok(Math.abs(sample.value - exact(sample.time, changed.initial, changed.capacity, 0.28)) < 2e-4 * sample.value);
      assert.notEqual(sample.value, original.find(observation => !unaffected(observation)).samples[50].value);
    }
  }

  for (const run of runs) t.diagnostic(JSON.stringify({ parameters: run.parameters, wetCells: run.wetCells,
    batches: run.batches.length, elapsedMs: run.elapsedMs, resultBytes: run.resultBytes, localErrors: run.localErrors,
    aggregateErrors: run.aggregateErrors, failure: run.failure }));
  if (process.env.IRRITATOR_LAKE_NATIVE_EVIDENCE) {
    const sha256 = data => createHash('sha256').update(data).digest('hex');
    const evidence = { runnerSha256: sha256(readFileSync(process.env.IRRITATOR_RUNNER)), geojsonSha256: sha256(geojson),
      node: process.version, runs };
    writeFileSync(process.env.IRRITATOR_LAKE_NATIVE_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  }
});

test('P1.10 — Gradient conservatif et reproductible sur les six grilles', async t => {
  const alpha = 0.6;
  // Keep the lot 1.9 quantum. Distinct initial ratios exercise other QSS3
  // trajectories, so their regression bounds are measured independently.
  const localRelativeTolerance = 7e-4;
  const aggregateRelativeTolerance = 3e-5;
  const analyticalByGrid = [];
  for (const resolution of lakeResolutions) {
    const mesh = lakeMeshFromGeoJson(source, resolution);
    const historical = lakeDomain(mesh);
    const disabled = lakeDomain(mesh, 'proportional', { kind: 'gradient', alpha: 0 });
    const gradient = lakeDomain(mesh, 'proportional', { kind: 'gradient', alpha });
    const moderate = lakeDomain(mesh, 'proportional', { kind: 'gradient', alpha: 0.3 });
    assert.deepEqual(disabled.cells, historical.cells);
    assert.deepEqual(disabled.batches, historical.batches);
    assert.equal(gradient.batches.length, historical.batches.length);
    assert.equal(gradient.parameters.areaKm2, 300);
    assert.equal(gradient.parameters.initialTonnes, 45_000);
    assert.equal(gradient.parameters.capacityDensity, 300);
    assert.deepEqual(gradient.parameters.simulation, { start: 0, end: 20 });
    const grid = `${mesh.rows}x${mesh.columns}`;

    for (const domain of [gradient, moderate]) {
      assert.ok(Math.abs(domain.cells.reduce((sum, cell) => sum + cell.area, 0) - 300) < 1e-12);
      assert.ok(Math.abs(domain.cells.reduce((sum, cell) => sum + cell.initial, 0) - 45_000) < 1e-9);
      assert.ok(Math.abs(domain.cells.reduce((sum, cell) => sum + cell.capacity, 0) - 90_000) < 1e-9);
      const factor = cell => 1 + domain.parameters.distribution.alpha * (0.5 - (cell.row + 0.5) / mesh.rows);
      const denominator = domain.cells.reduce((sum, cell) => sum + cell.area * factor(cell), 0);
      for (const [index, cell] of domain.cells.entries()) {
        assert.ok(Math.abs(cell.initial - (45_000 / denominator) * cell.area * factor(cell)) < 1e-11);
        assert.ok(cell.initial > 0 && cell.initial < cell.capacity);
        assert.equal(cell.capacity, 300 * cell.area);
        assert.equal(cell.growth, 0.35);
        assert.equal(cell.quantum, historical.cells[index].quantum);
      }
      assert.ok(domain.cells[0].initial / domain.cells[0].capacity > 0.5);
      const southern = domain.cells.at(-1);
      assert.ok(southern.initial / southern.capacity < 0.5);
    }

    for (const [index, { request, cells }] of gradient.batches.entries()) {
      const previous = historical.batches[index].request.model;
      assert.deepEqual(request.model.connections, previous.connections);
      assert.deepEqual(request.model.observations, previous.observations);
      assert.ok(request.model.components.length <= caps.maxComponents);
      assert.ok(request.model.connections.every(({ from, to }) =>
        from.component.split('-')[0] === to.component.split('-')[0]));
      const integrators = request.model.components.filter(atom => atom.type === 'qss3_integrator');
      assert.deepEqual(integrators.map(atom => atom.parameters), cells.map(cell => ({ X: cell.initial, dQ: cell.quantum })));
      assert.deepEqual(request.model.components.filter(atom => atom.type !== 'qss3_integrator'),
        previous.components.filter(atom => atom.type !== 'qss3_integrator'));
    }

    const baselineRun = await runLakeSimulation(historical, async request => runNative(request));
    const disabledRun = await runLakeSimulation(disabled, async request => runNative(request));
    assert.deepEqual(disabledRun.observations, baselineRun.observations);
    assert.deepEqual(disabledRun.trace.aggregateErrors, baselineRun.trace.aggregateErrors);
    assert.deepEqual(disabledRun.trace.localErrors, baselineRun.trace.localErrors);

    const baselineTotals = Array(201).fill(0);
    for (const observation of baselineRun.observations) {
      observation.samples.forEach(({ value }, tick) => { baselineTotals[tick] += value; });
    }
    for (const domain of [moderate, gradient]) {
      const analytical = Array(201).fill(0);
      const native = Array(201).fill(0);
      const { observations, trace } = await runLakeSimulation(domain, async request => runNative(request));
      assert.equal(trace.points, domain.cells.length * 201);
      assert.equal(trace.batches.length, domain.batches.length);
      for (const [index, { component, samples }] of observations.entries()) {
        const { initial, capacity, growth, quantum } = domain.cells[index];
        assert.equal(component, domain.cells[index].component);
        assert.ok(Math.abs(samples[0].value - initial) <= 32 * Number.EPSILON * initial);
        for (const [tick, { time, value }] of samples.entries()) {
          assert.ok(value >= 0);
          const expected = exact(tick * 0.1, initial, capacity, growth);
          analytical[tick] += expected;
          native[tick] += value;
          const floorAllowance = quantum === 1e-9 ? 1e-7 : 0;
          assert.ok(Math.abs(value - expected) <= localRelativeTolerance * expected + floorAllowance,
            `${grid} ${component}, ${time} mois`);
        }
      }
      const errors = native.map((value, tick) => Math.abs(value - analytical[tick]));
      assert.ok(errors.every((error, tick) => error <= aggregateRelativeTolerance * analytical[tick]));
      assert.equal(trace.aggregateErrors.maxAbsoluteTonnes, Math.max(...errors));
      assert.ok(Math.abs(analytical[0] - 45_000) < 1e-9);
      assert.ok(analytical[100] < exact(10, 45_000, 90_000) - 1);
      if (domain === gradient) {
        analyticalByGrid.push({ grid, analytical });
        const repeat = await runLakeSimulation(domain, async request => runNative(request));
        assert.deepEqual(repeat.observations, observations);
        assert.deepEqual(repeat.trace.batches.map(batch => batch.runCalls), trace.batches.map(batch => batch.runCalls));

        const batch = domain.batches[Math.floor(domain.batches.length / 2)];
        const variant = structuredClone(batch.request);
        const changed = batch.cells[0];
        const integrator = variant.model.components.find(atom => atom.id === changed.component);
        integrator.parameters.X *= 0.9;
        const altered = runNative(variant).observations;
        const originals = observations.filter(series => batch.cells.some(cell => cell.component === series.component));
        assert.notDeepEqual(altered[0], originals[0]);
        assert.deepEqual(altered.slice(1), originals.slice(1));
      }
      const atMonths = series => [series[0], series[100], series[200]];
      t.diagnostic(JSON.stringify({ grid, alpha: domain.parameters.distribution.alpha, wetCells: domain.cells.length,
        batches: trace.batches.length, points: trace.points, maxRunCalls: Math.max(...trace.batches.map(batch => batch.runCalls)),
        localErrors: trace.localErrors, aggregateErrors: trace.aggregateErrors, baseline: atMonths(baselineTotals),
        native: atMonths(native), analytical: atMonths(analytical) }));
    }
  }
  const finest = analyticalByGrid.at(-1).analytical;
  for (const { grid, analytical } of analyticalByGrid) {
    const meshDifferences = analytical.map((value, tick) => value - finest[tick]);
    const maxMeshDifference = Math.max(...meshDifferences.map(Math.abs));
    if (grid !== '48x24') assert.ok(maxMeshDifference > 0.01);
    t.diagnostic(JSON.stringify({ grid, meshComparison: '48x24', maxMeshDifference,
      timeOfMax: meshDifferences.findIndex(value => Math.abs(value) === maxMeshDifference) / 10,
      atMonths: [meshDifferences[0], meshDifferences[100], meshDifferences[200]] }));
  }
});

function trajectoryDifference(series, reference, interval) {
  const differences = series.map((value, tick) => value - reference[tick]);
  const maxAbsolute = Math.max(...differences.map(Math.abs));
  const tick = differences.findIndex(value => Math.abs(value) === maxAbsolute);
  return { maxAbsolute, timeOfMax: Number((tick * interval).toFixed(1)),
    atMonths: [differences[0], differences[100], differences[200]] };
}

test('P1.14 — Trajectoires natives des profils sigmoïdes sur les six grilles', async t => {
  for (const resolution of lakeResolutions) {
    const mesh = lakeMeshFromGeoJson(source, resolution);
    const grid = `${mesh.rows}x${mesh.columns}`;
    for (const [kind, alpha] of [['wet-gradient', 0], ['wet-gradient', 0.3], ['wet-gradient', 0.6], ['gradient', 0.6]]) {
      const domain = lakeDomain(mesh, 'proportional', { kind, alpha, profile: 'sigmoid-v2' });
      const { observations, trace } = await runLakeSimulation(domain, async request => runNative(request));
      assert.equal(trace.parameters.distribution.profile, 'sigmoid-v2');
      assert.equal(trace.points, domain.cells.length * 201);
      assert.equal(trace.batches.length, domain.batches.length);
      const maxRunCalls = Math.max(...trace.batches.map(batch => batch.runCalls));
      assert.ok(maxRunCalls <= caps.maxRunCalls);
      assert.ok(trace.batches.every(batch => batch.modelId.includes('-sigmoid-v2-')));
      const ratios = domain.cells.map(cell => cell.initial / cell.capacity);
      const areaBelow20 = domain.cells.reduce((sum, cell, index) => sum + (ratios[index] < 0.2 ? cell.area : 0), 0);
      const areaAbove80 = domain.cells.reduce((sum, cell, index) => sum + (ratios[index] > 0.8 ? cell.area : 0), 0);
      const totals = [0, 100, 200].map(tick => observations.reduce((sum, row) => sum + row.samples[tick].value, 0));
      t.diagnostic(JSON.stringify({ grid, kind, alpha, points: trace.points, maxRunCalls,
        ratioMin: Math.min(...ratios), ratioMax: Math.max(...ratios), areaBelow20, areaAbove80, totals,
        localErrors: trace.localErrors, aggregateErrors: trace.aggregateErrors }));
      assert.ok(Math.abs(totals[0] - 45_000) < 1e-8);
      assert.ok(trace.aggregateErrors.maxRelative < 1e-4);
      for (const [index, { component, samples }] of observations.entries()) {
        const { initial, capacity, growth, quantum } = domain.cells[index];
        assert.equal(component, domain.cells[index].component);
        assert.equal(samples.length, 201);
        for (const { time, value } of samples) {
          const expected = exact(time, initial, capacity, growth);
          const floorAllowance = quantum === 1e-9 ? 1e-7 : 0;
          assert.ok(Number.isFinite(value) && value > 0);
          assert.ok(Math.abs(value - expected) <= 0.005 * expected + floorAllowance,
            `${grid} ${kind} α=${alpha} ${component} t=${time}: ${value} au lieu de ${expected}`);
        }
      }
    }
  }
});

test('P1.11 — Sépare les écarts analytiques de maillage et les erreurs QSS3', async t => {
  const casesByResolution = lakeResolutions.map(resolution => {
    const mesh = lakeMeshFromGeoJson(source, resolution);
    const homogeneous = lakeDomain(mesh);
    const baseline = lakeReference(homogeneous);
    const zero = lakeDomain(mesh, 'proportional', { kind: 'wet-gradient', alpha: 0 });
    assert.deepEqual(zero.batches, homogeneous.batches);
    assert.deepEqual(lakeReference(zero), baseline);
    const cases = [0.3, 0.6].map(alpha => {
      const scenarios = ['gradient', 'wet-gradient'].map(kind => {
        const domain = lakeDomain(mesh, 'proportional', { kind, alpha });
        const reference = lakeReference(domain);
        const sums = {
          area: domain.cells.reduce((sum, cell) => sum + cell.area, 0),
          initial: domain.cells.reduce((sum, cell) => sum + cell.initial, 0),
          capacity: domain.cells.reduce((sum, cell) => sum + cell.capacity, 0),
        };
        assert.ok(Math.abs(sums.area - 300) < 1e-10);
        assert.ok(Math.abs(sums.initial - 45_000) < 1e-8);
        assert.ok(Math.abs(sums.capacity - 90_000) < 1e-8);
        if (kind === 'wet-gradient') assert.equal(sums.initial, 45_000);
        for (const [index, cell] of domain.cells.entries()) {
          assert.ok(cell.initial > 0 && cell.initial < cell.capacity);
          assert.equal(cell.area, homogeneous.cells[index].area);
          assert.equal(cell.growth, 0.35);
          assert.equal(cell.capacity, 300 * cell.area);
          assert.equal(cell.quantum, homogeneous.cells[index].quantum);
        }
        // At fixed r, the logistic flow is strictly concave in the initial
        // B/K for t > 0. The capacities are the weights in Jensen's inequality.
        assert.ok(new Set(domain.cells.map(cell => cell.initial / cell.capacity)).size > 1);
        assert.ok(Math.abs(reference.total[0] - baseline.total[0]) < 1e-8);
        assert.ok(reference.total.slice(1).every((value, tick) => value < baseline.total[tick + 1]));
        return { domain, reference, sums };
      });
      return { alpha, scenarios };
    });
    return { resolution, homogeneous, zero, cases };
  });
  const finest = casesByResolution.at(-1);
  const analytical = casesByResolution.flatMap(({ resolution, cases }) => cases.map(({ alpha, scenarios }, intensity) => {
    const [row, wet] = scenarios;
    const [fineRow, fineWet] = finest.cases[intensity].scenarios;
    const interval = wet.domain.parameters.samplingInterval;
    return { grid: `${resolution.rows}x${resolution.columns}`, alpha,
      rowVsFinest: trajectoryDifference(row.reference.total, fineRow.reference.total, interval),
      wetVsFinest: trajectoryDifference(wet.reference.total, fineWet.reference.total, interval),
      rowVsWet: trajectoryDifference(row.reference.total, wet.reference.total, interval) };
  }));

  const native = [];
  for (const { resolution, homogeneous, zero, cases } of casesByResolution) {
    const grid = `${resolution.rows}x${resolution.columns}`;
    if (resolution === lakeResolutions[0]) {
      const historical = await runLakeSimulation(homogeneous, async request => runNative(request));
      const disabled = await runLakeSimulation(zero, async request => runNative(request));
      assert.deepEqual(disabled.observations, historical.observations);
      assert.deepEqual(disabled.trace.localErrors, historical.trace.localErrors);
      assert.deepEqual(disabled.trace.aggregateErrors, historical.trace.aggregateErrors);
    }
    for (const { alpha, scenarios } of cases) {
      for (const { domain, reference, sums } of scenarios) {
        const { distribution, samplingInterval } = domain.parameters;
        const localRelativeTolerance = distribution.kind === 'wet-gradient' ? 1.2e-3 : 7e-4;
        const { observations, trace } = await runLakeSimulation(domain, async request => runNative(request));
        assert.equal(trace.points, domain.cells.length * 201);
        const totals = Array(201).fill(0);
        let maxRelativeAboveFloor = 0;
        for (const [index, observation] of observations.entries()) {
          const { initial, capacity, growth, quantum } = domain.cells[index];
          for (const [tick, { value }] of observation.samples.entries()) {
            const expected = exact(tick * samplingInterval, initial, capacity, growth);
            assert.equal(reference.local[index][tick], expected);
            const floorAllowance = quantum === 1e-9 ? 1e-7 : 0;
            const error = Math.abs(value - expected);
            assert.ok(value > 0);
            assert.ok(error <= localRelativeTolerance * expected + floorAllowance,
              `${grid} ${distribution.kind} α=${alpha} ${observation.component} t=${tick * samplingInterval}: ${error} t`);
            if (!floorAllowance) maxRelativeAboveFloor = Math.max(maxRelativeAboveFloor, error / expected);
            totals[tick] += value;
          }
        }
        assert.ok(trace.aggregateErrors.maxRelative < 3e-5,
          `${grid} ${distribution.kind} α=${alpha}: ${JSON.stringify(trace.aggregateErrors)}`);
        native.push({ grid, alpha, distribution: distribution.kind, sums, wetCells: trace.wetCells,
          batches: trace.plannedBatches, points: trace.points,
          maxRunCalls: Math.max(...trace.batches.map(batch => batch.runCalls)),
          localErrors: trace.localErrors, maxRelativeAboveFloor, aggregateErrors: trace.aggregateErrors,
          analyticalAtMonths: [reference.total[0], reference.total[100], reference.total[200]],
          nativeAtMonths: [totals[0], totals[100], totals[200]] });
      }
    }
  }
  for (const comparison of analytical) t.diagnostic(JSON.stringify(comparison));
  for (const result of native) t.diagnostic(JSON.stringify(result));
  if (process.env.IRRITATOR_LAKE_CONVERGENCE_EVIDENCE) {
    const sha256 = data => createHash('sha256').update(data).digest('hex');
    const evidence = { runnerSha256: sha256(readFileSync(process.env.IRRITATOR_RUNNER)),
      geojsonSha256: sha256(geojson), analytical, native };
    writeFileSync(process.env.IRRITATOR_LAKE_CONVERGENCE_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  }
});
