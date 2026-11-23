import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const readExample = name => JSON.parse(readFileSync(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const single = readExample('logistic-single-v1');
const three = readExample('logistic-three-cells-v1');
const runner = process.env.IRRITATOR_RUNNER;
const nominal = new Map([
  ['C1', { initial: 60, growth: 0.35, capacity: 300 }],
  ['C2', { initial: 150, growth: 0.35, capacity: 300 }],
  ['C3', { initial: 380, growth: 0.35, capacity: 300 }],
]);
const heterogeneous = new Map([
  ['C1', { initial: 60, growth: 0.20, capacity: 240 }],
  ['C2', { initial: 150, growth: 0.42, capacity: 330 }],
  ['C3', { initial: 380, growth: 0.28, capacity: 260 }],
]);
const cellId = (cell, atom) => `${cell}-${atom}`;

function configure(request, cell, { initial, growth, capacity }) {
  const parameters = id => request.model.components.find(c => c.id === (cell ? cellId(cell, id) : id)).parameters;
  parameters('N').X = initial;
  parameters('r').value = growth;
  parameters('sum')['coeff-1'] = -1 / capacity;
}

function nativeRun(request) {
  assert.ok(runner, 'Définir IRRITATOR_RUNNER avec le chemin du runner C++ compilé.');
  const native = spawnSync(runner, [], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  assert.ifError(native.error);
  assert.equal(native.signal, null, native.stderr);
  assert.equal(native.status, 0, `${native.stderr}\n${native.stdout}`);

  const result = JSON.parse(native.stdout);
  assert.equal(result.status, 'completed');
  assert.equal(result.modelId, request.model.id);
  assert.equal(result.simulation.start, request.simulation.start);
  assert.equal(result.simulation.end, request.simulation.end);
  assert.equal(result.simulation.finalTime, request.simulation.end);
  const { runCalls } = result.simulation;
  assert.ok(Number.isSafeInteger(runCalls) && runCalls > 0);
  assert.deepEqual(
    result.observations.map(({ component, samplingInterval }) => ({ component, samplingInterval })),
    request.model.observations,
  );
  const series = new Map(result.observations.map(({ component, samples }) => [component, samples]));
  return { series, runCalls };
}

function checkTrajectory(samples, { initial, growth, capacity }, label) {
  const { start, end } = three.simulation;
  const isEquilibrium = initial === 0 || initial === capacity;
  const direction = Math.sign(capacity - initial);
  // Même critère provisoire que celui du lot 1.1 au quantum de 0,01 t.
  const absTolerance = 0.15;
  const relTolerance = 0.002;
  const equilibriumTolerance = 1e-6;

  assert.deepEqual(samples[0], { time: start, value: initial }, label);
  let maxError = 0;
  let timeOfMaxError = start;
  let previousTime = -Infinity;
  let previousValue = initial;
  for (const { time, value } of samples) {
    assert.ok(Number.isFinite(time) && Number.isFinite(value), `${label} : valeur non finie`);
    assert.ok(time >= start && time <= end && time > previousTime, `${label} : horodatage invalide`);
    assert.ok(value >= 0, `${label} : biomasse négative à t=${time}`);
    const exact = initial === 0 ? 0 : capacity / (1 + (capacity / initial - 1) * Math.exp(-growth * (time - start)));
    const error = Math.abs(value - exact);
    const tolerance = isEquilibrium ? equilibriumTolerance : absTolerance + relTolerance * Math.abs(exact);
    assert.ok(error <= tolerance, `${label} : erreur ${error} t au-delà de ${tolerance} t à t=${time}`);
    if (error > maxError) {
      maxError = error;
      timeOfMaxError = time;
    }
    if (!isEquilibrium) {
      assert.ok(direction * (value - previousValue) >= 0, `${label} : variation de sens inattendu à t=${time}`);
      assert.ok(direction * (capacity - value) >= 0, `${label} : franchissement de K à t=${time}`);
    }
    previousTime = time;
    previousValue = value;
  }

  const last = samples.at(-1);
  // Les séries constantes sont dédupliquées. nativeRun vérifie l'horizon dans tous les cas.
  if (!isEquilibrium) {
    assert.equal(last.time, end, label);
    assert.ok(direction * (last.value - initial) > 0, `${label} : la biomasse doit s'approcher de K`);
  }
  console.log(`${label} : ${samples.length} points, dernière valeur ${last.value.toPrecision(12)} t à t=${last.time}, erreur absolue max ${maxError.toPrecision(11)} t à t=${timeOfMaxError.toPrecision(6)}`);
}

function checkCells(result, settings, label) {
  console.log(`${label} : ${result.runCalls} appels au scheduler`);
  for (const [cell, parameters] of settings) {
    checkTrajectory(result.series.get(cellId(cell, 'N')), parameters, `${label} ${cell}`);
  }
}

test('P1.2-01 — Trois copies de la cellule corrigée, sans liaison entre elles', () => {
  assert.equal(three.schemaVersion, 1);
  assert.deepEqual(three.simulation, { start: 0, end: 20 });
  assert.equal(three.model.components.length, 21);
  assert.equal(three.model.connections.length, 27);

  const expectedComponents = [];
  const expectedConnections = [];
  const expectedObservations = [];
  for (const [cell, parameters] of nominal) {
    const isolated = structuredClone(single);
    configure(isolated, '', parameters);
    assert.equal(isolated.model.components.length, 7);
    assert.equal(isolated.model.connections.length, 9);
    assert.equal(isolated.model.components.find(c => c.id === 'N').parameters.dQ, 0.01);
    for (const atom of isolated.model.components) {
      expectedComponents.push({ ...atom, id: cellId(cell, atom.id) });
    }
    for (const { from, to } of isolated.model.connections) {
      expectedConnections.push({
        from: { ...from, component: cellId(cell, from.component) },
        to: { ...to, component: cellId(cell, to.component) },
      });
    }
    expectedObservations.push({ component: cellId(cell, 'N'), samplingInterval: 0.1 });
  }
  // Les 27 liaisons attendues restent chacune dans le préfixe de leur cellule.
  assert.deepEqual(three.model.components, expectedComponents);
  assert.deepEqual(three.model.connections, expectedConnections);
  assert.deepEqual(three.model.observations, expectedObservations);
});

test('P1.2-02 — Les trajectoires nominales coïncident avec les exécutions isolées', () => {
  const result = nativeRun(three);
  checkCells(result, nominal, 'Nominal');
  for (const [cell, parameters] of nominal) {
    const isolated = structuredClone(single);
    configure(isolated, '', parameters);
    assert.deepEqual(result.series.get(cellId(cell, 'N')), nativeRun(isolated).series.get('N'), cell);
  }
  console.log('Parité avec le lot 1.1 : mêmes dates et valeurs, écart maximal de 0 t.');
});

test('P1.2-03 — Modifier C1 laisse les trajectoires de C2 et C3 identiques', () => {
  const control = nativeRun(three);
  const request = structuredClone(three);
  const changed = { initial: 90, growth: 0.27, capacity: 260 };
  configure(request, 'C1', changed);
  const result = nativeRun(request);
  const settings = new Map(nominal);
  settings.set('C1', changed);
  checkCells(result, settings, 'C1 modifiée');

  assert.notDeepEqual(result.series.get('C1-N'), control.series.get('C1-N'));
  assert.deepEqual(result.series.get('C2-N'), control.series.get('C2-N'));
  assert.deepEqual(result.series.get('C3-N'), control.series.get('C3-N'));
});

test('P1.2-04 — Chaque cellule suit son propre oracle avec r et K distincts', () => {
  const request = structuredClone(three);
  for (const [cell, parameters] of heterogeneous) configure(request, cell, parameters);
  checkCells(nativeRun(request), heterogeneous, 'Hétérogène');
});

test('P1.2-05 — Les équilibres à zéro et à K persistent à côté d’une cellule active', () => {
  for (const [label, settings] of [['nominal', nominal], ['hétérogène', heterogeneous]]) {
    const request = structuredClone(three);
    for (const [cell, parameters] of settings) configure(request, cell, parameters);
    const control = nativeRun(request);

    const equilibria = new Map(settings);
    equilibria.set('C1', { ...settings.get('C1'), initial: 0 });
    equilibria.set('C2', { ...settings.get('C2'), initial: settings.get('C2').capacity });
    configure(request, 'C1', equilibria.get('C1'));
    configure(request, 'C2', equilibria.get('C2'));

    const result = nativeRun(request);
    checkCells(result, equilibria, `Équilibres ${label}`);
    assert.deepEqual(result.series.get('C3-N'), control.series.get('C3-N'));
  }
});
