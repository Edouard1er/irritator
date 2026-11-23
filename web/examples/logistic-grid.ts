import { ApiError, caps, validateRequest, type RunRequest } from '../packages/contracts/index.js';
import single from './logistic-single-v1.json' with { type: 'json' };
import reference from './logistic-nine-cells-v1.json' with { type: 'json' };
import type { LakeCell } from './logistic-lake.js';

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

export function lakeDomain(wetCells: readonly LakeCell[]) {
  checkBudget(wetCells.length, 'du lac');
  const totalFraction = wetCells.reduce((sum, cell) => sum + cell.wetFraction, 0);
  const cells = wetCells.map(cell => {
    const area = constantDomain.area * cell.wetFraction / totalFraction;
    return { ...cell, area, initial: constantDomain.initialDensity * area, capacity: constantDomain.capacityDensity * area };
  });
  const request = buildRequest('logistic-lake-silhouette', cells, { start: 0, end: constantDomain.horizon });
  return { cells, request };
}

function checkBudget(count: number, grid: string) {
  if (count * single.model.components.length > caps.maxComponents ||
      count * single.model.connections.length > caps.maxConnections) {
    throw new ApiError('LIMIT_EXCEEDED', `La grille ${grid} dépasse le budget de taille du runner.`);
  }
}

type ModelCell = { id: string; initial: number; capacity?: number | undefined };

function buildRequest(id: string, cells: readonly ModelCell[], simulation: RunRequest['simulation']): RunRequest {
  const template = single.model;
  const model: RunRequest['model'] = { id, components: [], connections: [], observations: [] };
  for (const { id, initial, capacity } of cells) {
    for (const atom of template.components) {
      const parameters = { ...atom.parameters } as Record<string, number>;
      if (atom.id === 'N') parameters.X = initial;
      if (capacity !== undefined) {
        if (atom.id === 'N') parameters.dQ = constantDomain.quantum;
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
