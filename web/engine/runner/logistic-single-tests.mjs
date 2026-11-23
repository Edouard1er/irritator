// Essai natif du lot 1. Lancé explicitement par Codex sur Windows.
// Aucune simulation JS: l'oracle analytique ne sert qu'à vérifier Irritator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const exampleFile = fileURLToPath(new URL('../../examples/logistic-single-v1.json', import.meta.url));
const runner = process.env.IRRITATOR_RUNNER;
const example = () => JSON.parse(readFileSync(exampleFile, 'utf8'));
const get = (m, id) => m.model.components.find(c => c.id === id);
const N0 = m => get(m, 'N').parameters.X;
const r = m => get(m, 'r').parameters.value;
const K = m => -1 / get(m, 'sum').parameters['coeff-1'];
// Critère de faisabilité provisoire pour dQ=0.01 t.
const atol = 0.15;
const rtol = 0.002;

function exact(initial, growth, cap, time) {
  if (initial === 0) return 0;
  return cap / (1 + (cap / initial - 1) * Math.exp(-growth * time));
}
function run(m) {
  assert.ok(runner, 'Définir IRRITATOR_RUNNER avec le chemin absolu du runner C++ déjà compilé.');
  const p = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(p.error);
  assert.equal(p.signal, null, `Runner interrompu : ${p.stderr}`);
  assert.equal(p.status, 0, `Exécution Irritator échouée : ${p.stderr}\n${p.stdout}`);
  const result = JSON.parse(p.stdout);
  assert.equal(result.status, 'completed');
  assert.equal(result.modelId, m.model.id);
  assert.equal(result.simulation.start, m.simulation.start);
  assert.equal(result.simulation.finalTime, m.simulation.end);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].component, 'N');
  assert.equal(result.observations[0].samplingInterval, m.model.observations[0].samplingInterval);
  assert.ok(result.observations[0].samples.length > 0, 'Aucune observation retournée.');
  return result.observations[0].samples;
}

function measureError(m, samples, label, enforceTolerance) {
  const { start, end } = m.simulation;
  const initial = N0(m);
  const growth = r(m);
  const capacity = K(m);
  assert.deepEqual(samples[0], { time: start, value: initial });
  let worst = { error: 0, time: start };
  let aboveTolerance = 0;
  let previous = -Infinity;
  for (const { time, value } of samples) {
    assert.ok(Number.isFinite(time) && Number.isFinite(value), `${label}: valeur non finie`);
    assert.ok(time >= start && time <= end, `${label}: temps hors horizon`);
    assert.ok(time > previous, `${label}: horodatage non croissant`);
    assert.ok(value >= 0, `${label}: biomasse négative`);
    previous = time;
    const target = exact(initial, growth, capacity, time - start);
    const error = Math.abs(value - target);
    if (error > worst.error) worst = { error, time };
    if (error > atol + rtol * Math.abs(target)) aboveTolerance++;
  }
  console.log(`${label} : ${samples.length} observations, erreur absolue max ${worst.error.toPrecision(10)} t à t=${worst.time.toPrecision(6)}, ${aboveTolerance} au-delà du seuil provisoire`);
  if (enforceTolerance) assert.equal(aboveTolerance, 0, `${label}: écart maximal à l’oracle ${worst.error} t à t=${worst.time}`);
}

function checkMovement(m, samples) {
  const initial = N0(m);
  const capacity = K(m);
  const last = samples.at(-1);
  const direction = Math.sign(capacity - initial);
  assert.equal(last.time, m.simulation.end);
  assert.ok(direction * (last.value - initial) > 0, 'La biomasse doit se rapprocher de K.');
  for (let i = 1; i < samples.length; i++) {
    const value = samples[i].value;
    assert.ok(direction * (value - samples[i - 1].value) >= 0, `Variation opposée à la tendance attendue à t=${samples[i].time}.`);
    assert.ok(direction * (capacity - value) >= 0, `Franchissement de K à t=${samples[i].time}.`);
  }
}

test('P1-01: une cellule logistique est exécutée par libirritator/QSS3', () => {
  const m = example();
  assert.equal(m.model.components.length, 7);
  assert.equal(m.model.connections.length, 9);
  assert.deepEqual(m.model.components.map(c => c.type).sort(), [
    'constant', 'constant', 'qss3_integrator',
    'qss3_multiplier', 'qss3_multiplier', 'qss3_multiplier', 'qss3_wsum_2',
  ]);
  assert.equal(N0(m), 150);
  assert.equal(K(m), 300);
  assert.equal(r(m), 0.35);
  assert.equal(get(m, 'N').parameters.dQ, 0.01);
  assert.deepEqual(m.simulation, { start: 0, end: 20 });
  assert.deepEqual(m.model.observations, [{ component: 'N', samplingInterval: 0.1 }]);
  const samples = run(m);
  measureError(m, samples, 'référence N0=150 t', true);
  checkMovement(m, samples);
});

for (const [name, initial] of [['vide', 0], ['sous la capacité', 60], ['à la capacité', 300], ['au-dessus de la capacité', 380]]) {
  test(`P1-02: condition initiale ${name} (N0=${initial})`, () => {
    const m = example();
    m.model.id = `logistic-${initial}`;
    get(m, 'N').parameters.X = initial;
    const samples = run(m);
    measureError(m, samples, name, true);
    if (initial === 0 || initial === K(m)) {
      // Le runner déduplique les valeurs identiques, y compris au scellement final.
      assert.ok(samples.every(s => Math.abs(s.value - initial) <= 1e-6), 'La biomasse doit rester à l’équilibre.');
    } else {
      checkMovement(m, samples);
    }
  });
}

test('P1-03: répéter la même configuration reproduit les observations natives', () => {
  const m = example();
  assert.deepEqual(run(m), run(m));
});

test('P1-04: étude exploratoire du quantum QSS3 (pas un temps discret)', () => {
  for (const quantum of [0.1, 0.01, 0.001]) {
    const m = example();
    get(m, 'N').parameters.dQ = quantum;
    const samples = run(m);
    assert.equal(samples.at(-1).time, m.simulation.end);
    // Les dépassements sont consignés pour l'étude du quantum.
    measureError(m, samples, `dQ=${quantum} t`, false);
  }
});
