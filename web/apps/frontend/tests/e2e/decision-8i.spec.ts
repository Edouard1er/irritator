import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { RunResultV2 } from '@contracts';

const evidence = path.resolve(process.env.IRRITATOR_8I_BROWSER_EVIDENCE ?? '../../../build-web-test8i/browser');
const runner = path.resolve(process.env.IRRITATOR_RUNNER!);
const last = (r: RunResultV2, id: string) => r.observations.find(o => o.component === id)!.samples.at(-1)!.value;
const ends = (r: RunResultV2) => r.resultEvents.filter(e => e.port === 13).map(e => e.value);
const factors = (r: RunResultV2, port: number, campaign: number) => r.resultEvents.filter(e => e.port === port && e.value[2] === campaign).map(e => e.value[0]);
test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept()); await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/tstar-schaefer-dynamic-uncertainty-v3.json'));
  await mkdir(evidence, { recursive: true });
});
async function execute(page: Page, name: string): Promise<RunResultV2> {
  const wait = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const res = await wait, result = await res.json(), request = res.request().postDataJSON();
  await writeFile(path.join(evidence, name + '.json'), JSON.stringify({ request, result, status: res.status() }, null, 2));
  expect(res.ok(), JSON.stringify(result)).toBe(true);
  const { runId, ...actual } = result; expect(runId).toBeTruthy();
  expect(actual).toEqual(JSON.parse(execFileSync(runner, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000 })));
  return actual;
}
async function select(page: Page, id: string) {
  const ports = page.locator('details.external-ports[open] > summary'); if (await ports.isVisible()) await ports.click();
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click();
  const node = page.getByTestId('rf__node-' + id); await node.focus(); await node.press('Enter');
  await expect(page.getByLabel('Identifiant du composant', { exact: true })).toHaveValue(id);
}
async function parameter(page: Page, id: string, key: string, value: string) {
  await select(page, id); const f = page.getByLabel(key, { exact: true });
  if (await f.evaluate(e => e.tagName === 'SELECT')) await f.selectOption(value);
  else { await f.fill(value); await f.blur(); }
}
async function rename(page: Page, id: string) { const f = page.getByLabel('Identifiant du composant', { exact: true }); await f.fill(id); await f.press('Enter'); }
async function wire(page: Page, source: string, output: number, target: string, input: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${source}|out:${output}`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${target}|in:${input}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
async function closeWires(page: Page) { const b = page.getByRole('button', { name: 'Fermer les connexions', exact: true }); if (await b.isVisible()) await b.click(); }
async function definition(page: Page, id: string) { await closeWires(page); await page.getByRole('button', { name: 'Ouvrir définition ' + id, exact: true }).click(); }
async function root(page: Page) { await closeWires(page); await page.getByRole('button', { name: 'Modèle principal', exact: true }).click(); }
async function remove(page: Page, id: string) { await select(page, id); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click(); }
async function roundtrip(page: Page, result: RunResultV2, name: string) {
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, name + '-export.json'); await (await wait).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, name + '-restored'); expect(restored.observations).toEqual(result.observations); expect(restored.resultEvents).toEqual(result.resultEvents);
}

test('8I builds and wires a reusable planning condition in React Flow, edits H and both selector strategies', async ({ page }) => {
  test.setTimeout(180000);
  const original = await execute(page, 'main-6-4'); expect(ends(original)).toEqual([[6, 6, 1], [4, 4, 2]]); expect(last(original, 'applied')).toBe(150);
  await definition(page, 'ObserverDecision'); await page.screenshot({ path: path.join(evidence, 'bstar-react-flow.png'), fullPage: true });
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('UiPlanCondition');
  await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  for (const [direction, label, names] of [['inputs', 'entrée', ['observation', 'reset']], ['outputs', 'sortie', ['condition']]] as const) for (const [p, name] of names.entries()) {
    await page.getByRole('button', { name: 'Ajouter une ' + label, exact: true }).click();
    const f = page.getByLabel(`Nom ${direction} ${p}`, { exact: true }); await f.fill(name); await f.blur();
  }
  await page.getByRole('button', { name: 'Ajouter event_operator', exact: true }).click(); await rename(page, 'compare');
  await page.getByLabel('operation', { exact: true }).selectOption('8');
  const right = page.getByLabel('right', { exact: true }); await right.fill('140'); await right.blur();
  await wire(page, '$input', 0, 'compare', 0); await wire(page, '$input', 1, 'compare', 4); await wire(page, 'compare', 0, '$output', 0);
  await closeWires(page); await page.screenshot({ path: path.join(evidence, 'condition-built-react-flow.png'), fullPage: true });
  await definition(page, 'BuildPlan'); await remove(page, 'less');
  await page.getByRole('button', { name: 'Insérer UiPlanCondition', exact: true }).click(); await rename(page, 'less');
  await wire(page, '$input', 0, 'less', 0); await wire(page, '$input', 1, 'less', 1); await wire(page, 'less', 0, 'otherwise', 0); await wire(page, 'less', 0, 'low', 2);
  await closeWires(page); await parameter(page, 'highHorizon', 'left', '5'); await root(page);
  const shorter = await execute(page, 'graph-built-horizon-5'); expect(ends(shorter)).toEqual([[6, 6, 1], [4, 4, 2]]); expect(last(shorter, 'applied')).toBe(150);
  expect(factors(shorter, 12, 2)[0]).toBeLessThan(factors(original, 12, 2)[0]!);
  await definition(page, 'UiPlanCondition'); await parameter(page, 'compare', 'right', '0'); await root(page);
  const other = await execute(page, 'planning-threshold-0'); expect(ends(other)[0]).toEqual([4, 4, 1]);
  await definition(page, 'UiPlanCondition'); await parameter(page, 'compare', 'right', '140');
  await definition(page, 'BuildPlan'); await parameter(page, 'highHorizon', 'left', '10');
  await definition(page, 'EvaluateGroups'); await parameter(page, 'admissible', 'right', '0'); await root(page);
  const permissive = await execute(page, 'ecological-threshold-0'); expect(last(permissive, 'applied')).toBe(260);
  await definition(page, 'ConditionalDecision'); await parameter(page, 'primary', 'direction', '1'); await parameter(page, 'secondary', 'direction', '1');
  await definition(page, 'AggregateActions'); await parameter(page, 'minCH', 'operation', '1'); await root(page);
  const alternative = await execute(page, 'edited-aggregation-and-strategies'); expect(last(alternative, 'applied')).toBe(80);
  await roundtrip(page, alternative, 'edited-policy');
});

test('8I edits the actual second E domain to one action and applies E=80, then roundtrips', async ({ page }) => {
  await definition(page, 'BuildPlan'); await parameter(page, 'highCount', 'left', '1');
  for (const id of ['highValue1', 'highValue1Tag']) await remove(page, id);
  await page.screenshot({ path: path.join(evidence, 'single-domain-react-flow.png'), fullPage: true }); await root(page);
  const r = await execute(page, 'single-6-2'); expect(ends(r)).toEqual([[6, 6, 1], [2, 2, 2]]);
  expect(factors(r, 9, 2)).toEqual([80, 80]); expect(factors(r, 10, 2)).toEqual([.0008, .001]); expect(last(r, 'applied')).toBe(80);
  expect(last(r, 'plant/N')).toBeCloseTo(174.227245, 5); expect(last(r, 'plant/C')).toBeCloseTo(106.405070, 5);
  await roundtrip(page, r, 'single-6-2');
});

test('8I independently edits q domains and counts, preserving actual singleton group completeness', async ({ page }) => {
  await definition(page, 'BuildPlan'); await parameter(page, 'highContextCount0', 'left', '1');
  for (const id of ['highContext0Value1', 'highContext0Value1Tag']) await remove(page, id);
  await root(page); const r = await execute(page, 'context-6-2');
  expect(ends(r)).toEqual([[6, 6, 1], [2, 2, 2]]); expect(factors(r, 9, 2)).toEqual([80, 150]); expect(factors(r, 10, 2)).toEqual([.0008, .0008]);
  expect(last(r, 'observer/decide/groups/count')).toBe(1); expect(last(r, 'applied')).toBe(150);
  await definition(page, 'BuildPlan'); await parameter(page, 'lowContext0Value0', 'left', '.0009'); await parameter(page, 'highContext0Value0', 'left', '.0009'); await root(page);
  const changed = await execute(page, 'context-values-edited'); expect(factors(changed, 10, 1)).toEqual([.0009, .0009, .0009, .001, .001, .001]); expect(factors(changed, 10, 2)).toEqual([.0009, .0009]);
  await roundtrip(page, changed, 'context-edited');
});
