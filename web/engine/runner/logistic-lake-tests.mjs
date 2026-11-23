import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { caps, parseResult } from '../../dist/packages/contracts/index.js';
import { lakeDomain } from '../../dist/examples/logistic-grid.js';
import { lakeMeshFromGeoJson, lakeResolutions } from '../../dist/examples/logistic-lake.js';
import { LakeRunError, runLakeSimulation } from '../../dist/examples/logistic-lake-run.js';

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
