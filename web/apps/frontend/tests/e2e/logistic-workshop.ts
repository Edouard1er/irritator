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

export async function openInteractions(page: Page) {
  const panel = await openExperiment(page);
  await panel.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('interactions');
  return panel.getByRole('region', { name: 'Interactions spatiales' });
}

export async function clickWetCell(page: Page, region: Locator) {
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
