import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { RunRequest, RunResult } from '@contracts';

type Parameters = { initial: number; growth: number; capacity: number };
const fixture: RunRequest = JSON.parse(readFileSync(new URL('../../../../examples/logistic-nine-cells-v1.json', import.meta.url), 'utf8'));
const experiment = 'Expérience logistique spatiale';
const runPath = '/api/v1/simulations/run';
const labels = {
  initial: 'Biomasse initiale N₀ (t)',
  growth: 'Taux de croissance r (mois⁻¹)',
  capacity: 'Capacité K (t)',
} as const;
const nominal = { initial: 380, growth: 0.35, capacity: 300 };
const isSimulation = (request: { method(): string; url(): string }) =>
  request.method() === 'POST' && new URL(request.url()).pathname === runPath;

const cell = (panel: Locator, id: string) => panel.getByRole('button', { name: id, exact: true });
const details = (panel: Locator, id = 'C11') => panel.getByRole('region', { name: `Paramètres de ${id}`, exact: true });
const field = (form: Locator, name: keyof Parameters) => form.getByLabel(labels[name], { exact: true });
const apply = (form: Locator) => form.getByRole('button', { name: 'Appliquer et simuler', exact: true });
const launch = (panel: Locator) => panel.getByRole('button', { name: 'Lancer la simulation', exact: true });
const slider = (panel: Locator) => panel.getByRole('slider', { name: 'Temps simulé', exact: true });
const phase = (panel: Locator) => panel.locator('[data-phase]');
const chart = (panel: Locator) => panel.getByLabel('Trajectoires logistiques', { exact: true });

async function openExperiment(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Moteur connecté' })).toBeVisible();
  await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click();
  // Each editor verifies its engine and catalogue on mount using the same process pool.
  await expect(page.locator('#level-two .engine-status')).toHaveText('Moteur connecté');
  await page.getByRole('button', { name: experiment, exact: true }).click();
  await page.waitForLoadState('networkidle');
  const panel = page.getByRole('region', { name: experiment, exact: true });
  await expect(panel).toBeVisible();
  await cell(panel, 'C11').click();
  return panel;
}

function requestWithC11({ initial, growth, capacity }: Parameters): RunRequest {
  const request = structuredClone(fixture);
  request.model.components.find(atom => atom.id === 'C11-N')!.parameters.X = initial;
  request.model.components.find(atom => atom.id === 'C11-r')!.parameters.value = growth;
  request.model.components.find(atom => atom.id === 'C11-sum')!.parameters['coeff-1'] = -1 / capacity;
  return request;
}

function waitForSimulation(page: Page) {
  return page.waitForResponse(response => isSimulation(response.request()));
}

async function acceptSimulation(response: Response, panel: Locator, expected: RunRequest) {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.request().postDataJSON()).toEqual(expected);
  const { runId, ...result } = await response.json() as RunResult & { runId: string };
  expect(runId).toEqual(expect.any(String));
  expect(result.simulation).toMatchObject({ start: 0, end: 20, finalTime: 20 });
  await expect(phase(panel)).toHaveText('Terminé');

  const runner = process.env.IRRITATOR_RUNNER;
  expect(runner, 'Définir IRRITATOR_RUNNER avec le même exécutable que le serveur API.').toBeTruthy();
  const native = spawnSync(runner!, [], {
    input: JSON.stringify(expected), encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  expect(native.error).toBeUndefined();
  expect(native.status, native.stderr).toBe(0);
  expect(result).toEqual(JSON.parse(native.stdout));
  return result;
}

async function execute(page: Page, panel: Locator, trigger: Locator, expected = fixture) {
  const pending = waitForSimulation(page);
  await trigger.click();
  return acceptSimulation(await pending, panel, expected);
}

async function editC11(panel: Locator, { initial, growth, capacity }: Parameters) {
  const form = details(panel);
  await field(form, 'initial').fill(String(initial));
  await field(form, 'growth').fill(String(growth).replace('.', ','));
  await field(form, 'capacity').fill(String(capacity));
}

function c11Samples(result: RunResult) {
  return result.observations.find(o => o.component === 'C11-N')!.samples;
}

function expectOtherCellsUnchanged(result: RunResult, baseline: RunResult) {
  expect(result.observations.filter(o => o.component !== 'C11-N')).toEqual(baseline.observations.filter(o => o.component !== 'C11-N'));
}

function expectOracle(result: RunResult, { initial, growth, capacity }: Parameters) {
  const samples = c11Samples(result);
  expect(samples[0]).toEqual({ time: 0, value: initial });
  for (const { time, value } of samples) {
    const exact = initial === 0 ? 0 : capacity / (1 + (capacity / initial - 1) * Math.exp(-growth * time));
    expect(Math.abs(value - exact), `C11 au mois ${time}`).toBeLessThanOrEqual(0.15 + 0.002 * Math.abs(exact));
  }
}

async function expectSimulatedParameters(panel: Locator, parameters: Parameters) {
  const simulated = details(panel).getByLabel('Paramètres simulés', { exact: true });
  await expect(simulated).toHaveAttribute('data-simulated-cell', 'C11');
  for (const [key, value] of Object.entries(parameters)) {
    await expect(simulated).toHaveAttribute(`data-${key}`, String(value));
  }
}

async function showC11At(panel: Locator, result: RunResult, month: number) {
  await slider(panel).fill(String(month));
  const samples = c11Samples(result);
  const native = samples.find(sample => Math.abs(sample.time - month) < 1e-9);
  if (native === undefined) expect(samples).toHaveLength(1);
  const point = native ?? samples[0]!;
  const tile = cell(panel, 'C11');
  await expect(tile).toHaveAttribute('data-biomass', String(point.value));
  await expect(tile).toHaveAttribute('data-observed-time', String(point.time));
  await expect(tile).toHaveAttribute('data-source', native ? 'native' : 'equilibrium');
}

test('la modification de C11 conserve les huit autres trajectoires et le retour rétablit la grille nominale', async ({ page }) => {
  const panel = await openExperiment(page);
  const baseline = await execute(page, panel, launch(panel));
  await showC11At(panel, baseline, 10);
  await expectSimulatedParameters(panel, nominal);

  const next = { initial: 120, growth: 0.42, capacity: 330 };
  await editC11(panel, next);
  const pendingCells = panel.locator('[data-pending-cells]');
  await expect(pendingCells).toContainText('Modifications non simulées : C11.');
  await expect(pendingCells).toContainText('La grille et les courbes montrent le dernier calcul.');
  await showC11At(panel, baseline, 10);
  await expect(cell(panel, 'C11')).toHaveAttribute('data-tone', 'above');
  await expectSimulatedParameters(panel, nominal);

  // Hold the request while checking the in-flight UI, then send it to the real API.
  const release = Promise.withResolvers<void>();
  await page.route(`**${runPath}`, async route => {
    await release.promise;
    await route.continue();
  }, { times: 1 });
  const pending = waitForSimulation(page);
  try {
    await apply(details(panel)).click();
    await expect(phase(panel)).toHaveText('En cours');
    await expect(chart(panel)).toHaveCount(0);
    await expect(panel.locator('[data-cell][data-biomass]')).toHaveCount(0);
  } finally {
    release.resolve();
  }
  const result = await acceptSimulation(await pending, panel, requestWithC11(next));
  await expect(pendingCells).toHaveCount(0);
  await expectSimulatedParameters(panel, next);
  expectOtherCellsUnchanged(result, baseline);
  expectOracle(result, next);
  expect(c11Samples(result)).toHaveLength(201);
  expect(c11Samples(result)).not.toEqual(c11Samples(baseline));
  await showC11At(panel, result, 0);
  await expect(cell(panel, 'C11')).toHaveAttribute('data-tone', 'low');
  await showC11At(panel, result, 20);

  await cell(panel, 'C02').click();
  await field(details(panel, 'C02'), 'initial').fill('175');
  await cell(panel, 'C11').click();
  const rerun = await execute(page, panel, launch(panel), requestWithC11(next));
  expect(rerun).toEqual(result);
  await expect(pendingCells).toHaveAttribute('data-pending-cells', 'C02');
  const restored = await execute(page, panel, panel.getByRole('button', { name: 'Restaurer les paramètres initiaux', exact: true }));
  expect(restored).toEqual(baseline);
  await expect(pendingCells).toHaveCount(0);
  await expectSimulatedParameters(panel, nominal);
  await showC11At(panel, restored, 0);
  await cell(panel, 'C02').click();
  await expect(field(details(panel, 'C02'), 'initial')).toHaveValue('150');
});

test('les entrées invalides ont des diagnostics liés et ne déclenchent aucune simulation', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (isSimulation(request)) requests++; });
  const panel = await openExperiment(page);
  const form = details(panel);
  for (const { values, errors } of [
    {
      values: { initial: '-1', growth: '0', capacity: '0' },
      errors: { initial: /positive ou nulle/, growth: /strictement positif/, capacity: /strictement positive/ },
    },
    {
      values: { initial: '', growth: 'Infinity', capacity: 'NaN' },
      errors: { initial: /Saisissez une valeur/, growth: /nombre fini/, capacity: /nombre fini/ },
    },
  ]) {
    for (const name of Object.keys(labels) as (keyof Parameters)[]) await field(form, name).fill(values[name]);
    await apply(form).click();
    await expect(form.getByRole('alert')).toBeVisible();
    for (const name of Object.keys(labels) as (keyof Parameters)[]) {
      const input = field(form, name);
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveAccessibleDescription(errors[name]);
    }
    await expect(phase(panel)).toHaveText('Non lancé');
  }
  expect(requests).toBe(0);
  await expect(panel.locator('[data-cell][data-biomass]')).toHaveCount(0);
});

test('C11 vide, à capacité ou au-dessus de K, avec récupération après un échec réseau', async ({ page, context }) => {
  const panel = await openExperiment(page);
  const baseline = await execute(page, panel, launch(panel));
  const growth = 0.20, capacity = 240;
  for (const initial of [0, capacity]) {
    const parameters = { initial, growth, capacity };
    await editC11(panel, parameters);
    const result = await execute(page, panel, apply(details(panel)), requestWithC11(parameters));
    expect(c11Samples(result)).toEqual([{ time: 0, value: initial }]);
    expectOtherCellsUnchanged(result, baseline);
    await expectSimulatedParameters(panel, parameters);
    await showC11At(panel, result, 20);
  }

  const aboveCapacity = { initial: 360, growth, capacity };
  await editC11(panel, aboveCapacity);
  await context.setOffline(true);
  try {
    await apply(details(panel)).click();
    await expect(phase(panel)).toHaveText('Erreur');
    await expect(panel.getByRole('alert').filter({ hasText: 'ENGINE_UNAVAILABLE' })).toBeVisible();
    await expect(chart(panel)).toHaveCount(0);
    await expect(panel.locator('[data-cell][data-biomass]')).toHaveCount(0);
    await expect(slider(panel)).toBeDisabled();
    await expect(field(details(panel), 'initial')).toHaveValue('360');
  } finally {
    await context.setOffline(false);
  }

  const result = await execute(page, panel, apply(details(panel)), requestWithC11(aboveCapacity));
  expectOtherCellsUnchanged(result, baseline);
  expectOracle(result, aboveCapacity);
  expect(c11Samples(result)).toHaveLength(201);
  const final = c11Samples(result).at(-1)!;
  expect(final.time).toBe(20);
  expect(final.value).toBeGreaterThan(capacity);
  expect(final.value).toBeLessThan(aboveCapacity.initial);
  await expectSimulatedParameters(panel, aboveCapacity);
  await showC11At(panel, result, 20);
  await expect(panel.getByRole('alert').filter({ hasText: 'ENGINE_UNAVAILABLE' })).toHaveCount(0);
});
