import { expect, test, type Locator, type Response } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunResult } from '@contracts';
import { lakeMapColor, lakeDisplays } from '../../lib/simulation/lake-exploration';
import { chart, isSimulation, openExperiment, slider } from './logistic-workshop';

const evidence = process.env.IRRITATOR_LAKE_CONTRAST_EVIDENCE;
const primaryName = 'Grille humide du lac de Guiers';

function readings(map: Locator) {
  return map.locator('[data-cell][data-source="native"]').evaluateAll(nodes => nodes.map(node => ({
    id: node.getAttribute('data-cell')!,
    ratio: Number(node.getAttribute('data-biomass-ratio')),
    value: Number(node.getAttribute('data-biomass')),
    area: Number(node.getAttribute('data-area')),
    color: getComputedStyle(node).fill,
  })));
}

test('simule et compare les gradients sigmoïdes avec les couleurs et valeurs natives', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1050 });
  const panel = await openExperiment(page);
  const responses: Response[] = [];
  page.on('response', response => { if (isSimulation(response.request())) responses.push(response); });
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  await panel.getByRole('button', { name: 'Mode atelier' }).click();
  const left = panel.getByRole('group', { name: primaryName, exact: true });
  const right = panel.getByRole('group', { name: `${primaryName} · comparaison`, exact: true });
  const legend = panel.locator('[data-map-display]');
  const primaryProfile = panel.getByRole('combobox', { name: 'Profil du gradient', exact: true });
  const mapFullscreen = panel.getByRole('button', { name: 'Plein écran · Carte du lac', exact: true });
  const fullscreen = page.locator(':fullscreen');
  const fullscreenSlider = fullscreen.getByRole('slider', { name: 'Temps en plein écran' });
  const leaveFullscreen = fullscreen.getByRole('button', { name: 'Quitter le plein écran · Carte du lac', exact: true });
  if (evidence) await mkdir(evidence, { recursive: true });

  async function checkMonths(scenario: string) {
    const colors = new Map<number, number>();
    await expect(left.locator('[data-source="native"]')).toHaveCount(65);
    await mapFullscreen.click();
    for (const month of [0, 10, 20]) {
      await fullscreenSlider.fill(String(month));
      await expect(left).toHaveAttribute('data-time', String(month));
      const cells = await readings(left);
      expect(cells).toHaveLength(65);
      expect(cells.every(cell => cell.color === lakeMapColor(cell.ratio * 100, lakeDisplays.ratio.limits, 'ratio'))).toBe(true);
      colors.set(month, new Set(cells.map(cell => cell.color)).size);
      if (evidence) {
        await page.mouse.move(0, 0);
        await fullscreen.screenshot({ path: path.join(evidence, `18x9-${scenario}-mois-${month}.png`), animations: 'disabled' });
      }
    }
    await fullscreenSlider.fill('0');
    await leaveFullscreen.click();
    const initial = await readings(left);
    expect(initial.reduce((sum, cell) => sum + cell.value, 0)).toBeCloseTo(45_000, 8);
    const ratios = initial.map(cell => cell.ratio);
    return { span: Math.max(...ratios) - Math.min(...ratios), colors };
  }

  await panel.getByRole('button', { name: 'Biomasse initiale homogène', exact: true }).click();
  const homogeneous = await checkMonths('homogene');
  expect(homogeneous.span).toBeCloseTo(0, 14);
  expect(homogeneous.colors.get(0)).toBe(1);
  await expect(legend).toContainText('0 %');
  await expect(legend).toContainText('50 %');
  await expect(legend).toContainText('100 %');

  await panel.getByRole('button', { name: 'Gradient sigmoïde · 0,3', exact: true }).click();
  await expect(panel.getByText('Intensité simulée α = 0,3', { exact: true })).toBeVisible();
  const moderate = await checkMonths('sigmoide-03');
  expect(moderate.span).toBeGreaterThan(homogeneous.span);

  // Changing the intensity through the regular form keeps the previous simulation visible until applied.
  await expect(primaryProfile).toHaveValue('sigmoid-v2');
  await primaryProfile.selectOption('linear-v1');
  await expect(panel.getByText('Profil simulé · Sigmoïde contrastée', { exact: true })).toBeVisible();
  await primaryProfile.selectOption('sigmoid-v2');
  await panel.getByRole('slider', { name: 'Intensité du gradient α', exact: true }).fill('0.6');
  await expect(panel.getByText('Intensité simulée α = 0,3', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Appliquer et simuler', exact: true }).click();
  await expect(panel.getByText('Intensité simulée α = 0,6', { exact: true })).toBeVisible();
  const strong = await checkMonths('sigmoide-06');
  expect(strong.span).toBeGreaterThan(0.9);
  expect(strong.span).toBeGreaterThan(moderate.span + 0.25);
  expect(strong.colors.get(0)).toBeGreaterThan(20);
  expect(strong.colors.get(10)).toBeGreaterThan(20);
  const range = panel.locator('[data-initial-ratio-min]');
  expect(Number(await range.getAttribute('data-initial-ratio-min'))).toBeCloseTo(0.011, 3);
  expect(Number(await range.getAttribute('data-initial-ratio-max'))).toBeCloseTo(0.967, 3);

  expect(responses).toHaveLength(12);
  const native = (await Promise.all(responses.slice(8).map(async response => {
    expect(response.ok()).toBe(true);
    const result = await response.json() as RunResult;
    expect(result.modelId).toContain('-sigmoid-v2-wg0p6-');
    return result.observations;
  }))).flat();
  expect(native).toHaveLength(65);
  expect(native.every(({ samples }) => samples.length === 201 && samples[200]?.time === 20)).toBe(true);

  const selected = await left.locator('[data-cell][aria-pressed="true"]').getAttribute('data-cell');
  const ids = (await readings(left)).map(cell => cell.id).filter(id => id !== selected).slice(0, 11);
  const search = panel.getByRole('searchbox', { name: 'Rechercher une cellule par identifiant' });
  for (const id of ids.slice(0, 10)) {
    await search.fill(id);
    await panel.getByRole('button', { name: `Comparer ${id}`, exact: true }).click();
  }
  await search.fill(ids[10]!);
  await expect(panel.getByRole('button', { name: `Comparer ${ids[10]}`, exact: true })).toBeDisabled();
  await expect(panel.getByText('10 / 10 cellules supplémentaires')).toBeVisible();
  await expect(chart(panel)).toHaveAttribute('data-series', [selected, ...ids.slice(0, 10)].join(','));
  await expect(panel.locator('[data-series-cell]')).toHaveCount(11);
  await search.fill('');

  await panel.getByRole('button', { name: 'Comparer homogène / sigmoïde', exact: true }).click();
  await expect(right.locator('[data-source="native"]')).toHaveCount(65);
  await expect(panel.getByRole('combobox', { name: 'Profil du gradient comparé' })).toHaveValue('sigmoid-v2');
  await slider(panel).fill('10');
  await expect(left).toHaveAttribute('data-time', '10');
  await expect(right).toHaveAttribute('data-time', '10');
  await expect(chart(panel)).toHaveAttribute('data-time', '10');
  expect(responses).toHaveLength(12); // Both datasets were already cached.
  const ratioReadings = await readings(right);
  expect(ratioReadings.map(cell => cell.value)).toEqual(native.map(row => row.samples[100]!.value));
  expect(new Set((await readings(left)).map(cell => cell.color)).size).toBe(1);
  expect(ratioReadings.every(cell => cell.color === lakeMapColor(cell.ratio * 100, lakeDisplays.ratio.limits, 'ratio'))).toBe(true);
  await expect(legend).toHaveAttribute('data-scale-min', '0');
  await expect(legend).toHaveAttribute('data-scale-max', '100');

  const display = panel.getByRole('combobox', { name: 'Affichage de la carte' });
  await display.selectOption('density');
  expect((await readings(right)).map(({ id, ratio, value, area }) => ({ id, ratio, value, area })))
    .toEqual(ratioReadings.map(({ id, ratio, value, area }) => ({ id, ratio, value, area })));
  await display.selectOption('ratio');
  await mapFullscreen.click();
  await fullscreen.getByRole('button', { name: 'Zoom avant' }).first().click();
  await expect(right).toHaveAttribute('data-zoom', '1.5');
  await expect(left).toHaveAttribute('viewBox', (await right.getAttribute('viewBox'))!);
  expect(await readings(right)).toEqual(ratioReadings);
  await leaveFullscreen.click();
  expect(await readings(right)).toEqual(ratioReadings);

  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Exporter cette vue' }).click();
  const svg = await download;
  expect(svg.suggestedFilename()).toBe('lac-de-guiers-18x9-mois-10-comparaison-homogeneous-wet-gradient-sigmoid-v2-0.6.svg');
  expect(await readFile((await svg.path())!, 'utf8')).toContain('data-profile="sigmoid-v2" data-alpha="0.6"');
});
