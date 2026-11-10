import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const evidence = path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '8a') : '../../../build-web-test8a/browser');
const runner = path.resolve(process.env.IRRITATOR_RUNNER ?? '../../../build-web-test8a/runner/irritator-runner.exe');
async function start(page: Page, file?: string) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  if (file) await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/' + file));
}
test.beforeEach(async ({ page }) => { page.on('dialog', d => d.accept()); });
async function add(page: Page, type: string, parameters: Record<string, number> = {}) {
  await page.getByRole('button', { name: `Ajouter ${type}`, exact: true }).click();
  for (const [key, value] of Object.entries(parameters)) {
    const field = page.getByLabel(key, { exact: true });
    if (await field.evaluate(e => e.tagName === 'SELECT')) await field.selectOption(String(value)); else await field.fill(String(value));
  }
}
async function rename(page: Page, name: string) { const field = page.getByLabel('Identifiant du composant', { exact: true }); await field.fill(name); await field.press('Enter'); }
async function wire(page: Page, from: string, fp: number, to: string, tp: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${from}|out:${fp}`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${to}|in:${tp}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
async function definition(page: Page, id: string, inputs: number) {
  await page.getByLabel('Identifiant de définition', { exact: true }).fill(id);
  await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  for (let i = 0; i < inputs; ++i) await page.getByRole('button', { name: 'Ajouter une entrée', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une sortie', exact: true }).click();
}
async function execute(page: Page, name: string) {
  const wait = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const response = await wait, result = await response.json(), request = response.request().postDataJSON();
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  const { runId, ...actual } = result;
  const native = JSON.parse(execFileSync(runner, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true }));
  expect(actual).toEqual(native);
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, name + '.json'), JSON.stringify({ request, result, directEqualsHttp: true }, null, 2));
  return result;
}
const last = (r: any, id: string) => r.observations.find((o: any) => o.component === id).samples.at(-1).value;
test('A construit une mémoire couplée à la demande et la connecte à un autre modèle', async ({ page }) => {
  await start(page); await definition(page, 'ObservationLibre', 2);
  await add(page, 'value_memory');
  await wire(page, '$input', 0, 'value_memory', 0); await wire(page, '$input', 1, 'value_memory', 1); await wire(page, 'value_memory', 0, '$output', 0);
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  await page.getByRole('button', { name: 'Insérer ObservationLibre', exact: true }).click(); await rename(page, 'observer');
  await add(page, 'constant', { value: 42 }); await add(page, 'constant', { offset: 1 }); await add(page, 'qss1_sum_2');
  await page.getByLabel('Observer ce composant', { exact: true }).check(); await page.getByLabel('Pas d’observation', { exact: true }).fill('0.1');
  await wire(page, 'c1', 0, 'observer', 0); await wire(page, 'c2', 0, 'observer', 1); await wire(page, 'observer', 0, 'sum', 0);
  const r = await execute(page, 'memory-manual'); expect(last(r, 'sum')).toBe(42);
});
test('B configure supérieur inférieur égal dans l’inspecteur', async ({ page }) => {
  await start(page, 'decision-comparison.json'); await page.getByTestId('node-greater').click();
  for (const [operation, expected] of [[7, 1], [8, 0], [9, 0]]) {
    await page.getByLabel('operation', { exact: true }).selectOption(String(operation));
    expect(last(await execute(page, 'comparison-' + operation), 'greater')).toBe(expected);
  }
});
test('C D F explore sélection, contrainte, repli et réutilisation', async ({ page }) => {
  for (const [name, expected] of [['selection', 100], ['constraint', 100], ['fallback', -7], ['reuse', 100]] as const) {
    await start(page, `decision-${name}.json`); const r = await execute(page, name);
    expect(last(r, 'received0')).toBe(expected); if (name === 'reuse') expect(last(r, 'received1')).toBe(200);
  }
});
test('E construit une décision externe par composition, active le flux, exporte et réimporte', async ({ page }) => {
  test.setTimeout(120000);
  await start(page, 'wrapper-affine-v3.json'); await page.getByTestId('node-decision').click();
  await page.getByLabel('Transmettre tous les scénarios au modèle parent', { exact: true }).check();
  await definition(page, 'DecisionLibre', 3);
  await add(page, 'event_operator', { operation: 3, right: -1 });
  await add(page, 'candidate_filter', { required: 3 }); await add(page, 'candidate_select', { fallback: -7 });
  await wire(page, '$input', 0, 'event_operator', 0); await wire(page, '$input', 2, 'event_operator', 3);
  await wire(page, '$input', 1, 'candidate_filter', 1); await wire(page, 'event_operator', 0, 'candidate_filter', 0); await wire(page, 'event_operator', 2, 'candidate_filter', 3);
  await wire(page, 'candidate_filter', 0, 'candidate_select', 0); await wire(page, 'candidate_filter', 1, 'candidate_select', 1); await wire(page, 'candidate_filter', 2, 'candidate_select', 2); await wire(page, 'candidate_select', 0, '$output', 0);
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click();
  await mkdir(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, 'decision-definition.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  await page.getByRole('button', { name: 'Insérer DecisionLibre', exact: true }).click(); await rename(page, 'external');
  await add(page, 'qss1_sum_2'); await page.getByLabel('Observer ce composant', { exact: true }).check();
  await wire(page, 'decision', 5, 'external', 0); await wire(page, 'decision', 4, 'external', 1); await wire(page, 'decision', 7, 'external', 2); await wire(page, 'external', 0, 'sum', 0);
  const r = await execute(page, 'prospective-manual'); expect(last(r, 'rate')).toBe(1); expect(last(r, 'sum')).toBe(-1);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const exported = path.join(evidence, 'decision-export.json'); await (await downloading).saveAs(exported);
  expect(JSON.parse(await readFile(exported, 'utf8')).model.definitions.find((d: any) => d.id === 'DecisionLibre').components).toHaveLength(3);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(exported);
  expect((await execute(page, 'prospective-restored')).observations).toEqual(r.observations);
});
