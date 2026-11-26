import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunRequest, RunResult } from '@contracts';
import { lakeDisplays, lakeMapColor } from '../../lib/simulation/lake-exploration';
import { chart, isSimulation, openExperiment, slider } from './logistic-workshop';

const evidence = process.env.IRRITATOR_LAKE_EXCHANGE_EVIDENCE;

async function openInteractions(page: Page) {
  const panel = await openExperiment(page);
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('interactions');
  return panel.getByRole('region', { name: 'Interactions spatiales' });
}

async function clickWetCell(page: Page, region: Locator) {
  await region.scrollIntoViewIfNeeded();
  const hit = await region.evaluate(node => {
    const cell = node as unknown as SVGRectElement;
    const box = cell.getBBox();
    const transform = cell.getScreenCTM()!;
    const fractions = [0.5, 0.33, 0.66, 0.2, 0.8, 0.1, 0.9];
    for (const x of fractions) for (const y of fractions) {
      const point = new DOMPoint(box.x + x * box.width, box.y + y * box.height).matrixTransform(transform);
      if (document.elementFromPoint(point.x, point.y) === cell) return { x: point.x, y: point.y };
    }
    return null;
  });
  expect(hit, 'Point cliquable dans la portion humide de la cellule').not.toBeNull();
  await page.mouse.click(hit!.x, hit!.y);
}

test('compare deux exécutions natives, vérifie les couleurs et capture les mois 0, 5, 10 et 20', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1080 });
  const panel = await openInteractions(page);
  const responses: Response[] = [];
  page.on('response', response => { if (isSimulation(response.request())) responses.push(response); });
  await expect(panel.getByRole('combobox', { name: 'Résolution du lac' })).toHaveValue('6x3');
  await panel.getByRole('combobox', { name: 'Distribution biologique' }).selectOption('wet-gradient');
  await panel.getByRole('combobox', { name: 'Profil du gradient' }).selectOption('sigmoid-v2');
  await panel.getByRole('slider', { name: 'Intensité du gradient α' }).fill('0.6');
  await panel.getByRole('combobox', { name: 'Échange de biomasse' }).selectOption('pair');
  await panel.getByRole('combobox', { name: 'Intensité d’échange μ (mois⁻¹)' }).selectOption('0.5');
  const left = panel.getByRole('group', { name: 'Carte sans échange' });
  const right = panel.getByRole('group', { name: 'Carte avec échange' });
  const launch = panel.getByRole('button', { name: 'Simuler les deux scénarios' });
  await expect(launch).toBeDisabled();
  await clickWetCell(page, left.getByRole('button', { name: 'C11', exact: true }));
  await expect(panel.getByRole('combobox', { name: 'Cellule A', exact: true })).toHaveValue('C11');
  await expect(left.getByRole('button', { name: 'C21', exact: true })).toHaveAttribute('data-wet-neighbor', 'true');
  await clickWetCell(page, left.getByRole('button', { name: 'C20', exact: true }));
  await expect(panel.getByRole('alert')).toContainText('ne partage pas de frontière humide');
  await expect(launch).toBeDisabled();
  await clickWetCell(page, left.getByRole('button', { name: 'C21', exact: true }));
  await expect(panel.getByRole('combobox', { name: 'Cellule B', exact: true })).toHaveValue('C21');
  await expect(right.locator('[data-exchange-pair]')).toHaveAttribute('data-exchange-pair', 'C11 C21');
  await expect(left.locator('[data-map-selection]')).toHaveCount(2);
  await expect(right.locator('[data-map-selection]')).toHaveCount(2);
  await expect(right.locator('[data-exchange-pair]')).not.toHaveAttribute('data-flow', /./);
  await launch.click();
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible();

  expect(responses).toHaveLength(3);
  const requests = responses.map(response => response.request().postDataJSON() as RunRequest);
  const native = await Promise.all(responses.map(async response => {
    expect(response.ok()).toBe(true);
    return (await response.json()) as RunResult;
  }));
  expect(requests[1]!.model.components).toHaveLength(17);
  expect(requests[1]!.model.connections).toHaveLength(24);
  expect(requests[1]!.model.observations.map(row => row.component)).toEqual(['C11-N', 'C21-N']);
  expect(requests[2]!.model.observations.map(row => row.component)).not.toContain('C11-N');
  expect(requests[2]!.model.observations.map(row => row.component)).not.toContain('C21-N');
  const indexes = [native.slice(0, 1), native.slice(1)].map(parts => new Map(parts.flatMap(result =>
    result.observations.map(series => [series.component.slice(0, -2), series.samples]))));
  expect(indexes.map(index => index.size)).toEqual([13, 13]);
  for (const index of indexes) {
    expect([...index.values()].every(samples => samples.length === 201 && samples[200]!.time === 20)).toBe(true);
  }
  for (const [id, samples] of indexes[0]!) {
    expect(indexes[1]!.get(id)?.[0]).toEqual(samples[0]);
    if (id !== 'C11' && id !== 'C21') expect(indexes[1]!.get(id)).toEqual(samples);
  }

  async function checkMap(map: Locator, scenario: number, month: number) {
    await expect(map).toHaveAttribute('data-time', String(month));
    const readings = await map.locator('[data-source="native"]').evaluateAll(nodes => nodes.map(node => ({
      id: node.getAttribute('data-cell')!,
      area: Number(node.getAttribute('data-area')),
      value: Number(node.getAttribute('data-biomass')),
      ratio: Number(node.getAttribute('data-biomass-ratio')),
      color: getComputedStyle(node).fill,
    })));
    expect(readings).toHaveLength(13);
    for (const { id, area, value, ratio, color } of readings) {
      const expected = indexes[scenario]!.get(id)![month * 10]!.value;
      expect(value).toBe(expected);
      expect(ratio).toBeCloseTo(expected / (area * 300), 14);
      expect(color).toBe(lakeMapColor(expected / (area * 300) * 100, lakeDisplays.ratio.limits, 'ratio'));
    }
    const mapPane = map.locator('../..');
    expect(Number(await mapPane.locator('[data-map-total]').getAttribute('data-map-total')))
      .toBeCloseTo(readings.reduce((sum, row) => sum + row.value, 0), 8);
    return new Map(readings.map(reading => [reading.id, reading]));
  }

  const fullscreen = page.locator(':fullscreen');
  await panel.getByRole('button', { name: 'Plein écran · Cartes des scénarios' }).click();
  const time = fullscreen.getByRole('slider', { name: 'Temps en plein écran' });
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const month of [0, 5, 10, 20]) {
    await time.fill(String(month));
    const control = await checkMap(left, 0, month);
    const exchange = await checkMap(right, 1, month);
    const a = exchange.get('C11')!;
    const b = exchange.get('C21')!;
    const flux = 0.5 * a.area * b.area / (a.area + b.area) * (a.value / a.area - b.value / b.area);
    const indicator = fullscreen.locator('[data-exchange-flux]');
    expect(Number(await indicator.getAttribute('data-exchange-flux'))).toBeCloseTo(flux, 10);
    await expect(indicator).toHaveAttribute('data-exchange-direction', 'C11 → C21');
    await expect(indicator).toContainText('Flux reconstitué à partir des biomasses natives observées.');
    if (month === 5) {
      expect(a.value).toBeLessThan(control.get(a.id)!.value - 500);
      expect(b.value).toBeGreaterThan(control.get(b.id)!.value + 500);
    }
    if (evidence) {
      await page.mouse.move(0, 0);
      await fullscreen.screenshot({ path: path.join(evidence, `6x3-sigmoide-06-mu-05-mois-${month}.png`), animations: 'disabled' });
    }
  }
  await fullscreen.getByRole('button', { name: 'Zoom avant' }).first().click();
  await expect(right).toHaveAttribute('data-zoom', '1.5');
  await expect(left).toHaveAttribute('viewBox', (await right.getAttribute('viewBox'))!);
  await fullscreen.getByRole('button', { name: 'Réinitialiser le cadrage' }).first().click();
  await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Cartes des scénarios' }).click();
  await expect(slider(panel)).toHaveValue('20');
  await slider(panel).fill('5');
  await expect(chart(panel)).toHaveAttribute('data-series', 'C11 · B,C11 · A,C21 · B,C21 · A');
  for (const [scenario, index] of indexes.entries()) {
    for (const id of ['C11', 'C21']) {
      const [initial, current] = [index.get(id)![0]!, index.get(id)![50]!];
      const row = panel.locator(`[data-pair-cell="${id}"][data-pair-scenario="${scenario === 0 ? 'A' : 'B'}"]`);
      await expect(row.locator('[data-pair-biomass]')).toHaveAttribute('data-pair-biomass', String(current.value));
      const area = Number(await left.getByRole('button', { name: id, exact: true }).getAttribute('data-area'));
      await expect(row.locator('[data-pair-density]')).toHaveAttribute('data-pair-density', String(current.value / area));
      await expect(row.locator('[data-pair-gain]')).toHaveAttribute('data-pair-gain', String(current.value - initial.value));
    }
  }
  await panel.getByRole('button', { name: 'Lire', exact: true }).click();
  await expect.poll(async () => Number(await slider(panel).inputValue())).toBeGreaterThan(5);
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await slider(panel).fill('5');

  const search = panel.getByRole('searchbox', { name: 'Rechercher une cellule par identifiant' });
  const extras = [...indexes[0]!.keys()].filter(id => id !== 'C11' && id !== 'C21');
  for (const id of extras.slice(0, 10)) {
    await search.fill(id);
    await panel.getByRole('button', { name: `Comparer ${id}`, exact: true }).click();
  }
  await search.fill(extras[10]!);
  await expect(panel.getByRole('button', { name: `Comparer ${extras[10]}`, exact: true })).toBeDisabled();
  await expect(chart(panel).locator('[data-lake-curve]')).toHaveCount(14);

  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Exporter cette vue' }).click();
  const svg = await download;
  expect(svg.suggestedFilename()).toContain('echange-C11-C21-mu-0.5.svg');
  const output = await readFile((await svg.path())!, 'utf8');
  expect(output).toContain('data-exchange-pair="C11 C21"');
  expect(output).toContain('C11 → C21');
  expect(output).toContain('reconstitué');
  await panel.getByRole('combobox', { name: 'Format de l’image' }).selectOption('png');
  const pngDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Exporter cette vue' }).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toContain('echange-C11-C21-mu-0.5.png');
  expect((await readFile((await png.path())!)).subarray(1, 4).toString()).toBe('PNG');
});

test('le mode sans échange et le réglage μ = 0 fonctionnent aussi en 18 × 9', async ({ page }) => {
  test.setTimeout(120_000);
  const panel = await openInteractions(page);
  const responses: Response[] = [];
  page.on('response', response => { if (isSimulation(response.request())) responses.push(response); });
  await panel.getByRole('combobox', { name: 'Résolution du lac' }).selectOption('18x9');
  const left = panel.getByRole('group', { name: 'Carte sans échange' });
  await expect(left).toHaveAttribute('data-rows', '18');
  await panel.getByRole('button', { name: 'Simuler sans échange' }).click();
  await expect(left.locator('[data-source="native"]')).toHaveCount(65);
  expect(responses).toHaveLength(4);
  await panel.getByRole('combobox', { name: 'Échange de biomasse' }).selectOption('pair');
  await panel.getByRole('combobox', { name: 'Cellule A', exact: true }).selectOption('C5_4');
  await panel.getByRole('combobox', { name: 'Cellule B', exact: true }).selectOption('C6_4');
  await panel.getByRole('combobox', { name: 'Intensité d’échange μ (mois⁻¹)' }).selectOption('0');
  await panel.getByRole('button', { name: 'Simuler les deux scénarios' }).click();
  const right = panel.getByRole('group', { name: 'Carte avec échange' });
  await expect(right.locator('[data-source="native"]')).toHaveCount(65, { timeout: 60_000 });
  await slider(panel).fill('10');
  await expect(panel.locator('[data-exchange-flux]')).toHaveAttribute('data-exchange-flux', '0');
  await expect(panel.locator('[data-exchange-flux]')).toContainText('Flux nul');
  for (const id of ['C5_4', 'C6_4']) {
    const first = Number(await left.getByRole('button', { name: id, exact: true }).getAttribute('data-biomass'));
    const second = Number(await right.getByRole('button', { name: id, exact: true }).getAttribute('data-biomass'));
    expect(second).toBeCloseTo(first, 4);
  }
  await panel.getByRole('combobox', { name: 'Cellule A', exact: true }).selectOption('C1_6');
  await panel.getByRole('combobox', { name: 'Cellule B', exact: true }).selectOption('C1_7');
  await panel.getByRole('combobox', { name: 'Intensité d’échange μ (mois⁻¹)' }).selectOption('0.5');
  await panel.getByRole('button', { name: 'Simuler les deux scénarios' }).click();
  await expect(right.locator('[data-source="native"]')).toHaveCount(65, { timeout: 60_000 });
  await expect(slider(panel)).toHaveValue('0');
  await expect(panel.locator('[data-exchange-flux]')).toHaveAttribute('data-exchange-flux', '0');
  await page.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  await expect(page.getByRole('button', { name: 'Mode atelier' })).toBeVisible();
});

test('le plan HTTP refuse les coins, les frontières sèches et les intensités hors catalogue', async ({ request }) => {
  const query = '/api/logistic-lake?resolution=6x3&distribution=homogeneous';
  for (const pair of ['a=C11&b=C20&mu=0.5', 'a=C21&b=C31&mu=0.5', 'a=C01&b=C00&mu=0.5',
    'a=C11&b=C21&mu=0.1', 'a=C11&mu=0.5']) {
    const response = await request.get(`${query}&${pair}`);
    expect(response.status()).toBe(400);
  }
  expect((await request.get(`${query}&a=C11&b=C21&mu=0.25`)).ok()).toBe(true);
});
