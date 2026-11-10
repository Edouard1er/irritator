import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const evidence = path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '8c') : '../../../build-web-test8c/browser');
const runner = path.resolve(process.env.IRRITATOR_RUNNER!);
const last = (r: any, id: string) => r.observations.find((o: any) => o.component === id).samples.at(-1).value;
test.beforeEach(async ({ page }) => { page.on('dialog', d => d.accept()); });
async function open(page: Page, name: string) {
  await page.goto('/'); await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve(`../../examples/decision-8c-${name}-v3.json`));
}
async function execute(page: Page, name: string) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const res = await response, result = await res.json(), request = res.request().postDataJSON();
  expect(res.ok(), JSON.stringify(result)).toBe(true); const { runId, ...actual } = result; expect(runId).toBeTruthy();
  expect(actual).toEqual(JSON.parse(execFileSync(runner, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000 })));
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, name + '.json'), JSON.stringify({ request, result, httpEqualsNative: true }, null, 2));
  return result;
}
async function roundtrip(page: Page, name: string, result: any) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, name + '-export.json'); await (await event).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click(); await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, name + '-restored'); expect(restored.observations).toEqual(result.observations);
}
async function add(page: Page, type: string, id: string, params: Record<string, number> = {}) {
  await page.getByRole('button', { name: 'Ajouter ' + type, exact: true }).click();
  const field = page.getByLabel('Identifiant du composant', { exact: true }); await field.fill(id); await field.press('Enter');
  for (const [key, value] of Object.entries(params)) {
    const input = page.getByLabel(key, { exact: true });
    if (await input.evaluate(e => e.tagName === 'SELECT')) await input.selectOption(String(value)); else { await input.fill(String(value)); await input.blur(); }
  }
}
async function wire(page: Page, a: string, ap: number, b: string, bp: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${a}|out:${ap}`); await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${b}|in:${bp}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
test('8C A importe et observe les cinq réductions, exporte et réimporte', async ({ page }) => {
  await open(page, 'aggregation'); const r = await execute(page, 'aggregation');
  for (const [id, value] of Object.entries({ minResult: 10, maxResult: 40, sumResult: 70, meanResult: 70 / 3, countResult: 3 })) expect(last(r, id)).toBe(value);
  await roundtrip(page, 'aggregation', r);
});
test('8C B construit agrégateur, diffusion et division dans React Flow', async ({ page }) => {
  test.setTimeout(120000); await open(page, 'normalization');
  await page.getByRole('button', { name: 'Ouvrir définition NormalizeCampaign', exact: true }).click();
  for (const id of ['ratio', 'join', 'max']) {
    await page.getByTestId('node-' + id).click(); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  }
  await add(page, 'campaign_aggregate', 'maximum', { operation: 1 }); await add(page, 'campaign_broadcast', 'broadcast'); await add(page, 'event_operator', 'divide', { operation: 4, required: 3 });
  for (const [a, ap, b, bp] of [['$input', 0, 'maximum', 0], ['$input', 1, 'maximum', 1], ['$input', 0, 'broadcast', 0], ['$input', 1, 'broadcast', 2], ['maximum', 0, 'broadcast', 1], ['maximum', 2, 'broadcast', 3], ['broadcast', 0, 'divide', 0], ['broadcast', 1, 'divide', 1], ['broadcast', 2, 'divide', 3], ['divide', 0, '$output', 0], ['divide', 2, '$output', 1]] as [string, number, string, number][]) await wire(page, a, ap, b, bp);
  await mkdir(evidence, { recursive: true }); await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click(); await page.screenshot({ path: path.join(evidence, 'normalization-definition.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); const r = await execute(page, 'normalization-manual'); expect(last(r, 'ratioReceipt')).toBe(1); expect(last(r, 'end')).toBe(3);
  for (const value of [.25, .5, 1]) expect(r.observations.find((o: any) => o.component === 'ratioReceipt').samples.some((s: any) => Math.abs(s.value - value) < 1e-12)).toBe(true);
  await roundtrip(page, 'normalization-manual', r);
});
test('8C C/D configure les priorités puis un repli réel, sans recompilation', async ({ page }) => {
  await open(page, 'fallback'); const r = await execute(page, 'fallback-primary'); expect(last(r, 'action')).toBe(300); expect(last(r, 'identity')).toBe(2); expect(last(r, 'selected')).toBe(1);
  await page.getByRole('button', { name: 'Ouvrir définition ConditionalDecision', exact: true }).click(); await page.getByTestId('node-priority').click(); await page.getByLabel('primaryPriority', { exact: true }).fill('2'); await page.getByLabel('primaryPriority', { exact: true }).blur();
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); const secondary = await execute(page, 'priority-secondary'); expect(last(secondary, 'action')).toBe(100); expect(last(secondary, 'identity')).toBe(0);
  await roundtrip(page, 'priority-secondary', secondary);
});
test('8C Schaefer change coefficients et contrainte depuis les inspecteurs', async ({ page }) => {
  test.setTimeout(120000); await open(page, 'schaefer'); const initial = await execute(page, 'schaefer-initial'); expect(last(initial, 'action')).toBe(150); expect(last(initial, 'identity')).toBe(4);
  await page.getByRole('button', { name: 'Ouvrir définition CampaignDecision', exact: true }).click();
  await page.getByTestId('node-condition').click(); await page.getByLabel('right', { exact: true }).fill('120'); await page.getByLabel('right', { exact: true }).blur();
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); expect(last(await execute(page, 'schaefer-threshold-120'), 'identity')).toBe(4);
  await page.getByRole('button', { name: 'Ouvrir définition CampaignDecision', exact: true }).click();
  for (const [id, right] of [['weightA', 1], ['weightB', 0]] as const) { await page.getByTestId('node-' + id).click(); await page.getByLabel('right', { exact: true }).fill(String(right)); await page.getByLabel('right', { exact: true }).blur(); }
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); const changed = await execute(page, 'schaefer-changed'); expect(last(changed, 'action')).toBe(260); expect(last(changed, 'identity')).toBe(2);
  await page.getByRole('button', { name: 'Ouvrir définition CampaignDecision', exact: true }).click(); await page.getByTestId('node-condition').click(); await page.getByLabel('right', { exact: true }).fill('160'); await page.getByLabel('right', { exact: true }).blur();
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); const fallback = await execute(page, 'schaefer-real-fallback'); expect(last(fallback, 'action')).toBe(150); expect(last(fallback, 'identity')).toBe(4); expect(last(fallback, 'selected')).toBe(1);
  await roundtrip(page, 'schaefer-real-fallback', fallback);
});
