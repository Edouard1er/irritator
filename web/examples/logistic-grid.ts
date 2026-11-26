import { ApiError, caps, catalog, requestSchema, validateRequest, type RunRequest } from '../packages/contracts/index.js';
import single from './logistic-single-v1.json' with { type: 'json' };
import reference from './logistic-nine-cells-v1.json' with { type: 'json' };
import { lakeDefaultGradientProfile, lakeMaxAlpha, lakeResolutionId, type LakeDistribution, type LakeMesh } from './logistic-lake.js';

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

function sigmoidInitials(capacities: readonly number[], positions: readonly number[], alpha: number, total: number) {
  const epsilon = 0.01;
  const steepness = 12 * (alpha / lakeMaxAlpha) ** 2;
  const offsets = positions.map(y => steepness * (0.5 - y));
  const biomass = (capacity: number, offset: number, center: number) =>
    capacity * (epsilon + (1 - 2 * epsilon) / (1 + Math.exp(-(center + offset))));

  // At the bracket endpoints every cell is strictly below or above half capacity.
  let lower = -1 - steepness / 2;
  let upper = 1 + steepness / 2;
  for (let step = 0; step < 60; step++) {
    const center = (lower + upper) / 2;
    const sum = capacities.reduce((value, capacity, index) => value + biomass(capacity, offsets[index]!, center), 0);
    if (sum < total) lower = center;
    else upper = center;
  }
  const center = (lower + upper) / 2;
  return capacities.map((capacity, index) => biomass(capacity, offsets[index]!, center));
}

function linearInitials(areas: readonly number[], positions: readonly number[], alpha: number, total: number, wet: boolean) {
  const weights = areas.map((area, index) => area * (1 + alpha * (0.5 - positions[index]!)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const initials = weights.map(weight => total * weight / totalWeight);
  if (wet) {
    const last = initials.length - 1;
    const subtotal = initials.slice(0, last).reduce((sum, initial) => sum + initial, 0);
    const remainder = total - subtotal;
    // Absorb rounding in the last cell, keeping its biomass if too small to resolve the remainder.
    if (remainder > 0) initials[last] = remainder;
  }
  return initials;
}

export function lakeDomain(mesh: LakeMesh, strategy: LakeQuantum = 'proportional',
  distribution: LakeDistribution = { kind: 'homogeneous' }) {
  const { initialDensity, capacityDensity, growth, horizon } = constantDomain;
  const simulation = { start: 0, end: horizon };
  const samplingInterval = single.model.observations[0]!.samplingInterval;
  const initialTonnes = initialDensity * lakeSurfaceAreaKm2;
  const alpha = distribution.kind === 'homogeneous' ? 0 : distribution.alpha;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > lakeMaxAlpha) {
    throw new RangeError('L’intensité du gradient doit être comprise entre 0 et 0,6.');
  }
  const totalFraction = mesh.cells.reduce((sum, cell) => sum + cell.wetFraction, 0);
  const areas = mesh.cells.map(cell => lakeSurfaceAreaKm2 * cell.wetFraction / totalFraction);
  const capacities = areas.map(area => capacityDensity * area);
  const explicitProfile = distribution.kind === 'homogeneous' ? undefined : distribution.profile;
  const profile = explicitProfile ?? lakeDefaultGradientProfile;
  let initials: number[] | undefined;
  if (alpha > 0) {
    const wet = distribution.kind === 'wet-gradient';
    const positions = mesh.cells.map(({ row, wetCentroid }) => wet ? wetCentroid[1] / mesh.height : (row + 0.5) / mesh.rows);
    initials = profile === 'sigmoid-v2' ? sigmoidInitials(capacities, positions, alpha, initialTonnes)
      : linearInitials(areas, positions, alpha, initialTonnes, wet);
  }
  const cells = mesh.cells.map((cell, index) => {
    const area = areas[index]!;
    const initial = initials?.[index] ?? initialDensity * area;
    const capacity = capacities[index]!;
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
  const gradientPrefix = distribution.kind === 'wet-gradient' ? 'wg' : 'g';
  const alphaId = `${gradientPrefix}${String(alpha).replace('.', 'p')}`;
  // Keep native IDs for historical requests that omitted the profile.
  const distributionSuffix = explicitProfile ? `-${explicitProfile}-${alphaId}` : alpha === 0 ? '' : `-${alphaId}`;
  // The abbreviated strategy leaves room for the profile and full-precision α in the 64-character ID.
  const strategyId = explicitProfile ? strategy[0] : strategy;
  const batches: { request: RunRequest; cells: typeof cells }[] = [];
  for (let offset = 0; offset < cells.length; offset += batchSize) {
    const members = cells.slice(offset, offset + batchSize);
    const id = `logistic-lake-${resolution}-${strategyId}${distributionSuffix}-${batches.length + 1}`;
    batches.push({ request: buildRequest(id, members, simulation), cells: members });
  }
  const parameters = { rows: mesh.rows, columns: mesh.columns, areaKm2: lakeSurfaceAreaKm2,
    initialDensity, initialTonnes, capacityDensity, growth, simulation, samplingInterval,
    distribution: distribution.kind === 'homogeneous' ? distribution : { ...distribution, profile },
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

type ModelCell = { id: string; initial: number; capacity?: number | undefined; quantum?: number; growth?: number };

export function buildRequest(id: string, cells: readonly ModelCell[], simulation: RunRequest['simulation']): RunRequest {
  const template = single.model;
  const model: RunRequest['model'] = { id, components: [], connections: [], observations: [] };
  for (const { id, initial, capacity, quantum, growth } of cells) {
    for (const atom of template.components) {
      const parameters = { ...atom.parameters } as Record<string, number>;
      if (atom.id === 'N') parameters.X = initial;
      if (capacity !== undefined) {
        if (atom.id === 'N') parameters.dQ = quantum ?? constantDomain.quantum;
        if (atom.id === 'r') parameters.value = growth ?? constantDomain.growth;
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
