import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import example from '../../../../examples/tstar-schaefer-three-coupled-v3.json' with { type: 'json' };
const evidence = path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '8f') : '../../../build-web-test8f/browser');
const runner = path.resolve(process.env.IRRITATOR_RUNNER!);
const last = (r: any, id: string) => r.observations.find((o: any) => o.component === id).samples.at(-1).value;
test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept()); await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/tstar-schaefer-three-coupled-v3.json'));
});
async function execute(page: Page, name: string) {
  const wait = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const res = await wait, result = await res.json(), request = res.request().postDataJSON();
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, name + '.json'), JSON.stringify({ request, result, status: res.status() }, null, 2));
  expect(res.ok(), JSON.stringify(result)).toBe(true);
  const { runId, ...actual } = result; expect(runId).toBeTruthy();
  expect(actual).toEqual(JSON.parse(execFileSync(runner, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000 })));
  return result;
}
async function roundtrip(page: Page, name: string, r: any) {
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, name + '-export.json'); await (await wait).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, name + '-restored'); expect(restored.observations).toEqual(r.observations); expect(restored.resultEvents).toEqual(r.resultEvents);
}
async function wire(page: Page, e: any) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${e.from.component}|out:${e.from.port}`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${e.to.component}|in:${e.to.port}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
test('8F importe T*, deux cycles identifiés, observation à pas 1, export et réimport', async ({ page }) => {
  await page.getByText(/^Observations hiérarchiques \(/).click();
  for (const id of ['plant/N', 'plant/C']) { const f = page.getByLabel('Pas ' + id, { exact: true }); await f.fill('1'); await f.blur(); }
  const r = await execute(page, 'coarse-two-cycles');
  expect(last(r, 'plant/N')).toBeCloseTo(155.007095, 5); expect(last(r, 'plant/C')).toBeCloseTo(126.058377, 5);
  expect(r.resultEvents.filter((e: any) => e.port === 11).map((e: any) => [e.time, e.value[2]])).toEqual([[1, 1], [3, 2]]);
  await roundtrip(page, 'coarse-two-cycles', r);
});
test('8F construit B* dans une nouvelle définition React Flow et remplace son instance', async ({ page }) => {
  test.setTimeout(240000);
  const d = example.model.definitions.find(d => d.id === 'ObserverDecision')!;
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('UiObserver');
  await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  for (const [direction, label] of [['inputs', 'entrée'], ['outputs', 'sortie']] as const) for (const p of d[direction]) {
    await page.getByRole('button', { name: 'Ajouter une ' + label, exact: true }).click();
    const f = page.getByLabel(`Nom ${direction} ${p.port}`, { exact: true }); await f.fill(p.name); await f.blur();
  }
  for (const c of d.components) {
    await page.getByRole('button', { name: c.type === 'coupled' && 'definition' in c ? 'Insérer ' + c.definition : 'Ajouter ' + c.type, exact: true }).click();
    const f = page.getByLabel('Identifiant du composant', { exact: true }); await f.fill(c.id); await f.press('Enter');
  }
  for (const e of d.connections) await wire(page, e);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click();
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click(); await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'observer-from-react-flow.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  await page.getByTestId('node-observer').locator('.node-header').click(); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  await page.getByRole('button', { name: 'Insérer UiObserver', exact: true }).click();
  const f = page.getByLabel('Identifiant du composant', { exact: true }); await f.fill('observer'); await f.press('Enter');
  for (const e of example.model.connections.filter(e => e.from.component === 'observer' || e.to.component === 'observer')) await wire(page, e);
  // Deleting an instance also removes its hierarchical observations.
  await page.getByText(/^Observations hiérarchiques \(/).click();
  for (const leaf of ['request', 'synchronize/memoryN', 'synchronize/memoryC', 'decide/deltaC']) {
    await page.getByLabel('Chemin d’observation', { exact: true }).selectOption('observer/' + leaf);
    await page.getByRole('button', { name: 'Observer ce chemin', exact: true }).click();
  }
  const r = await execute(page, 'ui-observer'); expect(last(r, 'applied')).toBe(150); expect(last(r, 'plant/N')).toBeCloseTo(155.007095, 5);
  await roundtrip(page, 'ui-observer', r);
});
test('8F change seuil puis stratégie dans les inspecteurs sans modifier le Plant', async ({ page }) => {
  await page.getByRole('button', { name: 'Ouvrir définition EvaluateCandidates', exact: true }).click();
  await page.getByTestId('node-admissible').locator('.node-header').click();
  const threshold = page.getByLabel('right', { exact: true }); await threshold.fill('0'); await threshold.blur();
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  const r = await execute(page, 'ui-threshold'); expect(last(r, 'applied')).toBe(260); expect(last(r, 'plant/N')).toBeLessThan(130);
  await page.getByRole('button', { name: 'Ouvrir définition ConditionalDecision', exact: true }).click();
  for (const id of ['primary', 'secondary']) { await page.getByTestId('node-' + id).locator('.node-header').click(); await page.getByLabel('direction', { exact: true }).selectOption('1'); }
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  const conservative = await execute(page, 'ui-strategy'); expect(last(conservative, 'applied')).toBe(80); expect(last(conservative, 'plant/N')).toBeGreaterThan(last(r, 'plant/N'));
  await roundtrip(page, 'ui-strategy', conservative);
});
