import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { RunRequest, RunResult } from '@contracts';

const experiment = 'Expérience logistique spatiale';
const fixture: RunRequest = JSON.parse(readFileSync(new URL('../../../../examples/logistic-nine-cells-v1.json', import.meta.url), 'utf8'));
const evidence = process.env.IRRITATOR_LOGISTIC_BROWSER_EVIDENCE;
const formatBiomass = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
const isSimulation = (request: { method(): string; url(): string }) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/simulations/run';

async function openExperiment(page: Page) {
  await page.goto('/');
  const levelOne = page.getByRole('button', { name: 'Niveau 1 — Atelier actuel', exact: true });
  await expect(levelOne).toBeVisible();
  await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click();
  await page.getByRole('button', { name: experiment, exact: true }).click();
  const panel = page.getByRole('region', { name: experiment, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

async function execute(page: Page, panel: Locator) {
  const pending = page.waitForResponse(response => isSimulation(response.request()));
  await panel.getByRole('button', { name: 'Lancer la simulation', exact: true }).click();
  const response = await pending;
  expect(response.status(), await response.text()).toBe(200);
  expect(response.request().postDataJSON()).toEqual(fixture);
  const { runId, ...result } = await response.json() as RunResult & { runId: string };
  expect(typeof runId).toBe('string');
  expect(result.simulation).toMatchObject({ start: 0, end: 20, finalTime: 20 });
  expect(result.simulation.runCalls).toBeGreaterThan(0);
  expect(result.observations.map(({ component }) => component)).toEqual(fixture.model.observations.map(o => o.component));
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible();
  return result;
}

function compareNative(result: RunResult) {
  const runner = process.env.IRRITATOR_RUNNER;
  expect(runner, 'Définir IRRITATOR_RUNNER avec le même exécutable que le serveur API.').toBeTruthy();
  const native = spawnSync(runner!, [], {
    input: JSON.stringify(fixture), encoding: 'utf8', timeout: 30000, windowsHide: true,
  });
  expect(native.error).toBeUndefined();
  expect(native.status, native.stderr).toBe(0);
  expect(result).toEqual(JSON.parse(native.stdout));
}

const slider = (panel: Locator) => panel.getByRole('slider', { name: 'Temps simulé', exact: true });
const chart = (panel: Locator) => panel.getByLabel('Trajectoires logistiques', { exact: true });
const cell = (panel: Locator, id: string) => panel.getByRole('button', { name: id, exact: true });

function expectedAt(result: RunResult, id: string, month: number) {
  const { samples } = result.observations.find(({ component }) => component === `${id}-N`)!;
  const sample = samples.find(point => Math.abs(point.time - month) < 1e-9);
  if (sample) return sample;
  expect(samples, `${id} : observation native au mois ${month} ou équilibre dédupliqué`).toHaveLength(1);
  return samples[0]!;
}

async function expectPlottedSeries(panel: Locator, result: RunResult, ids: string[], month: number) {
  const expected = ids.map(id => {
    const { samples } = result.observations.find(({ component }) => component === `${id}-N`)!;
    const points = samples.length === 1 ? [...samples, { time: result.simulation.end, value: samples[0]!.value }] : samples;
    return {
      id, x: points.map(sample => sample.time), y: points.map(sample => sample.value),
      value: expectedAt(result, id, month).value,
    };
  });
  await expect(chart(panel)).toHaveAttribute('data-series', ids.join(','));
  const plot = chart(panel).locator('.js-plotly-plot');
  await expect(plot).toBeVisible();
  await expect.poll(() => plot.evaluate((element, { traces, time }) => {
    const state = element as HTMLElement & {
      data?: { name?: string; mode?: string; x?: number[]; y?: number[] }[];
      layout?: { shapes?: { x0?: number; x1?: number }[] };
    };
    const actual = state.data ?? [];
    const sameTime = (value?: number) => value !== undefined && Math.abs(value - time) < 1e-9;
    return actual.length === 2 * traces.length && state.layout?.shapes?.some(shape => sameTime(shape.x0) && sameTime(shape.x1)) &&
      traces.every(({ id, x, y, value }) => {
        const line = actual.find(trace => trace.name === id && trace.mode === 'lines');
        const marker = actual.find(trace => trace.name === id && trace.mode === 'markers');
        return line?.x?.length === x.length && line?.y?.length === y.length &&
          x.every((t, index) => t === line.x?.[index] && y[index] === line.y?.[index]) &&
          marker?.x?.length === 1 && sameTime(marker.x[0]) && marker.y?.length === 1 && marker.y[0] === value;
      });
  }, { traces: expected, time: month })).toBe(true);
}

async function showMonth(panel: Locator, result: RunResult, month: number) {
  const position = slider(panel);
  await position.fill(String(month));
  await expect.poll(async () => Number(await position.inputValue())).toBeCloseTo(month, 9);
  await expect.poll(async () => Number(await chart(panel).getAttribute('data-time') ?? NaN)).toBeCloseTo(month, 9);
  const expected = result.observations.map(({ component }) => {
    const id = component.slice(0, -2);
    const point = expectedAt(result, id, month);
    return { id, value: point.value, observedTime: point.time, reading: `${formatBiomass.format(point.value)} t` };
  });
  await expect.poll(() => panel.locator('[data-cell]').evaluateAll(elements => elements.map(element => ({
    id: element.getAttribute('data-cell'),
    value: Number(element.getAttribute('data-biomass') ?? NaN),
    observedTime: Number(element.getAttribute('data-observed-time') ?? NaN),
    reading: document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent?.trim(),
  })))).toEqual(expected);
}

async function saveFrame(panel: Locator, name: string) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await panel.screenshot({ path: path.join(evidence, name), animations: 'disabled' });
}

test('la grille présente les neuf séries du moteur natif avec leur provenance', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const panel = await openExperiment(page);
  await expect(panel.getByText('Non lancé', { exact: true })).toBeVisible();
  await expect(panel.getByText(/grille fictive.*synthétiques/)).toBeVisible();
  await expect(panel.locator('[data-cell][data-biomass]')).toHaveCount(0);

  const result = await execute(page, panel);
  compareNative(result);
  await expect(slider(panel)).toHaveAttribute('min', '0');
  await expect(slider(panel)).toHaveAttribute('max', '20');
  await expect(slider(panel)).toHaveAttribute('step', '0.1');

  await showMonth(panel, result, 0);
  await expect(cell(panel, 'C02')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByText('Rapport B/K', { exact: true })).toBeVisible();
  await expect(cell(panel, 'C00')).toHaveAttribute('data-tone', 'zero');
  await expect(cell(panel, 'C10')).toHaveAttribute('data-tone', 'capacity');
  await expect(cell(panel, 'C11')).toHaveAttribute('data-tone', 'above');
  for (const { component } of result.observations) {
    const id = component.slice(0, -2);
    await cell(panel, id).click();
    await expect(cell(panel, id)).toHaveAttribute('aria-pressed', 'true');
    await expectPlottedSeries(panel, result, [id], 0);
  }
  await cell(panel, 'C02').click();
  await expectPlottedSeries(panel, result, ['C02'], 0);
  await saveFrame(panel, '01-grille-t0.png');
  await cell(panel, 'C11').click();
  await expect(cell(panel, 'C11')).toHaveAttribute('aria-pressed', 'true');
  const details = panel.getByRole('region', { name: 'Paramètres de C11', exact: true });
  await expect(details).toBeVisible();
  for (const parameter of ['380', '300', '0,35']) await expect(details).toContainText(parameter);
  await panel.getByRole('checkbox', { name: 'Comparer C21', exact: true }).check();

  await showMonth(panel, result, 10);
  await expectPlottedSeries(panel, result, ['C11', 'C21'], 10);
  for (const id of ['C11', 'C21']) {
    const row = panel.locator(`[data-series-cell="${id}"]`);
    await expect(row).toHaveAttribute('data-biomass', String(expectedAt(result, id, 10).value));
  }
  for (const [id, biomass] of [['C00', '0'], ['C10', '300']] as const) {
    const equilibrium = cell(panel, id);
    await expect(equilibrium).toHaveAttribute('data-source', 'equilibrium');
    await expect(equilibrium).toHaveAttribute('data-biomass', biomass);
    await expect(equilibrium).toHaveAttribute('data-observed-time', '0');
    await expect(equilibrium.getByText('Équilibre', { exact: true })).toBeVisible();
  }
  await saveFrame(panel, '02-grille-t10.png');

  await showMonth(panel, result, 15.1);
  const valueBeforeOscillation = expectedAt(result, 'C21', 15.1).value;
  await showMonth(panel, result, 15.3);
  expect(expectedAt(result, 'C21', 15.3).value).toBeLessThan(valueBeforeOscillation);
  await expect(cell(panel, 'C21')).toHaveAttribute('data-source', 'native');
  await expect(panel.locator('[data-series-cell="C21"]')).toHaveAttribute('data-biomass', String(expectedAt(result, 'C21', 15.3).value));

  await showMonth(panel, result, 20);
  await panel.getByRole('checkbox', { name: 'Comparer C00', exact: true }).check();
  await expectPlottedSeries(panel, result, ['C00', 'C11', 'C21'], 20);
  await saveFrame(panel, '03-grille-t20.png');
  expect(errors).toEqual([]);
});

test('une coupure réseau retire les résultats précédents et permet une nouvelle simulation', async ({ page, context }) => {
  const panel = await openExperiment(page);
  const result = await execute(page, panel);
  await showMonth(panel, result, 20);

  await context.setOffline(true);
  try {
    await panel.getByRole('button', { name: 'Lancer la simulation', exact: true }).click();
    await expect(panel.getByRole('status')).toHaveText('Erreur');
    await expect(panel.getByRole('alert')).toContainText('ENGINE_UNAVAILABLE');
    await expect(panel.locator('[data-cell][data-biomass]')).toHaveCount(0);
    await expect(chart(panel)).toHaveCount(0);
    await expect(slider(panel)).toBeDisabled();
  } finally {
    await context.setOffline(false);
  }

  const recovered = await execute(page, panel);
  expect(recovered).toEqual(result);
  await showMonth(panel, recovered, 0);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('le curseur et la lecture restent synchronisés jusqu’à la fin et après une relance', async ({ page }) => {
  let nativeRequests = 0;
  page.on('request', request => { if (isSimulation(request)) nativeRequests++; });
  const panel = await openExperiment(page);
  const result = await execute(page, panel);
  const position = slider(panel);
  const play = panel.getByRole('button', { name: /^(Lire|Reprendre)$/ });
  const pause = panel.getByRole('button', { name: 'Pause', exact: true });
  const reset = panel.getByRole('button', { name: 'Remettre au début', exact: true });

  await showMonth(panel, result, 10);
  await play.click();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(10);
  await pause.click();
  const pausedAt = await position.inputValue();
  await expect(panel.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await chart(panel).getAttribute('data-time') ?? NaN)).toBeCloseTo(Number(pausedAt), 9);
  // Laisser passer plusieurs ticks de lecture afin d’observer que la pause tient.
  await page.waitForTimeout(250);
  await expect(position).toHaveValue(pausedAt);

  await showMonth(panel, result, 19.8);
  await play.click();
  await expect(position).toHaveValue('20');
  await expect(pause).toHaveCount(0);
  await expect(chart(panel)).toHaveAttribute('data-time', '20');
  await panel.getByRole('button', { name: 'Lire', exact: true }).click();
  await expect.poll(async () => Number(await position.inputValue())).toBeLessThan(5);
  await pause.click();
  await reset.click();
  await expect(position).toHaveValue('0');
  await expect(chart(panel)).toHaveAttribute('data-time', '0');
  await expect(cell(panel, 'C11')).toHaveAttribute('data-biomass', '380');
  expect(nativeRequests).toBe(1);

  await showMonth(panel, result, 20);
  const rerun = await execute(page, panel);
  expect(rerun).toEqual(result);
  await expect(position).toHaveValue('0');
  await expect(cell(panel, 'C11')).toHaveAttribute('data-biomass', '380');
  expect(nativeRequests).toBe(2);
  await play.click();
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Niveau 1 — Atelier actuel', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Exécuter la simulation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reprendre', exact: true })).toBeVisible();
  const restoredTime = await position.inputValue();
  expect(Number(restoredTime)).toBeGreaterThan(0);
  await expectPlottedSeries(panel, rerun, ['C02'], Number(restoredTime));
  expect(nativeRequests).toBe(2);
});
