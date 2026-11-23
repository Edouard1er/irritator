import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseResult } from '../../dist/packages/contracts/index.js';
import { constantDomainCell, spatialDimensions, spatialRequest } from '../../dist/examples/logistic-grid.js';

const end = 20;
const interval = 0.1;
const growth = 0.35;
const exact = (time, initial, capacity) => capacity / (1 + (capacity / initial - 1) * Math.exp(-growth * time));
const tolerance = value => 0.15 + 0.002 * Math.abs(value);
const totalTolerance = (value, dimension) => dimension ** 2 * tolerance(value / dimension ** 2);

for (const dimension of spatialDimensions) {
  test(`P1.7 — Géométrie et paramètres du domaine ${dimension} × ${dimension}`, () => {
    const count = dimension ** 2;
    const cell = constantDomainCell(dimension);
    const request = spatialRequest(dimension, 'constant');
    const atoms = new Map(request.model.components.map(({ id, parameters }) => [id, parameters]));
    let area = 0;
    let initial = 0;
    let capacity = 0;

    assert.equal(cell.area, 9 / count);
    assert.equal(request.model.components.length, 7 * count);
    assert.equal(request.model.connections.length, 9 * count);
    assert.equal(request.model.observations.length, count);
    assert.deepEqual(request.simulation, { start: 0, end });
    assert.ok(request.model.connections.every(({ from, to }) => from.component.slice(0, 3) === to.component.slice(0, 3)));
    assert.equal(request.limits, undefined);
    for (const { component, samplingInterval } of request.model.observations) {
      const { X, dQ } = atoms.get(component);
      const prefix = component.slice(0, -2);
      const K = -1 / atoms.get(`${prefix}-sum`)['coeff-1'];
      assert.equal(X, 150 * cell.area);
      assert.equal(dQ, 0.01);
      assert.equal(atoms.get(`${prefix}-r`).value, growth);
      assert.equal(atoms.get(`${prefix}-sum`)['coeff-1'], -1 / (300 * cell.area));
      assert.equal(samplingInterval, interval);
      area += cell.area;
      initial += X;
      capacity += K;
    }
    assert.equal(area, 9);
    assert.equal(initial, 1350);
    assert.ok(Math.abs(capacity - 2700) < 1e-10, String(capacity));
    for (const time of [0, 0.1, 5, 10, end]) {
      assert.ok(Math.abs(count * exact(time, cell.initial, cell.capacity) - exact(time, 1350, 2700)) < 1e-10);
    }
  });
}

function runNative(request) {
  const runner = process.env.IRRITATOR_RUNNER;
  assert.ok(runner, 'Définir IRRITATOR_RUNNER avec le chemin du runner C++ compilé.');
  const input = JSON.stringify(request);
  const start = performance.now();
  const native = spawnSync(runner, [], { input, encoding: 'utf8', timeout: 30000, windowsHide: true });
  const elapsed = performance.now() - start;
  assert.ifError(native.error);
  assert.equal(native.status, 0, native.stderr || native.stdout);
  const result = parseResult(JSON.parse(native.stdout), request);
  return { result, elapsed, stdoutBytes: Buffer.byteLength(native.stdout) };
}

test('P1.7 — Le runner suit les solutions analytiques locale et totale pour les trois tailles', t => {
  const grids = spatialDimensions.map(dimension => {
    const request = spatialRequest(dimension, 'constant');
    const run = runNative(request);
    const { result } = run;
    const { initial, capacity } = constantDomainCell(dimension);
    const totals = Array.from({ length: 201 }, () => 0);
    let worstLocal = { error: 0, time: 0, cell: '' };
    let worstTotal = { error: 0, time: 0 };

    assert.equal(result.simulation.finalTime, end);
    assert.equal(result.observations.length, dimension ** 2);
    for (const { component, samples } of result.observations) {
      assert.equal(samples.length, totals.length, component);
      assert.deepEqual(samples[0], { time: 0, value: initial }, component);
      assert.equal(samples.at(-1).time, end, component);
      for (const [index, { time, value }] of samples.entries()) {
        assert.ok(Math.abs(time - index * interval) < 1e-12, `${component}, t=${time}`);
        const expected = exact(time, initial, capacity);
        const error = Math.abs(value - expected);
        assert.ok(error <= tolerance(expected), `${component}, t=${time} : ${error} t`);
        totals[index] += value;
        if (error > worstLocal.error) worstLocal = { error, time, cell: component };
      }
    }
    for (const [index, value] of totals.entries()) {
      const time = index * interval;
      const expected = exact(time, 1350, 2700);
      const error = Math.abs(value - expected);
      assert.ok(error <= totalTolerance(expected, dimension), `${dimension} × ${dimension}, t=${time} : ${error} t`);
      if (error > worstTotal.error) worstTotal = { error, time };
    }
    assert.equal(totals[0], 1350);
    return { dimension, request, run, totals, worstLocal, worstTotal, times: [] };
  });

  if (process.env.IRRITATOR_LOGISTIC_BENCHMARK === '1') {
    // Rotate the order so every size occupies each position equally often.
    for (let repetition = 0; repetition < 9; repetition++) {
      for (let position = 0; position < grids.length; position++) {
        const grid = grids[(repetition + position) % grids.length];
        const run = runNative(grid.request);
        assert.deepEqual(run.result, grid.run.result);
        grid.times.push(run.elapsed);
      }
    }
  }
  for (const [index, grid] of grids.entries()) {
    const { dimension, run: { result, stdoutBytes }, totals, times, worstLocal, worstTotal } = grid;
    times.sort((a, b) => a - b);
    t.diagnostic(JSON.stringify({
      dimension, worstLocal, worstTotal, final: totals.at(-1), runCalls: result.simulation.runCalls,
      points: result.observations.reduce((count, series) => count + series.samples.length, 0),
      observationBytes: Buffer.byteLength(JSON.stringify(result.observations)), stdoutBytes,
      ...(times.length && { minMs: times[0], medianMs: times[4], maxMs: times.at(-1) }),
    }));
    for (const other of grids.slice(index + 1)) {
      let largestGap = { error: 0, time: 0 };
      for (const [tick, value] of totals.entries()) {
        const time = tick * interval;
        const error = Math.abs(value - other.totals[tick]);
        const expected = exact(time, 1350, 2700);
        const bound = totalTolerance(expected, dimension) + totalTolerance(expected, other.dimension);
        assert.ok(error <= bound, `${dimension} vs ${other.dimension}, t=${time} : ${error} t`);
        if (error > largestGap.error) largestGap = { error, time };
      }
      t.diagnostic(JSON.stringify({ grids: [dimension, other.dimension], largestGap }));
    }
  }
});
