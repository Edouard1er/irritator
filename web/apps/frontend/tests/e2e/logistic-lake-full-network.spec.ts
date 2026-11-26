import { expect, test, type Locator, type Response } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunRequest, RunResult } from '@contracts';
import type { LakeFullNetworkPlan } from '@/lib/simulation/spatial-experiment';
import { chart, clickWetCell, isSimulation, openInteractions, slider } from './logistic-workshop';

const evidence = process.env.IRRITATOR_LAKE_FULL_NETWORK_EVIDENCE;
const modeLabel = 'Réseau complet — grille 6 × 3';
const fullPlanUrl = '/api/logistic-lake?resolution=6x3&distribution=homogeneous&mode=full-network&mu=0.5';
const cellOn = (map: Locator, id: string) => map.getByRole('button', { name: id, exact: true });
const frontiers = (map: Locator) => map.locator('[data-wet-frontier]');
const arrows = (map: Locator) => map.locator('[data-exchange-pair]');

function color(ratio: number) {
  const stops = [[35, 103, 149], [227, 243, 237], [33, 136, 119]];
  const index = Math.max(0, Math.min(256, Math.round(ratio * 256)));
  const upper = index < 128 ? 1 : 2;
  const weight = (index - (upper - 1) * 128) / 128;
  const rgb = stops[upper - 1]!.map((channel, i) => Math.round(channel + weight * (stops[upper]![i]! - channel)));
  return `rgb(${rgb.join(', ')})`;
}

test('toute la topologie est sélectionnée automatiquement et les côtés secs restent exclus', async ({ page, request }) => {
  const panel = await openInteractions(page);
  const resolution = panel.getByRole('combobox', { name: 'Résolution du lac' });
  await resolution.selectOption('18x9');
  const mode = panel.getByRole('combobox', { name: 'Échange de biomasse' });
  await mode.selectOption({ label: modeLabel });
  await expect(resolution).toHaveValue('6x3');
  await expect(resolution).toBeDisabled();
  await expect(panel.locator('[data-full-cells]')).toHaveAttribute('data-full-cells', '13');
  await expect(panel.locator('[data-full-edges]')).toHaveAttribute('data-full-edges', '14');
  const map = panel.getByRole('group', { name: 'Carte avec échange' });
  await expect(map.locator('[data-cell]')).toHaveCount(13);
  await expect(frontiers(map)).toHaveCount(14);
  await expect(arrows(map)).toHaveCount(14);
  const pathsInWater = await map.evaluate(svg => {
    const shore = svg.querySelector('clipPath path')!.getAttribute('d')!;
    const context = document.createElement('canvas').getContext('2d')!;
    const water = new Path2D(shore);
    return [...svg.querySelectorAll<SVGPathElement>('[data-wet-frontier]')].every(segment => {
      const length = segment.getTotalLength();
      return [0.01, 0.19, 0.37, 0.53, 0.73, 0.91, 0.99].every(fraction => {
        const point = segment.getPointAtLength(length * fraction);
        return context.isPointInPath(water, point.x, point.y, 'evenodd');
      });
    });
  });
  expect(pathsInWater).toBe(true);
  const response = await request.get(fullPlanUrl);
  expect(response.ok()).toBe(true);
  const { domain } = await response.json() as LakeFullNetworkPlan;
  const keys = domain.fullNetwork.edges.map(({ a, b }) => `${a} ${b}`);
  expect(await frontiers(map).evaluateAll(paths => paths.map(path => path.getAttribute('data-wet-frontier')))).toEqual(keys);
  expect(keys).not.toContain('C21 C31');
  expect(keys).not.toContain('C01 C12');
  for (const amendment of ['&edge=C21,C31', '&edge=C01,C12', '&cells=C01,C12', '&a=C01&b=C12']) {
    expect((await request.get(fullPlanUrl + amendment)).status()).toBe(400);
  }
  expect((await request.get(fullPlanUrl.replace('6x3', '18x9'))).status()).toBe(400);
  for (const preserved of ['none', 'pair', 'network']) {
    await mode.selectOption(preserved);
    await expect(resolution).toBeEnabled();
  }
});

test('cartes, flux, mesures, trajectoires et exports suivent les résultats natifs sans recalcul', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1430 });
  const panel = await openInteractions(page);
  const responses: Response[] = [];
  let requests = 0;
  let preparations = 0;
  page.on('request', request => {
    if (isSimulation(request)) requests++;
    if (new URL(request.url()).pathname === '/api/logistic-lake') preparations++;
  });
  page.on('response', response => { if (isSimulation(response.request())) responses.push(response); });
  await panel.getByRole('combobox', { name: 'Échange de biomasse' }).selectOption('full-network');
  await panel.getByRole('combobox', { name: 'Distribution biologique' }).selectOption('wet-gradient');
  await panel.getByRole('combobox', { name: 'Profil du gradient' }).selectOption('sigmoid-v2');
  await panel.getByRole('slider', { name: 'Intensité du gradient α' }).fill('0.6');
  await panel.getByRole('combobox', { name: 'Intensité d’échange μ (mois⁻¹)' }).selectOption('0.5');
  await panel.getByRole('button', { name: 'Simuler les deux scénarios' }).click();
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible();
  expect(requests).toBe(2);
  expect(responses).toHaveLength(2);
  const prepared = preparations;
  const [requestA, requestB] = responses.map(response => response.request().postDataJSON() as RunRequest);
  expect(requestA!.model.id).toMatch(/^logistic-lake-6x3-/);
  expect(requestB!.model.id).toMatch(/^lake-full-6x3-mu50-[a-f0-9]{32}$/);
  expect(requestB!.model.components).toHaveLength(107);
  expect(requestB!.model.connections).toHaveLength(175);
  const native = await Promise.all(responses.map(async response => {
    expect(response.ok()).toBe(true);
    return await response.json() as RunResult;
  }));
  const datasets = native.map(result => new Map(result.observations.map(({ component, samples }) => {
    expect(samples).toHaveLength(201);
    return [component.slice(0, -2), samples] as const;
  })));
  expect(datasets.map(dataset => dataset.size)).toEqual([13, 13]);
  const left = panel.getByRole('group', { name: 'Carte sans échange' });
  const right = panel.getByRole('group', { name: 'Carte avec échange' });
  const ids = [...datasets[0]!.keys()];
  const areas = new Map(await Promise.all(ids.map(async id => [id, Number(await cellOn(right, id).getAttribute('data-area'))] as const)));
  const edgeIds = await frontiers(right).evaluateAll(paths => paths.map(path => path.getAttribute('data-wet-frontier')!));
  const flux = (key: string, tick: number) => {
    const [a, b] = key.split(' ') as [string, string];
    const areaA = areas.get(a)!;
    const areaB = areas.get(b)!;
    const value = (id: string) => datasets[1]!.get(id)![tick]!.value;
    return 0.5 * (areaA * areaB / (areaA + areaB)) * (value(a) / areaA - value(b) / areaB);
  };
  const selected = 'C20';
  const consult = panel.getByRole('combobox', { name: 'Cellule consultée' });
  await clickWetCell(page, cellOn(left, selected));
  await expect(consult).toHaveValue(selected);
  await panel.getByRole('button', { name: 'Plein écran · Cartes des scénarios' }).click();
  const fullscreen = page.locator(':fullscreen');
  const time = fullscreen.getByRole('slider', { name: 'Temps en plein écran' });
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const month of [0, 5, 10, 20]) {
    const tick = month * 10;
    await time.fill(String(month));
    await expect(left).toHaveAttribute('data-time', String(month));
    await expect(right).toHaveAttribute('data-time', String(month));
    const totals: number[] = [];
    for (const [index, map] of [left, right].entries()) {
      let total = 0;
      for (const id of ids) {
        const value = datasets[index]!.get(id)![tick]!.value;
        const rect = cellOn(map, id);
        const capacity = 300 * areas.get(id)!;
        await expect(rect).toHaveAttribute('data-biomass', String(value));
        await expect(rect).toHaveCSS('fill', color(value / capacity));
        total += value;
      }
      const dispersion = ids.reduce((sum, id) => {
        const area = areas.get(id)!;
        return sum + area * (datasets[index]!.get(id)![tick]!.value / area - total / 300) ** 2;
      }, 0);
      const sc = index === 0 ? 'a' : 'b';
      expect(Number(await fullscreen.locator(`[data-full-total-${sc}]`).getAttribute(`data-full-total-${sc}`))).toBeCloseTo(total, 8);
      expect(Number(await fullscreen.locator(`[data-full-dispersion-${sc}]`).getAttribute(`data-full-dispersion-${sc}`))).toBeCloseTo(dispersion, 6);
      totals.push(total);
    }
    expect(Number(await fullscreen.locator('[data-full-delta]').getAttribute('data-full-delta'))).toBeCloseTo(totals[1]! - totals[0]!, 8);
    expect(Math.abs(Number(await fullscreen.locator('[data-full-balance]').getAttribute('data-full-balance')))).toBeLessThan(1e-10);
    const ranked = await fullscreen.locator('[data-network-edge]').evaluateAll(rows =>
      rows.map(row => [row.getAttribute('data-network-edge')!, Number(row.getAttribute('data-exchange-flux'))] as const));
    expect(ranked).toHaveLength(14);
    for (const [i, [key, value]] of ranked.entries()) {
      expect(value).toBeCloseTo(flux(key, tick), 10);
      if (i) expect(Math.abs(value)).toBeLessThanOrEqual(Math.abs(ranked[i - 1]![1]));
    }
    const net = ranked.reduce((sum, [key, value]) => {
      const [a, b] = key.split(' ');
      return sum + (a === selected ? -value : b === selected ? value : 0);
    }, 0);
    const row = fullscreen.locator(`[data-network-cell="${selected}"][data-network-scenario="B"]`);
    const biomass = datasets[1]!.get(selected)![tick]!.value;
    await expect(row.locator('[data-pair-biomass]')).toHaveAttribute('data-pair-biomass', String(biomass));
    expect(Number(await row.locator('[data-pair-density]').getAttribute('data-pair-density'))).toBeCloseTo(biomass / areas.get(selected)!, 10);
    expect(Number(await row.locator('[data-network-net-flux]').getAttribute('data-network-net-flux'))).toBeCloseTo(net, 10);
    if (evidence) {
      await page.mouse.move(0, 0);
      await fullscreen.screenshot({ path: path.join(evidence, `6x3-sigmoide-06-mu-05-mois-${month}.png`), animations: 'disabled' });
    }
  }
  const inversion = edgeIds.flatMap(key => {
    const initial = flux(key, 0);
    const opposite = datasets[1]!.get(key.split(' ')[0]!)!.findIndex((_, tick) => initial * flux(key, tick) < -1e-4);
    return opposite < 0 ? [] : [{ key, initial, opposite }];
  })[0]!;
  expect(inversion).toBeDefined();
  const [a, b] = inversion.key.split(' ');
  const reversal = right.locator(`[data-exchange-pair="${inversion.key}"]`);
  await time.fill('0');
  await expect(reversal).toHaveAttribute('data-flow-direction', inversion.initial > 0 ? `${a} → ${b}` : `${b} → ${a}`);
  const firstPath = await reversal.locator('path').last().getAttribute('d');
  await time.fill(String(inversion.opposite / 10));
  await expect(reversal).toHaveAttribute('data-flow-direction', inversion.initial > 0 ? `${b} → ${a}` : `${a} → ${b}`);
  await expect(reversal.locator('path').last()).not.toHaveAttribute('d', firstPath!);
  const onlyIncident = fullscreen.getByRole('checkbox', { name: 'Frontières de la cellule sélectionnée' });
  const showArrows = fullscreen.getByRole('checkbox', { name: 'Flèches d’échange' });
  const incident = edgeIds.filter(key => key.split(' ').includes(selected));
  await onlyIncident.check();
  await expect(frontiers(right)).toHaveCount(incident.length);
  await expect(arrows(right)).toHaveCount(incident.length);
  await fullscreen.getByRole('combobox', { name: 'Trier les flux' }).selectOption('topology');
  expect(await fullscreen.locator('[data-network-edge]').evaluateAll(rows =>
    rows.map(row => row.getAttribute('data-network-edge')))).toEqual(incident);
  await showArrows.uncheck();
  await expect(arrows(right)).toHaveCount(0);
  await expect(frontiers(right)).toHaveCount(incident.length);
  await onlyIncident.uncheck();
  await expect(frontiers(right)).toHaveCount(14);
  await showArrows.check();
  await fullscreen.getByRole('button', { name: 'Zoom avant' }).first().click();
  await expect(right).toHaveAttribute('data-zoom', '1.5');
  await expect(right).toHaveAttribute('viewBox', (await left.getAttribute('viewBox'))!);
  await fullscreen.getByRole('button', { name: 'Quitter le plein écran · Cartes des scénarios' }).click();
  await expect(slider(panel)).toHaveValue(String(inversion.opposite / 10));
  await panel.getByRole('button', { name: 'Lire', exact: true }).click();
  await expect.poll(async () => Number(await slider(panel).inputValue())).toBeGreaterThan(inversion.opposite / 10);
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await slider(panel).fill('5');

  const extras = ids.filter(id => id !== selected);
  const search = panel.getByRole('searchbox', { name: 'Rechercher une cellule par identifiant' });
  for (const id of extras.slice(0, 10)) {
    await search.fill(id);
    await panel.getByRole('button', { name: `Comparer ${id}`, exact: true }).click();
  }
  await search.fill(extras[10]!);
  await expect(panel.getByRole('button', { name: `Comparer ${extras[10]}`, exact: true })).toBeDisabled();
  await expect(chart(panel).locator('[data-lake-curve]')).toHaveCount(22);
  await expect(chart(panel).getByText(/biomasse totale/i)).toHaveCount(0);
  const exportButton = panel.getByRole('button', { name: 'Exporter cette vue' });
  const svgPending = page.waitForEvent('download');
  await exportButton.click();
  const svg = await svgPending;
  expect(svg.suggestedFilename()).toContain('reseau-complet-mu-0.5.svg');
  const output = await readFile((await svg.path())!, 'utf8');
  expect(output).toContain('data-mode="full-network" data-mu="0.5"');
  expect(output).toContain(requestB!.model.id);
  expect(output).toContain('sigmoid-v2');
  expect(output.match(/data-wet-frontier=/g)).toHaveLength(14);
  expect(output.match(/data-exchange-pair=/g)).toHaveLength(14);
  await panel.getByRole('combobox', { name: 'Format de l’image' }).selectOption('png');
  const pngPending = page.waitForEvent('download');
  await exportButton.click();
  const png = await pngPending;
  expect(png.suggestedFilename()).toContain('reseau-complet-mu-0.5.png');
  expect((await readFile((await png.path())!)).subarray(1, 4).toString()).toBe('PNG');
  expect(requests).toBe(2);
  expect(preparations).toBe(prepared);

  await panel.getByRole('combobox', { name: 'Intensité d’échange μ (mois⁻¹)' }).selectOption('0');
  await expect(slider(panel)).toBeDisabled();
  await panel.getByRole('button', { name: 'Simuler les deux scénarios' }).click();
  await expect(panel.getByText('Terminé', { exact: true })).toBeVisible();
  expect(requests).toBe(4);
  const zero = responses[3]!.request().postDataJSON() as RunRequest;
  expect(zero.model.id).toMatch(/^lake-full-6x3-mu0-/);
  expect(zero.model.id).not.toBe(requestB!.model.id);
  expect(await panel.locator('[data-network-edge]').evaluateAll(rows =>
    rows.map(row => Number(row.getAttribute('data-exchange-flux'))))).toEqual(Array(14).fill(0));
});
