import { ApiError, caps, catalog, requestSchema, validateRequest, type RunRequest } from '../packages/contracts/index.js';
import single from './logistic-single-v1.json' with { type: 'json' };
import reference from './logistic-nine-cells-v1.json' with { type: 'json' };
import { lakeMaxAlpha, lakeResolutionId, type LakeDistribution, type LakeMesh } from './logistic-lake.js';

export const spatialDimensions = [2, 3, 4] as const;
export type SpatialDimension = typeof spatialDimensions[number];
export type SpatialMode = 'independent' | 'constant';

export const constantDomain = {
  area: 9,
  initialDensity: 150,
  capacityDensity: 300,
  growth: 0.35,
  horizon: 20,
  quantum: 0.01,
} as const;

export function constantDomainCell(dimension: SpatialDimension) {
  const area = constantDomain.area / dimension ** 2;
  return {
    area,
    initial: constantDomain.initialDensity * area,
    capacity: constantDomain.capacityDensity * area,
  };
}

const modelIds = { 2: 'logistic-four-cells', 3: reference.model.id, 4: 'logistic-sixteen-cells' };
const referenceInitial = new Map(reference.model.components
  .filter(atom => atom.id.endsWith('-N'))
  .map(atom => [atom.id, atom.parameters.X]));

// Demonstration cells use the growth, capacity and quantum of the single-cell fixture.
const addedInitial: Readonly<Partial<Record<string, number>>> = {
  C03: 60, C13: 150, C23: 300, C30: 80, C31: 380, C32: 220, C33: 270,
};

export function spatialRequest(dimension: SpatialDimension = 3, mode: SpatialMode = 'independent'): RunRequest {
  const cellCount = dimension * dimension;
  const grid = `${dimension} × ${dimension}`;
  if (Number.isInteger(dimension) && dimension > 0) checkBudget(cellCount, grid);
  if (dimension !== 2 && dimension !== 3 && dimension !== 4) {
    throw new RangeError('Choisissez une grille de 2 × 2, 3 × 3 ou 4 × 4 cellules.');
  }

  const fixedCell = mode === 'constant' ? constantDomainCell(dimension) : undefined;
  const cells: ModelCell[] = [];
  for (let row = 0; row < dimension; row++) {
    for (let column = 0; column < dimension; column++) {
      const id = `C${row}${column}`;
      const initial = fixedCell?.initial ?? referenceInitial.get(`${id}-N`) ?? addedInitial[id];
      if (initial === undefined) throw new Error(`Biomasse initiale manquante pour ${id}.`);
      cells.push({ id, initial, capacity: fixedCell?.capacity });
    }
  }
  const modelId = fixedCell ? `logistic-constant-domain-${dimension}x${dimension}` : modelIds[dimension];
  return buildRequest(modelId, cells, fixedCell ? { start: 0, end: constantDomain.horizon } : { ...reference.simulation });
}

export const lakeSurfaceAreaKm2 = 300;
export const lakeQuantumFraction = 3e-7;
export type LakeQuantum = 'absolute' | 'proportional';
const quantumBounds = catalog.components.find(atom => atom.type === 'qss3_integrator')!.parameters.dQ!;

export function lakeDomain(mesh: LakeMesh, strategy: LakeQuantum = 'proportional',
  distribution: LakeDistribution = { kind: 'homogeneous' }) {
  const { initialDensity, capacityDensity, growth, horizon } = constantDomain;
  const simulation = { start: 0, end: horizon };
  const samplingInterval = single.model.observations[0]!.samplingInterval;
  const initialTonnes = initialDensity * lakeSurfaceAreaKm2;
  const alpha = distribution.kind === 'gradient' ? distribution.alpha : 0;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > lakeMaxAlpha) {
    throw new RangeError('L’intensité du gradient doit être comprise entre 0 et 0,6.');
  }
  const totalFraction = mesh.cells.reduce((sum, cell) => sum + cell.wetFraction, 0);
  const areas = mesh.cells.map(cell => lakeSurfaceAreaKm2 * cell.wetFraction / totalFraction);
  const weights = alpha === 0 ? undefined : mesh.cells.map(({ row }, index) =>
    areas[index]! * (1 + alpha * (0.5 - (row + 0.5) / mesh.rows)));
  const totalWeight = weights?.reduce((sum, weight) => sum + weight, 0);
  const cells = mesh.cells.map((cell, index) => {
    const area = areas[index]!;
    const initial = weights ? initialTonnes * weights[index]! / totalWeight! : initialDensity * area;
    const capacity = capacityDensity * area;
    const quantum = strategy === 'absolute' ? constantDomain.quantum
      : Math.min(quantumBounds.maximum, Math.max(quantumBounds.minimum, capacity * lakeQuantumFraction));
    return { ...cell, component: `${cell.id}-N`, area, initial, capacity, growth, quantum, samplingInterval };
  });
  // Same point estimate (including terminal margin) as the flat request contract.
  const pointsPerCell = single.model.observations.reduce((sum, observation) =>
    sum + Math.ceil(horizon / observation.samplingInterval) + 2, 0);
  const batchSize = Math.min(
    Math.floor(caps.maxComponents / single.model.components.length),
    Math.floor(caps.maxConnections / single.model.connections.length),
    Math.floor(requestSchema.properties.model.properties.observations.maxItems / single.model.observations.length),
    Math.floor(caps.maxPoints / pointsPerCell),
  );
  const resolution = lakeResolutionId(mesh);
  const distributionSuffix = alpha === 0 ? '' : `-g${String(alpha).replace('.', 'p')}`;
  const batches: { request: RunRequest; cells: typeof cells }[] = [];
  for (let offset = 0; offset < cells.length; offset += batchSize) {
    const members = cells.slice(offset, offset + batchSize);
    const id = `logistic-lake-${resolution}-${strategy}${distributionSuffix}-${batches.length + 1}`;
    batches.push({ request: buildRequest(id, members, simulation), cells: members });
  }
  const parameters = { rows: mesh.rows, columns: mesh.columns, areaKm2: lakeSurfaceAreaKm2,
    initialDensity, initialTonnes, capacityDensity, growth, simulation, samplingInterval, distribution,
    quantum: strategy === 'absolute' ? { strategy, tonnes: constantDomain.quantum }
      : { strategy, capacityFraction: lakeQuantumFraction, minimum: quantumBounds.minimum, maximum: quantumBounds.maximum } };
  return { cells, batches, parameters };
}

export type LakeDomain = ReturnType<typeof lakeDomain>;

function checkBudget(count: number, grid: string) {
  if (count * single.model.components.length > caps.maxComponents ||
      count * single.model.connections.length > caps.maxConnections) {
    throw new ApiError('LIMIT_EXCEEDED', `La grille ${grid} dépasse le budget de taille du runner.`);
  }
}

type ModelCell = { id: string; initial: number; capacity?: number | undefined; quantum?: number };

function buildRequest(id: string, cells: readonly ModelCell[], simulation: RunRequest['simulation']): RunRequest {
  const template = single.model;
  const model: RunRequest['model'] = { id, components: [], connections: [], observations: [] };
  for (const { id, initial, capacity, quantum } of cells) {
    for (const atom of template.components) {
      const parameters = { ...atom.parameters } as Record<string, number>;
      if (atom.id === 'N') parameters.X = initial;
      if (capacity !== undefined) {
        if (atom.id === 'N') parameters.dQ = quantum ?? constantDomain.quantum;
        if (atom.id === 'r') parameters.value = constantDomain.growth;
        if (atom.id === 'sum') parameters['coeff-1'] = -1 / capacity;
      }
      model.components.push({ ...atom, id: `${id}-${atom.id}`, parameters });
    }
    for (const { from, to } of template.connections) {
      model.connections.push({
        from: { ...from, component: `${id}-${from.component}` },
        to: { ...to, component: `${id}-${to.component}` },
      });
    }
    for (const observation of template.observations) {
      model.observations.push({ ...observation, component: `${id}-${observation.component}` });
    }
  }

  const request: RunRequest = { schemaVersion: 1, model, simulation };
  validateRequest(request);
  return request;
}
