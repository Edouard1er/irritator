import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guiersLogisticDefaults, runGuiersLogistic } from '../../dist/examples/guiers-logistic.js';
import { runGuiersNative } from './guiers-logistic.mjs';

const run = request => {
  assert.ok(process.env.IRRITATOR_RUNNER, 'IRRITATOR_RUNNER est requis');
  return runGuiersNative(process.env.IRRITATOR_RUNNER, request);
};

// Two different water areas and a graph edge; the autonomous model ignores the edge.
const grid = {
  resolutionM: 1000,
  cells: [
    { id: 'utm28n:h1000:x400:y1790', waterAreaM2: 500000, neighbors: ['utm28n:h1000:x401:y1790'] },
    { id: 'utm28n:h1000:x401:y1790', waterAreaM2: 1000000, neighbors: ['utm28n:h1000:x400:y1790'] },
  ],
};

for (const density of [0, guiersLogisticDefaults.capacityKgM2]) {
  test(`Équilibre QSS3 à ${density} kg/m²`, async () => {
    const result = await runGuiersLogistic(grid, 'synthetic', { ...guiersLogisticDefaults, initialKgM2: density }, run);
    result.cells.forEach((cell, i) => {
      assert.equal(cell.id, grid.cells[i].id);
      for (const sample of cell.samples) assert.equal(sample.value, grid.cells[i].waterAreaM2 * density);
    });
  });
}

test('Croissance QSS3 autonome, indépendance des cellules, même densité que le modèle agrégé', async () => {
  const p = guiersLogisticDefaults;
  const result = await runGuiersLogistic(grid, 'synthetic', p, run);
  const isolated = await runGuiersLogistic({ ...grid, cells: grid.cells.slice(0, 1) }, 'isolated', p, run);
  const aggregate = await runGuiersLogistic({ ...grid, cells: [{ ...grid.cells[0], waterAreaM2: 1500000 }] }, 'aggregate', p, run);
  assert.deepEqual(result.cells[0].samples, isolated.cells[0].samples);
  const end = result.cells.map(c => c.samples.at(-1));
  const total = end.reduce((sum, sample) => sum + sample.value, 0);
  const expected = 1500000 * p.capacityKgM2 / (1 + (p.capacityKgM2 / p.initialKgM2 - 1) * Math.exp(-p.growthPerDay * p.days));
  assert.ok(end.every(s => s.time === p.days));
  assert.ok(Math.abs(total - expected) < 0.02, `${total} vs ${expected}`);
  assert.ok(Math.abs(total - aggregate.cells[0].samples.at(-1).value) < 0.02);
});
