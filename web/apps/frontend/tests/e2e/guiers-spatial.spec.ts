import { expect, test } from '@playwright/test';
import { syntheticGuiersAlternative, syntheticGuiersFishing } from '../guiers-fixture';

test('niveau 2, SIG local, comparaison, lecture pêcheur et retour au niveau 1', async ({ page }) => {
  const errors: string[] = [];
  let runs = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (req.url().endsWith('/api/v1/simulations/run')) runs++; });
  await page.goto('/');
  const one = page.getByRole('button', { name: 'Niveau 1 — Atelier actuel', exact: true });
  const two = page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true });
  await two.click();
  const root = page.locator('#level-two');
  const reading = root.getByRole('group', { name: 'Lecture de l’atelier' });
  await reading.getByRole('button', { name: 'Scientifique', exact: true }).click();
  await root.getByRole('button', { name: 'Explorer le référentiel du lac' }).click();
  const atlas = root.getByRole('region', { name: 'Référentiel SIG du lac' });
  const configuration = atlas.getByRole('combobox', { name: 'Configuration', exact: true });
  const importFile = atlas.getByLabel('Ouvrir un référentiel candidat local', { exact: true });
  await expect(configuration).toHaveValue('H');
  await expect(configuration.locator('option[value=H_PLUS]')).toHaveJSProperty('disabled', true);
  await expect(configuration.locator('option').filter({ hasText: 'Lv+' })).toHaveJSProperty('disabled', true);
  await expect(atlas.getByText(/405 cellules actives/)).toBeVisible();
  await importFile.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(atlas.getByRole('alert')).toBeVisible();
  await expect(configuration).toHaveValue('H');
  await importFile.setInputFiles({ name: 'synthetique.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(syntheticGuiersAlternative())) });
  await expect(atlas.getByText('Aperçu avant activation locale')).toBeVisible();
  await expect(configuration).toHaveValue('H');
  await atlas.getByRole('button', { name: 'Activer le référentiel candidat' }).click();
  await expect(configuration).toHaveValue('H_PLUS');
  await expect(atlas.locator('.geo-sig-village')).toHaveCount(1);
  await atlas.getByRole('group', { name: 'Couches à afficher' }).getByRole('checkbox', { name: 'Villages candidats' }).uncheck();
  await expect(atlas.locator('.geo-sig-village')).toHaveCount(0);
  await atlas.getByLabel('Comparer les contours').check();
  await expect(atlas.locator('.geo-sig-alternate')).toHaveCount(1);
  await configuration.selectOption('E');
  await atlas.getByRole('combobox', { name: 'Résolution', exact: true }).selectOption('500');
  await expect(atlas.getByText(/1 cellules actives/)).toBeVisible();
  await configuration.selectOption('H_PLUS');
  await expect(atlas.getByText(/1283 cellules actives/)).toBeVisible();

  await page.setViewportSize({ width: 400, height: 850 });
  await reading.getByRole('button', { name: 'Pêcheur', exact: true }).click();
  await expect(atlas).toBeVisible();
  await expect(atlas.getByText(/EPSG/)).toHaveCount(0);
  expect(await atlas.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await reading.getByRole('button', { name: 'Scientifique', exact: true }).click();
  await expect(atlas.getByText(/EPSG/)).toBeVisible();
  await atlas.getByRole('button', { name: 'Fermer les données locales' }).click();
  await expect(configuration).toHaveValue('H');
  await root.getByRole('button', { name: 'Revenir aux lieux de pêche' }).click();
  await expect(root.getByRole('button', { name: 'Indiquer un endroit', exact: true })).toBeVisible();
  await one.click();
  await expect(one).toHaveAttribute('aria-current', 'page');
  expect(runs).toBe(0);
  expect(errors).toEqual([]);
});

test('croissance native sur H et résultat attaché à sa résolution', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click();
  const root = page.locator('#level-two');
  await root.getByRole('group', { name: 'Lecture de l’atelier' }).getByRole('button', { name: 'Scientifique', exact: true }).click();
  await root.getByRole('button', { name: 'Explorer le référentiel du lac' }).click();
  const atlas = root.getByRole('region', { name: 'Référentiel SIG du lac' });
  await atlas.getByRole('button', { name: 'Simuler la croissance autonome' }).click();
  await expect(atlas.getByText(/Biomasse simulée/)).toBeVisible({ timeout: 45000 });
  await expect(atlas.locator('path[fill^="hsl"]')).toHaveCount(405);
  await atlas.getByRole('combobox', { name: 'Résolution', exact: true }).selectOption('500');
  await expect(atlas.getByText(/son référentiel et sa résolution d’origine/)).toBeVisible();
  await expect(atlas.locator('path[fill^="hsl"]')).toHaveCount(0);
  await atlas.getByRole('combobox', { name: 'Résolution', exact: true }).selectOption('1000');
  await expect(atlas.locator('path[fill^="hsl"]')).toHaveCount(405);
});

test('le paquet V2 ouvre le périmètre candidat, sans requête de simulation', async ({ page }) => {
  let runs = 0;
  page.on('request', req => { if (req.url().endsWith('/api/v1/simulations/run')) runs++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click();
  const root = page.locator('#level-two');
  const reading = root.getByRole('group', { name: 'Lecture de l’atelier' });
  await reading.getByRole('button', { name: 'Scientifique', exact: true }).click();
  await root.getByRole('button', { name: 'Explorer le référentiel du lac' }).click();
  const atlas = root.getByRole('region', { name: 'Référentiel SIG du lac' });
  const configuration = atlas.getByRole('combobox', { name: 'Configuration', exact: true });
  const resolution = atlas.getByRole('combobox', { name: 'Résolution', exact: true });
  await expect(configuration.locator('option[value=HP_PLUS]')).toHaveJSProperty('disabled', true);
  await atlas.getByLabel('Ouvrir un référentiel candidat local', { exact: true }).setInputFiles(process.env.GUIERS_TEST_V2_BUNDLE ??
    { name: 'synthetique-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(syntheticGuiersFishing())) });
  await expect(atlas.getByText('Aperçu avant activation locale')).toBeVisible();
  await expect(configuration).toHaveValue('H');
  await atlas.getByRole('button', { name: 'Activer le référentiel candidat' }).click();
  await expect(configuration).toHaveValue('HP_PLUS');
  await expect(atlas.getByRole('button', { name: 'Simuler la croissance autonome' })).toBeDisabled();
  await atlas.getByLabel('Comparer les contours').check();
  await expect(atlas.locator('.geo-sig-removed')).toBeVisible();
  await expect(atlas.locator('.geo-sig-cut')).toBeVisible();
  await expect(atlas.locator('.geo-sig-village-outside')).toHaveCount(1);
  await atlas.getByText('Connectivité aquatique géométrique', { exact: true }).click();
  await expect(atlas.getByText(/water_parts_v1/)).toBeVisible();
  const localResult = process.env.GUIERS_TEST_V2_RESULT;
  if (localResult) {
    await atlas.getByLabel('Ouvrir un résultat local', { exact: true }).setInputFiles(localResult);
    await expect(atlas.getByText(/Biomasse simulée/)).toBeVisible();
    await resolution.selectOption('500');
    await expect(atlas.getByText(/son référentiel et sa résolution d’origine/)).toBeVisible();
    await resolution.selectOption('1000');
    await expect(atlas.getByText(/Biomasse simulée/)).toBeVisible();
  }
  await reading.getByRole('button', { name: 'Pêcheur', exact: true }).click();
  await expect(atlas.getByText(/Le périmètre proposé/)).toBeVisible();
  await expect(atlas.getByText(/water_parts_v1/)).toHaveCount(0);
  expect(runs).toBe(0);
});
