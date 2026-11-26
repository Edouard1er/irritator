import { caps, requestSchema, validateRequest, type RunRequest } from '../packages/contracts/index.js';
import { buildRequest, type LakeDomain } from './logistic-grid.js';
import { lakeExchangeIntensities, type LakeExchangeIntensity } from './logistic-lake-exchange.js';
import { lakeWetFrontier, type WetFrontier } from './lake-wet-frontier.js';
import { lakeResolutionId, type LakeMesh } from './logistic-lake.js';
import single from './logistic-single-v1.json' with { type: 'json' };

export const lakeNetworkSize = { min: 3, max: 6 } as const;
export type LakeNetworkInputs = {
  cells: readonly string[];
  edges: readonly (readonly [string, string])[];
  mu: LakeExchangeIntensity;
};
export type LakeNetworkEdge = { a: string; b: string; frontier: WetFrontier };
export type LakeNetwork = Pick<LakeNetworkInputs, 'cells' | 'mu'> & {
  edges: LakeNetworkEdge[];
  budget: { components: number; connections: number; observations: number; points: number };
};
type NetworkDomain = Pick<LakeDomain, 'cells' | 'batches'> & { parameters: Pick<RunRequest, 'simulation'> };

export function lakeNetworkConnected(cells: readonly string[], edges: readonly Pick<LakeNetworkEdge, 'a' | 'b'>[]) {
  const reached = new Set(cells.slice(0, 1));
  for (const id of reached) {
    for (const { a, b } of edges) {
      if (a === id) reached.add(b);
      if (b === id) reached.add(a);
    }
  }
  return reached.size === cells.length;
}

export function lakeNetworkDomain<T extends NetworkDomain>(mesh: LakeMesh, domain: T, inputs: LakeNetworkInputs) {
  const { mu } = inputs;
  const ids = new Set(inputs.cells);
  if (ids.size !== inputs.cells.length || ids.size < lakeNetworkSize.min || ids.size > lakeNetworkSize.max) {
    throw new RangeError('Choisissez entre trois et six cellules humides distinctes.');
  }
  if (!lakeExchangeIntensities.includes(mu)) throw new RangeError('Intensité d’échange invalide.');
  const members = domain.cells.filter(cell => ids.has(cell.id) && cell.wetFraction > 0 && cell.area > 0);
  if (members.length !== ids.size) throw new RangeError('Le réseau contient une cellule absente du maillage humide.');

  const byId = new Map(members.map(cell => [cell.id, cell]));
  const edges = new Map<string, LakeNetworkEdge>();
  for (const [first, second] of inputs.edges) {
    const [a, b] = first < second ? [first, second] : [second, first];
    const left = byId.get(a);
    const right = byId.get(b);
    if (!left || !right || a === b) throw new RangeError('Chaque arête doit relier deux cellules distinctes du réseau.');
    const key = `${a} ${b}`;
    if (edges.has(key)) throw new RangeError(`Arête en double · ${a} ↔ ${b}.`);
    const frontier = lakeWetFrontier(mesh, left, right);
    if (!frontier) throw new RangeError(`${a} et ${b} ne partagent pas de frontière humide de longueur positive.`);
    edges.set(key, { a, b, frontier });
  }
  const orderedEdges = [...edges.keys()].sort().map(key => edges.get(key)!);
  if (!lakeNetworkConnected(inputs.cells, orderedEdges)) throw new RangeError('Toutes les cellules du réseau doivent être reliées.');

  const incident = new Map(members.map(cell => [cell.id, [] as { flux: string; sign: 1 | -1 }[]]));
  for (const [index, { a, b }] of orderedEdges.entries()) {
    const flux = `network-flux-${index + 1}`;
    incident.get(a)!.push({ flux, sign: -1 });
    incident.get(b)!.push({ flux, sign: 1 });
  }

  const simulation = domain.parameters.simulation;
  const duration = simulation.end - simulation.start;
  const budget = {
    components: members.length * single.model.components.length + 3 * edges.size,
    connections: members.length * single.model.connections.length + 6 * edges.size,
    observations: members.length * single.model.observations.length,
    points: members.length * single.model.observations.reduce((sum, observation) =>
      sum + Math.ceil(duration / observation.samplingInterval) + 2, 0),
  };
  const ceilings = { components: caps.maxComponents, connections: caps.maxConnections,
    observations: requestSchema.properties.model.properties.observations.maxItems, points: caps.maxPoints };
  for (const resource of Object.keys(ceilings) as (keyof typeof ceilings)[]) {
    if (budget[resource] > ceilings[resource]) {
      throw new RangeError(`Budget du runner dépassé · ${resource} (${budget[resource]}/${ceilings[resource]}).`);
    }
  }

  const cellOrder = [...ids].sort();
  // Distinguish alternative topologies on the same cells within the model ID length limit.
  const edgeMask = orderedEdges.reduce((mask, { a, b }) => {
    const i = cellOrder.indexOf(a);
    const j = cellOrder.indexOf(b);
    return mask + 2 ** (j * (j - 1) / 2 + i);
  }, 0);
  const id = `lake-network-${lakeResolutionId(mesh)}-${members.map(cell => cell.id).join('-')}-${edgeMask.toString(16)}-${mu * 100}`;
  const request = buildRequest(id, members, simulation);
  const { model } = request;
  function sum(component: string, first: string, second: string, weightA: number, weightB: number) {
    model.components.push({ id: component, type: 'qss3_wsum_2', parameters: { 'coeff-0': weightA, 'coeff-1': weightB } });
    model.connections.push(
      { from: { component: first, port: 0 }, to: { component, port: 0 } },
      { from: { component: second, port: 0 }, to: { component, port: 1 } },
    );
  }
  for (const [index, edge] of orderedEdges.entries()) {
    const a = byId.get(edge.a)!;
    const b = byId.get(edge.b)!;
    const area = a.area + b.area;
    // The expanded weights stay bounded by μ even for very small wet areas.
    sum(`network-flux-${index + 1}`, a.component, b.component, mu * (b.area / area), -mu * (a.area / area));
  }
  const states = new Set(members.map(cell => cell.component));
  model.connections = model.connections.filter(({ to }) => !states.has(to.component));
  for (const cell of members) {
    let derivative = `${cell.id}-sum`;
    for (const [index, { flux, sign }] of incident.get(cell.id)!.entries()) {
      const next = `${cell.id}-derivative-${index + 1}`;
      sum(next, derivative, flux, 1, sign);
      derivative = next;
    }
    model.connections.push({ from: { component: derivative, port: 0 }, to: { component: cell.component, port: 0 } });
  }
  validateRequest(request);

  const independent = domain.batches.flatMap(({ cells, request }) => {
    const outside = cells.filter(cell => !ids.has(cell.id));
    if (!outside.length) return [];
    return [{ cells: outside, request: outside.length === cells.length ? request
      : buildRequest(request.model.id, outside, request.simulation) }];
  });
  const network: LakeNetwork = { cells: members.map(cell => cell.id), edges: orderedEdges, mu, budget };
  return { ...domain, network, batches: [{ request, cells: members }, ...independent] };
}
