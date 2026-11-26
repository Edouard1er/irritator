import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { lakeDomain } from '../../../examples/logistic-grid';
import { lakeNetworkDomain, type LakeNetworkInputs } from '../../../examples/logistic-lake-network';
import { clipLakeMesh, lakeMeshFromGeoJson, lakeResolutions } from '../../../examples/logistic-lake';
import { lakeDataset, lakeExchangeDirection, lakeExchangePath, lakeExchangeReading, lakeNetworkNetFlows } from '@/lib/simulation/lake-exploration';

const source = JSON.parse(readFileSync('data/geography/lac-de-guiers.hydrolakes.geojson', 'utf8'));
const mesh = lakeMeshFromGeoJson(source, lakeResolutions[0]);
const domain = lakeDomain(mesh, 'proportional', { kind: 'wet-gradient', alpha: 0.6, profile: 'sigmoid-v2' });
const chain: LakeNetworkInputs = { cells: ['C01', 'C11', 'C21'], edges: [['C01', 'C11'], ['C11', 'C21']], mu: 0.5 };

test('réunit les deux flux incidents à la cellule centrale dans le lot de la chaîne', () => {
  const plan = lakeNetworkDomain(mesh, domain, chain);
  const [coupled, outside] = plan.batches;
  const { request, cells } = coupled!;
  expect(cells.map(cell => cell.id)).toEqual(chain.cells);
  expect(outside!.cells).toHaveLength(domain.cells.length - 3);
  expect(plan.network.budget).toEqual({ components: 27, connections: 39, observations: 3, points: 606 });
  const connections = request.model.connections.map(({ from, to }) => [from.component, to.component, to.port]);
  expect(connections).toEqual(expect.arrayContaining([
    ['C11-sum', 'C11-derivative-1', 0], ['network-flux-1', 'C11-derivative-1', 1],
    ['C11-derivative-1', 'C11-derivative-2', 0], ['network-flux-2', 'C11-derivative-2', 1],
    ['C11-derivative-2', 'C11-N', 0],
  ]));
  expect(connections.filter(([, target]) => target === 'C11-N')).toHaveLength(1);
});

test.each([
  { selection: { ...chain, cells: ['C01', 'C11', 'C11'] }, message: 'distinctes' },
  { selection: { ...chain, cells: ['C00', 'C01', 'C11'] }, message: 'absente' },
  { selection: { ...chain, edges: [['C01', 'C11']] as const }, message: 'doivent être reliées' },
  { selection: { ...chain, edges: [...chain.edges, ['C21', 'C11'] as const] }, message: 'Arête en double' },
  { selection: { ...chain, edges: [...chain.edges, ['C01', 'C01'] as const] }, message: 'deux cellules distinctes' },
  { selection: { ...chain, edges: [...chain.edges, ['C01', 'C21'] as const] }, message: 'frontière humide' },
  { selection: { ...chain, cells: ['C11', 'C21', 'C31'], edges: [['C11', 'C21'], ['C21', 'C31']] as const }, message: 'frontière humide' },
])('rejette la topologie invalide ($message)', ({ selection, message }) => {
  expect(() => lakeNetworkDomain(mesh, domain, selection)).toThrow(message);
});

test('rejette une arête dont l’île recouvre la frontière commune entre deux cellules humides', () => {
  const islandMesh = clipLakeMesh([
    [[0.25, 0.25], [2.75, 0.25], [2.75, 5.75], [0.25, 5.75]],
    [[0.75, 0.75], [1.25, 0.75], [1.25, 2.25], [0.75, 2.25]],
  ], 3, 6);
  const islandDomain = lakeDomain(islandMesh);
  const cells = ['C00', 'C10', 'C11'];
  expect(islandDomain.cells.filter(cell => cells.includes(cell.id))).toHaveLength(3);
  expect(() => lakeNetworkDomain(islandMesh, islandDomain, { cells, edges: [['C00', 'C10'], ['C10', 'C11']], mu: 0.5 }))
    .toThrow('C10 et C11 ne partagent pas de frontière humide');
});

test('nomme le budget dépassé avant de construire la requête réseau', () => {
  const longer = { ...domain, parameters: { ...domain.parameters, simulation: { start: 0, end: 1000 } } };
  expect(() => lakeNetworkDomain(mesh, longer, chain)).toThrow('Budget du runner dépassé · points (30006/20000)');
});

test('change le sens des flèches à partir des trajectoires et somme algébriquement les flux', () => {
  const plan = lakeNetworkDomain(mesh, domain, chain);
  const samples = [[200, 100], [150, 150], [100, 100]];
  const observations = domain.cells.map(cell => ({
    component: cell.component, samplingInterval: 0.1, samples: (samples[chain.cells.indexOf(cell.id)] ?? [0, 0])
      .map((density, i) => ({ value: density * cell.area, time: i * 0.1 })),
  }));
  const dataset = lakeDataset(domain, { observations, trace: {
    parameters: domain.parameters, network: plan.network, startedAt: '', elapsedMs: 0, wetCells: domain.cells.length,
    plannedBatches: 0, batches: [], points: 0, resultBytes: 0,
  } });
  const [before, after] = [0, 1].map(tick => plan.network.edges.map(edge => lakeExchangeReading(edge, dataset, chain.mu, tick)));
  expect(before!.map(lakeExchangeDirection)).toEqual(['C01 → C11', 'C11 → C21']);
  expect(after!.map(lakeExchangeDirection)).toEqual(['C11 → C01', 'C11 → C21']);
  expect(lakeExchangePath(before![0]!, 0.1)).not.toEqual(lakeExchangePath(after![0]!, 0.1));
  for (const edges of [before!, after!]) {
    const net = lakeNetworkNetFlows(edges);
    expect(net.get('C11')).toBe(edges[0]!.flux! - edges[1]!.flux!);
    expect([...net.values()].reduce((sum, flux) => sum + flux, 0)).toBeCloseTo(0, 10);
  }
});
