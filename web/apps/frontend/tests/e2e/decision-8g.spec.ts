import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import example from '../../../../examples/decision-grouped-schaefer-v3.json' with { type: 'json' };
const evidence = path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '8g') : '../../../build-web-test8g/browser');
const runner = path.resolve(process.env.IRRITATOR_RUNNER!);
const last = (r: any, id: string) => r.observations.find((o: any) => o.component === id).samples.at(-1).value;
test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept()); await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/decision-grouped-schaefer-v3.json'));
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
async function wire(page: Page, e: any) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${e.from.component}|out:${e.from.port}`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${e.to.component}|in:${e.to.port}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
async function roundtrip(page: Page, r: any, name: string) {
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, name + '-export.json'); await (await wait).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, name + '-restored'); expect(restored.observations).toEqual(r.observations); expect(restored.resultEvents).toEqual(r.resultEvents);
}
test('8G change contrainte et opération depuis les inspecteurs et réimporte la décision', async ({ page }) => {
  const constrained = await execute(page, 'constrained'); expect(last(constrained, 'actionReceipt')).toBe(150);
  await page.getByRole('button', { name: 'Ouvrir définition GroupedDecision', exact: true }).click();
  await page.getByTestId('node-admissible').locator('.node-header').click();
  const t = page.getByLabel('right', { exact: true }); await t.fill('0'); await t.blur();
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  const unconstrained = await execute(page, 'max-min'); expect(last(unconstrained, 'actionReceipt')).toBe(260);
  await page.getByRole('button', { name: 'Ouvrir définition GroupedDecision', exact: true }).click();
  await page.getByTestId('node-minCH').locator('.node-header').click(); await page.getByLabel('operation', { exact: true }).selectOption('3');
  await page.getByLabel('validation', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  const descriptive = await execute(page, 'descriptive-mean'); expect(last(descriptive, 'actionReceipt')).toBe(260);
  await roundtrip(page, descriptive, 'descriptive-mean');
});
test('8G construit une définition de groupe avec ports et connexions React Flow puis la réutilise', async ({ page }) => {
  test.setTimeout(300000);
  const d = example.model.definitions.find(d => d.id === 'GroupedDecision')!;
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('UiGroups');
  await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  for (const [direction, label] of [['inputs', 'entrée'], ['outputs', 'sortie']] as const) for (const p of d[direction]) {
    await page.getByRole('button', { name: 'Ajouter une ' + label, exact: true }).click();
    const f = page.getByLabel(`Nom ${direction} ${p.port}`, { exact: true }); await f.fill(p.name); await f.blur();
  }
  for (const c of d.components) {
    await page.getByRole('button', { name: c.type === 'coupled' && 'definition' in c ? 'Insérer ' + c.definition : 'Ajouter ' + c.type, exact: true }).click();
    const f = page.getByLabel('Identifiant du composant', { exact: true }); await f.fill(c.id); await f.press('Enter');
    for (const [key, value] of Object.entries(c.parameters)) {
      const input = page.getByLabel(key, { exact: true });
      if (await input.evaluate(e => e.tagName === 'SELECT')) await input.selectOption(String(value));
      else { await input.fill(String(value)); await input.blur(); }
    }
  }
  for (const e of d.connections) await wire(page, e);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click();
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click();
  await mkdir(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, 'group-definition-react-flow.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  await page.getByTestId('node-external').locator('.node-header').click(); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  await page.getByRole('button', { name: 'Insérer UiGroups', exact: true }).click();
  const f = page.getByLabel('Identifiant du composant', { exact: true }); await f.fill('external'); await f.press('Enter');
  for (const e of example.model.connections.filter(e => e.from.component === 'external' || e.to.component === 'external')) await wire(page, e);
  const r = await execute(page, 'manual-groups'); expect(last(r, 'actionReceipt')).toBe(150);
  await roundtrip(page, r, 'manual-groups');
});
test('8G T* applique uniquement E et conserve deux campagnes à pas 1', async ({ page }) => {
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/tstar-schaefer-uncertainty-v3.json'));
  await page.getByText(/^Observations hiérarchiques \(/).click();
  for (const id of ['plant/N', 'plant/C']) { const f = page.getByLabel('Pas ' + id, { exact: true }); await f.fill('1'); await f.blur(); }
  const r = await execute(page, 'tstar-uncertainty'); expect(last(r, 'applied')).toBe(150); expect(last(r, 'plant/N')).toBeCloseTo(155.007095, 5);
  expect(r.resultEvents.filter((e: any) => e.port === 13).map((e: any) => [e.time, e.value])).toEqual([[1, [6,6,1]], [3, [6,6,2]]]);
  await roundtrip(page, r, 'tstar-uncertainty');
});
