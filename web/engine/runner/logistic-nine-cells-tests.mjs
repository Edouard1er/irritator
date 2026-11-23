import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const readExample = name => JSON.parse(readFileSync(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const single = readExample('logistic-single-v1');
const three = readExample('logistic-three-cells-v1');
const nine = readExample('logistic-nine-cells-v1');
const runner = process.env.IRRITATOR_RUNNER;

const initialByRow = [
  [0, 60, 150],
  [300, 380, 80],
  [220, 270, 50],
];
const cells = initialByRow.flatMap((row, line) => row.map((initial, column) => ({
  id: `C${line}${column}`, initial, growth: 0.35, capacity: 300,
})));
const atomId = (cell, atom) => `${cell}-${atom}`;

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
  assert.ok(Number.isSafeInteger(result.simulation.runCalls) && result.simulation.runCalls > 0);
  assert.equal(result.diagnostics.observationPolicy, 'engine-resampled-sealed-deduplicated');
  assert.deepEqual(
    result.observations.map(({ component, samplingInterval }) => ({ component, samplingInterval })),
    request.model.observations,
  );
  return result;
}

function checkTrajectories(request, result, label, overrides = {}) {
  const { start, end } = request.simulation;
  const sealedRuns = new Map();
  function sealedValue(component, time) {
    if (!sealedRuns.has(time)) {
      sealedRuns.set(time, nativeRun({ ...request, simulation: { start, end: time } }));
    }
    const observation = sealedRuns.get(time).observations.find(series => series.component === component);
    const endpoint = observation.samples.at(-1);
    assert.equal(endpoint.time, time, `${label} ${component} : point final du runner manquant`);
    return endpoint.value;
  }

  console.log(`${label} : ${result.simulation.runCalls} appels à l’ordonnanceur`);
  for (const [index, cell] of cells.entries()) {
    const { initial, growth, capacity } = { ...cell, ...overrides[cell.id] };
    const { component, samples } = result.observations[index];
    const name = `${label} ${cell.id}`;
    assert.deepEqual(samples[0], { time: start, value: initial }, name);
    if (initial === 0 || initial === capacity) {
      // Le runner déduplique les valeurs identiques jusqu’à la clôture de l’horizon.
      assert.deepEqual(samples, [{ time: start, value: initial }], name);
      console.log(`${name} : 1 point à t=${start}, biomasse ${initial} t, erreur maximale 0 t`);
      continue;
    }

    const direction = Math.sign(capacity - initial);
    let maxError = 0;
    let timeOfMaxError = start;
    let previous = { time: -Infinity, value: initial };
    for (const { time, value } of samples) {
      assert.ok(Number.isFinite(time) && Number.isFinite(value), `${name} : valeur non finie`);
      assert.ok(time >= start && time <= end && time > previous.time, `${name} : horodatage invalide`);
      assert.ok(value >= 0, `${name} : biomasse négative à t=${time}`);
      assert.ok(direction * (capacity - value) >= 0, `${name} : franchissement de K à t=${time}`);
      const exact = capacity / (1 + (capacity / initial - 1) * Math.exp(-growth * (time - start)));
      const error = Math.abs(value - exact);
      // Même critère provisoire que les lots 1.1 et 1.2 au quantum de 0,01 t.
      const tolerance = 0.15 + 0.002 * Math.abs(exact);
      assert.ok(error <= tolerance, `${name} : erreur ${error} t au-delà de ${tolerance} t à t=${time}`);
      if (error > maxError) {
        maxError = error;
        timeOfMaxError = time;
      }
      if (direction * (value - previous.value) < 0) {
        // Le scellement à chaque date tranche entre inversion native et effet du rééchantillonnage.
        const before = previous.time === start ? initial : sealedValue(component, previous.time);
        const after = sealedValue(component, time);
        assert.ok(direction * (after - before) > 0, `${name} : tendance native inversée à t=${time}`);
        console.log(`${name} : à ${previous.time.toPrecision(6)}–${time.toPrecision(6)} mois, variation rééchantillonnée ${(value - previous.value).toPrecision(8)} t, variation des points finaux ${(after - before).toPrecision(8)} t`);
      }
      previous = { time, value };
    }

    const last = samples.at(-1);
    assert.equal(last.time, end, name);
    assert.ok(direction * (last.value - initial) > 0, `${name} : la biomasse doit s’approcher de K`);
    console.log(`${name} : ${samples.length} points, dernière valeur ${last.value.toPrecision(12)} t, erreur maximale ${maxError.toPrecision(11)} t à t=${timeOfMaxError.toPrecision(6)}`);
  }
}

test('P1.3-01 — La disposition logique reproduit neuf graphes indépendants', () => {
  assert.equal(nine.schemaVersion, 1);
  assert.deepEqual(nine.simulation, { start: 0, end: 20 });
  assert.equal(nine.model.components.length, 63);
  assert.equal(nine.model.connections.length, 81);
  const expectedComponents = [];
  const expectedConnections = [];
  for (const { id, initial, growth, capacity } of cells) {
    for (const atom of single.model.components) {
      const parameters = { ...atom.parameters };
      if (atom.id === 'N') Object.assign(parameters, { X: initial, dQ: 0.01 });
      if (atom.id === 'r') parameters.value = growth;
      if (atom.id === 'sum') parameters['coeff-1'] = -1 / capacity;
      expectedComponents.push({ ...atom, id: atomId(id, atom.id), parameters });
    }
    for (const { from, to } of single.model.connections) {
      expectedConnections.push({
        from: { ...from, component: atomId(id, from.component) },
        to: { ...to, component: atomId(id, to.component) },
      });
    }
  }
  assert.deepEqual(nine.model.components, expectedComponents);
  assert.deepEqual(nine.model.connections, expectedConnections);
  assert.deepEqual(nine.model.observations, cells.map(({ id }) => ({
    component: atomId(id, 'N'), samplingInterval: 0.1,
  })));
});

test('P1.3-02 — Trajectoires nominales, équilibres dédupliqués et parité avec les lots précédents', () => {
  const nominal = nativeRun(nine);
  checkTrajectories(nine, nominal, 'Nominal');
  const nominalSeries = new Map(nominal.observations.map(({ component, samples }) => [component, samples]));
  assert.deepEqual(nominalSeries.get('C02-N'), nativeRun(single).observations[0].samples);
  const priorGridIds = ['C01-N', 'C02-N', 'C11-N'];
  for (const [index, { samples }] of nativeRun(three).observations.entries()) {
    assert.deepEqual(nominalSeries.get(priorGridIds[index]), samples, priorGridIds[index]);
  }
});

test('P1.3-03 — Deux exécutions identiques donnent les mêmes observations et appels', () => {
  assert.deepEqual(nativeRun(nine), nativeRun(nine));
});

test('P1.3-04 — Changer seulement C11 préserve les huit autres séries', () => {
  const nominal = nativeRun(nine);
  const altered = structuredClone(nine);
  const initial = 180;
  altered.model.components.find(c => c.id === 'C11-N').parameters.X = initial;
  const result = nativeRun(altered);
  checkTrajectories(altered, result, 'C11 modifiée', { C11: { initial } });
  for (const [index, series] of result.observations.entries()) {
    const reference = nominal.observations[index];
    if (series.component === 'C11-N') {
      assert.notDeepEqual(series, reference);
    } else {
      assert.deepEqual(series, reference, series.component);
    }
  }
});

test('P1.3-05 — Les neuf cellules suivent leur oracle avec des r et K distincts', () => {
  const altered = structuredClone(nine);
  const overrides = {
    C01: { growth: 0.20, capacity: 240 },
    C02: { growth: 0.42, capacity: 330 },
    C11: { growth: 0.28, capacity: 260 },
  };
  for (const [cell, { growth, capacity }] of Object.entries(overrides)) {
    altered.model.components.find(c => c.id === atomId(cell, 'r')).parameters.value = growth;
    altered.model.components.find(c => c.id === atomId(cell, 'sum')).parameters['coeff-1'] = -1 / capacity;
  }
  const result = nativeRun(altered);
  checkTrajectories(altered, result, 'Hétérogène', overrides);
  const reference = nativeRun(nine);
  for (const [index, { id }] of cells.entries()) {
    if (!Object.hasOwn(overrides, id)) {
      assert.deepEqual(result.observations[index], reference.observations[index], id);
    }
  }
});
