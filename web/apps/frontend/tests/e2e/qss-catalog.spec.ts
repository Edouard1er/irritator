import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const evidence = path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, 'qss') : '../../../build-web-test6-1/logs/browser-qss3');
async function start(page: Page) {
  page.on('dialog', d => d.accept()); await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ajouter / }).filter({ hasNotText: 'Simulation imbriquée' })).toHaveCount(25);
}
async function add(page: Page, type: string, parameters: Record<string, number> = {}) {
  await page.getByRole('button', { name: `Ajouter ${type}`, exact: true }).click();
  for (const [key, value] of Object.entries(parameters)) await page.getByLabel(key, { exact: true }).fill(String(value));
}
async function wire(page: Page, source: string, target: string, input: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${source}|out:0`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${target}|in:${input}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
async function run(page: Page, name: string) {
  const waiting = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const response = await waiting, result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true);
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, `${name}.json`), JSON.stringify({ request: response.request().postDataJSON(), result }, null, 2));
  return result;
}
async function roundTrip(page: Page, name: string) {
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, `${name}-export.json`); await (await downloading).saveAs(file);
  const request = JSON.parse(await readFile(file, 'utf8'));
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  return request;
}
const cases: [string, string, Record<string, number>, number, boolean][] = [
  ['qss3_multiplier', 'product', {}, 12, true],
  ['qss3_wsum_2', 'sum', { 'coeff-0': 2, 'coeff-1': -.5 }, 6.5, true],
  ['qss3_power', 'power', { n: 3 }, 64, false],
  ['qss3_inverse', 'inverse', {}, .25, false],
  ['qss3_square', 'square', {}, 16, false],
  ['qss3_sqrt', 'sqrt', {}, 2, false],
];
for (const [type, id, parameters, expected, binary] of cases) test(`React Flow ${type}: creation, ports, native calculation and export/import`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await start(page);
  await add(page, 'constant', { value: 4 }); if (binary) await add(page, 'constant', { value: 3 });
  await add(page, type);
  for (const [key, value] of Object.entries(parameters)) {
    await expect(page.getByLabel(key, { exact: true })).toHaveValue('1');
    await page.getByLabel(key, { exact: true }).fill(String(value));
  }
  await expect(page.getByLabel(`${id} entrée 0`, { exact: true })).toBeAttached();
  await expect(page.getByLabel(`${id} sortie 0`, { exact: true })).toBeAttached();
  await page.getByLabel('Observer ce composant', { exact: true }).check();
  await wire(page, 'c1', id, 0); if (binary) await wire(page, 'c2', id, 1);
  const result = await run(page, `${type}-built`); expect(result.observations[0].samples).toEqual([{ time: 0, value: expected }]);
  const request = await roundTrip(page, type);
  expect(request.model.components.find((c: { type: string }) => c.type === type).parameters).toEqual(parameters);
  expect((await run(page, `${type}-reimported`)).observations).toEqual(result.observations);
  expect(errors).toEqual([]);
});
test('six QSS3 operators in reused nested definitions: inspector edits and v2 round trip', async ({ page }) => {
  await start(page); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/qss3-operators-coupled.json'));
  await page.getByRole('button', { name: 'Ouvrir définition Operators', exact: true }).click();
  for (const id of ['product', 'weighted', 'power', 'inverse', 'square', 'sqrt']) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
  await page.getByTestId('node-weighted').click();
  await expect(page.getByLabel('coeff-0', { exact: true })).toHaveValue('2');
  await page.getByLabel('coeff-0', { exact: true }).fill('4'); await page.getByLabel('coeff-1', { exact: true }).fill('-.25');
  await page.getByTestId('node-power').click(); await page.getByLabel('n', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  const result = await run(page, 'qss3-nested-edited');
  expect(result.observations.map((o: { samples: { value: number }[] }) => o.samples[0]!.value)).toEqual([12, 15.25, 16, .25, 16, 2, 18, 35.5, 81, 1 / 9, 81, 3]);
  const request = await roundTrip(page, 'qss3-nested'); expect(request.schemaVersion).toBe(2);
  expect((await run(page, 'qss3-nested-reimported')).observations).toEqual(result.observations);
});
