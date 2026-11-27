import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';

test('recette locale du SIG synthétique et des simulations natives', async ({ page, request }) => {
  test.skip(process.env.GUIERS_RECIPE !== 'synthetic', 'Requiert le lanceur avec -Synthetic.');
  test.setTimeout(180_000);
  const output = process.env.GUIERS_SCREENSHOTS;
  if (output) await mkdir(output, { recursive: true });
  const capture = async (name: string, top?: Locator) => {
    if (!output) return;
    const viewport = page.viewportSize()!;
    const taller = /^(05|11|12|13|14)-/.test(name);
    if (taller) await page.setViewportSize({ ...viewport, height: 1300 });
    if (top) await top.evaluate(node => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: join(output, name), animations: 'disabled' });
    if (taller) await page.setViewportSize(viewport);
  };

  const api = 'http://127.0.0.1:3001';
  const reference = `${api}/local/guiers/reference`;
  const origin = 'http://localhost:3000';
  const health = await request.get(`${api}/api/v1/health`);
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).runner.available).toBe(true);
  expect((await request.get(reference)).status()).toBe(404);
  expect((await request.get(reference, { headers: { Origin: 'http://example.test' } })).status()).toBe(404);
  const local = await request.get(reference, { headers: { Origin: origin } });
  expect(local.headers()['cache-control']).toBe('no-store');
  expect(local.headers()['access-control-allow-origin']).toBe(origin);
  const bundle = await local.json();
  expect(bundle.synthetic).toBe(true);
  expect((await request.get(`${api}/local/guiers/graph?configuration=HP_PLUS&resolution=1000&sha=bad`,
    { headers: { Origin: origin } })).status()).toBe(400);
  for (const path of ['/geography/candidate-local-v2.json', '/local-sig-guiers/recipe/candidate-local-v2.json',
    '/api/v1/local/guiers/reference', '/water-part-graphs.json', '/mask-local.geojson']) {
    expect((await request.get(origin + path)).status()).toBe(404);
  }

  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin);
  const one = page.getByRole('button', { name: 'Niveau 1 — Atelier actuel', exact: true });
  const two = page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true });
  await expect(one).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#level-one').getByRole('button', { name: 'Moteur connecté' })).toBeVisible();
  await capture('01-niveau-1.png');
  await two.click();
  const level = page.locator('#level-two');
  const reading = level.getByRole('group', { name: 'Lecture de l’atelier' });
  await reading.getByRole('button', { name: 'Scientifique', exact: true }).click();
  await expect(level.getByRole('button', { name: 'Moteur connecté' })).toBeVisible();
  await capture('02-niveau-2.png', level);
  await level.getByRole('button', { name: 'Explorer le référentiel du lac' }).click();
  const atlas = level.getByRole('region', { name: 'Référentiel SIG du lac' });
  const configuration = atlas.getByRole('combobox', { name: 'Configuration', exact: true });
  const resolution = atlas.getByRole('combobox', { name: 'Résolution', exact: true });
  const map = atlas.locator('.geo-map-card');
  await expect(configuration).toHaveValue('HP_PLUS');
  await expect(resolution).toHaveValue('1000');
  await expect(atlas.getByText(/^Recette synthétique\. Le fond HydroLAKES/)).toBeVisible();
  await configuration.selectOption('H');
  await expect(atlas.getByText(/405 cellules actives/)).toBeVisible();
  await capture('03-hydrolakes-complet.png', atlas);
  await configuration.selectOption('E');
  await expect(configuration.locator('option:checked')).toHaveText(/contour alternatif synthétique/);
  await capture('04-contour-alternatif-synthetique.png', atlas);
  await configuration.selectOption('H_PLUS');
  await expect(atlas.getByText(/405 cellules actives/)).toBeVisible();
  await configuration.selectOption('HP_PLUS');
  await atlas.getByLabel('Comparer les contours').check();
  await atlas.getByLabel('Masque du domaine').check();
  await expect(map.locator('.geo-sig-removed')).toBeVisible();
  await expect(map.locator('.geo-sig-cut')).toBeVisible();
  await expect(map.locator('.geo-sig-mask')).toBeVisible();
  await capture('05-hybride-hp-plus-synthetique.png', atlas);
  for (const [label, selector] of [['Villages candidats', '.geo-sig-village'], ['Noms des villages', '.geo-sig-village-name'],
    ['Réserves candidates (à confirmer)', '.geo-sig-reserve'], ['Typha théorique', '.geo-sig-typha']] as const) {
    const control = atlas.getByRole('checkbox', { name: label, exact: true });
    await control.uncheck();
    await expect(map.locator(selector)).toHaveCount(0);
    await control.check();
    await expect(map.locator(selector)).toHaveCount(1);
  }
  await capture('06-villages-reserves-typha-synthetiques.png', map);
  const zoom = map.getByRole('button', { name: 'Agrandir le fond géographique' });
  const svg = map.getByRole('group', { name: 'Carte géographique des lieux' });
  const center = await svg.getAttribute('viewBox');
  await zoom.click();
  await map.getByRole('button', { name: 'Déplacer vers le nord' }).click();
  await expect(svg).not.toHaveAttribute('viewBox', center!);
  await map.getByRole('button', { name: 'Recentrer le lac' }).click();
  await expect(svg).toHaveAttribute('viewBox', center!);
  await atlas.getByLabel('Grille', { exact: true }).check();
  await expect(map.locator('.geo-sig-cell')).toHaveCount(148);
  await capture('07-grille-1000m.png', map);
  await resolution.selectOption('500');
  await expect(map.locator('.geo-sig-cell')).toHaveCount(524);
  await capture('08-grille-500m.png', map);
  await atlas.getByLabel('Sous-composantes aquatiques').check();
  await atlas.getByLabel('Relations de voisinage').check();
  await expect(map.locator('.geo-sig-parts')).toBeVisible();
  await expect(map.locator('.geo-sig-links')).toBeVisible();
  await capture('09-connectivite-aquatique.png', map);
  await atlas.getByLabel('Relations de voisinage').uncheck();
  await expect(map.locator('.geo-sig-links')).toHaveCount(0);
  const cell = atlas.getByRole('combobox', { name: 'Cellule active' });
  await map.locator('.geo-sig-cell').evaluateAll(cells => {
    const click = cells.flatMap(candidate => {
      const { x, y, width, height } = candidate.getBoundingClientRect();
      const element = document.elementFromPoint(x+width/2, y+height/2);
      return element === candidate ? [{ candidate, x: x+width/2, y: y+height/2 }] : [];
    })[0];
    if (click) click.candidate.setAttribute('data-click-target', `${click.x},${click.y}`);
  });
  const clickTarget = await map.locator('[data-click-target]').getAttribute('data-click-target');
  const [x, y] = clickTarget!.split(',').map(Number);
  await page.mouse.click(x!, y!);
  await expect(cell).not.toHaveValue('');
  const details = atlas.getByRole('region', { name: 'Détails de la cellule' });
  await expect(details.getByText(/m² au total.*m² en eau/)).toBeVisible();
  await details.getByText(/Parties et connexions aquatiques/).click();
  await capture('10-details-cellule.png', map);

  await atlas.getByLabel('Sous-composantes aquatiques').uncheck();
  await resolution.selectOption('1000');
  await atlas.getByLabel('Durée (jours)').fill('10');
  await atlas.getByLabel('Taux de croissance (par jour)').fill('0.04');
  const run = atlas.getByRole('button', { name: 'Simuler la croissance autonome' });
  const cursor = atlas.getByRole('slider', { name: 'Jour de simulation' });
  const nativeRun = (count: number) => page.waitForResponse(response => response.url() === `${api}/local/guiers/run` && response.request().method() === 'POST')
    .then(async response => {
      expect(response.ok()).toBeTruthy();
      const result = await response.json();
      expect(result.parameters).toMatchObject({ days: 10, growthPerDay: 0.04 });
      expect(result.cells).toHaveLength(count);
      expect(result.cells[0].samples.at(-1).value).toBeGreaterThan(result.cells[0].samples[0].value);
    });
  await Promise.all([nativeRun(148), run.click()]);
  await expect(cursor).toHaveValue('10');
  await expect(atlas.getByRole('img', { name: 'Évolution de la biomasse totale par jour' })).toBeVisible();
  await expect(map.locator('path[fill^="hsl"]')).toHaveCount(148);
  await cell.selectOption({ index: 1 });
  await expect(details.getByText(/Biomasse initiale.*Biomasse au jour 10/)).toBeVisible();
  await cell.selectOption('');
  await cursor.press('Home');
  await expect(cursor).toHaveValue('0');
  await capture('11-croissance-initiale.png', map);
  for (let i = 0; i < 5; i++) await cursor.press('ArrowRight');
  await expect(cursor).toHaveValue('5');
  await capture('12-croissance-intermediaire.png', map);
  await cursor.press('End');
  await expect(cursor).toHaveValue('10');
  await capture('13-croissance-finale.png', map);
  await resolution.selectOption('500');
  await expect(cursor).toHaveCount(0);
  await Promise.all([nativeRun(524), run.click()]);
  await expect(map.locator('path[fill^="hsl"]')).toHaveCount(524);
  await expect(atlas.getByText(/À 1000 m, biomasse initiale/)).toBeVisible();
  await resolution.selectOption('1000');
  await expect(cursor).toHaveValue('10');
  await expect(atlas.getByText(/À 500 m, biomasse initiale/)).toBeVisible();
  await resolution.selectOption('500');
  await reading.getByRole('button', { name: 'Pêcheur', exact: true }).click();
  await expect(cursor).toBeVisible();
  await expect(atlas.getByText(/EPSG/)).toHaveCount(0);
  await atlas.getByRole('button', { name: 'Animer la biomasse' }).click();
  await expect(cursor).not.toHaveValue('10');
  await capture('14-mode-pecheur.png', atlas);
  await reading.getByRole('button', { name: 'Scientifique', exact: true }).click();
  await atlas.getByRole('button', { name: 'Réinitialiser la simulation' }).click();
  await expect(cursor).toHaveCount(0);
  await expect(map.locator('path[fill^="hsl"]')).toHaveCount(0);
  await atlas.getByRole('button', { name: 'Fermer les données locales' }).click();
  await expect(configuration).toHaveValue('H');
  const invalid = JSON.parse(bundle.raw);
  invalid.sources.lac.rights = 'unconfirmed';
  await atlas.getByLabel('Ouvrir un référentiel candidat local', { exact: true }).setInputFiles({
    name: 'non-autorise.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)),
  });
  await expect(atlas.getByRole('alert')).toBeVisible();
  await expect(configuration).toHaveValue('H');
  await one.click();
  await expect(one).toHaveAttribute('aria-current', 'page');
  expect(pageErrors).toEqual([]);
});
