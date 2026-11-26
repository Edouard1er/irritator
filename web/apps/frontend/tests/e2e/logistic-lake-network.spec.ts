import { expect, test, type Locator, type Response } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunRequest, RunResult } from '@contracts';
import { chart, clickWetCell, isSimulation, openInteractions, slider } from './logistic-workshop';

const evidence = process.env.IRRITATOR_LAKE_NETWORK_EVIDENCE;
const ids = ['C5_3', 'C5_4', 'C6_3'] as const;
const region = (map: Locator, id: string) => map.getByRole('button', { name: id, exact: true });
const overlays = (map: Locator) => map.locator('[data-exchange-pair]');

test('compare les scénarios natifs sur 18 × 9 et suit les deux flux incidents, dont un flux qui s’inverse', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1200 });
  const panel = await openInteractions(page);
  const responses: Response[] = [];
  let requests = 0;
  page.on('request', request => { if (isSimulation(request)) requests++; });
  page.on('response', response => { if (isSimulation(response.request())) responses.push(response); });

  await panel.getByRole('combobox', { name: 'Résolution du lac' }).selectOption('18x9');
  await panel.getByRole('combobox', { name: 'Distribution biologique' }).selectOption('wet-gradient');
  await panel.getByRole('combobox', { name: 'Profil du gradient' }).selectOption('sigmoid-v2');
  await panel.getByRole('slider', { name: 'Intensité du gradient α' }).fill('0.6');
  await panel.getByRole('combobox', { name: 'Échange de biomasse' }).selectOption('network');
  const left = panel.getByRole('group', { name: 'Carte sans échange' });
  const right = panel.getByRole('group', { name: 'Carte avec échange' });
  await expect(left).toHaveAttribute('data-rows', '18');
  const launch = panel.getByRole('button', { name: 'Simuler les deux scénarios' });
  for (const id of ids) {
    await expect(launch).toBeDisabled();
    if (id !== ids[0]) await expect(region(left, id)).toHaveAttribute('data-wet-neighbor', 'true');
    await clickWetCell(page, region(left, id));
  }
  await expect(right.locator('[data-map-selection]')).toHaveCount(3);
  await expect(overlays(right)).toHaveCount(2);
  const connections = panel.getByRole('group', { name: 'Connexions du réseau' });
  for (const peer of ids.slice(1)) {
    await expect(right.locator(`[data-exchange-pair="${ids[0]} ${peer}"]`)).toBeAttached();
    await expect(connections.getByRole('checkbox', { name: `${ids[0]} ↔ ${peer}` })).toBeDisabled();
  }
  await expect(overlays(left)).toHaveCount(0);
  await launch.click();
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(requests).toBe(9);
  expect(responses).toHaveLength(requests);
  const native = await Promise.all(responses.map(async response => {
    expect(response.ok()).toBe(true);
    return await response.json() as RunResult;
  }));
  const request = responses[4]!.request().postDataJSON() as RunRequest;
  expect(request.model.observations.map(row => row.component)).toEqual(ids.map(id => `${id}-N`));
  expect(request.model.components).toHaveLength(27);
  expect(request.model.connections).toHaveLength(39);
  const samples = (runs: RunResult[]) => new Map(runs.flatMap(run =>
    run.observations.map(({ component, samples }) => [component.slice(0, -2), samples] as const)));
  const datasets = [samples(native.slice(0, 4)), samples(native.slice(4))];
  expect(datasets.map(dataset => dataset.size)).toEqual([65, 65]);
  for (const [id, control] of datasets[0]!) {
    const coupled = datasets[1]!.get(id)!;
    expect(control).toHaveLength(201);
    expect(coupled).toHaveLength(201);
    expect(coupled[0]).toEqual(control[0]);
    if (!ids.some(cell => cell === id)) expect(coupled).toEqual(control);
  }
  const areas = new Map(await Promise.all(ids.map(async id => [id, Number(await region(right, id).getAttribute('data-area'))] as const)));
  const fullscreen = page.locator(':fullscreen');
  await panel.getByRole('button', { name: 'Plein écran · Cartes des scénarios' }).click();
  const time = fullscreen.getByRole('slider', { name: 'Temps en plein écran' });
  const firstArrow = right.locator('[data-exchange-pair="C5_3 C5_4"]');
  let initialPath = '';
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const month of [0, 5, 10, 20]) {
    await time.fill(String(month));
    await expect(left).toHaveAttribute('data-time', String(month));
    await expect(right).toHaveAttribute('data-time', String(month));
    const densities = new Map<string, number>();
    for (const [index, map] of [left, right].entries()) {
      for (const id of ids) {
        const value = datasets[index]!.get(id)![month * 10]!.value;
        const density = value / areas.get(id)!;
        await expect(region(map, id)).toHaveAttribute('data-biomass', String(value));
        const row = fullscreen.locator(`[data-network-cell="${id}"][data-network-scenario="${index ? 'B' : 'A'}"]`);
        await expect(row.locator('[data-pair-biomass]')).toHaveAttribute('data-pair-biomass', String(value));
        await expect(row.locator('[data-pair-density]')).toHaveAttribute('data-pair-density', String(density));
        if (index) densities.set(id, density);
      }
    }
    let net = 0;
    for (const peer of ids.slice(1)) {
      const a = areas.get(ids[0])!;
      const b = areas.get(peer)!;
      const flux = 0.5 * a * b / (a + b) * (densities.get(ids[0])! - densities.get(peer)!);
      net -= flux;
      const key = `${ids[0]} ${peer}`;
      const line = fullscreen.locator(`[data-network-edge="${key}"]`);
      const direction = flux > 0 ? `${ids[0]} → ${peer}` : `${peer} → ${ids[0]}`;
      await expect(right.locator(`[data-exchange-pair="${key}"]`)).toHaveAttribute('data-flow-direction', direction);
      await expect(line).toContainText(direction);
      await expect(line).toContainText('t/mois');
      expect(Number(await line.getAttribute('data-exchange-flux'))).toBeCloseTo(flux, 10);
    }
    const middle = fullscreen.locator('[data-network-cell="C5_3"][data-network-scenario="B"] [data-network-net-flux]');
    expect(Number(await middle.getAttribute('data-network-net-flux'))).toBeCloseTo(net, 10);
    if (month === 0) {
      initialPath = (await firstArrow.locator('path').last().getAttribute('d'))!;
      await expect(firstArrow).toHaveAttribute('data-flow-direction', 'C5_3 → C5_4');
    }
    if (month === 5) {
      await expect(firstArrow).toHaveAttribute('data-flow-direction', 'C5_4 → C5_3');
      await expect(firstArrow.locator('path').last()).not.toHaveAttribute('d', initialPath);
      expect(datasets[1]!.get('C6_3')![50]!.value).toBeGreaterThan(datasets[0]!.get('C6_3')![50]!.value);
    }
    if (evidence) {
      await page.mouse.move(0, 0);
      await fullscreen.screenshot({ path: path.join(evidence, `18x9-sigmoide-06-mu-05-mois-${month}.png`), animations: 'disabled' });
    }
  }
  await fullscreen.getByRole('button', { name: 'Zoom avant' }).first().click();
  await expect(right).toHaveAttribute('data-zoom', '1.5');
  await expect(right).toHaveAttribute('viewBox', (await left.getAttribute('viewBox'))!);
  await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Cartes des scénarios' }).click();
  await expect(slider(panel)).toHaveValue('20');
  await slider(panel).fill('5');
  await panel.getByRole('button', { name: 'Lire', exact: true }).click();
  await expect.poll(async () => Number(await slider(panel).inputValue())).toBeGreaterThan(5);
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await slider(panel).fill('5');

  const search = panel.getByRole('searchbox', { name: 'Rechercher une cellule par identifiant' });
  const extras = [...datasets[0]!.keys()].filter(id => !ids.some(cell => cell === id));
  for (const id of extras.slice(0, 10)) {
    await search.fill(id);
    await panel.getByRole('button', { name: `Comparer ${id}`, exact: true }).click();
  }
  await search.fill(extras[10]!);
  await expect(panel.getByRole('button', { name: `Comparer ${extras[10]}`, exact: true })).toBeDisabled();
  await expect(chart(panel).locator('[data-lake-curve]')).toHaveCount(16);
  await panel.getByRole('button', { name: 'Plein écran · Trajectoires des scénarios' }).click();
  await expect(fullscreen.locator('[data-lake-curve]')).toHaveCount(16);
  await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Trajectoires des scénarios' }).click();

  const svgDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Exporter cette vue' }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toContain('reseau-C5_3-C5_4-C6_3-mu-0.5.svg');
  const output = await readFile((await svg.path())!, 'utf8');
  expect(output).toContain('data-exchange-pair="C5_3 C5_4"');
  expect(output).toContain('data-exchange-pair="C5_3 C6_3"');
  expect(output).toContain('C5_4 → C5_3');
  await panel.getByRole('combobox', { name: 'Format de l’image' }).selectOption('png');
  const pngDownload = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Exporter cette vue' }).click();
  expect((await readFile((await (await pngDownload).path())!)).subarray(1, 4).toString()).toBe('PNG');
  expect(requests).toBe(9);
});

test('refuse un côté commun sec et autorise un réseau de six cellules avec deux cycles', async ({ page, request }) => {
  test.setTimeout(120_000);
  const panel = await openInteractions(page);
  await panel.getByRole('combobox', { name: 'Échange de biomasse' }).selectOption('network');
  const left = panel.getByRole('group', { name: 'Carte sans échange' });
  const right = panel.getByRole('group', { name: 'Carte avec échange' });
  await clickWetCell(page, region(left, 'C11'));
  await clickWetCell(page, region(left, 'C21'));
  await expect(region(left, 'C31')).not.toHaveAttribute('data-wet-neighbor');
  await region(left, 'C31').press('Enter');
  await expect(panel.getByRole('alert')).toContainText('C31 ne partage pas de frontière humide');
  await expect(overlays(right)).toHaveCount(1);
  const url = '/api/logistic-lake?resolution=6x3&distribution=homogeneous&mu=0.5';
  for (const query of ['cells=C11,C21,C31&edge=C11,C21&edge=C21,C31', 'cells=C01,C11,C21&edge=C01,C11',
    'cells=C01,C11,C21&edge=C01,C11&edge=C11,C21&edge=C21,C11']) {
    expect((await request.get(`${url}&${query}`)).status()).toBe(400);
  }

  await panel.getByRole('combobox', { name: 'Résolution du lac' }).selectOption('18x9');
  const add = panel.getByRole('combobox', { name: 'Ajouter une cellule au réseau' });
  for (const id of [...ids, 'C6_4', 'C7_3', 'C7_4']) await add.selectOption(id);
  await expect(add).toBeDisabled();
  await expect(overlays(right)).toHaveCount(7);
  const connections = panel.getByRole('group', { name: 'Connexions du réseau' });
  const lowerEdge = connections.getByRole('checkbox', { name: 'C6_3 ↔ C7_3' });
  await lowerEdge.uncheck();
  await expect(overlays(right)).toHaveCount(6);
  await panel.getByRole('button', { name: 'Retirer la dernière cellule' }).click();
  await expect(lowerEdge).toBeChecked();
  await expect(lowerEdge).toBeDisabled();
  await expect(overlays(right)).toHaveCount(5);
  await add.selectOption('C7_4');
  await expect(overlays(right)).toHaveCount(7);
  const upperEdge = connections.getByRole('checkbox', { name: 'C5_3 ↔ C5_4' });
  await upperEdge.uncheck();
  await panel.getByRole('button', { name: 'Simuler les deux scénarios' }).click();
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('[data-network-edge]')).toHaveCount(6);
  await expect(panel.locator('[data-network-edge="C5_3 C5_4"]')).toHaveCount(0);
  await expect(panel.locator('[data-network-scenario="B"] [data-network-net-flux]')).toHaveCount(6);
  await page.getByRole('combobox', { name: 'Mode de l’expérience' }).selectOption('lake');
  await expect(page.getByRole('button', { name: 'Mode atelier' })).toBeVisible();
});
