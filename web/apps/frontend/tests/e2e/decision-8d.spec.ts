import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const evidence = path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '8d') : '../../../build-web-test8d/browser');
const runner = path.resolve(process.env.IRRITATOR_RUNNER!);
const last = (r: any, id: string) => r.observations.find((o: any) => o.component === id).samples.at(-1).value;
test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept()); await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/decision-feedback-minimal-v3.json'));
});
async function execute(page: Page, name: string) {
  const wait = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const res = await wait, result = await res.json(), request = res.request().postDataJSON(); expect(res.ok(), JSON.stringify(result)).toBe(true);
  const { runId, ...actual } = result; expect(runId).toBeTruthy();
  expect(actual).toEqual(JSON.parse(execFileSync(runner, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000 })));
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, name + '.json'), JSON.stringify({ request, result, httpEqualsNative: true }, null, 2));
  return result;
}
async function roundtrip(page: Page, name: string, result: any) {
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, name + '-export.json'); await (await wait).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, name + '-restored'); expect(restored.observations).toEqual(result.observations); expect(restored.resultEvents).toEqual(result.resultEvents);
}
async function rename(page: Page, id: string) {
  const input = page.getByLabel('Identifiant du composant', { exact: true }); await input.fill(id); await input.press('Enter');
}
async function add(page: Page, type: string, id: string, params: Record<string, number> = {}) {
  await page.getByRole('button', { name: 'Ajouter ' + type, exact: true }).click(); await rename(page, id);
  for (const [key, value] of Object.entries(params)) { const field = page.getByLabel(key, { exact: true }); await field.fill(String(value)); await field.blur(); }
}
async function wire(page: Page, a: string, ap: number, b: string, bp: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${a}|out:${ap}`); await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${b}|in:${bp}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
test('8D importe deux cycles natifs, applique les actions et réimporte le modèle', async ({ page }) => {
  const r = await execute(page, 'minimal'); expect(last(r, 'plant/X')).toBeCloseTo(10, 10); expect(last(r, 'applied')).toBe(0);
  for (const [campaign, initial, time] of [[1, 12, 1], [2, 10, 3]] as const) {
    const rows = r.resultEvents.filter((e: any) => e.port === 4 && e.value[2] === campaign); expect(rows).toHaveLength(3);
    for (const e of rows) { expect(e.value[0]).toBeCloseTo(initial, 10); expect(e.time).toBe(time); }
  }
  await roundtrip(page, 'minimal', r);
});
test('8D construit un système couplé avec ports lecture/action et lecture de l’état réel dans React Flow', async ({ page }) => {
  test.setTimeout(180000);
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('NativePlant');
  await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une entrée', exact: true }).click(); await page.getByRole('button', { name: 'Ajouter une entrée', exact: true }).click(); await page.getByRole('button', { name: 'Ajouter une sortie', exact: true }).click();
  for (const [label, name] of [['Nom inputs 0', 'read'], ['Nom inputs 1', 'action'], ['Nom outputs 0', 'observation']] as const) { const field = page.getByLabel(label, { exact: true }); await field.fill(name); await field.blur(); }
  await add(page, 'qss3_integrator', 'X', { X: 10, dQ: .01 }); await add(page, 'zero_order_hold', 'hold'); await add(page, 'state_observer', 'sample', { capacity: 128 });
  for (const [a, ap, b, bp] of [['$input', 0, 'sample', 1], ['$input', 1, 'hold', 0], ['hold', 0, 'X', 0], ['X', 0, 'sample', 0], ['sample', 0, '$output', 0]] as [string, number, string, number][]) await wire(page, a, ap, b, bp);
  await mkdir(evidence, { recursive: true }); await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click(); await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click(); await page.screenshot({ path: path.join(evidence, 'native-plant-definition.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); await page.getByTestId('node-plant').locator('.node-header').click(); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  await page.getByRole('button', { name: 'Insérer NativePlant', exact: true }).click(); await rename(page, 'plant');
  for (const [a, ap, b, bp] of [['initialCommand', 0, 'plant', 1], ['read1', 0, 'plant', 0], ['read2', 0, 'plant', 0], ['decide', 0, 'plant', 1], ['plant', 0, 'observation', 0]] as [string, number, string, number][]) await wire(page, a, ap, b, bp);
  await page.getByText(/^Observations hiérarchiques \(/).click();
  for (const leaf of ['X', 'hold', 'sample']) { await page.getByLabel('Chemin d’observation', { exact: true }).selectOption('plant/' + leaf); await page.getByRole('button', { name: 'Observer ce chemin', exact: true }).click(); }
  const r = await execute(page, 'manual-native-plant'); expect(last(r, 'plant/X')).toBeCloseTo(10, 10); expect(last(r, 'plant/hold')).toBe(0); await roundtrip(page, 'manual-native-plant', r);
});
test('8D configure un nouvel instant de décision et un délai prospectif depuis les inspecteurs', async ({ page }) => {
  await page.getByTestId('node-read2').click(); await page.getByLabel('offset', { exact: true }).fill('4'); await page.getByLabel('offset', { exact: true }).blur();
  let r = await execute(page, 'read-at-four'); expect(last(r, 'applied')).toBe(1);
  const rows = r.resultEvents.filter((e: any) => e.port === 4 && e.value[2] === 2); expect(rows).toHaveLength(3); for (const e of rows) expect(e.value[0]).toBeCloseTo(9, 10);
  await page.getByTestId('node-runValue').click(); await page.getByLabel('right', { exact: true }).fill('.5'); await page.getByLabel('right', { exact: true }).blur();
  r = await execute(page, 'delay-half'); expect(r.resultEvents.some((e: any) => e.time === 1.5)).toBe(true); expect(r.resultEvents.some((e: any) => e.time === 4.5)).toBe(true); await roundtrip(page, 'delay-half', r);
});
