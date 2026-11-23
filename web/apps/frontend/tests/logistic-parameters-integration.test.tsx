import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { catalog, type RunRequest } from '@contracts';
import { LogisticSpatialExperiment } from '@/components/simulation/logistic-spatial-experiment';
import type { HttpResult } from '@/lib/api/client';
import { spatialRequest } from '@/lib/simulation/spatial-experiment';

vi.mock('@/components/charts/trajectory-plot', () => ({
  loadPlotly: async () => ({ react: vi.fn(), purge: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

const initialLabel = 'Biomasse initiale N₀ (t)';
const growthLabel = 'Taux de croissance r (mois⁻¹)';
const capacityLabel = 'Capacité K (t)';

function requestBody(options?: RequestInit): RunRequest {
  if (typeof options?.body !== 'string') throw new Error('Requête JSON absente');
  return JSON.parse(options.body) as RunRequest;
}

function completedRun(request: RunRequest): Response {
  return Response.json({
    schemaVersion: 1,
    status: 'completed',
    modelId: request.model.id,
    runId: 'logistic-integration-test',
    simulation: { ...request.simulation, finalTime: request.simulation.end, runCalls: 1 },
    diagnostics: {
      engineVersion: catalog.engineVersion,
      adapterVersion: catalog.adapterVersion,
      observationPolicy: 'engine-resampled-sealed-deduplicated',
    },
    observations: request.model.observations.map(observation => ({
      ...observation,
      samples: [{
        time: request.simulation.start,
        value: request.model.components.find(({ id }) => id === observation.component)!.parameters.X,
      }],
    })),
  });
}

function cell(id: string) {
  return screen.getByRole('button', { name: id });
}

function field(label: string) {
  return within(screen.getByRole('region', { name: /^Paramètres de C/ })).getByRole('textbox', { name: label });
}

function changeField(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

function apply() {
  fireEvent.click(screen.getByRole('button', { name: 'Appliquer et simuler' }));
}

async function launch() {
  fireEvent.click(screen.getByRole('button', { name: 'Lancer la simulation' }));
  expect(await screen.findByText('Terminé')).toHaveAttribute('data-phase', 'completed');
}

it('compare les trois grilles natives au même instant et retrouve les paramètres du mode indépendant', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    const request = requestBody(options);
    const body: HttpResult = await completedRun(request).json();
    for (const [index, observation] of body.observations.entries()) {
      observation.samples.push({ time: 20, value: observation.samples[0]!.value + index });
    }
    return Response.json(body);
  });
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<LogisticSpatialExperiment active />);
  const mode = screen.getByRole('combobox', { name: 'Mode de l’expérience' });
  const dimensions = screen.getByRole('combobox', { name: 'Dimensions de la grille' });
  expect(mode).toHaveDisplayValue('Populations indépendantes');
  fireEvent.change(dimensions, { target: { value: '2' } });
  fireEvent.click(cell('C11'));
  changeField(initialLabel, '420');
  apply();
  expect(await screen.findByText('Terminé')).toBeVisible();
  changeField(growthLabel, '0,42');

  fireEvent.change(mode, { target: { value: 'constant' } });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Dimensions de la grille' })).toHaveValue('3');
  const metrics = screen.getByLabelText('Domaine de la grille');
  expect(metrics).toHaveTextContent(/Surface totale9 km²/);
  expect(metrics).toHaveTextContent(/Surface par cellule1 km²/);
  expect(metrics).toHaveTextContent(/Capacité totale2\s700 t/);
  fireEvent.click(screen.getByRole('button', { name: 'Simuler les trois grilles' }));
  expect(await screen.findByText('Terminé')).toBeVisible();
  expect(fetcher.mock.calls.slice(1).map(([, options]) => requestBody(options)))
    .toEqual([spatialRequest(2, 'constant'), spatialRequest(3, 'constant'), spatialRequest(4, 'constant')]);
  expect(container.querySelector('[data-total-biomass]')).toHaveAttribute('data-total-biomass', '1350');

  fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } });
  for (const [size, total] of [[2, 1356], [3, 1386], [4, 1470]]) {
    expect(container.querySelector(`[data-total-grid="${size}"]`)).toHaveAttribute('data-biomass', String(total));
  }
  fireEvent.change(screen.getByRole('combobox', { name: 'Dimensions de la grille' }), { target: { value: '4' } });
  expect(screen.getByRole('slider')).toHaveValue('20');
  expect(metrics).toHaveTextContent(/Surface par cellule0,5625 km²/);
  expect(container.querySelector('[data-total-biomass]')).toHaveAttribute('data-total-biomass', '1470');
  expect(cell('C33')).toHaveAttribute('data-biomass', '99.375');

  fireEvent.change(mode, { target: { value: 'independent' } });
  expect(screen.getByRole('combobox', { name: 'Dimensions de la grille' })).toHaveValue('2');
  expect(field(initialLabel)).toHaveValue('420');
  expect(field(growthLabel)).toHaveValue('0,42');
  expect(cell('C11')).toHaveAttribute('data-biomass', '420');
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('retire la comparaison si une grille échoue et relance les trois tailles', async () => {
  let fail = false;
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
    const request = requestBody(options);
    if (fail && request.model.id === 'logistic-constant-domain-3x3') {
      return Response.json({ error: { code: 'ENGINE_UNAVAILABLE', message: 'Indisponible.' } }, { status: 503 });
    }
    return completedRun(request);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<LogisticSpatialExperiment active />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Mode de l’expérience' }), { target: { value: 'constant' } });
  const launchComparison = screen.getByRole('button', { name: 'Simuler les trois grilles' });
  fireEvent.click(launchComparison);
  expect(await screen.findByText('Terminé')).toBeVisible();

  fail = true;
  fireEvent.click(launchComparison);
  expect(await screen.findByRole('alert')).toHaveTextContent('Grille 3 × 3 · ENGINE_UNAVAILABLE');
  expect(screen.queryByLabelText('Trajectoires de biomasse totale')).toBeNull();
  expect(screen.getByRole('slider')).toBeDisabled();
  expect(fetcher).toHaveBeenCalledTimes(5);

  fail = false;
  fireEvent.click(launchComparison);
  expect(await screen.findByText('Terminé')).toBeVisible();
  expect(screen.getByRole('slider')).toBeEnabled();
  expect(fetcher).toHaveBeenCalledTimes(8);
});

it('garde les brouillons séparés et publie les paramètres de la seule cellule appliquée', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => completedRun(requestBody(options)));
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<LogisticSpatialExperiment active />);
  await launch();
  expect(requestBody(fetcher.mock.calls[0]![1])).toEqual(spatialRequest());

  fireEvent.click(cell('C11'));
  changeField(initialLabel, '420');
  changeField(growthLabel, '0,7');
  changeField(capacityLabel, '480');
  expect(container.querySelector('[data-pending-cells]')).toHaveTextContent('Modifications non simulées : C11.');
  expect(screen.getByLabelText('Paramètres simulés')).toHaveAttribute('data-initial', '380');
  expect(cell('C11')).toHaveAttribute('data-biomass', '380');

  fireEvent.click(cell('C02'));
  expect(field(initialLabel)).toHaveValue('150');
  changeField(initialLabel, '175');
  fireEvent.click(cell('C11'));
  expect(field(initialLabel)).toHaveValue('420');
  expect(field(growthLabel)).toHaveValue('0,7');
  expect(field(capacityLabel)).toHaveValue('480');
  expect(fetcher).toHaveBeenCalledTimes(1);

  apply();
  expect(await screen.findByText('Terminé')).toHaveAttribute('data-phase', 'completed');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]![0]).toBe('/api/v1/simulations/run');
  expect(fetcher.mock.calls[1]![1]?.method).toBe('POST');
  const expected = spatialRequest();
  expected.model.components.find(({ id }) => id === 'C11-N')!.parameters.X = 420;
  expected.model.components.find(({ id }) => id === 'C11-r')!.parameters.value = 0.7;
  expected.model.components.find(({ id }) => id === 'C11-sum')!.parameters['coeff-1'] = -1 / 480;
  expect(requestBody(fetcher.mock.calls[1]![1])).toEqual(expected);

  const simulated = screen.getByLabelText('Paramètres simulés');
  expect(simulated).toHaveAttribute('data-simulated-cell', 'C11');
  expect(simulated).toHaveAttribute('data-initial', '420');
  expect(simulated).toHaveAttribute('data-growth', '0.7');
  expect(simulated).toHaveAttribute('data-capacity', '480');
  expect(cell('C11')).toHaveAttribute('data-biomass', '420');
  expect(container.querySelector('[data-pending-cells]')).toHaveTextContent('Modifications non simulées : C02.');

  fireEvent.click(cell('C02'));
  expect(field(initialLabel)).toHaveValue('175');
  expect(screen.getByLabelText('Paramètres simulés')).toHaveAttribute('data-initial', '150');
  expect(cell('C02')).toHaveAttribute('data-biomass', '150');
});

it('bloque la saisie invalide, retire le résultat pendant le calcul et conserve le brouillon après un rejet', async () => {
  const rejected = Promise.withResolvers<Response>();
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => completedRun(requestBody(options)));
  vi.stubGlobal('fetch', fetcher);
  render(<LogisticSpatialExperiment active />);
  await launch();
  fireEvent.click(cell('C11'));

  changeField(initialLabel, '');
  changeField(capacityLabel, '0');
  apply();
  expect(field(initialLabel)).toHaveAttribute('aria-invalid', 'true');
  expect(field(capacityLabel)).toHaveAttribute('aria-invalid', 'true');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(cell('C11')).toHaveAttribute('data-biomass', '380');

  changeField(initialLabel, '405');
  changeField(capacityLabel, '450');
  const slider = screen.getByRole('slider', { name: 'Temps simulé' });
  fireEvent.change(slider, { target: { value: '10' } });
  expect(slider).toHaveValue('10');
  fetcher.mockReturnValueOnce(rejected.promise);
  apply();
  expect(screen.getByText('En cours')).toHaveAttribute('data-phase', 'running');
  expect(slider).toBeDisabled();
  expect(slider).toHaveValue('0');
  expect(screen.queryByLabelText('Paramètres simulés')).not.toBeInTheDocument();
  expect(cell('C11')).not.toHaveAttribute('data-biomass');

  await act(async () => rejected.resolve(Response.json({
    error: { code: 'LIMIT_EXCEEDED', message: 'Budget atteint.' },
  }, { status: 422 })));
  expect(await screen.findByText(/Simulation impossible.*LIMIT_EXCEEDED/)).toBeVisible();
  expect(field(initialLabel)).toHaveValue('405');
  expect(field(capacityLabel)).toHaveValue('450');
  expect(cell('C11')).not.toHaveAttribute('data-biomass');

  apply();
  expect(await screen.findByText('Terminé')).toHaveAttribute('data-phase', 'completed');
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(requestBody(fetcher.mock.calls[2]![1])).toEqual(requestBody(fetcher.mock.calls[1]![1]));
  expect(screen.getByLabelText('Paramètres simulés')).toHaveAttribute('data-initial', '405');
  expect(cell('C11')).toHaveAttribute('data-biomass', '405');
});

it('conserve les paramètres des cellules communes et attend une nouvelle simulation après redimensionnement', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => completedRun(requestBody(options)));
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<LogisticSpatialExperiment active />);
  const dimensions = screen.getByRole('combobox', { name: 'Dimensions de la grille' });
  const slider = screen.getByRole('slider', { name: 'Temps simulé' });
  const compare = (id: string) => screen.getByRole('checkbox', { name: `Comparer ${id}` });

  fireEvent.click(cell('C11'));
  changeField(initialLabel, '405');
  apply();
  expect(await screen.findByText('Terminé')).toBeVisible();
  fireEvent.click(cell('C01'));
  changeField(growthLabel, '0,55');
  fireEvent.click(cell('C02'));
  changeField(initialLabel, '175');
  fireEvent.click(compare('C10'));
  fireEvent.click(compare('C22'));
  fireEvent.change(slider, { target: { value: '10' } });
  expect(slider).toHaveValue('10');
  expect(dimensions).toHaveValue('3');

  fireEvent.change(dimensions, { target: { value: '2' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Non lancé');
  expect(slider).toBeDisabled();
  expect(slider).toHaveValue('0');
  expect(screen.queryByRole('img', { name: 'Trajectoires logistiques' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Paramètres simulés')).not.toBeInTheDocument();
  expect(container.querySelectorAll('[data-cell][data-biomass]')).toHaveLength(0);
  expect(cell('C00')).toHaveAttribute('aria-pressed', 'true');
  expect(compare('C10')).toBeChecked();
  expect(screen.queryByRole('checkbox', { name: 'Comparer C22' })).not.toBeInTheDocument();
  expect(container.querySelector('[data-pending-cells]')).toHaveAttribute('data-pending-cells', 'C01');
  fireEvent.click(cell('C01'));
  expect(field(growthLabel)).toHaveValue('0,55');
  await launch();
  const expected = spatialRequest(2);
  expected.model.components.find(({ id }) => id === 'C11-N')!.parameters.X = 405;
  expect(requestBody(fetcher.mock.calls[1]![1])).toEqual(expected);

  fireEvent.change(dimensions, { target: { value: '4' } });
  expect(cell('C01')).toHaveAttribute('aria-pressed', 'true');
  expect(compare('C22')).not.toBeChecked();
  fireEvent.click(cell('C02'));
  expect(field(initialLabel)).toHaveValue('150');
  fireEvent.click(cell('C11'));
  expect(field(initialLabel)).toHaveValue('405');
  fireEvent.click(screen.getByRole('button', { name: 'Restaurer les paramètres initiaux' }));
  expect(await screen.findByText('Terminé')).toBeVisible();
  expect(dimensions).toHaveValue('4');
  expect(requestBody(fetcher.mock.calls[2]![1])).toEqual(spatialRequest(4));
  expect(container.querySelector('[data-pending-cells]')).toBeNull();
});
