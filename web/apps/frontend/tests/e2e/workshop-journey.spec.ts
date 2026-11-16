import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
const evidence = path.resolve('../../../reports/niveau2-2.3.A');
const captureStyle = 'html,body,.level-application,.level-workspace,.workbench,.modeling-workspace{height:auto!important;max-height:none!important;overflow:visible!important}nextjs-portal{display:none!important}';
const nav = (two: Locator, name: string) => two.getByRole('navigation', { name: 'Étapes de l’atelier' }).getByRole('button', { name: new RegExp(name) });
const audience = (two: Locator, name: string) => two.getByRole('group', { name: 'Lecture de l’atelier' }).getByRole('button', { name, exact: true });
async function open(page: Page) { await page.goto('/'); await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click(); return page.locator('#level-two'); }
async function prepare(two: Locator) { await audience(two, 'Scientifique').click(); await two.getByRole('checkbox', { name: /Je confirme que la collecte/ }).check(); await two.getByLabel('Code participant (pseudonyme)', { exact: true }).fill('P-TEST'); }
async function capture(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.locator('#level-two .level-two-journey').screenshot({ path: path.join(evidence, name + '.png'), style: captureStyle });
}
test.use({ hasTouch: true });
test('S1 real Irritator, independent D1/presentation/D2, export/reimport, native purity and level one retained', async ({ page }) => {
  test.setTimeout(180000); page.on('dialog', d => d.accept()); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let calls = 0; page.on('request', r => { if (r.url().endsWith('/api/v1/simulations/run')) calls++; });
  await page.goto('/'); const one = page.locator('#level-one');
  await one.getByLabel('Ouvrir un modèle JSON', { exact: true }).setInputFiles(path.resolve('../../examples/atelier-interventions-month-v3.json'));
  await one.getByLabel('Nom du modèle', { exact: true }).fill('niveau1-conserve-2-3-a');
  await expect(one.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  const oneResponse = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run')); await one.getByRole('button', { name: 'Simuler', exact: true }).click(); expect((await oneResponse).status()).toBe(200);
  await one.getByLabel('Position temporelle').fill('25');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('irritator.workspace.v2')!).request.model.id)).toBe('niveau1-conserve-2-3-a');
  const storageOne = await page.evaluate(() => localStorage.getItem('irritator.workspace.v2'));
  await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click(); const two = page.locator('#level-two');
  await prepare(two); await two.getByRole('button', { name: 'Essayer la démonstration fictive' }).click(); await two.getByRole('button', { name: 'Zone fictive A', exact: true }).click(); await two.getByRole('button', { name: 'Confirmer cette zone' }).click();
  await nav(two, 'Votre premier choix').click(); await audience(two, 'Pêcheur').click();
  await expect(nav(two, 'Voyons')).toBeDisabled(); await expect(nav(two, 'Votre choix maintenant')).toBeDisabled();
  await expect(two.getByLabel('Espace Simulation')).not.toBeVisible();
  await two.getByRole('radio', { name: 'Rechercher plus d’informations', exact: true }).check(); await two.getByRole('textbox', { name: 'Pourquoi ce choix ? (facultatif)', exact: true }).fill('Les témoignages sont différents.');
  await nav(two, 'Notre lac').click(); await nav(two, 'Votre premier choix').click(); await expect(two.getByRole('textbox', { name: 'Pourquoi ce choix ? (facultatif)', exact: true })).toHaveValue('Les témoignages sont différents.');
  await capture(page, 'd1-pecheur-1440'); await page.setViewportSize({ width: 390, height: 844 }); await capture(page, 'd1-pecheur-390'); await audience(two, 'Scientifique').click(); await capture(page, 'd1-animateur-390'); await page.setViewportSize({ width: 1440, height: 900 }); await capture(page, 'd1-animateur-1440'); await audience(two, 'Pêcheur').click(); await two.getByRole('button', { name: 'Enregistrer mon premier choix', exact: true }).click();
  await two.getByLabel('Support à présenter', { exact: true }).selectOption('native-simulation'); await audience(two, 'Scientifique').click();
  await expect(two.getByRole('button', { name: 'Confirmer que ce support a été présenté' })).toBeDisabled();
  await page.waitForLoadState('networkidle'); if (await two.getByRole('button', { name: 'Moteur indisponible', exact: true }).isVisible()) await two.getByRole('button', { name: 'Moteur indisponible', exact: true }).click();
  await expect(two.getByRole('button', { name: /Moteur connecté/ })).toBeVisible();
  const pending = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run')); await two.getByRole('button', { name: 'Lancer la simulation Irritator' }).click(); const response = await pending; expect(response.status()).toBe(200); const native = await response.json(), executed = response.request().postDataJSON();
  await expect(two.getByLabel('Position temporelle')).toBeVisible(); await expect(two.locator('.intervention-history')).not.toBeVisible(); await capture(page, 'simulation-animateur-1440'); expect(calls).toBe(2);
  const noPresentation = await page.evaluate(() => JSON.parse(localStorage.getItem('irritator.level2.decisions.v1')!)); expect(noPresentation.records[0].presentation).toBeUndefined();
  await expect(nav(two, 'Votre choix maintenant')).toBeDisabled();
  await two.getByRole('button', { name: 'Confirmer que ce support a été présenté' }).click(); await expect(two.getByRole('heading', { name: 'Après la simulation' })).toBeVisible(); await capture(page, 'd2-animateur-1440'); await page.setViewportSize({ width: 390, height: 844 }); await capture(page, 'd2-animateur-390'); await page.setViewportSize({ width: 1440, height: 900 });
  await audience(two, 'Pêcheur').click(); await two.getByRole('radio', { name: 'Réduire les sorties', exact: true }).check(); await two.getByRole('textbox', { name: 'Pourquoi ce choix ? (facultatif)', exact: true }).fill('Je veux vérifier les prises récentes.'); await capture(page, 'd2-pecheur-1440');
  await two.getByRole('button', { name: 'Enregistrer mon choix maintenant' }).click(); await expect(two.getByText('Choix modifié', { exact: true })).toBeVisible(); await capture(page, 'bilan-pecheur-1440');
  for (const width of [1024, 390]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(page, `bilan-pecheur-${width}`); await nav(two, 'Votre premier choix').click(); await capture(page, `d1-verrouille-${width}`); await nav(two, 'Votre choix maintenant').click(); await capture(page, `d2-pecheur-${width}`); await nav(two, 'Ce qu').click(); }
  await audience(two, 'Scientifique').click(); await capture(page, 'bilan-animateur-390');
  await page.setViewportSize({ width: 1440, height: 900 }); await capture(page, 'bilan-animateur-1440');
  const download = page.waitForEvent('download'); await two.getByRole('button', { name: 'Exporter les réponses de l’atelier' }).click(); const exported = path.join(evidence, 'atelier-decisions-export-reimporte.json'); await (await download).saveAs(exported); const json = JSON.parse(await readFile(exported, 'utf8'));
  expect(json.records[0].presentation.runId).toBe(native.runId); const { fishingActivities: _, ...science } = executed; expect(JSON.parse(json.records[0].presentation.modelFingerprint)).toEqual(science);
  await two.getByLabel('Importer une séance', { exact: true }).setInputFiles(exported); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('irritator.level2.decisions.v1')!))).toEqual(json);
  await two.getByLabel('Fiches de cette séance').selectOption(json.records[0].id); await nav(two, 'Votre premier choix').click(); await expect(two.getByRole('radio', { name: 'Rechercher plus d’informations', exact: true })).toBeDisabled();
  await nav(two, 'Voyons').click(); const again = page.waitForResponse(r => r.url().endsWith('/api/v1/simulations/run')); await two.getByRole('button', { name: 'Lancer la simulation Irritator' }).click(); const rerun = await again; expect(rerun.request().postDataJSON()).toEqual(executed); expect((await rerun.json()).observations).toEqual(native.observations);
  for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Niveau 1 — Atelier actuel', exact: true }).click(); await expect(one.getByLabel('Position temporelle')).toHaveValue('25'); await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click(); }
  expect(await page.evaluate(() => localStorage.getItem('irritator.workspace.v2'))).toBe(storageOne); expect(errors).toEqual([]);
});
test('S2/S3 discussion, keyboard, mobile, reduced motion, local restore, invalid import and deletion', async ({ page }) => {
  test.setTimeout(120000); page.on('dialog', d => d.accept()); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 390, height: 844 });
  const two = await open(page); await prepare(two); await two.getByLabel('Situation de discussion').selectOption('S2-reserve');
  await audience(two, 'Pêcheur').click(); const option = two.getByRole('radio', { name: 'Demander où passent les limites', exact: true }); await option.focus(); await page.keyboard.press('Space'); await two.getByRole('button', { name: 'Enregistrer mon premier choix' }).focus(); await page.keyboard.press('Enter');
  await expect(two.getByText('Support de discussion', { exact: true })).toBeVisible(); await expect(two.getByRole('option', { name: 'Simulation calculée par Irritator' })).toHaveCount(0);
  await audience(two, 'Scientifique').click(); await two.getByRole('button', { name: 'Confirmer que ce support a été présenté' }).focus(); await page.keyboard.press('Enter'); await audience(two, 'Pêcheur').click(); await expect(two.getByRole('heading', { name: 'Après la discussion' })).toBeVisible();
  await two.getByRole('radio', { name: 'Je ne sais pas', exact: true }).check(); await two.getByRole('button', { name: 'Enregistrer mon choix maintenant' }).click(); await expect(two.getByText('Encore incertain', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await audience(two, 'Scientifique').click(); const saved = await page.evaluate(() => localStorage.getItem('irritator.level2.decisions.v1'));
  await two.getByLabel('Importer une séance', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') }); expect(await page.evaluate(() => localStorage.getItem('irritator.level2.decisions.v1'))).toBe(saved);
  await page.reload(); await page.getByRole('button', { name: 'Niveau 2 — Lac de Guiers', exact: true }).click(); await prepare(two); await two.getByRole('button', { name: 'Restaurer la séance locale' }).click(); await two.getByLabel('Fiches de cette séance').selectOption(JSON.parse(saved!).records[0].id); await nav(two, 'Ce qu').click();
  await two.getByRole('button', { name: 'Afficher la restitution anonyme' }).click(); await expect(two.getByText('Encore incertain', { exact: true })).toBeVisible(); await expect(two.getByText('P-TEST', { exact: true })).not.toBeVisible(); await capture(page, 'restitution-anonyme-390'); await two.getByRole('button', { name: 'Masquer la restitution projetable' }).click();
  await two.getByRole('button', { name: 'Nouveau participant', exact: true }).click(); await two.getByLabel('Code participant (pseudonyme)', { exact: true }).fill('P-TEST-2'); await two.getByLabel('Situation de discussion').selectOption('S3-couts'); await two.getByRole('radio', { name: 'Partager les dépenses ou organiser des sorties communes', exact: true }).check(); await two.getByRole('button', { name: 'Enregistrer mon premier choix' }).click(); await expect(two.getByRole('option', { name: 'Simulation calculée par Irritator' })).toHaveCount(0); await two.getByRole('button', { name: 'Confirmer que ce support a été présenté' }).click(); await expect(two.getByRole('heading', { name: 'Après la discussion' })).toBeVisible();
  await two.getByRole('button', { name: 'Effacer les décisions locales' }).click(); expect(await page.evaluate(() => localStorage.getItem('irritator.level2.decisions.v1'))).toBeNull();
});
test('engine failure preserves D1 and allows an explicitly recorded discussion fallback', async ({ page }) => {
  const two = await open(page); await prepare(two);
  await two.getByRole('button', { name: 'Essayer la démonstration fictive' }).click(); await two.getByRole('button', { name: 'Zone fictive A', exact: true }).click(); await two.getByRole('button', { name: 'Confirmer cette zone' }).click();
  await nav(two, 'Votre premier choix').click(); await two.getByRole('radio', { name: 'Je ne sais pas', exact: true }).check(); await two.getByRole('button', { name: 'Enregistrer mon premier choix' }).click();
  await two.getByLabel('Support à présenter', { exact: true }).selectOption('native-simulation');
  // Failure injection only; no scientific result or trajectory is mocked.
  await page.route('**/api/v1/simulations/run', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ENGINE_UNAVAILABLE', message: 'Indisponibilité injectée pour le test.' } }) }));
  await two.getByRole('button', { name: 'Lancer la simulation Irritator' }).click(); await expect(two.getByText(/La simulation n’a pas abouti/)).toBeVisible();
  await expect(two.getByRole('button', { name: 'Confirmer que ce support a été présenté' })).toBeDisabled();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('irritator.level2.decisions.v1')!)); expect(saved.records[0].before.status).toBe('unsure'); expect(saved.records[0].presentation).toBeUndefined();
  await two.getByLabel('Support à présenter', { exact: true }).selectOption('discussion-card'); await two.getByRole('button', { name: 'Confirmer que ce support a été présenté' }).click(); await expect(two.getByRole('heading', { name: 'Après la discussion' })).toBeVisible();
});
