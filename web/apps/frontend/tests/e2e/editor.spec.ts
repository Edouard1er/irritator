import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const evidence = path.resolve('../../../build-web-test5/logs/browser');
const screenshots = path.resolve('../../../reports/frontend-test-5');
async function start(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter constant', exact: true })).toBeVisible();
}
async function add(page: Page, type: string, params: Record<string, number> = {}) {
  await page.getByRole('button', { name: `Ajouter ${type}`, exact: true }).click();
  for (const [key, value] of Object.entries(params)) await page.getByLabel(key, { exact: true }).fill(String(value));
}
async function observe(page: Page, interval: number) {
  await page.getByLabel('Observer ce composant', { exact: true }).check();
  await page.getByLabel('Pas d’observation', { exact: true }).fill(String(interval));
}
async function wire(page: Page, source: string, target: string, input: number) {
  await page.getByLabel(`${source} sortie 0`, { exact: true }).click();
  await page.getByLabel(`${target} entrée ${input}`, { exact: true }).click();
}
async function execute(page: Page, name: string) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const r = await response;
  const result = await r.json();
  expect(r.ok(), JSON.stringify(result)).toBe(true);
  expect(result.status).toBe('completed');
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, `${name}.json`), JSON.stringify({ request: r.request().postDataJSON(), result }, null, 2));
  await expect(page.getByRole('status').filter({ hasText: /^Terminé$/ })).toBeVisible();
  return result;
}
async function verifyTable(page: Page, values: number[]) {
  await page.getByRole('tab', { name: 'Données', exact: true }).click();
  for (let i = 0; i < values.length; i++) await expect(page.getByRole('row').filter({ hasText: new RegExp(`sum${i}${values[i]}$`) })).toHaveCount(1);
}
const browserErrors = new WeakMap<Page, string[]>();
const externalRequests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  browserErrors.set(page, []); externalRequests.set(page, []);
  page.on('pageerror', error => browserErrors.get(page)!.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.get(page)!.push(request.url());
  });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), 'Aucune exception JavaScript non interceptée').toEqual([]);
  expect(externalRequests.get(page), 'Aucune ressource distante nécessaire').toEqual([]);
});

test('construit le graphe sum3 avec les ports, calcule, modifie, exporte et réimporte', async ({ page }) => {
  await start(page);
  await add(page, 'constant', { value: 10, offset: 0 });
  await add(page, 'constant', { value: 100, offset: 1 });
  await add(page, 'constant', { value: 1000, offset: 2 });
  await add(page, 'qss1_sum_3');
  await observe(page, 1);
  for (let i = 0; i < 3; i++) await wire(page, `c${i + 1}`, 'sum', i);
  await expect(page.getByText('3 connexions', { exact: true })).toBeVisible();
  const initial = await execute(page, 'sum3-built');
  expect(initial.observations[0].samples).toEqual([{ time: 0, value: 10 }, { time: 1, value: 110 }, { time: 2, value: 1110 }]);
  await expect(page.locator('.js-plotly-plot .scatterlayer .trace')).toHaveCount(1);
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'sum3-graph.png'), fullPage: true });
  await verifyTable(page, [10, 110, 1110]);
  const csvWait = page.waitForEvent('download'); await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const csv = await csvWait; const csvPath = path.join(evidence, 'sum3-points.csv'); await csv.saveAs(csvPath);
  expect(await readFile(csvPath, 'utf8')).toBe('component,time,value\r\n"sum",0,10\r\n"sum",1,110\r\n"sum",2,1110\r\n');
  const values = [-2, 7, 40];
  for (let i = 0; i < 3; i++) { await page.getByTestId(`node-c${i + 1}`).click(); await page.getByLabel('value', { exact: true }).fill(String(values[i])); }
  await expect(page.getByText(/ces résultats proviennent d’une version précédente/)).toBeVisible();
  const changed = await execute(page, 'sum3-changed');
  expect(changed.observations[0].samples.map((s: { value: number }) => s.value)).toEqual([-2, 5, 45]);
  await verifyTable(page, [-2, 5, 45]);
  const downloadWait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const download = await downloadWait; const file = path.join(evidence, 'model-export.json'); await download.saveAs(file);
  const exported = JSON.parse(await readFile(file, 'utf8')); expect(exported.model.components).toHaveLength(4); expect(exported.positions).toBeUndefined();
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await expect(page.getByText('0 composants', { exact: true })).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const reopened = await execute(page, 'sum3-reimported'); expect(reopened.observations).toEqual(changed.observations);
  await page.reload(); await expect(page.getByText('4 composants', { exact: true })).toBeVisible();
  await expect(page.getByLabel('c1 sortie 0 vers sum entrée 0', { exact: true })).toBeVisible();
  await expect(page.getByLabel('c2 sortie 0 vers sum entrée 1', { exact: true })).toBeVisible();
  await expect(page.getByLabel('c3 sortie 0 vers sum entrée 2', { exact: true })).toBeVisible();
});

test('importe le fichier sum3 existant et retrouve l’oracle du Test 1', async ({ page }) => {
  await start(page);
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/sum3.json'));
  const r = await execute(page, 'sum3-imported'); expect(r.observations[0].samples.map((s: { value: number }) => s.value)).toEqual([10, 110, 1110]);
  await verifyTable(page, [10, 110, 1110]);
});

test('exécute une topologie à deux constantes et supprime ses connexions avec un composant', async ({ page }) => {
  await start(page); await add(page, 'constant', { value: -2 }); await add(page, 'constant', { value: 7, offset: 1 }); await add(page, 'qss1_sum_2'); await observe(page, 1);
  await wire(page, 'c1', 'sum', 0); await wire(page, 'c2', 'sum', 1);
  const r = await execute(page, 'sum2-built'); expect(r.observations[0].samples).toEqual([{ time: 0, value: -2 }, { time: 1, value: 5 }]);
  await page.getByTestId('node-c1').click(); await page.getByRole('button', { name: 'Supprimer le composant' }).click();
  await expect(page.getByText('2 composants', { exact: true })).toBeVisible(); await expect(page.getByText('1 connexions', { exact: true })).toBeVisible();
});

for (const type of ['qss1_integrator', 'qss3_integrator']) test(`construit ${type} et vérifie X(t)=5+2t, horizon 11`, async ({ page }) => {
  await start(page); await add(page, 'constant', { value: 2 }); await add(page, type, { X: 5, dQ: 0.25 }); await observe(page, 0.1); await wire(page, 'c1', 'integrator', 0);
  const r = await execute(page, `${type}-built`);
  expect(r.simulation.finalTime).toBe(3);
  for (const s of r.observations[0].samples) expect(Math.abs(s.value - (5 + 2 * s.time))).toBeLessThanOrEqual(1e-9);
  expect(r.observations[0].samples.at(-1).value).toBeCloseTo(11, 9);
  await page.getByRole('tab', { name: 'Exécution', exact: true }).click(); await expect(page.getByText('Appels à run()', { exact: true })).toBeVisible();
});

test('refuse une saisie invalide, un doublon, puis permet une nouvelle exécution', async ({ page }) => {
  await start(page); await add(page, 'constant', { value: 2 }); await add(page, 'qss1_sum_2'); await observe(page, 1);
  await page.getByRole('button', { name: 'Relier des ports' }).click();
  await page.getByLabel('Port de sortie').selectOption('c1|out:0'); await page.getByLabel('Port d’entrée').selectOption('sum|in:0');
  await page.getByRole('button', { name: 'Créer la connexion' }).click(); await page.getByRole('button', { name: 'Créer la connexion' }).click(); await expect(page.getByText('Cette connexion existe déjà.')).toBeVisible();
  await page.getByTestId('node-c1').click(); await page.getByLabel('value', { exact: true }).fill('Infinity');
  await expect(page.getByLabel('value', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'INVALID_' })).toBeVisible();
  await page.getByLabel('value', { exact: true }).fill('4'); const r = await execute(page, 'recovery'); expect(r.observations[0].samples[0].value).toBe(4);
});

test('les erreurs HTTP structurées ne bloquent pas l’éditeur (réponse mockée)', async ({ page }) => {
  await page.route('**/api/v1/health', route => route.fulfill({ status: 503, json: { schemaVersion: 1, status: 'failed', runner: { available: false }, error: { code: 'ENGINE_UNAVAILABLE', message: 'Moteur arrêté pour le test UI' } } }));
  await page.goto('/'); await expect(page.getByRole('button', { name: /Moteur indisponible/ })).toBeVisible();
  await add(page, 'constant', { value: 6 }); await expect(page.getByTestId('node-c1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exécuter la simulation', exact: true })).toBeDisabled();
});

test('échec de catalogue explicite, sans faux catalogue de secours (réponse mockée)', async ({ page }) => {
  await page.route('**/api/v1/components', route => route.fulfill({ status: 503, json: { error: { code: 'ENGINE_UNAVAILABLE', message: 'Catalogue indisponible pour le test UI' } } }));
  await page.goto('/'); await expect(page.getByRole('alert').filter({ hasText: 'Catalogue indisponible' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ajouter constant/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await expect(page.getByText('0 composants', { exact: true })).toBeVisible();
});

test('déplace le graphe sans invalider le calcul et supprime une connexion, sur écran portable', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 }); await start(page);
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/sum3.json'));
  await execute(page, 'laptop');
  const node = page.getByTestId('node-c1'); const before = (await node.boundingBox())!;
  await page.mouse.move(before.x + 65, before.y + 15); await page.mouse.down(); await page.mouse.move(before.x + 110, before.y + 50, { steps: 12 }); await page.mouse.up();
  expect((await node.boundingBox())!.x).toBeGreaterThan(before.x + 20);
  await expect(page.getByLabel('value', { exact: true })).toHaveValue('10');
  await expect(page.getByText(/ces résultats proviennent d’une version précédente/)).toHaveCount(0);
  await expect(page.locator('.js-plotly-plot .scatterlayer .trace')).toHaveCount(1);
  await page.screenshot({ path: path.join(screenshots, 'laptop-1366.png'), fullPage: true });
  // Keyboard selection remains precise when several visible edge hit areas overlap.
  await page.getByLabel('c1 sortie 0 vers sum entrée 0', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Supprimer la connexion', exact: true }).click();
  await expect(page.getByText('2 connexions', { exact: true })).toBeVisible();
  await expect(page.getByText(/ces résultats proviennent d’une version précédente/)).toBeVisible();
});

test('compare deux observations et masque une série sans altérer les exports', async ({ page }) => {
  await start(page); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/sum3.json'));
  await page.getByTestId('node-c1').click(); await observe(page, 1);
  const r = await execute(page, 'multiple-observations'); expect(r.observations).toHaveLength(2);
  await expect(page.locator('.js-plotly-plot .scatterlayer .trace')).toHaveCount(2);
  await page.getByLabel('Séries affichées').getByRole('checkbox', { name: /c1/ }).uncheck();
  await expect(page.locator('.js-plotly-plot .scatterlayer .trace')).toHaveCount(1);
  const csvWait = page.waitForEvent('download'); await page.getByRole('button', { name: 'CSV', exact: true }).click(); const csv = await csvWait;
  const file = path.join(evidence, 'multiple-points.csv'); await csv.saveAs(file);
  expect((await readFile(file, 'utf8')).trim().split('\r\n')).toHaveLength(5);
});

test('un import invalide préserve le travail et un timeout HTTP conserve les derniers résultats', async ({ page }) => {
  await start(page); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/sum3.json')); await execute(page, 'before-timeout');
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1}') });
  await expect(page.getByRole('alert').filter({ hasText: 'Import impossible' })).toBeVisible(); await expect(page.getByText('4 composants', { exact: true })).toBeVisible();
  await page.route('**/api/v1/simulations/run', route => route.fulfill({ status: 504, json: { schemaVersion: 1, status: 'failed', error: { code: 'ENGINE_TIMEOUT', message: 'Délai de test UI dépassé' } } }));
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ENGINE_TIMEOUT' })).toBeVisible(); await verifyTable(page, [10, 110, 1110]);
  await expect(page.getByRole('button', { name: 'Exécuter la simulation', exact: true })).toBeEnabled();
  await page.unroute('**/api/v1/simulations/run'); await execute(page, 'after-timeout-recovery');
});

test('avertit avant de remplacer un modèle modifié', async ({ page }) => {
  await start(page); await add(page, 'constant', { value: 9 });
  page.removeAllListeners('dialog'); let warned = false;
  page.once('dialog', async dialog => { warned = true; await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); expect(warned).toBe(true); await expect(page.getByTestId('node-c1')).toBeVisible();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await expect(page.getByText('0 composants', { exact: true })).toBeVisible();
});
