import { createHash } from 'node:crypto';
import { caps, requestSchema, validateRequest } from '../packages/contracts/index.js';
import { lakeFullNetworkResolution, lakeFullTopology } from './lake-full-topology.js';
import { buildCompactLogisticRequest } from './logistic-compact.js';
import type { LakeDomain } from './logistic-grid.js';
import { lakeExchangeIntensities, type LakeExchangeIntensity } from './logistic-lake-exchange.js';
import { lakeResolutionId, type LakeMesh } from './logistic-lake.js';

export type LakeFullNetworkInputs = { mode: 'full-network'; mu: LakeExchangeIntensity };
export type LakeFullNetwork = ReturnType<typeof lakeFullTopology> & LakeFullNetworkInputs & {
  budget: { components: number; connections: number; observations: number; points: number; requestBytes: number };
};

export function lakeFullNetworkDomain(mesh: LakeMesh, domain: LakeDomain, { mu }: LakeFullNetworkInputs) {
  if (lakeResolutionId(mesh) !== lakeFullNetworkResolution) {
    throw new RangeError('Le réseau complet est disponible sur la grille 6 × 3.');
  }
  if (!lakeExchangeIntensities.includes(mu)) throw new RangeError('Intensité d’échange invalide.');
  const topology = lakeFullTopology(mesh);
  const { cells, edges } = topology;
  const members = domain.cells;
  const byId = new Map(members.map(cell => [cell.id, cell]));
  if (cells.length !== members.length || cells.some(id => (byId.get(id)?.area ?? 0) <= 0)) {
    throw new RangeError('Le domaine biologique doit couvrir toutes les cellules humides du maillage.');
  }
  const request = buildCompactLogisticRequest('lake-full-6x3', members, domain.parameters.simulation);
  const { model } = request;
  const connect = (from: string, to: string, port: number) => {
    model.connections.push({ from: { component: from, port: 0 }, to: { component: to, port } });
  };
  function sum(id: string, first: string, second: string, weightA: number, weightB: number) {
    model.components.push({ id, type: 'qss3_wsum_2', parameters: { 'coeff-0': weightA, 'coeff-1': weightB } });
    connect(first, id, 0);
    connect(second, id, 1);
  }
  const derivatives = new Map(cells.map(id => [id, `${id}-sum`]));
  const states = new Set(members.map(cell => cell.component));
  model.connections = model.connections.filter(({ to }) => !states.has(to.component));
  for (const [index, edge] of edges.entries()) {
    const a = byId.get(edge.a)!;
    const b = byId.get(edge.b)!;
    const area = a.area + b.area;
    const flux = `full-flux-${index + 1}`;
    // Expand the density difference so that each weight is bounded by μ.
    sum(flux, a.component, b.component, mu * (b.area / area), -mu * (a.area / area));
    for (const [cell, sign] of [[a, -1], [b, 1]] as const) {
      const next = `${cell.id}-derivative-${index + 1}`;
      sum(next, derivatives.get(cell.id)!, flux, 1, sign);
      derivatives.set(cell.id, next);
    }
  }
  for (const cell of members) connect(derivatives.get(cell.id)!, cell.component, 0);

  // Include geometry, parameters and the actual native assembly in the deterministic ID.
  const digest = createHash('sha256')
    .update(JSON.stringify([topology, domain.parameters.distribution, mu, request])).digest('hex').slice(0, 32);
  model.id = `lake-full-6x3-mu${100 * mu}-${digest}`;
  const duration = request.simulation.end - request.simulation.start;
  const budget = {
    components: model.components.length,
    connections: model.connections.length,
    observations: model.observations.length,
    points: model.observations.reduce((total, { samplingInterval }) => total + Math.ceil(duration / samplingInterval) + 2, 0),
    requestBytes: Buffer.byteLength(JSON.stringify(request), 'utf8'),
  };
  const ceilings = { components: caps.maxComponents, connections: caps.maxConnections,
    observations: requestSchema.properties.model.properties.observations.maxItems, points: caps.maxPoints,
    requestBytes: 1_048_576 };
  for (const resource of Object.keys(ceilings) as (keyof typeof ceilings)[]) {
    if (budget[resource] > ceilings[resource]) {
      throw new RangeError(`Budget du runner dépassé · ${resource} (${budget[resource]}/${ceilings[resource]}).`);
    }
  }
  validateRequest(request);
  const fullNetwork: LakeFullNetwork = { ...topology, mode: 'full-network', mu, budget };
  return { ...domain, fullNetwork, batches: [{ request, cells: members }] };
}
