import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { caps, parseResult } from '../../dist/packages/contracts/index.js';
import { lakeDomain } from '../../dist/examples/logistic-grid.js';
import { lakeMeshFromGeoJson } from '../../dist/examples/logistic-lake.js';

const source = JSON.parse(readFileSync(new URL('../../apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson', import.meta.url), 'utf8'));
const { request, cells } = lakeDomain(lakeMeshFromGeoJson(source).cells);
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
  assert.ok(Math.abs(cells.reduce((sum, cell) => sum + cell.area, 0) - 9) < 1e-12);
  assert.ok(Math.abs(initial - 1350) < 1e-10);
  assert.ok(Math.abs(capacity - 2700) < 1e-10);
});

function runNative(input) {
  const runner = process.env.IRRITATOR_RUNNER;
  assert.ok(runner, 'Définir IRRITATOR_RUNNER avec le chemin du runner C++ compilé.');
  const native = spawnSync(runner, [], { input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(native.error);
  assert.equal(native.status, 0, native.stderr || native.stdout);
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
    assert.ok(Math.abs(samples[0].value - initial) < 1e-12);
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
    const expected = exact(time, 1350, 2700);
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
