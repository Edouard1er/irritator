import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { RunResultV2 } from '@contracts';

const evidence = path.resolve(process.env.IRRITATOR_8H_BROWSER_EVIDENCE ?? process.env.IRRITATOR_BROWSER_EVIDENCE ?? '../../../build-web-test8h/browser');
const runner = path.resolve(process.env.IRRITATOR_RUNNER!);
const last = (r: RunResultV2, id: string) => r.observations.find(o => o.component === id)!.samples.at(-1)!.value;
const events = (r: RunResultV2, kind: string) => r.resultEvents.filter(e => r.wrappers.find(w => w.component === e.component)!.outputs[e.port]!.kind === kind);
test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept()); await page.goto('/');
  await expect(page.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
});
async function open(page: Page, file: string) {
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/' + file));
}
async function execute(page: Page, name: string): Promise<RunResultV2> {
  const wait = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Exécuter la simulation', exact: true }).click();
  const response = await wait, result = await response.json(), request = response.request().postDataJSON();
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, name + '.json'), JSON.stringify({ request, result, status: response.status() }, null, 2));
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  const { runId, ...actual } = result; expect(runId).toBeTruthy();
  expect(actual).toEqual(JSON.parse(execFileSync(runner, [], { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 30000 })));
  return actual;
}
async function editParameter(page: Page, id: string, parameter: string, value: string) {
  await selectNode(page, id);
  const field = page.getByLabel(parameter, { exact: true }); await field.fill(value); await field.blur();
}
async function selectNode(page: Page, id: string) {
  const ports = page.locator('details.external-ports[open] > summary');
  if (await ports.isVisible()) await ports.click();
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click();
  // React Flow's keyboard selection also reaches nodes in a large graph whose
  // bodies overlap at the overview zoom. This uses its normal accessible UI.
  const node = page.getByTestId('rf__node-' + id);
  await node.focus(); await node.press('Enter');
  await expect(page.getByLabel('Identifiant du composant', { exact: true })).toHaveValue(id);
}
async function wire(page: Page, source: string, output: number, target: string, input: number) {
  if (!await page.getByLabel('Port de sortie', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Relier des ports', exact: true }).click();
  await page.getByLabel('Port de sortie', { exact: true }).selectOption(`${source}|out:${output}`);
  await page.getByLabel('Port d’entrée', { exact: true }).selectOption(`${target}|in:${input}`);
  await page.getByRole('button', { name: 'Créer la connexion', exact: true }).click();
}
async function renameSelected(page: Page, id: string) {
  const field = page.getByLabel('Identifiant du composant', { exact: true }); await field.fill(id); await field.press('Enter');
}
async function expectSeparatedCards(page: Page) {
  const cards = await page.locator('.react-flow__node .model-node').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { id: node.getAttribute('data-testid'), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }));
  for (let i = 0; i < cards.length; ++i) for (let j = i + 1; j < cards.length; ++j) {
    const a = cards[i]!, b = cards[j]!;
    expect(Math.min(a.right, b.right) <= Math.max(a.left, b.left) || Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top), `${a.id} overlaps ${b.id}`).toBe(true);
  }
}
async function buildCondition(page: Page) {
  await page.getByLabel('Identifiant de définition', { exact: true }).fill('UiCondition');
  await page.getByRole('button', { name: 'Créer le composant couplé', exact: true }).click();
  for (const [direction, label, names] of [['inputs', 'entrée', ['observation', 'reset']], ['outputs', 'sortie', ['condition']]] as const) for (const [port, name] of names.entries()) {
    await page.getByRole('button', { name: 'Ajouter une ' + label, exact: true }).click();
    const field = page.getByLabel(`Nom ${direction} ${port}`, { exact: true }); await field.fill(name); await field.blur();
  }
  await page.getByRole('button', { name: 'Ajouter event_operator', exact: true }).click(); await renameSelected(page, 'compare');
  await page.getByLabel('operation', { exact: true }).selectOption('8');
  const threshold = page.getByLabel('right', { exact: true }); await threshold.fill('2'); await threshold.blur();
  await wire(page, '$input', 0, 'compare', 0); await wire(page, '$input', 1, 'compare', 4); await wire(page, 'compare', 0, '$output', 0);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click();
  await selectNode(page, 'compare');
  await page.screenshot({ path: path.join(evidence, 'generic-condition-react-flow.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ouvrir définition BuildPlan', exact: true }).click();
  await selectNode(page, 'less'); await expectSeparatedCards(page); await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  await page.getByRole('button', { name: 'Insérer UiCondition', exact: true }).click(); await renameSelected(page, 'less');
  await wire(page, '$input', 0, 'less', 0); await wire(page, '$input', 1, 'less', 1); await wire(page, 'less', 0, 'otherwise', 0); await wire(page, 'less', 0, 'low', 2);
  await page.getByRole('button', { name: 'Fermer les connexions', exact: true }).click();
}
async function roundtrip(page: Page, expected: RunResultV2, name: string) {
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const file = path.join(evidence, name + '-export.json'); await (await wait).saveAs(file);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(file);
  const restored = await execute(page, name + '-restored'); expect(restored.observations).toEqual(expected.observations); expect(restored.resultEvents).toEqual(expected.resultEvents);
}

test('8H two generic observation-driven plans change both cardinality and horizon, then a threshold edit changes the second plan', async ({ page }) => {
  test.setTimeout(120000); // This test also creates, wires and inserts a coupled condition through the editor.
  await open(page, 'decision-dynamic-plan-minimal-v3.json');
  await selectNode(page, 'forecast');
  await expect(page.getByLabel('Recevoir un plan dynamique par campagne')).toBeChecked();
  await expect(page.getByText(/Entrée plan x\[4\]/)).toBeVisible();
  const r = await execute(page, 'minimal-3-2');
  expect(events(r, 'plan-ready').map(e => [e.time, e.value])).toEqual([[1, [3, 1, 1]], [3, [2, 2, 2]]]);
  expect(events(r, 'campaign-end').map(e => e.value)).toEqual([[3, 3, 1], [2, 2, 2]]);
  const criteria = events(r, 'scenario-selection').map(e => e.value[0]);
  for (const [i, expected] of [-3, -1, 1, 0, 1].entries()) expect(criteria[i]).toBeCloseTo(expected, 7);
  expect(last(r, 'plant/hold')).toBe(0); expect(last(r, 'plant/X')).toBeCloseTo(1, 7);
  await buildCondition(page);
  await page.getByRole('button', { name: 'Ajuster la vue', exact: true }).click();
  await page.screenshot({ path: path.join(evidence, 'generic-planning-react-flow.png'), fullPage: true });
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  const changed = await execute(page, 'minimal-threshold-2');
  expect(events(changed, 'plan-ready').map(e => e.value)).toEqual([[3, 1, 1], [3, 1, 2]]);
  expect(events(changed, 'campaign-end').map(e => e.value)).toEqual([[3, 3, 1], [3, 3, 2]]);
  expect(last(changed, 'plant/hold')).toBe(1); expect(last(changed, 'plant/X')).toBeCloseTo(3, 7);
  await roundtrip(page, changed, 'minimal-threshold-2');
});

test('8H edits the second Schaefer domain graph to the unique E=80 candidate and changes the actual Plant', async ({ page }) => {
  await open(page, 'tstar-schaefer-dynamic-plan-v3.json');
  const original = await execute(page, 'schaefer-3-2');
  expect(events(original, 'plan-ready').map(e => e.value)).toEqual([[3, 1, 1], [2, 2, 2]]);
  expect(last(original, 'applied')).toBe(150);
  await page.getByRole('button', { name: 'Ouvrir définition BuildPlan', exact: true }).click();
  await editParameter(page, 'highCount', 'left', '1');
  await expectSeparatedCards(page);
  for (const id of ['highValue1', 'highValue1Tag']) {
    await selectNode(page, id);
    await page.getByRole('button', { name: 'Supprimer le composant', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Modèle principal', exact: true }).click();
  const variant = await execute(page, 'schaefer-3-1');
  expect(events(variant, 'plan-ready').map(e => e.value)).toEqual([[3, 1, 1], [1, 2, 2]]);
  expect(events(variant, 'campaign-end').map(e => e.value)).toEqual([[3, 3, 1], [1, 1, 2]]);
  expect(last(variant, 'applied')).toBe(80);
  expect(last(variant, 'plant/N')).toBeGreaterThan(last(original, 'plant/N'));
  const effortPort = variant.wrappers[0]!.outputs.find(p => p.kind === 'scenario-factor' && p.id === 'effort')!.port;
  expect(events(variant, 'scenario-factor').filter(e => e.port === effortPort && e.value[2] === 2).map(e => e.value[0])).toEqual([80]);
  await roundtrip(page, variant, 'schaefer-3-1');
});
