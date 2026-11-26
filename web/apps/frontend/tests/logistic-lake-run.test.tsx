import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { catalog, type RunRequest, type RunResult } from '@contracts';
import { LakeTrajectoryChart } from '@/components/simulation/logistic-lake-trajectories';
import { LogisticSpatialExperiment } from '@/components/simulation/logistic-spatial-experiment';
import { lakeDomain } from '../../../examples/logistic-grid';
import { lakeMeshFromGeoJson, lakeResolutions, runLakeBatches } from '@/lib/simulation/spatial-experiment';
import { lakeReference } from '../../../examples/logistic-lake-analysis';
import { GET as lakePlan } from '../app/api/logistic-lake/route';

vi.mock('@/components/charts/trajectory-plot', () => ({
  loadPlotly: async () => ({ react: vi.fn(), purge: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

const source = JSON.parse(readFileSync('data/geography/lac-de-guiers.hydrolakes.geojson', 'utf8'));
const domain = lakeDomain(lakeMeshFromGeoJson(source, lakeResolutions[2]));
function completedBatch(request: RunRequest): RunResult & { runId: string } {
  return {
    schemaVersion: 1, status: 'completed', modelId: request.model.id, runId: `${request.model.id}-test`,
    simulation: { ...request.simulation, finalTime: request.simulation.end, runCalls: 1 },
    diagnostics: { engineVersion: catalog.engineVersion, adapterVersion: catalog.adapterVersion,
      observationPolicy: 'engine-resampled-sealed-deduplicated' },
    observations: request.model.observations.map(observation => ({
      ...observation,
      samples: Array.from({ length: 201 }, (_, tick) => ({ time: tick / 10,
        value: request.model.components.find(atom => atom.id === observation.component)!.parameters.X! + tick / 100 })),
    })),
  };
}

it.each([
  ['identifiant du modèle', (result: RunResult) => { result.modelId += '-other'; }],
  ['horizon', (result: RunResult) => { result.simulation.finalTime = 19.9; }],
  ['identifiant observé', (result: RunResult) => { result.observations[0]!.component += '-other'; }],
  ['date', (result: RunResult) => { result.observations[0]!.samples[2]!.time = 0.21; }],
  ['biomasse', (result: RunResult) => { result.observations[0]!.samples[2]!.value = -1; }],
  ['point terminal', (result: RunResult) => { result.observations[0]!.samples.pop(); }],
] as const)('rejette le lot 2 si son %s est incohérent', async (_, corrupt) => {
  const progress: number[] = [];
  let calls = 0;
  await expect(runLakeBatches(domain, lakeReference(domain), async request => {
    const result = completedBatch(request);
    if (++calls === 2) corrupt(result);
    return result;
  }, { onProgress: done => progress.push(done) })).rejects.toMatchObject({
    trace: { wetCells: 65, plannedBatches: 4, points: 18 * 201,
      failure: { modelId: domain.batches[1]!.request.model.id } },
  });
  expect(progress).toEqual([1]);
  expect(calls).toBe(2);
});

it('annule une résolution en cours, écarte sa réponse tardive et relance après une erreur partielle', async () => {
  let releaseOld: (() => void) | undefined;
  let oldSignal: AbortSignal | null | undefined;
  let rejectSecond = true;
  let busyCount = 0;
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).startsWith('/api/logistic-lake?')) return lakePlan(new Request(new URL(String(url), 'http://localhost')));
    const request: RunRequest = JSON.parse(String(options?.body));
    if (request.model.id.includes('18x9')) {
      oldSignal = options?.signal;
      return new Promise(resolve => { releaseOld = () => resolve(Response.json(completedBatch(request))); });
    }
    if (rejectSecond && request.model.id.endsWith('-2')) {
      return Response.json({ error: { code: 'ENGINE_TIMEOUT', message: 'Lot interrompu' } }, { status: 502 });
    }
    if (!rejectSecond && busyCount === 0) {
      busyCount++;
      return Response.json({ error: { code: 'ENGINE_BUSY', message: 'Moteur occupé' } }, { status: 503 });
    }
    return Response.json(completedBatch(request));
  });
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<LogisticSpatialExperiment active />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Mode de l’expérience' }), { target: { value: 'lake' } });
  const resolution = await screen.findByRole('combobox', { name: 'Résolution du lac' });
  const launch = screen.getByRole('button', { name: 'Lancer la simulation' });
  fireEvent.change(resolution, { target: { value: '18x9' } });
  await waitFor(() => expect(launch).toBeEnabled());
  fireEvent.click(launch);
  await waitFor(() => expect(releaseOld).toBeDefined());
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '4');
  fireEvent.change(resolution, { target: { value: '24x12' } });
  expect(oldSignal?.aborted).toBe(true);
  await waitFor(() => expect(launch).toBeEnabled());
  fireEvent.click(launch);
  expect(await screen.findByRole('alert')).toHaveTextContent('Lot 2/6 · ENGINE_TIMEOUT');
  expect(screen.getByRole('slider', { name: 'Temps simulé' })).toBeDisabled();
  expect(container.querySelectorAll('[data-cell][data-biomass]')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Télécharger la trace JSON' })).toBeVisible();
  rejectSecond = false;
  fireEvent.click(launch);
  expect(await screen.findByText('Terminé')).toBeVisible();
  await act(async () => releaseOld!());
  expect(screen.getByRole('group', { name: 'Grille humide du lac de Guiers' })).toHaveAttribute('data-rows', '24');
  expect(container.querySelectorAll('[data-cell][data-biomass]')).toHaveLength(101);
  expect(busyCount).toBe(1);
  expect(fetcher.mock.calls.filter(([, options]) => String(options?.body).includes('18x9'))).toHaveLength(1);
});

it.each([
  'resolution=7x3&distribution=homogeneous',
  'resolution=6x3&distribution=unknown',
  'resolution=6x3&distribution=gradient',
  'resolution=6x3&distribution=gradient&alpha=0.61',
  'resolution=6x3&distribution=gradient&alpha=-0.01',
  'resolution=6x3&distribution=gradient&alpha=NaN',
  'resolution=6x3&distribution=wet-gradient',
  'resolution=6x3&distribution=wet-gradient&alpha=0.61',
  'resolution=6x3&distribution=wet-gradient&alpha=-0.01',
  'resolution=6x3&distribution=wet-gradient&alpha=NaN',
  'resolution=6x3&distribution=wet-gradient&alpha=0.6&profile=unknown',
  'resolution=6x3&distribution=wet-gradient&alpha=0.6&profile=',
  'resolution=6x3&distribution=homogeneous&profile=sigmoid-v2',
])('rejette la configuration %s', async query => {
  expect((await lakePlan(new Request(`http://localhost/api/logistic-lake?${query}`))).status).toBe(400);
});

it('versionne le profil dans les plans et identifiants sans modifier le gradient historique', async () => {
  const url = 'http://localhost/api/logistic-lake?resolution=6x3&distribution=wet-gradient&alpha=0.6';
  const implicit = await (await lakePlan(new Request(url))).json();
  const linear = await (await lakePlan(new Request(`${url}&profile=linear-v1`))).json();
  const sigmoid = await (await lakePlan(new Request(`${url}&profile=sigmoid-v2`))).json();
  expect(linear.domain.cells).toEqual(implicit.domain.cells);
  expect(linear.reference).toEqual(implicit.reference);
  expect(implicit.domain.parameters.distribution.profile).toBe('linear-v1');
  expect(implicit.domain.batches[0].request.model.id).toBe('logistic-lake-6x3-proportional-wg0p6-1');
  expect(linear.domain.batches[0].request.model.id).toContain('-linear-v1-');
  expect(sigmoid.domain.batches[0].request.model.id).toContain('-sigmoid-v2-');
  expect(sigmoid.domain.parameters.distribution).toEqual({ kind: 'wet-gradient', alpha: 0.6, profile: 'sigmoid-v2' });
  expect(sigmoid.reference.local).not.toEqual(linear.reference.local);
  const preciseUrl = url.replace('6x3', '48x24').replace('0.6', '0.0000019999999999999995');
  expect((await lakePlan(new Request(`${preciseUrl}&profile=sigmoid-v2`))).status).toBe(200);
});

it('prépare le gradient côté serveur, annule le lot en cours et compare uniquement les observations terminées', async () => {
  const plans: string[] = [];
  const runs: RunRequest[] = [];
  let releaseOld: (() => void) | undefined;
  let oldSignal: AbortSignal | null | undefined;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).startsWith('/api/logistic-lake?')) {
      plans.push(String(url));
      return lakePlan(new Request(new URL(String(url), 'http://localhost')));
    }
    const request: RunRequest = JSON.parse(String(options?.body));
    runs.push(request);
    if (request.model.id.includes('-g0p3-')) {
      oldSignal = options?.signal;
      return new Promise(resolve => { releaseOld = () => resolve(Response.json(completedBatch(request))); });
    }
    return Response.json(completedBatch(request));
  }));
  const { container } = render(<LogisticSpatialExperiment active />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Mode de l’expérience' }), { target: { value: 'lake' } });
  const distribution = await screen.findByRole('combobox', { name: 'Distribution biologique' });
  expect(distribution).toHaveValue('homogeneous');
  fireEvent.click(screen.getByRole('button', { name: 'Lancer la simulation' }));
  await screen.findByText('Terminé');

  fireEvent.change(distribution, { target: { value: 'gradient' } });
  const intensity = screen.getByRole('slider', { name: 'Intensité du gradient α' });
  const launch = screen.getByRole('button', { name: /^Appliquer et simuler$/ });
  expect(screen.getByText('Gradient biologique synthétique — non calibré')).toBeVisible();
  expect(intensity).toHaveAttribute('max', '0.6');
  await waitFor(() => expect(launch).toBeEnabled());
  expect(runs).toHaveLength(1);
  expect(plans).toHaveLength(1);
  fireEvent.click(launch);
  await waitFor(() => expect(releaseOld).toBeDefined());
  fireEvent.change(intensity, { target: { value: '0.6' } });
  expect(oldSignal?.aborted).toBe(false);
  expect(plans).toHaveLength(2);
  await waitFor(() => expect(launch).toBeEnabled());
  expect(container.querySelectorAll('[data-comparison-biomass]')).toHaveLength(3);
  fireEvent.click(launch);
  expect(oldSignal?.aborted).toBe(true);
  await screen.findByText('Terminé');
  await act(async () => releaseOld!());
  expect(container.querySelectorAll('[data-comparison-biomass]')).toHaveLength(6);
  expect(container.querySelectorAll('[data-below-half]').length).toBeGreaterThan(0);
  expect(plans.at(-1)).toContain('distribution=gradient&alpha=0.6');
  expect(runs.at(-1)!.model.id).toContain('-g0p6-');
  expect(screen.getByRole('button', { name: 'Télécharger la trace JSON' })).toBeVisible();

  fireEvent.change(distribution, { target: { value: 'wet-gradient' } });
  const wetComparison = screen.getByRole('row', { name: /Gradient pondéré par surface humide/ });
  expect(wetComparison).toHaveTextContent('α = 0,6');
  expect(wetComparison.querySelectorAll('[data-comparison-biomass]')).toHaveLength(0);
  await waitFor(() => expect(launch).toBeEnabled());
  fireEvent.click(launch);
  await screen.findByText('Terminé');
  expect(plans.at(-1)).toContain('distribution=wet-gradient&alpha=0.6');
  expect(runs.at(-1)!.model.id).toContain('-wg0p6-');
  expect(wetComparison.querySelectorAll('[data-comparison-biomass]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-comparison-biomass]')).toHaveLength(9);

  fireEvent.change(screen.getByRole('slider', { name: 'Intensité du gradient α' }), { target: { value: '0.3' } });
  await waitFor(() => expect(launch).toBeEnabled());
  expect(wetComparison).toHaveTextContent('α = 0,6');
  expect(screen.getByText('Intensité simulée α = 0,6')).toBeVisible();
  expect(container.querySelectorAll('[data-comparison-biomass]')).toHaveLength(9);
  fireEvent.change(screen.getByRole('combobox', { name: 'Résolution du lac' }), { target: { value: '12x6' } });
  await waitFor(() => expect(launch).toBeEnabled());
  expect(container.querySelectorAll('[data-comparison-biomass]')).toHaveLength(0);
});

it('lit aux trois vitesses, recule, boucle et reste en pause après avoir quitté le mode', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).startsWith('/api/logistic-lake?')) return lakePlan(new Request(new URL(String(url), 'http://localhost')));
    return Response.json(completedBatch(JSON.parse(String(options?.body))));
  }));
  const { rerender } = render(<LogisticSpatialExperiment active />);
  const mode = screen.getByRole('combobox', { name: 'Mode de l’expérience' });
  fireEvent.change(mode, { target: { value: 'lake' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Lancer la simulation' }));
  await screen.findByText('Terminé');
  const position = screen.getByRole('slider', { name: 'Temps simulé' });
  const speed = screen.getByRole('combobox', { name: 'Vitesse' });
  const tick = () => Math.round(Number((position as HTMLInputElement).value) * 10);
  vi.useFakeTimers();
  const elapsed = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  try {
    for (const rate of [1, 2, 4]) {
      fireEvent.click(screen.getByRole('button', { name: 'Remettre au début' }));
      fireEvent.change(speed, { target: { value: String(rate) } });
      fireEvent.click(screen.getByRole('button', { name: 'Lire' }));
      elapsed(180);
      expect(tick()).toBe(rate * 2);
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      elapsed(180);
      expect(tick()).toBe(rate * 2);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Observation précédente' }));
    expect(tick()).toBe(7);
    fireEvent.click(screen.getByRole('button', { name: 'Observation suivante' }));
    expect(tick()).toBe(8);
    fireEvent.change(position, { target: { value: 19.9 } });
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
    elapsed(100);
    expect(tick()).toBe(200);
    expect(screen.getByRole('button', { name: 'Lire' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'En boucle' }));
    fireEvent.change(position, { target: { value: 19.9 } });
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
    elapsed(23);
    expect(tick()).toBe(200);
    elapsed(23);
    expect(tick()).toBe(0);
    elapsed(23);
    expect(tick()).toBe(1);
    fireEvent.change(mode, { target: { value: 'constant' } });
    elapsed(180);
    fireEvent.change(mode, { target: { value: 'lake' } });
    expect(screen.getByRole('slider', { name: 'Temps simulé' })).toHaveValue('0.1');
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
    rerender(<LogisticSpatialExperiment active={false} />);
    elapsed(180);
    rerender(<LogisticSpatialExperiment active />);
    expect(screen.getByRole('slider', { name: 'Temps simulé' })).toHaveValue('0.1');
    expect(screen.getByRole('button', { name: 'Reprendre' })).toBeEnabled();
  } finally {
    vi.useRealTimers();
  }
});

it('réutilise les scènes présentées et limite la sélection à dix trajectoires supplémentaires', async () => {
  const requests: RunRequest[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).startsWith('/api/logistic-lake?')) return lakePlan(new Request(new URL(String(url), 'http://localhost')));
    const request: RunRequest = JSON.parse(String(options?.body));
    requests.push(request);
    return Response.json(completedBatch(request));
  });
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<LogisticSpatialExperiment active />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Mode de l’expérience' }), { target: { value: 'lake' } });
  const workshop = await screen.findByRole('button', { name: 'Mode atelier' });
  const beforeWorkshop = fetcher.mock.calls.length;
  fireEvent.click(workshop);
  expect(fetcher).toHaveBeenCalledTimes(beforeWorkshop);
  expect(screen.queryByRole('table', { name: /Biomasses totales simulées/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Comparer homogène / gradient' }));
  await screen.findByText(/Simulation disponible · Gradient nord-sud · α = 0,3/);
  expect(requests).toHaveLength(8);
  expect(screen.getByRole('combobox', { name: 'Résolution du lac' })).toHaveValue('18x9');
  const grids = screen.getAllByRole('group', { name: /Grille humide du lac de Guiers/ });
  const picker = screen.getByRole('group', { name: 'Comparer les trajectoires' });
  const plot = screen.getByRole('img', { name: 'Trajectoires logistiques' });
  const legend = screen.getByRole('list', { name: 'Séries à l’instant consulté' });
  const search = within(picker).getByRole('searchbox');
  const selected = grids[0]!.querySelector('[data-cell][aria-pressed="true"]')!.getAttribute('data-cell')!;
  const selectable = [...grids[0]!.querySelectorAll('[data-cell][aria-pressed="false"]')].slice(0, 11)
    .map(element => element.getAttribute('data-cell')!);
  const beforeReading = fetcher.mock.calls.length;
  expect(plot).toHaveAttribute('data-series', selected);
  expect(plot.querySelectorAll('[data-lake-axis]:not([data-lake-axis="time"])')).toHaveLength(1);
  expect(within(plot).getByText('Biomasse des cellules (t)')).toBeInTheDocument();
  expect(plot.querySelectorAll('[data-lake-curve]')).toHaveLength(1);
  for (const id of selectable.slice(0, 10)) {
    fireEvent.change(search, { target: { value: id.toLowerCase() } });
    fireEvent.click(within(picker).getByRole('button', { name: `Comparer ${id}` }));
    expect(within(picker).getByRole('button', { name: `Retirer ${id} de la comparaison` })).toBeVisible();
    expect(container.querySelectorAll(`[data-map-selection="${id}"]`)).toHaveLength(2);
    expect(container.querySelector(`[data-lake-mark="${id}"]`)).toBeInTheDocument();
  }
  expect(within(picker).getByText('10 / 10 cellules supplémentaires')).toBeVisible();
  expect(plot.querySelectorAll('[data-lake-curve]')).toHaveLength(11);
  expect(within(legend).getAllByRole('listitem')).toHaveLength(11);
  expect(legend).not.toHaveTextContent('Biomasse totale');
  const first = selectable[0]!;
  const eleventh = selectable[10]!;
  fireEvent.change(search, { target: { value: eleventh } });
  const addEleventh = within(picker).getByRole('button', { name: `Comparer ${eleventh}` });
  expect(addEleventh).toBeDisabled();
  fireEvent.click(within(picker).getByRole('button', { name: `Retirer ${first} de la comparaison` }));
  expect(addEleventh).toBeEnabled();
  fireEvent.click(addEleventh);
  fireEvent.click(within(grids[1]!).getByRole('button', { name: eleventh }));
  expect(within(grids[0]!).getByRole('button', { name: eleventh })).toHaveAttribute('aria-pressed', 'true');
  expect(plot).toHaveAttribute('data-series', [eleventh, ...selectable.slice(1, 10)].join(','));
  fireEvent.change(screen.getByRole('slider', { name: 'Temps simulé' }), { target: { value: 10 } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Affichage de la carte' }), { target: { value: 'density' } });
  fireEvent.click(within(grids[0]!.parentElement!).getByRole('button', { name: 'Zoom avant' }));
  fireEvent.click(workshop);
  expect(screen.getByRole('table', { name: /Biomasses totales simulées/ })).toBeVisible();
  expect(screen.getByText('Fraction humide')).toBeVisible();
  expect(container.querySelector('[data-total-biomass]')).toHaveAttribute('data-total-biomass');
  expect(container.querySelectorAll('[data-map-total]')).toHaveLength(2);
  expect(container.querySelector('[data-map-total-difference]')).toHaveAttribute('data-map-total-difference');
  expect(grids[1]).toHaveAttribute('data-time', '10');
  expect(grids[1]).toHaveAttribute('data-zoom', '1.5');
  expect(fetcher).toHaveBeenCalledTimes(beforeReading);
});

it('laisse une interruption dans la trajectoire et signale une observation absente au survol', () => {
  const points = [12, 16, null, 24, 28].map((value, time) => ({ time, value }));
  const { container } = render(<LakeTrajectoryChart curves={[{ name: 'C11', color: '#202c38', points }]}
    tick={2} time={2} start={0} end={4} />);
  const segments = container.querySelectorAll('[data-lake-curve="C11"] polyline');
  expect([...segments].map(segment => segment.getAttribute('points'))).toEqual(['0,12 1,16', '3,24 4,28']);
  expect(container.querySelector('[data-lake-mark="C11"]')).toBeNull();
  expect(container.querySelector('[data-lake-cursor]')).toHaveAttribute('data-lake-cursor', '2');
  const hoverArea = container.querySelector('svg rect')!;
  vi.spyOn(hoverArea, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
  fireEvent.pointerMove(hoverArea, { clientX: 50 });
  expect(screen.getByText('2,0 mois')).toBeVisible();
  expect(screen.getByText('Point absent')).toBeVisible();
  fireEvent.pointerLeave(hoverArea);
  expect(screen.queryByText('Point absent')).not.toBeInTheDocument();
});
