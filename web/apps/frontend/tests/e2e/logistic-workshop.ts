import { expect, type Locator, type Page } from '@playwright/test';

const experiment = 'Expérience logistique spatiale';
export const isSimulation = (request: { method(): string; url(): string }) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/simulations/run';

export async function openExperiment(page: Page) {
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

export const slider = (panel: Locator) => panel.getByRole('slider', { name: 'Temps simulé', exact: true });
export const chart = (panel: Locator) => panel.getByLabel('Trajectoires logistiques', { exact: true });
