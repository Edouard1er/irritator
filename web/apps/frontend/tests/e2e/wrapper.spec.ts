import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runnerCapabilities } from '../../../../packages/contracts/index';
import { affine, pair } from '../wrapper-fixtures';

const evidence = path.resolve('../../../build-web-test7e/logs/browser');
const fixture = path.resolve('../../examples/wrapper-affine-v3.json');
async function start(page: Page) {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter simulation_wrapper', exact: true })).toBeEnabled();
}
async function wire(page: Page, source: string, output: number, target: string, input: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${source}|out:${output}`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${target}|in:${input}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
async function rename(page: Page, id: string) { const field = page.getByLabel('Identifiant du composant', { exact: true }); await field.fill(id); await field.press('Enter'); }
async function add(page: Page, type: string, params: Record<string, number> = {}) {
  await page.getByRole('button', { name: `Ajouter ${type}`, exact: true }).click();
  for (const [key, value] of Object.entries(params)) await page.getByLabel(key, { exact: true }).fill(String(value));
}
async function execute(page: Page, name: string) {
  const waiting = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const response = await waiting, result = await response.json();
  expect(response.ok(), JSON.stringify(result)).toBe(true); expect(result.schemaVersion).toBe(2); expect(result.status).toBe('completed');
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, `${name}.json`), JSON.stringify({ request: response.request().postDataJSON(), result }, null, 2));
  await expect(page.getByRole('tab', { name: 'Décisions natives', exact: true })).toHaveAttribute('aria-selected', 'true');
  return result;
}
async function affineEvents(page: Page, result: { resultEvents: { time: number; value: number[] }[]; wrappers: { scenarioCount: number }[] }) {
  expect(result.resultEvents.map(e => [e.time, e.value[0]])).toEqual([[1, 3], [1, 1], [1, 1]]); expect(result.wrappers[0]!.scenarioCount).toBe(3);
  await expect(page.getByTestId('wrapper-events').locator('tbody tr')).toHaveCount(3);
  await expect(page.getByTestId('wrapper-summary-decision')).toContainText('3 scénarios configurés');
}
test('importe graphiquement l’affine v3, inspecte ses ports et exécute le vrai moteur 7D', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await start(page);
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(fixture);
  await expect(page.getByTestId('node-decision')).toContainText('Integrale prospective');
  await page.getByTestId('node-decision').click();
  await expect(page.getByLabel('Définition prospective', { exact: true })).toHaveValue('Prospectif');
  await expect(page.getByTestId('factor-rate').getByLabel('Valeurs fixes')).toHaveValue('-1, 0, 1');
  await expect(page.getByTestId('selection-terminal').getByLabel('Critère', { exact: true })).toHaveValue('max-last');
  await expect(page.getByTestId('selection-minimum').getByLabel('Critère', { exact: true })).toHaveValue('min');
  for (let p = 0; p < 3; p++) { await expect(page.getByLabel(`decision entrée ${p}`, { exact: true })).toBeAttached(); await expect(page.getByLabel(`decision sortie ${p}`, { exact: true })).toBeAttached(); }
  await expect(page.getByLabel('run sortie 0 vers decision entrée 1', { exact: true })).toBeAttached();
  await expect(page.getByLabel('Fin prospective', { exact: true })).toHaveValue('2'); await expect(page.getByLabel('Fin', { exact: true })).toHaveValue('3');
  await mkdir(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, 'affine-inspector.png'), fullPage: true });
  await page.getByLabel('Inspecteur expérimental').getByRole('button', { name: 'Ouvrir le prospectif', exact: true }).click();
  await expect(page.getByTestId('node-X')).toBeAttached(); await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  await affineEvents(page, await execute(page, 'affine-imported'));
  await page.getByRole('tab', { name: 'Trajectoires', exact: true }).click(); await expect(page.locator('.js-plotly-plot .scatterlayer .trace')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Décisions natives', exact: true }).click();
  await page.screenshot({ path: path.join(evidence, 'affine-imported.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('construit le prospectif et son wrapper sans JSON puis exporte, réimporte et reproduit 3/1/1', async ({ page }) => {
  test.setTimeout(120000); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await start(page);
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('Prospectif'); await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  await add(page, 'constant', { value: 0 }); await rename(page, 'u');
  await add(page, 'qss3_integrator', { X: 1, dQ: .01 }); await rename(page, 'X'); await wire(page, 'u', 0, 'X', 0);
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  await add(page, 'simulation_wrapper'); await rename(page, 'decision'); await page.getByLabel('Définition prospective', { exact: true }).selectOption('Prospectif');
  await page.getByRole('button', { name: 'Ajouter un facteur', exact: true }).click();
  const factor = page.getByTestId('factor-factor1'); await factor.getByLabel('Id du facteur', { exact: true }).fill('u'); await factor.getByLabel('Id du facteur', { exact: true }).press('Enter');
  await page.getByTestId('factor-u').getByLabel('Type du facteur', { exact: true }).selectOption('fixed'); await page.getByTestId('factor-u').getByLabel('Valeurs fixes', { exact: true }).fill('-1,0,1');
  await page.getByRole('button', { name: 'Ajouter une sélection', exact: true }).click();
  await page.getByTestId('selection-selection1').getByLabel('Id de la sélection', { exact: true }).fill('terminal'); await page.getByTestId('selection-selection1').getByLabel('Id de la sélection', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Ajouter une sélection', exact: true }).click();
  await page.getByTestId('selection-selection1').getByLabel('Id de la sélection', { exact: true }).fill('minimum'); await page.getByTestId('selection-selection1').getByLabel('Id de la sélection', { exact: true }).press('Enter');
  await page.getByTestId('selection-minimum').getByLabel('Critère', { exact: true }).selectOption('min');
  await page.getByLabel('Sens de l’objectif', { exact: true }).selectOption('maximize'); await page.getByLabel('Sélection primaire', { exact: true }).selectOption('terminal');
  await expect(page.getByLabel('Mode d’exécution', { exact: true })).toHaveValue('complete'); await expect(page.getByLabel('Méthode', { exact: true })).toHaveValue('simple');
  await add(page, 'constant', { value: 0, offset: 1 }); await rename(page, 'run'); await wire(page, 'run', 0, 'decision', 1);
  const initial = await execute(page, 'affine-built'); await affineEvents(page, initial);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click(); const file = path.join(evidence, 'affine-built-export.json'); await (await downloading).saveAs(file);
  const exported = JSON.parse(await readFile(file, 'utf8')); expect(exported.schemaVersion).toBe(3); expect(exported.model.definitions[0].components.map((c: { id: string }) => c.id)).toEqual(['u', 'X']);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, 'affine-built-reimported'); expect(restored.resultEvents).toEqual(initial.resultEvents); expect(restored.wrappers).toEqual(initial.wrappers); expect(restored.observations).toEqual(initial.observations);
  const bytes = await readFile(path.resolve('../../../build-web-test7d/Release/runner/irritator-runner.exe'));
  const direct = JSON.parse(execFileSync(path.resolve('../../../build-web-test7d/Release/runner/irritator-runner.exe'), [], { input: JSON.stringify(exported), windowsHide: true, encoding: 'utf8' }));
  const { runId, ...native } = restored; expect(native).toEqual(direct);
  await writeFile(path.join(evidence, 'native-proof.json'), JSON.stringify({ runner: 'build-web-test7d/Release/runner/irritator-runner.exe', sha256: createHash('sha256').update(bytes).digest('hex'), capabilities: runnerCapabilities, manualJson: false, directEqualsHttp: true, events: restored.resultEvents }, null, 2));
  expect(errors).toEqual([]);
});

test('remappe les sélections connectées, bloque leur suppression et garde les références après renommage du prospectif', async ({ page }) => {
  await start(page); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(fixture); await page.getByTestId('node-decision').click();
  await page.getByRole('button', { name: 'Monter sélection minimum', exact: true }).click();
  await expect(page.getByLabel('decision sortie 1 vers terminal entrée 0', { exact: true })).toBeAttached(); await expect(page.getByLabel('decision sortie 0 vers minimum entrée 0', { exact: true })).toBeAttached();
  await page.getByRole('button', { name: 'Supprimer sélection minimum', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Ce port est connecté' })).toBeVisible();
  await expect(page.getByTestId('selection-minimum')).toBeVisible();
  const result = await execute(page, 'affine-reordered'); expect(result.resultEvents.map((e: { value: number[] }) => e.value[0])).toEqual([1, 3, 1]);
  await page.getByRole('button', { name: 'Ouvrir définition Prospectif', exact: true }).click(); await page.getByTestId('node-u').click(); await rename(page, 'flow');
  await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'est ciblé' })).toBeVisible();
  await expect(page.getByLabel('flow sortie 0 vers X entrée 0', { exact: true })).toBeAttached();
  // The same protection applies to keyboard deletion, including incident edges.
  await page.getByTestId('node-flow').click(); await page.keyboard.press('Delete'); await expect(page.getByTestId('node-flow')).toBeAttached(); await expect(page.getByLabel('flow sortie 0 vers X entrée 0', { exact: true })).toBeAttached();
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); await page.getByTestId('node-decision').click(); await expect(page.getByTestId('factor-rate').getByLabel('Cible du facteur')).toHaveValue('flow');
  expect((await execute(page, 'affine-renamed')).resultEvents).toEqual(result.resultEvents);
});

test('plusieurs occurrences couplées : édite un override et conserve les ports et plans au réimport', async ({ page }) => {
  await start(page); const document = pair(); document.model.definitions!.reverse();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles({ name: 'pair.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await add(page, 'simulation_wrapper'); await expect(page.getByLabel('Définition prospective', { exact: true })).toHaveValue('Prospectif'); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  await page.getByTestId('node-right').locator('.node-header').click(); await expect(page.getByLabel('Personnaliser decision')).toBeChecked(); await page.getByLabel('Valeurs fixes', { exact: true }).fill('-3, 3');
  const result = await execute(page, 'pair-overrides'); expect(result.resultEvents.map((e: { value: number[] }) => e.value[0])).toEqual([3, 1, 1, 7, 1, 3]); expect(result.wrappers.map((w: { scenarioCount: number }) => w.scenarioCount)).toEqual([3, 2]);
  await page.getByRole('button', { name: 'Ouvrir définition Cell', exact: true }).click(); await page.getByTestId('node-decision').click();
  const id = page.getByTestId('factor-rate').getByLabel('Id du facteur'); await id.fill('u'); await id.press('Enter');
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); await page.getByTestId('node-right').locator('.node-header').click(); await expect(page.getByLabel('Valeurs fixes', { exact: true })).toHaveValue('-3, 3');
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click(); const file = path.join(evidence, 'pair-export.json'); await (await downloading).saveAs(file);
  const request = JSON.parse(await readFile(file, 'utf8')); expect(request.model.components[2].experimentOverrides[0].factors).toEqual([{ id: 'u', type: 'fixed', values: [-3, 3] }]);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, 'pair-reimported'); expect(restored.resultEvents).toEqual(result.resultEvents); expect(restored.wrappers[0].outputs[2].id).toBe('u');
});

test('affiche les sacs natifs à dates répétées puis l’état vide en absence de run', async ({ page }) => {
  await start(page); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(fixture);
  await add(page, 'qss1_sum_2'); await rename(page, 'relay'); await wire(page, 'run', 0, 'relay', 0); await wire(page, 'relay', 0, 'decision', 1);
  const repeated = await execute(page, 'repeated-bags'); const events = repeated.resultEvents.filter((e: { time: number }) => e.time === 1); expect(events.length).toBeGreaterThanOrEqual(6); expect(new Set(events.map((e: { bag: number }) => e.bag)).size).toBeGreaterThanOrEqual(2);
  const rows = page.getByTestId('wrapper-events').locator('tbody tr'); await expect(rows).toHaveCount(repeated.resultEvents.length); expect(await rows.locator('td:nth-child(2)').allTextContents()).toEqual(repeated.resultEvents.map((e: { time: number }) => String(e.time)));
  const noRun = affine(); noRun.model.connections = noRun.model.connections.filter(c => c.to.component !== 'decision');
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles({ name: 'without-run.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(noRun)) });
  expect((await execute(page, 'without-run')).resultEvents).toEqual([]); await expect(page.getByText(/Aucune décision émise par le moteur/)).toBeVisible(); await expect(page.getByTestId('wrapper-events')).toHaveCount(0);
});

test('présente une erreur native réelle puis permet de corriger et relancer', async ({ page }) => {
  await start(page); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(fixture); await execute(page, 'before-native-error');
  await page.getByTestId('node-run').click(); await page.getByLabel('value', { exact: true }).fill('-1');
  const waiting = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST'); await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const response = await waiting; expect(response.status()).toBe(422); const body = await response.json(); expect(body.error.code).toBe('EXECUTION_ERROR');
  await expect(page.getByRole('alert').filter({ hasText: 'EXECUTION_ERROR' })).toContainText('moteur'); await expect(page.getByTestId('wrapper-events').locator('tbody tr')).toHaveCount(3);
  await page.getByLabel('value', { exact: true }).fill('0'); await affineEvents(page, await execute(page, 'after-native-error'));
});

test('ajoute un wrapper dans une définition couplée, garde v3 et rejette une référence récursive', async ({ page }) => {
  await start(page); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(fixture);
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('Cell'); await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  await add(page, 'simulation_wrapper'); await rename(page, 'child');
  await page.getByLabel('Définition prospective', { exact: true }).selectOption('Cell'); await expect(page.getByRole('alert').filter({ hasText: 'récursive' })).toBeVisible();
  await expect(page.getByLabel('Définition prospective', { exact: true })).toHaveValue('Prospectif');
  await page.getByRole('button', { name: 'Ajouter un facteur', exact: true }).click(); await page.getByTestId('factor-factor1').getByLabel('Type du facteur').selectOption('fixed'); await page.getByTestId('factor-factor1').getByLabel('Valeurs fixes').fill('-1,0,1');
  await page.getByRole('button', { name: 'Ajouter une sélection', exact: true }).click(); await page.getByRole('button', { name: 'Ajouter une sélection', exact: true }).click();
  await page.getByTestId('selection-selection2').getByLabel('Critère', { exact: true }).selectOption('min');
  await page.getByRole('button', { name: 'Ajouter une entrée', exact: true }).click(); await wire(page, '$input', 0, 'child', 1);
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); await page.getByRole('button', { name: 'Insérer Cell', exact: true }).click(); await wire(page, 'run', 0, 'Cell', 0);
  const result = await execute(page, 'coupled-created'); expect(result.wrappers.map((w: { component: string }) => w.component)).toEqual(['decision', 'Cell/child']); expect(result.resultEvents.map((e: { value: number[] }) => e.value[0])).toEqual([3, 1, 1, 3, 1, 1]);
  await page.getByRole('button', { name: 'Ouvrir définition Cell', exact: true }).click(); await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('irritator.workspace.v2') ?? '{}').activeScope)).toBe('Cell');
  await page.reload(); await expect(page.getByTestId('node-child')).toBeAttached(); await expect(page.getByLabel('$input sortie 0 vers child entrée 1', { exact: true })).toBeAttached();
});
