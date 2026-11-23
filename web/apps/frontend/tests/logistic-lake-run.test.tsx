import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { catalog, type RunRequest, type RunResult } from '@contracts';
import { LogisticSpatialExperiment } from '@/components/simulation/logistic-spatial-experiment';
import { lakeDomain, lakeMeshFromGeoJson, lakeResolutions, runLakeSimulation } from '@/lib/simulation/spatial-experiment';

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
  ['point terminal', (result: RunResult) => { result.observations[0]!.samples.pop(); }],
] as const)('rejette le lot 2 si son %s est incohérent', async (_, corrupt) => {
  const progress: number[] = [];
  let calls = 0;
  await expect(runLakeSimulation(domain, async request => {
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
    if (String(url).endsWith('.geojson')) return Response.json(source);
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
  fireEvent.click(launch);
  await waitFor(() => expect(releaseOld).toBeDefined());
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '4');
  fireEvent.change(resolution, { target: { value: '24x12' } });
  expect(oldSignal?.aborted).toBe(true);
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
