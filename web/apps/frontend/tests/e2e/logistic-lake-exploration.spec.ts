import { expect, test, type Locator, type Response } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { RunResult } from '@contracts';
import { chart, isSimulation, openExperiment, slider } from './logistic-workshop';

const livingEvidence = process.env.IRRITATOR_LAKE_LIVING_EVIDENCE;

// La capture vidéo de la trace Playwright fausse la mesure de la cadence.
test.use({ trace: 'off' });

test('la comparaison anime deux cartes de 296 cellules avec les mêmes mois, valeurs et échelles', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await openExperiment(page);
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  const distribution = panel.getByRole('combobox', { name: 'Distribution biologique' });
  const display = panel.getByRole('combobox', { name: 'Affichage de la carte' });
  const scale = panel.getByRole('combobox', { name: 'Échelle des écarts' });
  const legend = panel.locator('[data-map-display]');
  const left = panel.getByRole('group', { name: 'Grille humide du lac de Guiers', exact: true });
  const right = panel.getByRole('group', { name: 'Grille humide du lac de Guiers · comparaison', exact: true });
  const responses: Response[] = [];
  page.on('response', response => { if (isSimulation(response.request())) responses.push(response); });
  async function observations(offset: number) {
    return (await Promise.all(responses.slice(offset).map(async response => (await response.json() as RunResult).observations))).flat();
  }

  await panel.getByRole('combobox', { name: 'Résolution du lac' }).selectOption('48x24');
  await distribution.selectOption('wet-gradient');
  await panel.getByRole('slider', { name: 'Intensité du gradient α' }).fill('0.6');
  await panel.getByRole('button', { name: 'Appliquer et simuler', exact: true }).click();
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible({ timeout: 60000 });
  const weighted = await observations(0);
  expect(weighted).toHaveLength(296);
  expect(responses).toHaveLength(17);

  await display.selectOption('difference');
  await expect(panel.getByText('Simulez la distribution homogène sur cette grille pour afficher les écarts.')).toBeVisible();
  await expect(left.locator('[data-map-value]')).toHaveCount(0);
  await expect(legend).toHaveAttribute('data-scale-unit', 'points de %');
  expect(responses).toHaveLength(17);

  await panel.getByRole('checkbox', { name: 'Comparer deux scénarios' }).check();
  const secondary = panel.getByRole('combobox', { name: 'Distribution à comparer' });
  await secondary.selectOption('homogeneous');
  await expect(right.getByRole('button')).toHaveCount(296);
  await expect(right.locator('[data-biomass]')).toHaveCount(296);
  await expect(right.locator('[data-biomass]').first()).toHaveAttribute('data-biomass', String(weighted[0]!.samples[0]!.value));
  expect(responses).toHaveLength(17);
  const compareRun = panel.getByRole('button', { name: 'Appliquer et simuler le scénario comparé' });
  await compareRun.click();
  await expect(panel.getByText('Observations disponibles · Distribution homogène')).toBeVisible({ timeout: 60000 });
  const homogeneous = await observations(17);
  expect(homogeneous).toHaveLength(296);
  expect(responses).toHaveLength(34);

  await distribution.selectOption('homogeneous');
  await panel.getByRole('button', { name: 'Appliquer et simuler', exact: true }).click();
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible();
  await secondary.selectOption('wet-gradient');
  await compareRun.click();
  await expect(panel.getByText(/Observations disponibles · Gradient pondéré/)).toBeVisible();
  await expect(compareRun).toHaveCount(0);

  const id = await right.locator('[data-cell]').first().getAttribute('data-cell');
  expect(id).toBeTruthy();
  await right.locator(`[data-cell="${id}"]`).press('Enter');
  const leftCell = left.locator(`[data-cell="${id}"]`);
  const rightCell = right.locator(`[data-cell="${id}"]`);
  await expect(leftCell).toHaveAttribute('aria-pressed', 'true');
  await expect(rightCell).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('combobox', { name: 'Cellule à consulter' })).toHaveValue(id!);
  await expect(chart(panel)).toHaveAttribute('data-series', id!);
  await expect(panel.locator(`[data-series-cell="${id}"]`)).toHaveAttribute('data-selected', 'true');

  await slider(panel).fill('10');
  const a = homogeneous.find(entry => entry.component === `${id}-N`)!.samples[100]!.value;
  const b = weighted.find(entry => entry.component === `${id}-N`)!.samples[100]!.value;
  const area = Number(await rightCell.getAttribute('data-area'));
  const mapValue = async (which: Locator) => Number(await which.getAttribute('data-map-value'));
  const fixed = Number(await legend.getAttribute('data-scale-max'));
  expect(fixed).toBeGreaterThan(10);
  await expect(legend).toHaveAttribute('data-scale-min', String(-fixed));
  expect(await mapValue(leftCell)).toBe(0);
  expect(await mapValue(rightCell)).toBeCloseTo((b / (300 * area) - a / (300 * area)) * 100, 10);
  await expect(left).toHaveAttribute('data-time', '10');
  await expect(right).toHaveAttribute('data-time', '10');

  const leftTotal = homogeneous.reduce((sum, row) => sum + row.samples[100]!.value, 0);
  const rightTotal = weighted.reduce((sum, row) => sum + row.samples[100]!.value, 0);
  await expect(panel.locator('[data-total-biomass]')).toHaveAttribute('data-total-biomass', String(leftTotal));
  await expect(panel.locator('[data-map-total-difference]')).toHaveAttribute('data-map-total-difference', String(rightTotal - leftTotal));
  await expect(panel.locator(`[data-series-cell="${id}"]`)).toHaveAttribute('data-biomass', String(a));

  await display.selectOption('density');
  await expect(legend).toHaveAttribute('data-scale-unit', 't/km²');
  await expect(legend).toHaveAttribute('data-scale-max', '300');
  expect(await mapValue(rightCell)).toBe(b / area);
  await display.selectOption('ratio');
  await expect(legend).toHaveAttribute('data-scale-unit', '%');
  expect(await mapValue(rightCell)).toBeCloseTo(b / (300 * area) * 100, 10);
  await display.selectOption('difference');
  await expect(legend).toHaveAttribute('data-scale-max', String(fixed));
  await scale.selectOption('month');
  await expect(legend).toContainText('Échelle ajustée au mois consulté.');
  const adaptive = Number(await legend.getAttribute('data-scale-max'));
  expect(adaptive).toBeGreaterThan(0);
  expect(adaptive).toBeLessThan(fixed);
  await slider(panel).fill('20');
  const endScale = Number(await legend.getAttribute('data-scale-max'));
  expect(endScale).toBeGreaterThan(0);
  expect(endScale).toBeLessThan(adaptive);
  expect(new Set(await right.locator('[data-map-value]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill))).size)
    .toBeGreaterThan(20);

  await panel.getByRole('button', { name: 'Plein écran · Carte du lac', exact: true }).click();
  const fullscreen = page.locator(':fullscreen');
  await expect(fullscreen.getByRole('slider', { name: 'Temps en plein écran' })).toHaveValue('20');
  await fullscreen.getByRole('button', { name: 'Zoom avant' }).first().click();
  await expect(right).toHaveAttribute('data-zoom', '1.5');
  await expect(right).toHaveAttribute('viewBox', (await left.getAttribute('viewBox'))!);
  await fullscreen.getByRole('button', { name: 'Réinitialiser le cadrage' }).first().click();
  await fullscreen.getByRole('slider', { name: 'Temps en plein écran' }).fill('10');
  await expect(left).toHaveAttribute('data-time', '10');
  await expect(right).toHaveAttribute('data-time', '10');
  await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Carte du lac', exact: true }).click();
  await expect(slider(panel)).toHaveValue('10');
  await expect(rightCell).toHaveAttribute('aria-pressed', 'true');
  await expect(scale).toHaveValue('month');

  if (livingEvidence) {
    await mkdir(livingEvidence, { recursive: true });
    for (const [mode, instant] of [['ratio', 0], ['density', 10], ['difference', 20]] as const) {
      await display.selectOption(mode);
      await slider(panel).fill(String(instant));
      await panel.getByRole('button', { name: 'Plein écran · Carte du lac', exact: true }).click();
      await expect(fullscreen).toBeVisible();
      await page.screenshot({ path: path.join(livingEvidence, `48x24-${mode}-t${instant}.png`), animations: 'disabled' });
      await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Carte du lac', exact: true }).click();
    }
    await slider(panel).fill('10');
    await panel.getByRole('button', { name: 'Plein écran · Trajectoires', exact: true }).click();
    await expect(fullscreen.locator('[data-lake-cursor]')).toHaveAttribute('data-lake-cursor', '10');
    await page.screenshot({ path: path.join(livingEvidence, '48x24-trajectoires-t10.png'), animations: 'disabled' });
    await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Trajectoires', exact: true }).click();
  }

  await slider(panel).fill('0');
  await panel.getByRole('combobox', { name: 'Vitesse' }).selectOption('4');
  const metrics = page.evaluate(() => new Promise<{ updates: number; longest: number; outOfSync: boolean }>(resolve => {
    const maps = [...document.querySelectorAll('svg[data-rows="48"]')];
    const marker = document.querySelector('[data-lake-cursor]');
    let updates = 0;
    let longest = 0;
    let previous = 0;
    let outOfSync = false;
    const finish = () => { observer.disconnect(); resolve({ updates, longest, outOfSync }); };
    const watchdog = setTimeout(finish, 7000);
    const observer = new MutationObserver(() => {
      const now = performance.now();
      const time = maps[0]?.getAttribute('data-time');
      outOfSync ||= time !== maps[1]?.getAttribute('data-time') || time !== marker?.getAttribute('data-lake-cursor');
      if (previous) longest = Math.max(longest, now - previous);
      else {
        clearTimeout(watchdog);
        setTimeout(finish, 2200);
      }
      previous = now;
      updates++;
    });
    observer.observe(maps[0]!, { attributeFilter: ['data-time'] });
  }));
  await panel.getByRole('button', { name: 'Lire', exact: true }).click();
  const measured = await metrics;
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await testInfo.attach('lecture-x4-48x24', { body: JSON.stringify(measured), contentType: 'application/json' });
  expect(measured.outOfSync).toBe(false);
  expect(measured.updates).toBeGreaterThanOrEqual(32);
  expect(measured.longest).toBeLessThan(300);
  const paused = await left.getAttribute('data-time');
  expect(Number(paused)).toBeCloseTo(Number(await slider(panel).inputValue()), 9);
  await expect(right).toHaveAttribute('data-time', paused!);
  await expect(chart(panel)).toHaveAttribute('data-time', paused!);
  await expect(chart(panel).locator('[data-lake-cursor]')).toHaveAttribute('data-lake-cursor', paused!);
  expect(responses).toHaveLength(34);
});
