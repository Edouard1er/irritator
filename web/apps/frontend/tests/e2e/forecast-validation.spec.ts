import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const evidence = path.resolve(process.env.IRRITATOR_8M_BROWSER_EVIDENCE ?? '../../../build-web-test8m/browser');
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
async function execute(page: Page, name: string) {
  const pending = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click(); const response = await pending;
  const result = await response.json(), request = response.request().postDataJSON();
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, name + '.json'), JSON.stringify({ request, result }, null, 2));
  expect(response.status(), JSON.stringify(result)).toBe(200);
  const p = spawnSync(process.env.IRRITATOR_RUNNER!, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000 });
  expect(p.status).toBe(0); const { runId, requestId, ...actual } = result; expect(actual).toEqual(JSON.parse(p.stdout)); return actual;
}
const values = (r: any, id: string) => r.modelEvents.filter((e: any) => e.component === id && e.port === 0 && e.value[2] === 2).map((e: any) => e.value[0]);
test.beforeEach(async ({ page }) => { page.on('dialog', d => d.accept()); await page.goto('/'); await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible(); });

test('8M constructs a native error calculation in React Flow, edits M2, then exports and imports it', async ({ page }) => {
  test.setTimeout(150000);
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/decision-forecast-validation-minimal-v3.json'));
  const first = await execute(page, 'linear-operational'); expect(values(first, 'M2XAE')[0]).toBeCloseTo(1 - Math.exp(-.5), 2);
  await page.getByRole('tab', { name: 'Évaluations natives', exact: true }).click(); await expect(page.getByRole('columnheader', { name: 'Campagne', exact: true })).toBeVisible();
  await select(page, 'M2Xerror'); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter event_operator', exact: true }).click();
  const id = page.getByLabel('Identifiant du composant', { exact: true }); await id.fill('M2Xerror'); await id.press('Enter');
  await page.getByLabel('operation', { exact: true }).selectOption('2');
  const required = page.getByLabel('required', { exact: true }); await required.fill('3'); await required.blur();
  await wire(page, 'M2Xpair', 1, 'M2Xerror', 0); await wire(page, 'M2Xpair', 0, 'M2Xerror', 1);
  await wire(page, 'M2Xerror', 0, 'M2XAE', 0); await wire(page, 'M2Xerror', 0, 'M2XSE', 0);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir définition DampedProspect', exact: true }).click(); await select(page, 'lambda');
  const lambda = page.getByLabel('value', { exact: true }); await lambda.fill('1'); await lambda.blur();
  const changed = await execute(page, 'linear-rebuilt-lambda-one'); expect(values(changed, 'M2XAE')[0]).toBeCloseTo(1 - Math.exp(-1), 2);
  await lambda.fill('.9'); await lambda.blur();
  await page.getByRole('tab', { name: 'Évaluations natives', exact: true }).click();
  const evaluationDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exporter les évaluations', exact: true }).click();
  const evaluationFile = path.join(evidence, 'native-evaluation-export.json'); await (await evaluationDownload).saveAs(evaluationFile);
  const archived = JSON.parse(await readFile(evaluationFile, 'utf8'));
  expect(archived.result.modelEvents).toEqual(changed.modelEvents);
  expect(archived.request.model.definitions.find((d: any) => d.id === 'DampedProspect').components.find((c: any) => c.id === 'lambda').parameters.value).toBe(1);
  await lambda.fill('1'); await lambda.blur();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, 'linear-export.json'); await (await download).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, 'linear-restored'); expect(restored.modelEvents).toEqual(changed.modelEvents);
  await page.getByRole('tab', { name: 'Évaluations natives', exact: true }).click(); await page.screenshot({ path: path.join(evidence, 'native-evaluations.png'), fullPage: true });
});
test('8M diagnostic graph exposes two models and editable validity and aggregation contracts', async ({ page }) => {
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/decision-forecast-comparison-v3.json'));
  const result = await execute(page, 'linear-diagnostic'); expect(values(result, 'M1XAE')[0]).toBeCloseTo(0, 3); expect(values(result, 'M2XAE')[0]).toBeGreaterThan(.39);
  await select(page, 'M2Xpair'); await expect(page.getByLabel('requireContext', { exact: true })).toHaveValue('1'); await expect(page.getByLabel('requireDuration', { exact: true })).toHaveValue('1');
  await select(page, 'M2XMAE'); await expect(page.getByLabel('streaming', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Ajouter event_calendar', exact: true })).toBeVisible();
});
test('8M Schaefer compares biomass and capture separately and exposes native provenance', async ({ page }) => {
  test.setTimeout(120000);
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/tstar-schaefer-forecast-validation-v3.json'));
  const r = await execute(page, 'schaefer-diagnostic'); expect(values(r, 'M1NAE')[0]).toBeLessThan(.06); expect(values(r, 'M2NAE')[0]).toBeGreaterThan(11);
  expect(values(r, 'M1CAE')[0]).toBeLessThan(.10); expect(values(r, 'M2CAE')[0]).toBeGreaterThan(.3);
  await expect(page.getByTestId('wrapper-summary-verificationM1')).toBeVisible(); await expect(page.getByTestId('wrapper-summary-verificationM2')).toBeVisible();
  await page.getByRole('tab', { name: 'Évaluations natives', exact: true }).click(); await page.screenshot({ path: path.join(evidence, 'schaefer-evaluations.png'), fullPage: true });
});
