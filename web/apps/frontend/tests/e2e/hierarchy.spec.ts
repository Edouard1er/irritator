import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const evidence = path.resolve('../../../build-web-test6/logs/browser');
const screenshots = path.resolve('../../../reports/hierarchy-test-6');
async function start(page: Page) {
  page.on('dialog', d => d.accept());
  await page.goto('/'); await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
}
async function wire(page: Page, source: string, output: number, target: string, input: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${source}|out:${output}`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${target}|in:${input}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
async function add(page: Page, type: string, parameters: Record<string, number> = {}) {
  await page.getByRole('button', { name: `Ajouter ${type}`, exact: true }).click();
  for (const [name, value] of Object.entries(parameters)) await page.getByLabel(name, { exact: true }).fill(String(value));
}
async function rename(page: Page, id: string) {
  const field = page.getByLabel('Identifiant du composant', { exact: true });
  await field.fill(id); await field.press('Enter');
}
async function run(page: Page, name: string) {
  const waiting = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const response = await waiting, result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true);
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, `${name}.json`), JSON.stringify({ request: response.request().postDataJSON(), result }, null, 2));
  return result;
}
test('crée Sum2Block dans React Flow, deux instances, exécution, export/import et positions indépendantes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await start(page);
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('Sum2Block');
  await page.getByLabel('Nom de définition', { exact: true }).fill('Somme réutilisable');
  await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une entrée', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une entrée', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une sortie', exact: true }).click();
  await add(page, 'qss1_sum_2');
  await wire(page, '$input', 0, 'sum', 0); await wire(page, '$input', 1, 'sum', 1); await wire(page, 'sum', 0, '$output', 0);
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click();
  await mkdir(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, 'sum2-definition.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  await page.getByRole('button', { name: 'Insérer Sum2Block', exact: true }).click(); await rename(page, 'sumA');
  await page.getByRole('button', { name: 'Insérer Sum2Block', exact: true }).click(); await rename(page, 'sumB');
  await add(page, 'constant', { value: 10, offset: 0 }); await add(page, 'constant', { value: 100, offset: 1 }); await add(page, 'constant', { value: 1000, offset: 2 });
  await wire(page, 'c1', 0, 'sumA', 0); await wire(page, 'c2', 0, 'sumA', 1); await wire(page, 'sumA', 0, 'sumB', 0); await wire(page, 'c3', 0, 'sumB', 1);
  await page.getByText('Observations hiérarchiques (0)', { exact: true }).click();
  await page.getByLabel('Chemin d’observation', { exact: true }).selectOption('sumB/sum'); await page.getByRole('button', { name: 'Observer ce chemin', exact: true }).click();
  const result = await run(page, 'sum-built'); expect(result.observations[0].samples).toEqual([{ time: 0, value: 10 }, { time: 1, value: 110 }, { time: 2, value: 1110 }]);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click(); await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click();
  await page.screenshot({ path: path.join(screenshots, 'sum-two-instances.png'), fullPage: true });
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const filename = path.join(evidence, 'hierarchy-export.json'); await (await downloading).saveAs(filename);
  const exported = JSON.parse(await readFile(filename, 'utf8')); expect(exported.schemaVersion).toBe(2); expect(exported.model.definitions).toHaveLength(1); expect(exported.positions).toBeUndefined();
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(filename);
  expect((await run(page, 'sum-reimported')).observations).toEqual(result.observations);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('irritator.workspace.v2'))).not.toBeNull();
  await page.evaluate(() => { const key = 'irritator.workspace.v2', state = JSON.parse(localStorage.getItem(key)!); state.positions.sumA = { x: 1000, y: 900 }; localStorage.setItem(key, JSON.stringify(state)); });
  await page.reload(); await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  expect((await run(page, 'sum-repositioned')).observations).toEqual(result.observations);
  expect(errors).toEqual([]);
});
test('deux niveaux réels, navigation, définition partagée, ports stables et réimport', async ({ page }) => {
  await start(page); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/hierarchy-nested.json'));
  const initial = await run(page, 'nested-imported'); expect(initial.observations[0].samples.map((s: { value: number }) => s.value)).toEqual([10, 110, 1110]);
  await page.getByTestId('node-composite').getByRole('button', { name: 'Ouvrir le contenu', exact: true }).click();
  await page.getByTestId('node-left').getByRole('button', { name: 'Ouvrir le contenu', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation hiérarchique' })).toContainText('CompositeBlock');
  await expect(page.getByRole('navigation', { name: 'Navigation hiérarchique' })).toContainText('Sum2Block');
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click(); await page.getByTestId('node-sum').click(); await rename(page, 'adder');
  const edited = await run(page, 'nested-renamed'); expect(edited.observations[0].component).toBe('composite/right/adder'); expect(edited.observations[0].samples).toEqual(initial.observations[0].samples);
  await expect(page.getByLabel('$input sortie 0 vers adder entrée 0', { exact: true })).toBeVisible();
  await expect(page.getByLabel('adder sortie 0 vers $output entrée 0', { exact: true })).toBeVisible();
  await mkdir(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, 'nested-navigation.png'), fullPage: true });
  // Append/remove an unused interface: no silent reassignment of existing ports.
  await page.getByRole('button', { name: 'Ajouter une entrée', exact: true }).click(); await page.getByRole('button', { name: 'Supprimer inputs 2 et ses connexions', exact: true }).click();
  await expect(page.getByLabel('Nom inputs 0', { exact: true })).toHaveValue('p0'); await expect(page.getByLabel('Nom inputs 1', { exact: true })).toHaveValue('p1');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('irritator.workspace.v2') ?? '{}').activeScope)).toBe('Sum2Block');
  const camera = await page.evaluate(() => JSON.parse(localStorage.getItem('irritator.workspace.v2')!).scopes.Sum2Block.viewport as { x: number; y: number; zoom: number });
  await page.reload(); await expect(page.getByRole('navigation', { name: 'Navigation hiérarchique' })).toContainText('Sum2Block');
  await expect.poll(() => page.locator('.react-flow__viewport').evaluate((element, expected) => { const m = new DOMMatrix(getComputedStyle(element).transform); return Math.abs(m.e - expected.x) + Math.abs(m.f - expected.y) + Math.abs(m.a - expected.zoom); }, camera)).toBeLessThan(.001);
  expect((await run(page, 'nested-restored-scope')).observations).toEqual(edited.observations);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click(); const file = path.join(evidence, 'nested-export.json'); await (await downloading).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file); expect((await run(page, 'nested-reimported')).observations).toEqual(edited.observations);
});
test('QSS2 ajouté et multiplicateur créés avec l’inspecteur générique et moteur réel', async ({ page }) => {
  await start(page); await add(page, 'constant', { value: 2 }); await add(page, 'qss2_integrator', { X: 5, dQ: .25 });
  await page.getByLabel('Observer ce composant', { exact: true }).check(); await page.getByLabel('Pas d’observation', { exact: true }).fill('.1'); await wire(page, 'c1', 0, 'integrator', 0);
  const qss = await run(page, 'qss2-built'); for (const s of qss.observations[0].samples) expect(Math.abs(s.value - (5 + 2 * s.time))).toBeLessThanOrEqual(.01 + 1e-12); expect(qss.observations[0].samples.at(-1).value).toBe(11);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await add(page, 'constant', { value: 2 }); await add(page, 'constant', { value: 3 }); await add(page, 'qss1_multiplier');
  await page.getByLabel('Observer ce composant', { exact: true }).check(); await wire(page, 'c1', 0, 'product', 0); await wire(page, 'c2', 0, 'product', 1);
  expect((await run(page, 'multiplier-built')).observations[0].samples).toEqual([{ time: 0, value: 6 }]);
});
test('migration navigateur v1 et sauvegarde corrompue conservée sans écrasement', async ({ page }) => {
  const legacyRequest = JSON.parse(await readFile(path.resolve('../../examples/sum3.json'), 'utf8'));
  const legacy = JSON.stringify({ workspaceVersion: 1, request: legacyRequest, positions: { c1: { x: 123, y: 234 } }, viewport: { x: 70, y: 45, zoom: 1 } });
  await page.addInitScript(value => { if (!localStorage.getItem('test-seeded')) { localStorage.setItem('irritator.workspace.v1', value); localStorage.setItem('test-seeded', '1'); } }, legacy);
  await start(page); expect((await run(page, 'legacy-workspace')).observations[0].samples.map((s: { value: number }) => s.value)).toEqual([10, 110, 1110]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('irritator.workspace.v2'))).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('irritator.workspace.v1'))).toBe(legacy);
  await page.evaluate(() => localStorage.setItem('irritator.workspace.v2', '{broken'));
  await page.reload(); await expect(page.getByText(/Elle est conservée/)).toBeVisible();
  // A health handshake completes well after the autosave debounce; the bad bytes must survive it.
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('irritator.workspace.v2'))).toBe('{broken');
  expect(await page.evaluate(() => localStorage.getItem('irritator.workspace.v1'))).toBe(legacy);
});
