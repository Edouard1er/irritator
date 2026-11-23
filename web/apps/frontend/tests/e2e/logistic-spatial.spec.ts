import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { RunRequest, RunResult } from '@contracts';

const experiment = 'Expérience logistique spatiale';
const fixture: RunRequest = JSON.parse(readFileSync(new URL('../../../../examples/logistic-nine-cells-v1.json', import.meta.url), 'utf8'));
const evidence = process.env.IRRITATOR_LOGISTIC_BROWSER_EVIDENCE;
const refinementEvidence = process.env.IRRITATOR_LAKE_REFINEMENT_EVIDENCE;
const heterogeneityEvidence = process.env.IRRITATOR_LAKE_GRADIENT_EVIDENCE;
const formatBiomass = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
const isSimulation = (request: { method(): string; url(): string }) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/simulations/run';

async function openExperiment(page: Page) {
  await page.goto('/');
  const levelOne = page.getByRole('button', { name: 'Niveau 1 — Atelier actuel', exact: true });
  await expect(levelOne).toBeVisible();
  // Stage the editors' startup handshakes on the shared native process pool.
  await expect(page.getByRole('button', { name: 'Moteur connecté' })).toBeVisible();
  await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click();
  await expect(page.locator('#level-two .engine-status')).toHaveText('Moteur connecté');
  await page.getByRole('button', { name: experiment, exact: true }).click();
  const panel = page.getByRole('region', { name: experiment, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

async function executeRequest(page: Page, panel: Locator, trigger = panel.getByRole('button', { name: 'Lancer la simulation', exact: true })) {
  const pending = page.waitForResponse(response => isSimulation(response.request()));
  await trigger.click();
  const response = await pending;
  expect(response.status(), await response.text()).toBe(200);
  const request = response.request().postDataJSON() as RunRequest;
  const { runId, ...result } = await response.json() as RunResult & { runId: string };
  expect(typeof runId).toBe('string');
  expect(result.simulation).toMatchObject({ start: 0, end: 20, finalTime: 20 });
  expect(result.simulation.runCalls).toBeGreaterThan(0);
  expect(result.observations.map(({ component }) => component)).toEqual(request.model.observations.map(o => o.component));
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible();
  return { request, result };
}

async function execute(page: Page, panel: Locator) {
  const { request, result } = await executeRequest(page, panel);
  expect(request).toEqual(fixture);
  return result;
}

function compareNative(result: RunResult, request = fixture) {
  const runner = process.env.IRRITATOR_RUNNER;
  expect(runner, 'Définir IRRITATOR_RUNNER avec le même exécutable que le serveur API.').toBeTruthy();
  const native = spawnSync(runner!, [], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 30000, windowsHide: true,
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

test('les grilles 2 × 2, 3 × 3 et 4 × 4 conservent les paramètres communs et demandent un nouveau calcul natif', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (isSimulation(request)) requests.push(request.url()); });
  const panel = await openExperiment(page);
  await page.waitForLoadState('networkidle');
  const dimensions = panel.getByRole('combobox', { name: 'Dimensions de la grille', exact: true });
  const details = (id: string) => panel.getByRole('region', { name: `Paramètres de ${id}`, exact: true });
  const initial = (id: string) => details(id).getByLabel('Biomasse initiale N₀ (t)', { exact: true });
  const growth = (id: string) => details(id).getByLabel('Taux de croissance r (mois⁻¹)', { exact: true });
  const capacity = (id: string) => details(id).getByLabel('Capacité K (t)', { exact: true });
  const compare = (id: string) => panel.getByRole('checkbox', { name: `Comparer ${id}`, exact: true });

  async function expectGrid(size: number) {
    const ids = Array.from({ length: size * size }, (_, index) => `C${Math.floor(index / size)}${index % size}`);
    const tiles = panel.locator('[data-cell]');
    await expect.poll(() => tiles.evaluateAll(elements => elements.map(element => element.getAttribute('data-cell')))).toEqual(ids);
    await expect.poll(() => tiles.first().evaluate(element => getComputedStyle(element.parentElement!).gridTemplateColumns.split(' ').length)).toBe(size);
    return ids;
  }

  async function resize(size: number) {
    const count = requests.length;
    await dimensions.selectOption(String(size));
    const ids = await expectGrid(size);
    await expect(panel.getByText('Non lancé', { exact: true })).toBeVisible();
    await expect(panel.locator('[data-cell][data-biomass]')).toHaveCount(0);
    await expect(chart(panel)).toHaveCount(0);
    await expect(panel.getByLabel('Paramètres simulés', { exact: true })).toHaveCount(0);
    await expect(slider(panel)).toBeDisabled();
    await expect(slider(panel)).toHaveValue('0');
    await expect(panel.getByRole('button', { name: 'Lire', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Remettre au début', exact: true })).toBeDisabled();
    expect(requests).toHaveLength(count);
    return ids;
  }

  async function checkRun(ids: string[], modelId: string) {
    const { request, result } = await executeRequest(page, panel);
    expect(request.model.id).toBe(modelId);
    expect(request.model.components).toHaveLength(ids.length * 7);
    expect(request.model.connections).toHaveLength(ids.length * 9);
    expect(request.model.observations.map(({ component }) => component)).toEqual(ids.map(id => `${id}-N`));
    expect(request.model.components.find(atom => atom.id === 'C11-N')?.parameters.X).toBe(120);
    expect(request.model.components.find(atom => atom.id === 'C11-r')?.parameters.value).toBe(0.42);
    expect(request.model.components.find(atom => atom.id === 'C11-sum')?.parameters['coeff-1']).toBe(-1 / 330);
    expect(request.model.components.find(atom => atom.id === 'C01-r')?.parameters.value).toBe(0.35);
    compareNative(result, request);
    await expect(slider(panel)).toBeEnabled();
    await showMonth(panel, result, 0);
    await showMonth(panel, result, 20);
    return result;
  }

  await expect(dimensions).toHaveValue('3');
  const nineIds = await expectGrid(3);
  await cell(panel, 'C11').click();
  await initial('C11').fill('120');
  await growth('C11').fill('0,42');
  await capacity('C11').fill('330');
  const { result: nine } = await executeRequest(page, panel, details('C11').getByRole('button', { name: 'Appliquer et simuler', exact: true }));
  await showMonth(panel, nine, 20);
  await cell(panel, 'C01').click();
  await growth('C01').fill('0,4');
  await cell(panel, 'C11').click();
  await compare('C01').check();

  const sixteenIds = await resize(4);
  await expect(cell(panel, 'C11')).toHaveAttribute('aria-pressed', 'true');
  await expect(compare('C01')).toBeChecked();
  await cell(panel, 'C33').click();
  await expect(initial('C33')).toHaveValue('270');
  await expect(growth('C33')).toHaveValue('0.35');
  await expect(capacity('C33')).toHaveValue('300');
  await compare('C23').check();
  const sixteen = await checkRun(sixteenIds, 'logistic-sixteen-cells');
  expect(sixteen.observations.filter(({ component }) => nineIds.includes(component.slice(0, -2)))).toEqual(nine.observations);
  await expectPlottedSeries(panel, sixteen, ['C01', 'C23', 'C33'], 20);

  const fourIds = await resize(2);
  await expect(cell(panel, 'C00')).toHaveAttribute('aria-pressed', 'true');
  await expect(compare('C23')).toHaveCount(0);
  await expect(compare('C01')).toBeChecked();
  await cell(panel, 'C01').click();
  await expect(growth('C01')).toHaveValue('0,4');
  await expect(panel.locator('[data-pending-cells]')).toHaveAttribute('data-pending-cells', 'C01');
  await cell(panel, 'C11').click();
  await expect(initial('C11')).toHaveValue('120');
  await expect(growth('C11')).toHaveValue('0.42');
  await expect(capacity('C11')).toHaveValue('330');
  const four = await checkRun(fourIds, 'logistic-four-cells');
  expect(four.observations).toEqual(nine.observations.filter(({ component }) => fourIds.includes(component.slice(0, -2))));
  await expectPlottedSeries(panel, four, ['C01', 'C11'], 20);

  expect(await resize(3)).toEqual(nineIds);
  await expect(cell(panel, 'C11')).toHaveAttribute('aria-pressed', 'true');
  const restored = await checkRun(nineIds, fixture.model.id);
  expect(restored).toEqual(nine);
  await expectPlottedSeries(panel, restored, ['C01', 'C11'], 20);
  expect(requests).toHaveLength(4);
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

test('le domaine constant présente les observations locales et les trois sommes natives', async ({ page }) => {
  const panel = await openExperiment(page);
  await page.waitForLoadState('networkidle');
  const mode = panel.getByRole('combobox', { name: 'Mode de l’expérience' });
  await expect(mode).toHaveValue('independent');
  await mode.selectOption('constant');
  const dimensions = panel.getByRole('combobox', { name: 'Dimensions de la grille' });
  await expect(dimensions).toHaveValue('3');
  await expect(panel.getByRole('textbox')).toHaveCount(0);

  const sizes = [2, 3, 4] as const;
  const responses = sizes.map(size => page.waitForResponse(response => isSimulation(response.request()) &&
    response.request().postDataJSON().model.id === `logistic-constant-domain-${size}x${size}`));
  await panel.getByRole('button', { name: 'Simuler les trois grilles', exact: true }).click();
  const results = await Promise.all(responses.map(async (pending, index) => {
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
    const size = sizes[index]!;
    const request = response.request().postDataJSON() as RunRequest;
    const { runId, ...result } = await response.json() as RunResult & { runId: string };
    expect(runId).toBeTruthy();
    expect(request.model.observations).toHaveLength(size ** 2);
    expect(request.simulation).toEqual({ start: 0, end: 20 });
    expect(request.model.components.find(atom => atom.id === 'C00-N')?.parameters)
      .toEqual({ X: 1350 / size ** 2, dQ: 0.01 });
    compareNative(result, request);
    const sums = result.observations[0]!.samples.map((_, tick) =>
      result.observations.reduce((total, observation) => total + observation.samples[tick]!.value, 0));
    expect(sums).toHaveLength(201);
    expect(sums[0]).toBe(1350);
    return { size, result, sums, name: `${size} × ${size}` };
  }));
  await expect(panel.getByRole('status')).toHaveText('Terminé');
  await expect(slider(panel)).toHaveValue('0');
  await expect(panel.locator('[data-total-biomass]')).toHaveAttribute('data-total-biomass', '1350');

  const aggregate = panel.getByLabel('Trajectoires de biomasse totale');
  const plot = aggregate.locator('.js-plotly-plot');
  await expect(plot).toBeVisible();
  await expect(aggregate).toBeInViewport();
  await expect(aggregate).toHaveAttribute('data-series', '2 × 2,3 × 3,4 × 4');
  const metrics = panel.getByLabel('Domaine de la grille');
  await expect(metrics).toContainText('9 km²');
  await expect(metrics).toContainText(formatBiomass.format(2700) + ' t');

  for (const time of [10, 20]) {
    const tick = time * 10;
    await slider(panel).fill(String(time));
    for (const { size, result, sums } of results) {
      await dimensions.selectOption(String(size));
      await expect(slider(panel)).toHaveValue(String(time));
      await expect(panel.locator('[data-cell]')).toHaveCount(size ** 2);
      await expect(metrics.getByText(formatBiomass.format(9 / size ** 2) + ' km²', { exact: true })).toBeVisible();
      for (const { component, samples } of result.observations) {
        await expect(cell(panel, component.slice(0, -2))).toHaveAttribute('data-biomass', String(samples[tick]!.value));
      }
      await expect(panel.locator('[data-total-biomass]')).toHaveAttribute('data-total-biomass', String(sums[tick]));
      await expect(panel.locator(`[data-total-grid="${size}"]`)).toHaveAttribute('data-biomass', String(sums[tick]));
    }
    await expect.poll(() => plot.evaluate((element, { grids, current }) => {
      type Trace = { name: string; mode: string; x: number[]; y: number[]; line?: { dash: string } };
      const traces = (element as HTMLElement & { data?: Trace[] }).data ?? [];
      const lines = traces.filter(trace => trace.mode === 'lines');
      return traces.length === 6 && new Set(lines.map(line => line.line?.dash)).size === 3 && grids.every(({ name, sums }) => {
        const line = lines.find(trace => trace.name === name);
        const marker = traces.find(trace => trace.name === name && trace.mode === 'markers');
        return line?.x.length === sums.length && line.y.length === sums.length &&
          sums.every((value, tick) => Math.abs(line.x[tick]! - tick / 10) < 1e-9 && line.y[tick] === value) &&
          marker?.x[0] === current && marker.y[0] === sums[current * 10];
      });
    }, { grids: results.map(({ name, sums }) => ({ name, sums })), current: time })).toBe(true);
  }

  await mode.selectOption('independent');
  await expect(dimensions).toHaveValue('3');
  await expect(panel.getByText('Non lancé', { exact: true })).toBeVisible();
  await expect(aggregate).toHaveCount(0);
  await mode.selectOption('constant');
  await expect(dimensions).toHaveValue('4');
  await expect(slider(panel)).toHaveValue('20');
  await expect(plot).toBeVisible();
  await saveFrame(panel, '04-domaine-constant-t20.png');
});

test('la silhouette découpe les cellules et rejoue les trajectoires du runner', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1240 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await openExperiment(page);
  const mode = panel.getByRole('combobox', { name: 'Mode de l’expérience' });
  await mode.selectOption('lake');
  const grid = panel.getByRole('group', { name: 'Grille humide du lac de Guiers' });
  await expect(grid).toHaveAttribute('data-rows', '6');
  await expect(grid).toHaveAttribute('data-columns', '3');
  await expect(grid.getByRole('button')).toHaveCount(13);
  for (const id of ['C00', 'C22', 'C32', 'C41', 'C42']) await expect(cell(panel, id)).toHaveCount(0);

  const source = JSON.parse(readFileSync(new URL('../../data/geography/lac-de-guiers.hydrolakes.geojson', import.meta.url), 'utf8'));
  const rings = source.features[0].geometry.coordinates as [number, number][][];
  const west = Math.min(...rings[0]!.map(([x]) => x));
  const south = Math.min(...rings[0]!.map(([, y]) => y));
  const north = Math.max(...rings[0]!.map(([, y]) => y));
  const aspect = Math.cos((north + south) / 2 * Math.PI / 180);
  const projected = rings.map(ring => ring.slice(0, -1).map(([x, y]) => [(x - west) * aspect / (north - south), (north - y) / (north - south)]));
  const outline = grid.locator('clipPath path');
  await expect(outline).toHaveAttribute('clip-rule', 'evenodd');
  const pathRings = (await outline.getAttribute('d'))!.split('Z').filter(Boolean).map(part =>
    part.slice(1).split('L').map(vertex => vertex.split(',').map(Number)));
  expect(pathRings.map(ring => ring.length)).toEqual(projected.map(ring => ring.length));
  expect(pathRings.every((ring, r) => ring.every((vertex, i) => vertex.every((coord, axis) =>
    Math.abs(coord - projected[r]![i]![axis]!) < 1e-12)))).toBe(true);

  // Probe the SVG hit map on a wet case at water, shore and island positions.
  await grid.scrollIntoViewIfNeeded();
  const points = await grid.evaluate((element, rings) => {
    const svg = element as SVGSVGElement;
    const target = svg.querySelector<SVGRectElement>('[data-cell="C30"]')!;
    const { x, y, width, height } = target.getBBox();
    const transform = svg.getScreenCTM()!;
    const contains = (ring: number[][], px: number, py: number) => ring.reduce((inside, point, i) => {
      const [ax, ay] = point as [number, number];
      const [bx, by] = ring[(i + 1) % ring.length] as [number, number];
      return (ay > py) !== (by > py) && px < ax + (py - ay) * (bx - ax) / (by - ay) ? !inside : inside;
    }, false);
    const probes: Record<string, { x: number; y: number; hit: string | null }> = {};
    for (let row = 1; row < 64; row++) for (let column = 1; column < 64; column++) {
      const px = x + width * column / 64;
      const py = y + height * row / 64;
      const kind = !contains(rings[0]!, px, py) ? 'shore'
        : rings.slice(1).some(ring => contains(ring, px, py)) ? 'island' : 'water';
      if (probes[kind]) continue;
      const screen = new DOMPoint(px, py).matrixTransform(transform);
      const hit = document.elementFromPoint(screen.x, screen.y)?.closest('[data-cell]')?.getAttribute('data-cell') ?? null;
      // Skip points where the antialiased boundary can affect hit testing.
      if (![[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) => {
        const adjacent = new DOMPoint(screen.x + dx!, screen.y + dy!).matrixTransform(transform.inverse());
        const side = !contains(rings[0]!, adjacent.x, adjacent.y) ? 'shore'
          : rings.slice(1).some(ring => contains(ring, adjacent.x, adjacent.y)) ? 'island' : 'water';
        return side === kind;
      })) continue;
      probes[kind] = { x: screen.x, y: screen.y, hit };
    }
    return probes;
  }, projected);
  expect(points.water?.hit).toBe('C30');
  expect(points.shore?.hit).toBeNull();
  expect(points.island?.hit).toBeNull();
  await page.mouse.click(points.water!.x, points.water!.y);
  await expect(cell(panel, 'C30')).toHaveAttribute('aria-pressed', 'true');
  await cell(panel, 'C11').press('Enter');
  await expect(cell(panel, 'C11')).toHaveAttribute('aria-pressed', 'true');
  const details = panel.getByRole('region', { name: 'Paramètres de C11', exact: true });
  await expect(details).toContainText('Fraction humide');
  await expect(details).toContainText('65,066');
  await expect(details).toContainText('Surface humide');
  await expect(details).toContainText('Biomasse initiale');
  await expect(details).toContainText('0,35 mois⁻¹');
  await expect(details).toContainText('Capacité de charge');

  const { request, result } = await executeRequest(page, panel);
  compareNative(result, request);
  const ids = result.observations.map(({ component }) => component.slice(0, -2));
  expect(ids).toHaveLength(13);
  const renderedIds = await grid.getByRole('button').evaluateAll(elements => elements.map(element => element.getAttribute('data-cell')));
  expect(renderedIds).toEqual(ids);
  expect(request.model.components).toHaveLength(91);
  await panel.getByRole('checkbox', { name: 'Comparer C20', exact: true }).check();
  const fills = [];
  const frames = process.env.IRRITATOR_LAKE_BROWSER_EVIDENCE;
  if (frames) await mkdir(frames, { recursive: true });
  for (const time of [0, 10, 20]) {
    await slider(panel).fill(String(time));
    await expect(grid).toHaveAttribute('data-time', String(time));
    let sum = 0;
    for (const id of ids) {
      const point = expectedAt(result, id, time);
      sum += point.value;
      await expect(cell(panel, id)).toHaveAttribute('data-biomass', String(point.value));
    }
    await expect(panel.locator('[data-total-biomass]')).toHaveAttribute('data-total-biomass', String(sum));
    await expectPlottedSeries(panel, result, ['C11', 'C20'], time);
    fills.push(await cell(panel, 'C11').evaluate(element => getComputedStyle(element).fill));
    if (frames) await panel.screenshot({ path: path.join(frames, `grille-t${time}.png`), animations: 'disabled' });
  }
  expect(new Set(fills).size).toBe(3);

  await slider(panel).fill('19.8');
  await panel.getByRole('button', { name: 'Lire', exact: true }).click();
  await expect(grid).toHaveAttribute('data-time', '20');
  await mode.selectOption('constant');
  await expect(panel.getByRole('button', { name: 'Simuler les trois grilles' })).toBeVisible();
  await mode.selectOption('independent');
  await expect(panel.getByRole('combobox', { name: 'Dimensions de la grille' })).toHaveValue('3');
  await mode.selectOption('lake');
  await expect(grid).toHaveAttribute('data-time', '20');
  await expect(cell(panel, 'C11')).toHaveAttribute('aria-pressed', 'true');
  await expectPlottedSeries(panel, result, ['C11', 'C20'], 20);
});

test('le contour peut être rechargé après une erreur sans affecter les autres modes', async ({ page }) => {
  const contour = '**/api/logistic-lake?*';
  await page.route(contour, route => route.fulfill({ status: 503 }));
  const panel = await openExperiment(page);
  const mode = panel.getByRole('combobox', { name: 'Mode de l’expérience' });
  await mode.selectOption('lake');
  await expect(panel.getByRole('alert')).toContainText('Chargement du contour impossible');
  await mode.selectOption('independent');
  await expect(panel.getByRole('combobox', { name: 'Dimensions de la grille' })).toHaveValue('3');
  await mode.selectOption('lake');
  await page.unroute(contour);
  await panel.getByRole('button', { name: 'Recharger le contour' }).click();
  await expect(panel.getByRole('group', { name: 'Grille humide du lac de Guiers' }).getByRole('button')).toHaveCount(13);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('les six résolutions utilisent leurs lots natifs et publient la trace complète', async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 1600 });
  const panel = await openExperiment(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  const resolution = panel.getByRole('combobox', { name: 'Résolution du lac' });
  const grid = panel.getByRole('group', { name: 'Grille humide du lac de Guiers' });
  const responses: Response[] = [];
  page.on('response', response => {
    if (isSimulation(response.request())) responses.push(response);
  });
  if (refinementEvidence) await mkdir(refinementEvidence, { recursive: true });

  for (const [size, wetCells, batchCount] of [
    ['6x3', 13, 1], ['12x6', 35, 2], ['18x9', 65, 4], ['24x12', 101, 6], ['36x18', 184, 11], ['48x24', 296, 17],
  ] as const) {
    await resolution.selectOption(size);
    await expect(grid.getByRole('button')).toHaveCount(wetCells);
    await expect(panel.getByLabel('Domaine de la grille')).toContainText('300 km²');
    const offset = responses.length;
    await panel.getByRole('button', { name: 'Lancer la simulation', exact: true }).click();
    const outcome = panel.locator('[data-phase="completed"], [data-phase="error"]');
    await expect(outcome).toBeVisible({ timeout: 60000 });
    expect(await outcome.getAttribute('data-phase'), (await panel.getByRole('alert').allTextContents()).join('\n')).toBe('completed');
    const batches = [];
    for (const response of responses.slice(offset)) {
      if (response.status() === 503) {
        expect((await response.json()).error.code).toBe('ENGINE_BUSY');
        continue;
      }
      expect(response.status()).toBe(200);
      const { runId, ...result } = await response.json() as RunResult & { runId: string };
      expect(runId).toBeTruthy();
      batches.push({ result, request: response.request().postDataJSON() as RunRequest });
    }
    expect(batches).toHaveLength(batchCount);
    const observedIds: string[] = [];
    let total = 0;
    for (const [index, { request, result }] of batches.entries()) {
      expect(request.model.id).toBe(`logistic-lake-${size}-proportional-${index + 1}`);
      expect(request.model.components.length).toBeLessThanOrEqual(128);
      expect(result.simulation.finalTime).toBe(20);
      expect(result.simulation.runCalls).toBeGreaterThan(0);
      for (const { component, samples } of result.observations) {
        expect(samples).toHaveLength(201);
        observedIds.push(component.slice(0, -2));
        total += samples[100]!.value;
      }
    }
    expect(await grid.getByRole('button').evaluateAll(elements => elements.map(element => element.getAttribute('data-cell')))).toEqual(observedIds);
    await slider(panel).fill('10');
    await expect(panel.locator('[data-total-biomass]')).toHaveAttribute('data-total-biomass', String(total));
    await expect.poll(() => chart(panel).locator('.js-plotly-plot').evaluate(element =>
      (element as HTMLElement & { data?: { x: number[] }[] }).data?.[0]?.x.length)).toBe(201);
    if (refinementEvidence) await panel.screenshot({ path: path.join(refinementEvidence, `grille-${size}.png`), animations: 'disabled' });
  }

  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Télécharger la trace JSON' }).click();
  const download = await downloadPromise;
  const trace = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(trace).toMatchObject({ wetCells: 296, plannedBatches: 17, points: 296 * 201, parameters: { areaKm2: 300 } });
  expect(trace.resultBytes).toBeGreaterThan(3_000_000);
  expect(trace.batches.every((batch: { runId?: string }) => batch.runId)).toBe(true);
  expect(trace.aggregateErrors.maxRelative).toBeLessThan(2e-6);
});

test('les pleins écrans partagent instant, sélection et cadrage avec la grille', async ({ page }) => {
  const panel = await openExperiment(page);
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  await panel.getByRole('combobox', { name: 'Résolution du lac' }).selectOption('18x9');
  await panel.getByRole('button', { name: 'Lancer la simulation', exact: true }).click();
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible();
  const grid = panel.getByRole('group', { name: 'Grille humide du lac de Guiers' });
  const selected = await grid.locator('[aria-pressed="true"]').getAttribute('data-cell');
  await slider(panel).fill('10');
  const initialView = await grid.getAttribute('viewBox');
  const currentFullscreen = () => page.evaluate(() => document.fullscreenElement?.querySelector('button')?.getAttribute('aria-label'));
  const enter = async (name: string) => {
    await panel.getByRole('button', { name: `Plein écran · ${name}`, exact: true }).click();
    await expect.poll(currentFullscreen).toBe(`Quitter le plein écran · ${name}`);
  };
  const exit = async (name: string) => {
    await panel.getByRole('button', { name: `Quitter le plein écran · ${name}`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  };
  await enter('Carte du lac');
  const fullscreenTime = panel.getByRole('slider', { name: 'Temps en plein écran' });
  await expect(fullscreenTime).toHaveValue('10');
  await panel.getByRole('button', { name: 'Zoom avant', exact: true }).click();
  await expect(grid).toHaveAttribute('data-zoom', '1.5');
  const zoomedView = await grid.getAttribute('viewBox');
  const box = (await grid.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect(grid).not.toHaveAttribute('viewBox', zoomedView!);
  await expect(grid.locator('[aria-pressed="true"]')).toHaveAttribute('data-cell', selected!);
  await grid.press('ArrowDown');
  await panel.getByRole('button', { name: 'Zoom arrière', exact: true }).click();
  await expect(grid).toHaveAttribute('viewBox', initialView!);
  await panel.getByRole('button', { name: 'Zoom avant', exact: true }).click();
  await panel.getByRole('button', { name: 'Réinitialiser le cadrage', exact: true }).click();
  await expect(grid).toHaveAttribute('viewBox', initialView!);
  const other = grid.locator('[data-cell][aria-pressed="false"]').first();
  const cellId = (await other.getAttribute('data-cell'))!;
  await other.press('Enter');
  await expect(cell(panel, cellId)).toHaveAttribute('aria-pressed', 'true');
  await fullscreenTime.fill('12');
  if (refinementEvidence) await page.screenshot({ path: path.join(refinementEvidence, 'plein-ecran-carte.png'), animations: 'disabled' });
  await panel.getByRole('button', { name: 'Zoom avant', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(slider(panel)).toHaveValue('12');
  await expect(grid).toHaveAttribute('data-zoom', '1.5');
  await panel.getByRole('button', { name: 'Réinitialiser le cadrage', exact: true }).click();

  for (const [name, text] of [
    ['Biomasse par cellule', 'Résolution du lac'], ['Indicateurs du domaine', 'Capacité totale'],
    ['Détails de la cellule', `Cellule ${cellId}`], ['Trajectoires', 'Comparer les trajectoires'],
  ] as const) {
    await enter(name);
    await expect(fullscreenTime).toHaveValue('12');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.textContent)).toContain(text);
    if (name === 'Trajectoires') {
      await expect(chart(panel)).toHaveAttribute('data-time', '12');
      await expect(chart(panel)).toHaveAttribute('data-series', cellId);
      const plot = chart(panel).locator('.js-plotly-plot');
      await expect.poll(() => plot.evaluate(element =>
        (element as HTMLElement & { _fullLayout?: { height: number } })._fullLayout?.height ?? 0)).toBeGreaterThan(500);
      if (refinementEvidence) await page.screenshot({ path: path.join(refinementEvidence, 'plein-ecran-trajectoires.png'), animations: 'disabled' });
    }
    await exit(name);
    await expect(cell(panel, cellId)).toHaveAttribute('aria-pressed', 'true');
    await expect(slider(panel)).toHaveValue('12');
  }
});

test('le gradient nord-sud relance les six maillages et compare les observations à 0, 10 et 20 mois', async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 1850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await openExperiment(page);
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  const resolution = panel.getByRole('combobox', { name: 'Résolution du lac' });
  const distribution = panel.getByRole('combobox', { name: 'Distribution biologique' });
  const intensity = panel.getByRole('slider', { name: 'Intensité du gradient α' });
  const grid = panel.getByRole('group', { name: 'Grille humide du lac de Guiers' });
  const launch = panel.getByRole('button', { name: 'Lancer la simulation', exact: true });
  const months = [0, 10, 20];
  const responses: Response[] = [];
  page.on('response', response => {
    if (isSimulation(response.request())) responses.push(response);
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  if (heterogeneityEvidence) await mkdir(heterogeneityEvidence, { recursive: true });

  async function run(batchCount: number, modelPrefix: string) {
    const offset = responses.length;
    await launch.click();
    const outcome = panel.locator('[data-phase="completed"], [data-phase="error"]');
    await expect(outcome).toBeVisible({ timeout: 60000 });
    expect(await outcome.getAttribute('data-phase'), (await panel.getByRole('alert').allTextContents()).join('\n')).toBe('completed');
    const observations: RunResult['observations'] = [];
    const initial: number[] = [];
    let batches = 0;
    for (const response of responses.slice(offset)) {
      if (response.status() === 503) {
        expect((await response.json()).error.code).toBe('ENGINE_BUSY');
        continue;
      }
      expect(response.status(), await response.text()).toBe(200);
      const request: RunRequest = response.request().postDataJSON();
      expect(request.model.id).toBe(`${modelPrefix}-${++batches}`);
      const result = await response.json() as RunResult & { runId: string };
      expect(result.runId).toBeTruthy();
      expect(result.simulation.finalTime).toBe(20);
      expect(result.simulation.runCalls).toBeGreaterThan(0);
      expect(result.observations.every(o => o.samples.length === 201)).toBe(true);
      observations.push(...result.observations);
      initial.push(...request.model.components.filter(atom => atom.type === 'qss3_integrator').map(atom => atom.parameters.X!));
    }
    expect(batches).toBe(batchCount);
    expect(initial.reduce((sum, value) => sum + value, 0)).toBeCloseTo(45_000, 8);
    const totals = months.map(instant => observations.reduce((sum, observation) => sum + observation.samples[instant * 10]!.value, 0));
    return { observations, totals };
  }

  async function showMonths(totals: number[], size: string, kind: string, capture: boolean) {
    for (const [index, instant] of months.entries()) {
      await slider(panel).fill(String(instant));
      await expect(panel.locator('[data-total-biomass]')).toHaveAttribute('data-total-biomass', String(totals[index]));
      await expect(chart(panel)).toHaveAttribute('data-time', String(instant));
      if (capture && heterogeneityEvidence) {
        await expect(panel.getByLabel('Rapport biomasse sur capacité')).toBeInViewport();
        await expect.poll(() => chart(panel).locator('.js-plotly-plot').evaluate((element, time) =>
          (element as HTMLElement & { layout?: { shapes?: { x0: number }[] } }).layout?.shapes?.[0]?.x0 === time,
        instant)).toBe(true);
        await panel.screenshot({
          path: path.join(heterogeneityEvidence, `${size}-${kind}-t${instant}.png`), animations: 'disabled',
        });
      }
    }
  }

  for (const [size, wetCells, batchCount] of [
    ['6x3', 13, 1], ['12x6', 35, 2], ['18x9', 65, 4], ['24x12', 101, 6], ['36x18', 184, 11], ['48x24', 296, 17],
  ] as const) {
    const prefix = `logistic-lake-${size}-proportional`;
    const capture = size === '6x3' || size === '48x24';
    await resolution.selectOption(size);
    await expect(grid.getByRole('button')).toHaveCount(wetCells);
    let homogeneous: Awaited<ReturnType<typeof run>> | undefined;
    if (capture) {
      await distribution.selectOption('homogeneous');
      homogeneous = await run(batchCount, prefix);
      await showMonths(homogeneous.totals, size, 'homogene', true);
    }

    const previousRequests = responses.length;
    await distribution.selectOption('gradient');
    await intensity.fill('0.6');
    await expect(panel.getByText('Gradient biologique synthétique — non calibré')).toBeVisible();
    expect(responses).toHaveLength(previousRequests);
    const gradient = await run(batchCount, `${prefix}-g0p6`);
    expect(gradient.observations).toHaveLength(wetCells);
    const initialRatios = await grid.getByRole('button').evaluateAll(cells => cells.map(cell => ({
      ratio: Number(cell.getAttribute('data-biomass-ratio')),
      fill: getComputedStyle(cell).fill,
    })));
    expect(initialRatios[0]!.ratio).toBeGreaterThan(0.5);
    expect(initialRatios.at(-1)!.ratio).toBeLessThan(0.5);
    expect(new Set(initialRatios.map(cell => cell.fill)).size).toBeGreaterThan(2);
    const initialTable = panel.getByRole('row', { name: /Gradient nord-sud/ });
    for (const [index, total] of gradient.totals.entries()) {
      await expect(initialTable.getByRole('cell').nth(index)).toHaveAttribute('data-comparison-biomass', String(total));
      if (homogeneous) await expect(panel.getByRole('row', { name: /Distribution homogène/ }).getByRole('cell').nth(index))
        .toHaveAttribute('data-comparison-biomass', String(homogeneous.totals[index]));
    }
    if (homogeneous) {
      expect(gradient.totals[0]).toBeCloseTo(homogeneous.totals[0]!, 8);
      expect(gradient.totals[1]).toBeLessThan(homogeneous.totals[1]!);
      expect(gradient.totals[2]).toBeLessThan(homogeneous.totals[2]!);
    }
    await showMonths(gradient.totals, size, 'gradient', capture);
    if (size === '6x3') {
      await intensity.fill('0');
      const zero = await run(1, prefix);
      expect(zero).toEqual(homogeneous);
      await intensity.fill('0.6');
    }
  }

  await panel.getByRole('button', { name: 'Plein écran · Carte du lac', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.textContent)).toContain('Gradient biologique synthétique — non calibré');
  await panel.getByRole('slider', { name: 'Temps en plein écran' }).fill('10');
  await expect(grid).toHaveAttribute('data-time', '10');
  await panel.getByRole('button', { name: 'Quitter le plein écran · Carte du lac', exact: true }).click();
  await expect(slider(panel)).toHaveValue('10');

  const downloading = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Télécharger la trace JSON' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('lac-de-guiers-48x24-gradient-0.6.json');
  const trace = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(trace).toMatchObject({ parameters: { rows: 48, columns: 24, distribution: { kind: 'gradient', alpha: 0.6 } },
    plannedBatches: 17, points: 296 * 201 });
  expect(trace.aggregateErrors.maxAbsoluteTonnes).toBeLessThan(1);
  expect(errors).toEqual([]);
});
