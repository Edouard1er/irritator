import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { catalog, type RunRequest, type RunResult } from '@contracts';
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
])('rejette la configuration %s', async query => {
  expect((await lakePlan(new Request(`http://localhost/api/logistic-lake?${query}`))).status).toBe(400);
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
  const launch = screen.getByRole('button', { name: 'Lancer la simulation' });
  expect(distribution).toHaveValue('homogeneous');
  fireEvent.click(launch);
  await screen.findByText('Terminé');

  fireEvent.change(distribution, { target: { value: 'gradient' } });
  const intensity = screen.getByRole('slider', { name: 'Intensité du gradient α' });
  expect(screen.getByText('Gradient biologique synthétique — non calibré')).toBeVisible();
  expect(intensity).toHaveAttribute('max', '0.6');
  await waitFor(() => expect(launch).toBeEnabled());
  expect(runs).toHaveLength(1);
  fireEvent.click(launch);
  await waitFor(() => expect(releaseOld).toBeDefined());
  fireEvent.change(intensity, { target: { value: '0.6' } });
  expect(oldSignal?.aborted).toBe(true);
  await waitFor(() => expect(launch).toBeEnabled());
  expect(container.querySelectorAll('[data-comparison-biomass]')).toHaveLength(3);
  fireEvent.click(launch);
  await screen.findByText('Terminé');
  await act(async () => releaseOld!());
  expect(container.querySelectorAll('[data-comparison-biomass]')).toHaveLength(6);
  expect(container.querySelectorAll('[data-below-half]').length).toBeGreaterThan(0);
  expect(plans.at(-1)).toContain('distribution=gradient&alpha=0.6');
  expect(runs.at(-1)!.model.id).toContain('-g0p6-');
  expect(screen.getByRole('button', { name: 'Télécharger la trace JSON' })).toBeVisible();
});
