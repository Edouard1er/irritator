import { expect, test, type Download, type Response } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunRequest, RunResult } from '@contracts';
import { lakeNumber } from '../../lib/simulation/lake-exploration';
import { chart, isSimulation, openExperiment, slider } from './logistic-workshop';

const evidence = process.env.IRRITATOR_LAKE_WORKSHOP_EVIDENCE;
const synthetic = 'Simulation expérimentale — données biologiques synthétiques';
const primaryName = 'Grille humide du lac de Guiers';

test('présente les simulations natives et exporte le mois et les cartes affichés', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1150 });
  const panel = await openExperiment(page);
  const responses: Response[] = [];
  let requests = 0;
  let plans = 0;
  page.on('request', request => {
    if (isSimulation(request)) requests++;
    if (new URL(request.url()).pathname === '/api/logistic-lake') plans++;
  });
  page.on('response', response => {
    if (isSimulation(response.request()) && response.ok()) responses.push(response);
  });
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  const workshop = panel.getByRole('button', { name: 'Mode atelier' });
  const left = panel.getByRole('group', { name: primaryName, exact: true });
  const right = panel.getByRole('group', { name: `${primaryName} · comparaison`, exact: true });
  const assay = panel.getByRole('table', { name: /Biomasses totales simulées/ });
  const exportButton = panel.getByRole('button', { name: 'Exporter cette vue' });
  const format = panel.getByRole('combobox', { name: 'Format de l’image' });
  const save = (download: Download, name: string) => evidence ? download.saveAs(path.join(evidence, name)) : Promise.resolve();

  await expect(assay).toBeVisible();
  const initialPlans = plans;
  await workshop.click();
  await expect(workshop).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByText(synthetic, { exact: true })).toBeVisible();
  await expect(assay).toHaveCount(0);
  await expect(exportButton).toBeDisabled();
  expect(requests).toBe(0);
  expect(plans).toBe(initialPlans);

  await panel.getByRole('button', { name: 'Biomasse initiale homogène', exact: true }).click();
  await expect(left.locator('[data-biomass]')).toHaveCount(65);
  await expect(left).toHaveAttribute('data-time', '0');
  await expect(panel.locator('[data-map-total]')).toHaveText(/45\s000 t/);
  await expect(panel.locator('[data-map-gain]')).toHaveText('0 t');
  expect(responses).toHaveLength(4);
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1580 });
    await panel.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const bounds = (await panel.boundingBox())!;
    const mapBounds = (await left.locator('..').boundingBox())!;
    const y = Math.max(0, bounds.y);
    await page.screenshot({
      path: path.join(evidence, 'atelier-homogene-mois-0.png'), animations: 'disabled',
      clip: { x: bounds.x, y, width: bounds.width, height: Math.min(1580, mapBounds.y + mapBounds.height + 24) - y },
    });
    await page.setViewportSize({ width: 1440, height: 1150 });
  }

  await panel.getByRole('button', { name: 'Lire', exact: true }).click();
  await expect.poll(async () => Number(await left.getAttribute('data-time'))).toBeGreaterThan(0);
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await slider(panel).fill('10');
  const id = (await left.locator('[data-cell]').first().getAttribute('data-cell'))!;
  await left.locator(`[data-cell="${id}"]`).press('Enter');
  await expect(chart(panel)).toHaveAttribute('data-series', id);
  await expect(chart(panel).locator('[data-lake-cursor]')).toHaveAttribute('data-lake-cursor', '10');
  const singleDownload = page.waitForEvent('download');
  await exportButton.click();
  const single = await singleDownload;
  expect(single.suggestedFilename()).toBe('lac-de-guiers-18x9-mois-10.svg');
  const singleXml = await readFile((await single.path())!, 'utf8');
  expect(singleXml.match(/data-map-total=/g)).toHaveLength(1);
  expect(singleXml).toContain('Biomasse / capacité (%)');
  expect(singleXml).toContain('50 %');
  await save(single, 'export-homogene-mois-10.svg');

  await panel.getByRole('button', { name: 'Comparer homogène / gradient', exact: true }).click();
  await expect(right.locator('[data-biomass]')).toHaveCount(65);
  await expect(right.locator(`[data-cell="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(right).toHaveAttribute('data-time', '10');
  expect(responses).toHaveLength(8);
  const gradient = (await Promise.all(responses.slice(4).map(async response => (await response.json() as RunResult).observations))).flat();
  expect(gradient).toHaveLength(65);
  const nativeTotal = gradient.reduce((sum, row) => sum + row.samples[100]!.value, 0);
  const nativeCell = gradient.find(row => row.component === `${id}-N`)!.samples[100]!.value;
  expect((responses[4]!.request().postDataJSON() as RunRequest).model.id).toContain('-g0p3-');
  await expect(panel.locator('[data-map-total]').nth(1)).toHaveAttribute('data-map-total', String(nativeTotal));
  const presentationCounts = { requests, plans };
  await panel.getByRole('slider', { name: 'Intensité du gradient comparé α' }).fill('0.45');
  await panel.getByRole('slider', { name: 'Intensité du gradient comparé α' }).fill('0.58');
  await expect(panel.getByText('Intensité simulée α = 0,3')).toBeVisible();
  await expect(right.locator(`[data-cell="${id}"]`)).toHaveAttribute('data-biomass', String(nativeCell));
  await panel.getByRole('combobox', { name: 'Affichage de la carte' }).selectOption('difference');
  await panel.getByRole('combobox', { name: 'Échelle des écarts' }).selectOption('month');
  await panel.getByRole('button', { name: 'Plein écran · Carte du lac', exact: true }).click();
  const fullscreen = page.locator(':fullscreen');
  await expect(fullscreen.getByText(synthetic, { exact: true })).toBeVisible();
  const visibleMap = (await right.boundingBox())!;
  expect(visibleMap.y + visibleMap.height).toBeLessThanOrEqual(1150);
  if (evidence) await fullscreen.screenshot({ path: path.join(evidence, 'atelier-comparaison-mois-10.png'), animations: 'disabled' });
  await fullscreen.getByRole('button', { name: 'Zoom avant' }).first().click();
  await expect(right).toHaveAttribute('data-zoom', '1.5');
  const currentBox = (await right.getAttribute('viewBox'))!;
  const value = (await right.locator(`[data-cell="${id}"]`).getAttribute('data-map-value'))!;
  const fill = await right.locator(`[data-cell="${id}"]`).evaluate(element => getComputedStyle(element).fill);
  const svgDownload = page.waitForEvent('download');
  await exportButton.click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe('lac-de-guiers-18x9-mois-10-comparaison.svg');
  const xml = await readFile((await svg.path())!, 'utf8');
  const structure = await page.evaluate(({ xml, id }) => {
    const svg = new DOMParser().parseFromString(xml, 'image/svg+xml');
    const maps = [...svg.querySelectorAll('[data-map-total]')];
    const cell = maps[1]!.querySelector(`[data-cell="${id}"]`)!;
    return {
      text: svg.documentElement.textContent, time: svg.documentElement.getAttribute('data-time'),
      boxes: maps.map(map => map.querySelector('svg')!.getAttribute('viewBox')),
      total: maps[1]!.getAttribute('data-map-total'), cell: cell.getAttribute('data-biomass'),
      value: cell.getAttribute('data-map-value'), fill: cell.getAttribute('fill'),
      wet: Number(cell.getAttribute('data-wet-fraction')), clip: svg.querySelector('clipPath path')!.getAttribute('d'),
    };
  }, { xml, id });
  expect(structure).toMatchObject({ time: '10', boxes: [currentBox, currentBox], total: String(nativeTotal),
    cell: String(nativeCell), value, fill, clip: await right.locator('clipPath path').getAttribute('d') });
  expect(structure.wet).toBeLessThan(1);
  expect(structure.text).toContain(synthetic);
  expect(structure.text).toContain('Gradient nord-sud · α = 0,3');
  expect(structure.text).toContain('Écart au scénario homogène (points de %)');
  expect(structure.text).toContain('Échelle ajustée au mois consulté.');
  expect(structure.text).toContain('Mois simulé 10,0 · Grille 18 × 9');
  await save(svg, 'export-comparaison-mois-10.svg');
  await fullscreen.getByRole('button', { name: 'Réinitialiser le cadrage' }).first().click();
  await format.selectOption('png');
  const pngDownload = page.waitForEvent('download');
  await exportButton.click();
  const png = await pngDownload;
  const bytes = await readFile((await png.path())!);
  expect(png.suggestedFilename()).toBe('lac-de-guiers-18x9-mois-10-comparaison.png');
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([2720, 1880]);
  await save(png, 'export-comparaison-mois-10.png');
  await fullscreen.getByRole('button', { name: 'Zoom avant' }).first().click();
  await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Carte du lac', exact: true }).click();
  await workshop.click();
  await expect(assay).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Télécharger la trace JSON' })).toBeVisible();
  await expect(slider(panel)).toHaveValue('10');
  await expect(left).toHaveAttribute('data-zoom', '1.5');
  await expect(left.locator(`[data-cell="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  expect({ requests, plans }).toEqual(presentationCounts);

  await workshop.click();
  await panel.getByRole('button', { name: 'Gradient pondéré par surface humide · 0,6', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Gradient pondéré par surface humide · α = 0,6' })).toBeVisible();
  await expect(left.locator('[data-biomass]')).toHaveCount(65);
  expect(responses).toHaveLength(12);
  expect((responses[8]!.request().postDataJSON() as RunRequest).model.id).toContain('-wg0p6-');
  await panel.getByRole('button', { name: 'Gradient nord-sud · 0,3', exact: true }).click();
  await expect(left.locator(`[data-cell="${id}"]`)).toHaveAttribute('data-biomass', String(nativeCell));
  expect(responses).toHaveLength(12);
});

test('trace les observations natives de la cellule principale et de dix cellules supplémentaires', async ({ page }) => {
  test.setTimeout(120000);
  const panel = await openExperiment(page);
  const responses: Response[] = [];
  let requests = 0;
  page.on('request', request => { if (isSimulation(request)) requests++; });
  page.on('response', response => { if (isSimulation(response.request()) && response.ok()) responses.push(response); });
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  await panel.getByRole('button', { name: 'Mode atelier' }).click();
  await panel.getByRole('button', { name: 'Gradient pondéré par surface humide · 0,6', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Résolution du lac' })).toHaveValue('18x9');
  const grid = panel.getByRole('group', { name: primaryName, exact: true });
  await expect(grid.locator('[data-cell][data-biomass]')).toHaveCount(65);
  expect(requests).toBe(4);
  const native = (await Promise.all(responses.map(async response => (await response.json() as RunResult).observations))).flat();
  const picker = panel.getByRole('group', { name: 'Comparer les trajectoires' });
  const search = picker.getByRole('searchbox', { name: 'Rechercher une cellule par identifiant' });
  const add = (id: string) => picker.getByRole('button', { name: `Comparer ${id}`, exact: true });
  const main = 'C7_3';
  const additional = ['C2_5', 'C7_2', 'C1_6', 'C0_6', 'C8_1', 'C14_0', 'C12_1', 'C9_1', 'C16_6', 'C16_8'];
  const plot = chart(panel);
  const curves = plot.locator('[data-lake-curve]');
  const legend = panel.getByRole('list', { name: 'Séries à l’instant consulté' });
  const biomassAxis = plot.locator('[data-lake-axis="biomass"]');
  await search.fill(main);
  await search.press('Enter');
  await expect(plot).toHaveAttribute('data-series', main);
  await expect(curves).toHaveCount(1);
  await expect(plot.locator('[data-lake-axis]:not([data-lake-axis="time"])')).toHaveCount(1);
  await expect(biomassAxis).toContainText('Biomasse des cellules (t)');
  await expect(plot.locator('[data-lake-axis="time"]')).toContainText('Temps simulé (mois)');
  const upperTick = biomassAxis.locator('g text').last();
  const soloLimit = await upperTick.textContent();

  for (const id of additional) {
    await search.fill(id.toLowerCase());
    await add(id).click();
    if (id === additional[0]) {
      await expect(upperTick).not.toHaveText(soloLimit!);
      await search.fill(id);
      await expect(add(id)).toBeDisabled();
    }
  }
  const ids = [main, ...additional];
  await expect(picker.getByText('10 / 10 cellules supplémentaires', { exact: true })).toBeVisible();
  await expect(plot).toHaveAttribute('data-series', ids.join(','));
  await expect(curves).toHaveCount(11);
  await expect(legend.getByRole('listitem')).toHaveCount(11);
  await expect(legend).not.toContainText('Biomasse totale');
  await expect(legend.locator(`[data-series-cell="${main}"]`)).toHaveAttribute('data-selected', 'true');
  await expect(curves.last()).toHaveAttribute('data-lake-curve', main);
  await expect(curves.last().locator('polyline')).toHaveAttribute('stroke-width', '3.5');
  await slider(panel).fill('10');
  await expect(grid).toHaveAttribute('data-time', '10');
  await expect(plot.locator('[data-lake-cursor]')).toHaveAttribute('data-lake-cursor', '10');
  const colors = new Set<string>();
  for (const id of ids) {
    const { samples } = native.find(observation => observation.component === `${id}-N`)!;
    expect(samples).toHaveLength(201);
    const line = plot.locator(`[data-lake-curve="${id}"] polyline`);
    await expect(line).toHaveAttribute('points', samples.map(({ time, value }) => `${time},${value}`).join(' '));
    const marker = plot.locator(`[data-lake-mark="${id}"]`);
    await expect(marker).toHaveAttribute('data-biomass', String(samples[100]!.value));
    const color = (await line.getAttribute('stroke'))!;
    colors.add(color);
    await expect(marker).toHaveAttribute('fill', color);
    await expect(grid.locator(`[data-map-selection="${id}"]`)).toHaveAttribute('stroke', color);
    const cssColor = await line.evaluate(element => getComputedStyle(element).stroke);
    await expect(legend.locator(`[data-series-cell="${id}"] i`)).toHaveCSS('background-color', cssColor);
    await expect(picker.locator(`[data-picker-cell="${id}"]`)).toHaveCSS('color', cssColor);
  }
  expect(colors.size).toBe(11);

  await panel.getByRole('button', { name: 'Plein écran · Trajectoires', exact: true }).click();
  const fullscreen = page.locator(':fullscreen');
  await expect(fullscreen.locator('[data-lake-curve]')).toHaveCount(11);
  await expect(legend).toBeInViewport({ ratio: 1 });
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await fullscreen.screenshot({ path: path.join(evidence, '18x9-trajectoires-11-cellules.png'), animations: 'disabled' });
  }
  const hoverArea = plot.locator('svg rect');
  const bounds = (await hoverArea.boundingBox())!;
  await hoverArea.hover({ position: { x: bounds.width / 2, y: 12 } });
  const tooltip = plot.locator('[data-lake-tooltip]');
  await expect(tooltip.getByText('10,0 mois', { exact: true })).toBeVisible();
  await expect(tooltip.locator('> div')).toHaveCount(11);
  for (const id of ids) {
    const value = native.find(observation => observation.component === `${id}-N`)!.samples[100]!.value;
    await expect(tooltip.locator('> div').filter({ has: page.getByText(id, { exact: true }) })).toContainText(`${lakeNumber.format(value)} t`);
  }
  await expect(tooltip).not.toContainText('Biomasse totale');
  await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Trajectoires', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(legend).toBeVisible();
  expect(await legend.evaluate(element => new Set([...element.children].map(row => row.getBoundingClientRect().top)).size))
    .toBeGreaterThan(1);
  await hoverArea.hover();
  await expect(tooltip).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const replacement = 'C10_3';
  const removed = additional[1]!;
  await search.fill(replacement);
  await expect(add(replacement)).toBeDisabled();
  await picker.getByRole('button', { name: `Retirer ${removed} de la comparaison` }).click();
  await expect(grid.locator(`[data-map-selection="${removed}"]`)).toHaveCount(0);
  await expect(add(replacement)).toBeEnabled();
  await add(replacement).click();
  await expect(curves).toHaveCount(11);
  const promoted = additional[0]!;
  await search.fill(promoted);
  await search.press('Enter');
  await expect(grid.locator(`[data-cell="${promoted}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(plot).toHaveAttribute('data-series', [promoted, ...additional.slice(2), replacement].join(','));
  await expect(curves).toHaveCount(10);
  await expect(picker.getByText('9 / 10 cellules supplémentaires', { exact: true })).toBeVisible();
  expect(requests).toBe(4);

  await panel.getByRole('combobox', { name: 'Résolution du lac' }).selectOption('48x24');
  await expect(grid.locator('[data-cell]')).toHaveCount(296);
  await search.fill('c');
  await expect(picker.getByRole('listitem')).toHaveCount(8);
  await expect(picker.getByText(/296 résultats/)).toBeVisible();
});
