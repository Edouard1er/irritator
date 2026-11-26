import { validateRequest, type RunRequest } from '../packages/contracts/index.js';
import { buildRequest, type LakeDomain } from './logistic-grid.js';
import { lakeWetFrontier, type WetFrontier } from './lake-wet-frontier.js';
import { lakeResolutionId, lakeResolutions, type LakeMesh } from './logistic-lake.js';

export const lakeExchangeIntensities = [0, 0.25, 0.5] as const;
export const lakeExchangeResolutions = [lakeResolutions[0], lakeResolutions[2]] as const;
export type LakeExchangeIntensity = typeof lakeExchangeIntensities[number];
export type LakeExchangeInputs = { a: string; b: string; mu: LakeExchangeIntensity };
export type LakeExchange = LakeExchangeInputs & { frontier: WetFrontier };
type ExchangeCell = LakeDomain['cells'][number];

export function lakeExchangeFlux(mu: number, areaA: number, areaB: number, densityA: number, densityB: number) {
  const difference = densityA - densityB;
  // Dividing the observed B = density × area can round equal densities differently.
  const rounding = 4 * Number.EPSILON * Math.max(Math.abs(densityA), Math.abs(densityB));
  if (Math.abs(difference) <= rounding) return 0;
  return mu * (areaA * areaB / (areaA + areaB)) * difference;
}

export function lakePairRequest(id: string, pair: readonly [ExchangeCell, ExchangeCell], mu: LakeExchangeIntensity,
  simulation: RunRequest['simulation']): RunRequest {
  const [a, b] = pair;
  const request = buildRequest(id, pair, simulation);
  const { model } = request;
  const weightedSum = (id: string, first: number, second: number) => {
    model.components.push({ id, type: 'qss3_wsum_2', parameters: { 'coeff-0': first, 'coeff-1': second } });
  };
  const connect = (from: string, to: string, port: number) => {
    model.connections.push({ from: { component: from, port: 0 }, to: { component: to, port } });
  };
  // Expand the density difference so both weights remain bounded by mu, even for tiny wet cells.
  const area = a.area + b.area;
  weightedSum('exchange-flux', mu * (b.area / area), -mu * (a.area / area));
  connect(a.component, 'exchange-flux', 0);
  connect(b.component, 'exchange-flux', 1);
  for (const [index, cell] of pair.entries()) {
    const derivative = `${cell.id}-derivative`;
    weightedSum(derivative, 1, index === 0 ? -1 : 1);
    model.connections = model.connections.filter(({ to }) => to.component !== cell.component);
    connect(`${cell.id}-sum`, derivative, 0);
    connect('exchange-flux', derivative, 1);
    connect(derivative, cell.component, 0);
  }
  validateRequest(request);
  return request;
}

export function lakeExchangeDomain(mesh: LakeMesh, domain: LakeDomain, inputs: LakeExchangeInputs) {
  const a = domain.cells.find(cell => cell.id === inputs.a);
  const b = domain.cells.find(cell => cell.id === inputs.b);
  const frontier = a && b && lakeWetFrontier(mesh, a, b);
  if (!a || !b || !frontier) throw new RangeError('Choisissez deux cellules qui partagent une frontière humide de longueur positive.');
  const exchange: LakeExchange = { ...inputs, frontier };
  const pair = [a, b] as const;
  const independent = domain.batches.flatMap(({ cells, request }) => {
    const members = cells.filter(cell => cell !== a && cell !== b);
    if (members.length === 0) return [];
    return [{ cells: members, request: members.length === cells.length ? request
      : buildRequest(request.model.id, members, request.simulation) }];
  });
  const id = `lake-exchange-${lakeResolutionId(mesh)}-${a.id}-${b.id}-${inputs.mu * 100}`;
  const request = lakePairRequest(id, pair, inputs.mu, domain.parameters.simulation);
  return { ...domain, exchange, batches: [{ request, cells: [...pair] }, ...independent] };
}
