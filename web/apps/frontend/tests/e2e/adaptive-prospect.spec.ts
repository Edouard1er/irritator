import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const evidence = path.resolve(process.env.IRRITATOR_8N_BROWSER_EVIDENCE ?? '../../../build-web-test8n/browser');
async function select(page: Page, id: string) {
  const ports = page.locator('details.external-ports[open] > summary'); if (await ports.isVisible()) await ports.click();
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click();
  const node = page.getByTestId('rf__node-' + id); await node.focus(); await node.press('Enter');
  await expect(page.getByLabel('Identifiant du composant', { exact: true })).toHaveValue(id);
}
async function wire(page: Page, from: string, output: number, to: string, input: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${from}|out:${output}`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${to}|in:${input}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
async function number(page: Page, name: string, value: number) {
  const field = page.getByLabel(name, { exact: true }); await field.fill(String(value)); await field.blur();
}
async function execute(page: Page, name: string) {
  const pending = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click(); const response = await pending;
  const result = await response.json(), request = response.request().postDataJSON();
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, name + '.json'), JSON.stringify({ request, result }, null, 2));
  expect(response.status(), JSON.stringify(result)).toBe(200);
  const p = spawnSync(process.env.IRRITATOR_RUNNER!, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  expect(p.status).toBe(0); const { runId, requestId, ...actual } = result; expect(actual).toEqual(JSON.parse(p.stdout)); return actual;
}
const chosen = (r: any) => r.modelEvents.filter((e: any) => e.component === 'observer/selector/selected' && e.port === 0).map((e: any) => e.value[0]);
test.beforeEach(async ({ page }) => { page.on('dialog', d => d.accept()); await page.goto('/'); await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible(); });

test('8N builds native admission in React Flow, changes nMin and roundtrips the adaptive graph', async ({ page }) => {
  test.setTimeout(180000);
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/decision-adaptive-prospect-selection-v3.json'));
  expect(chosen(await execute(page, 'linear'))).toEqual([2, 1]);
  await page.getByRole('button', { name: 'Ouvrir définition SelectProspective', exact: true }).click();
  for (const id of ['M1admissible', 'M2admissible']) { await select(page, id); await number(page, 'right', 2); }
  expect(chosen(await execute(page, 'minimum-two'))).toEqual([2, 2]);
  await select(page, 'M2admissible'); await number(page, 'right', 1);
  await select(page, 'M1admissible'); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter event_operator', exact: true }).click();
  const id = page.getByLabel('Identifiant du composant', { exact: true }); await id.fill('M1admissible'); await id.press('Enter');
  await page.getByLabel('operation', { exact: true }).selectOption('10'); await number(page, 'right', 1);
  await wire(page, 'M1countRead', 0, 'M1admissible', 0); await wire(page, 'M1admissible', 0, 'candidates', 2); await wire(page, '$input', 2, 'M1admissible', 4);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click();
  const rebuilt = await execute(page, 'rebuilt-admission'); expect(chosen(rebuilt)).toEqual([2, 1]);
  await select(page, 'chooseModel'); await page.getByLabel('direction', { exact: true }).selectOption('0');
  expect(chosen(await execute(page, 'maximize-error-policy'))).toEqual([2, 2]);
  await page.getByLabel('direction', { exact: true }).selectOption('1');
  const first = await execute(page, 'minimum-error-policy');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, 'adaptive-export.json'); await (await download).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, 'adaptive-restored'); expect(restored.modelEvents).toEqual(first.modelEvents);
  await page.getByRole('tab', { name: 'Évaluations natives', exact: true }).click(); await page.screenshot({ path: path.join(evidence, 'adaptive-evaluations.png'), fullPage: true });
});
test('8N graphical baseline and alternative plant expose opposite causal experiments', async ({ page }) => {
  for (const file of ['decision-adaptive-prospect-baseline', 'decision-adaptive-prospect-alternative-plant']) {
    await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/' + file + '-v3.json'));
    expect(chosen(await execute(page, file))).toEqual([2, 2]);
  }
});
test('8N Schaefer executes the selected prospective at t=5 using the t=4 biomass evidence', async ({ page }) => {
  test.setTimeout(120000);
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/tstar-schaefer-adaptive-prospect-v3.json'));
  const r = await execute(page, 'schaefer'); expect(chosen(r)).toEqual([2, 2, 1]);
  expect(r.modelEvents.find((e: any) => e.component === 'M1NMAE' && e.port === 0).time).toBe(4);
  expect(r.modelEvents.filter((e: any) => e.component === 'plant/effort' && e.port === 0).at(-1).value[0]).toBe(150);
  await page.getByRole('tab', { name: 'Évaluations natives', exact: true }).click(); await page.screenshot({ path: path.join(evidence, 'schaefer-adaptive.png'), fullPage: true });
});
