import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { caps, parseResult, validateRequest } from '../../dist/packages/contracts/index.js';
import { spatialRequest } from '../../dist/examples/logistic-grid.js';

const readExample = name => JSON.parse(readFileSync(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const single = readExample('logistic-single-v1');
const nine = readExample('logistic-nine-cells-v1');

function invoke(request) {
  const runner = process.env.IRRITATOR_RUNNER;
  assert.ok(runner, 'Définir IRRITATOR_RUNNER avec le chemin du runner C++ compilé.');
  const native = spawnSync(runner, [], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  assert.ifError(native.error);
  assert.equal(native.signal, null, native.stderr);
  return native;
}

function nativeRun(request) {
  validateRequest(request);
  const native = invoke(request);
  assert.equal(native.status, 0, native.stderr || native.stdout);
  return parseResult(JSON.parse(native.stdout), request);
}

function checkTrajectories(request, result) {
  const { start, end } = request.simulation;
  const atoms = new Map(request.model.components.map(({ id, parameters }) => [id, parameters]));
  let worst = { component: '', error: 0, time: start };
  for (const { component, samples } of result.observations) {
    const cell = component.slice(0, -2);
    const initial = atoms.get(component).X;
    const growth = atoms.get(`${cell}-r`).value;
    const capacity = -1 / atoms.get(`${cell}-sum`)['coeff-1'];
    assert.deepEqual(samples[0], { time: start, value: initial }, component);
    if (initial === 0 || initial === capacity) {
      assert.deepEqual(samples, [{ time: start, value: initial }], component);
      continue;
    }

    assert.equal(samples.at(-1).time, end, component);
    for (const { time, value } of samples) {
      assert.ok(value >= 0, `${component} : biomasse négative à t=${time}`);
      const exact = capacity / (1 + (capacity / initial - 1) * Math.exp(-growth * (time - start)));
      const error = Math.abs(value - exact);
      const tolerance = 0.15 + 0.002 * Math.abs(exact);
      assert.ok(error <= tolerance, `${component} : erreur ${error} t au-delà de ${tolerance} t à t=${time}`);
      if (error > worst.error) worst = { component, error, time };
    }
  }
  return worst;
}

for (const [dimension, atoms, connections, points] of [
  [2, 28, 36, 404],
  [3, 63, 81, 1409],
  [4, 112, 144, 2616],
]) {
  test(`P1.6 — Grille ${dimension} × ${dimension} : graphe et trajectoires natifs`, t => {
    const request = spatialRequest(dimension);
    const cellIds = Array.from({ length: dimension ** 2 }, (_, index) =>
      `C${Math.floor(index / dimension)}${index % dimension}`);
    assert.equal(request.model.components.length, atoms);
    assert.equal(request.model.connections.length, connections);
    assert.deepEqual(request.model.components.map(({ id, type }) => ({ id, type })), cellIds.flatMap(cell =>
      single.model.components.map(({ id, type }) => ({ id: `${cell}-${id}`, type }))));
    assert.deepEqual(request.model.connections, cellIds.flatMap(cell =>
      single.model.connections.map(({ from, to }) => ({
        from: { ...from, component: `${cell}-${from.component}` },
        to: { ...to, component: `${cell}-${to.component}` },
      }))));
    assert.deepEqual(request.model.observations, cellIds.map(cell => ({
      component: `${cell}-N`, samplingInterval: single.model.observations[0].samplingInterval,
    })));

    const result = nativeRun(request);
    const worst = checkTrajectories(request, result);
    assert.equal(result.observations.reduce((total, { samples }) => total + samples.length, 0), points);
    t.diagnostic(`${result.simulation.runCalls} appels, ${points} points, erreur maximale ${worst.error} t (${worst.component}, t=${worst.time})`);
  });
}

test('P1.6 — La grille 3 × 3 reproduit intégralement le fixture et sa sortie native', () => {
  const request = spatialRequest(3);
  assert.deepEqual(request, nine);
  assert.deepEqual(nativeRun(request), nativeRun(nine));
});

test('P1.6 — Les séries communes coïncident lors des changements de taille', () => {
  const largest = nativeRun(spatialRequest(4));
  const byComponent = new Map(largest.observations.map(series => [series.component, series]));
  for (const dimension of [2, 3]) {
    for (const series of nativeRun(spatialRequest(dimension)).observations) {
      assert.deepEqual(series, byComponent.get(series.component), series.component);
    }
  }
});

test('P1.6 — Modifier les trois paramètres de C33 préserve les quinze autres séries', t => {
  const request = spatialRequest(4);
  const reference = nativeRun(request);
  request.model.components.find(atom => atom.id === 'C33-N').parameters.X = 100;
  request.model.components.find(atom => atom.id === 'C33-r').parameters.value = 0.28;
  request.model.components.find(atom => atom.id === 'C33-sum').parameters['coeff-1'] = -1 / 260;
  const result = nativeRun(request);
  const worst = checkTrajectories(request, result);

  for (const [index, series] of result.observations.entries()) {
    if (series.component === 'C33-N') {
      assert.notDeepEqual(series, reference.observations[index]);
    } else {
      assert.deepEqual(series, reference.observations[index], series.component);
    }
  }
  t.diagnostic(`${result.simulation.runCalls} appels, erreur maximale ${worst.error} t (${worst.component}, t=${worst.time})`);
});

test('P1.6 — Les budgets du runner refusent explicitement la grille hors limites', () => {
  const request = spatialRequest(4);
  assert.deepEqual(request.limits, nine.limits);
  assert.ok(request.model.components.length <= caps.maxComponents);
  assert.ok(request.model.connections.length <= caps.maxConnections);
  request.limits = { maxComponents: 111 };
  assert.throws(() => validateRequest(request), { code: 'LIMIT_EXCEEDED' });
  request.limits = { maxConnections: 143 };
  assert.throws(() => validateRequest(request), { code: 'LIMIT_EXCEEDED' });
  request.limits = { maxPoints: 3231 };
  assert.throws(() => validateRequest(request), { code: 'LIMIT_EXCEEDED' });

  request.limits = { maxRunCalls: 1 };
  validateRequest(request);
  const native = invoke(request);
  assert.equal(native.status, 2, native.stderr || native.stdout);
  const result = JSON.parse(native.stdout);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'LIMIT_EXCEEDED');
  assert.match(result.error.message, /Scheduler call budget exceeded/);
  assert.equal(result.observations, undefined);
});
