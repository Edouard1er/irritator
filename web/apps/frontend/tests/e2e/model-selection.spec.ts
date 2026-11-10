import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const evidence = path.resolve(process.env.IRRITATOR_8L_BROWSER_EVIDENCE ?? '../../../build-web-test8l/browser');
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
  expect(p.status).toBe(0); const { runId, ...actual } = result; expect(actual).toEqual(JSON.parse(p.stdout)); return actual;
}
async function roundtrip(page: Page, name: string, first: any) {
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, name + '-export.json'); await (await download).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const second = await execute(page, name + '-restored'); expect(second.resultEvents).toEqual(first.resultEvents); expect(second.observations).toEqual(first.observations);
}
const count = (r: any, model: string) => r.resultEvents.filter((e: any) => e.component === 'forecast/' + model && r.wrappers.find((w: any) => w.component === e.component).outputs[e.port].kind === 'scenario-run-calls').length;
test.beforeEach(async ({ page }) => { page.on('dialog', d => d.accept()); await page.goto('/'); await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible(); });

test('8L constructs a coupled graphical model condition, reconnects both routes, runs and roundtrips', async ({ page }) => {
  test.setTimeout(150000); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/decision-select-prospect-model-v3.json'));
  const baseline = await execute(page, 'minimal'); expect(count(baseline, 'M1')).toBe(3); expect(count(baseline, 'M2')).toBe(2);
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('UiModelCondition'); await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  for (const [label, direction, names] of [['entrée', 'inputs', ['observation', 'reset']], ['sortie', 'outputs', ['condition']]] as const)
    for (const [i, name] of names.entries()) { await page.getByRole('button', { name: 'Ajouter une ' + label, exact: true }).click(); const f = page.getByLabel(`Nom ${direction} ${i}`, { exact: true }); await f.fill(name); await f.blur(); }
  await page.getByRole('button', { name: 'Ajouter event_operator', exact: true }).click();
  const id = page.getByLabel('Identifiant du composant', { exact: true }); await id.fill('compare'); await id.press('Enter');
  await page.getByLabel('operation', { exact: true }).selectOption('8'); const value = page.getByLabel('right', { exact: true }); await value.fill('2'); await value.blur();
  await wire(page, '$input', 0, 'compare', 0); await wire(page, '$input', 1, 'compare', 4); await wire(page, 'compare', 0, '$output', 0);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir définition SelectProspective', exact: true }).click(); await select(page, 'less'); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  await page.getByRole('button', { name: 'Insérer UiModelCondition', exact: true }).click(); const replacement = page.getByLabel('Identifiant du composant', { exact: true }); await replacement.fill('less'); await replacement.press('Enter');
  await wire(page, 'once', 0, 'less', 0); await wire(page, '$input', 2, 'less', 1);
  for (const [to, port] of [['otherwise', 0], ['route10', 2], ['route11', 2]] as const) await wire(page, 'less', 0, to, port);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click();
  const changed = await execute(page, 'ui-condition-2'); expect(count(changed, 'M1')).toBe(6); expect(count(changed, 'M2')).toBe(0);
  await page.getByRole('button', { name: 'Ouvrir définition UiModelCondition', exact: true }).click(); await select(page, 'compare');
  const threshold = page.getByLabel('right', { exact: true }); await threshold.fill('0'); await threshold.blur();
  const restored = await execute(page, 'ui-condition-0'); expect(count(restored, 'M1')).toBe(3); expect(count(restored, 'M2')).toBe(2);
  await page.screenshot({ path: path.join(evidence, 'graphical-model-condition.png'), fullPage: true }); await roundtrip(page, 'ui-condition', restored);
});

test('8L Schaefer exposes actual wrapper provenance and edits M2 QSS mortality in React Flow', async ({ page }) => {
  test.setTimeout(120000); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/tstar-schaefer-select-prospect-v3.json'));
  const first = await execute(page, 'schaefer'); expect(count(first, 'M1')).toBe(6); expect(count(first, 'M2')).toBe(4);
  await expect(page.getByTestId('wrapper-summary-forecast/M1')).toBeVisible(); await expect(page.getByTestId('wrapper-summary-forecast/M2')).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir définition SchaeferMortality', exact: true }).click(); await select(page, 'mortality');
  const mortality = page.getByLabel('value', { exact: true }); await mortality.fill('0.04'); await mortality.blur();
  const second = await execute(page, 'mortality-edited');
  const criteria = (r: any) => r.resultEvents.filter((e: any) => e.component === 'forecast/M2' && e.port === 12).map((e: any) => e.value);
  expect(criteria(second)).not.toEqual(criteria(first));
  await page.screenshot({ path: path.join(evidence, 'selected-prospective-results.png'), fullPage: true }); await roundtrip(page, 'schaefer', second);
});

test('8L coupled interface editor accepts ports above 15 within the existing 32-port contract', async ({ page }) => {
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/tstar-schaefer-select-prospect-v3.json'));
  await page.getByRole('button', { name: 'Ouvrir définition ObserverDecision', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une sortie', exact: true }).click(); await expect(page.getByLabel('Nom outputs 23', { exact: true })).toBeVisible();
  await page.getByLabel('Supprimer outputs 23 et ses connexions', { exact: true }).click();
  await page.getByRole('button', { name: 'Valider le modèle', exact: true }).click(); await expect(page.getByText('Validation structurelle réussie.', { exact: true })).toBeVisible();
});
