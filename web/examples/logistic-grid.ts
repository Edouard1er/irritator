import { ApiError, caps, validateRequest, type RunRequest } from '../packages/contracts/index.js';
import single from './logistic-single-v1.json' with { type: 'json' };
import reference from './logistic-nine-cells-v1.json' with { type: 'json' };

export type SpatialDimension = 2 | 3 | 4;

const modelIds = { 2: 'logistic-four-cells', 3: reference.model.id, 4: 'logistic-sixteen-cells' };
const referenceInitial = new Map(reference.model.components
  .filter(atom => atom.id.endsWith('-N'))
  .map(atom => [atom.id, atom.parameters.X]));

// Demonstration cells use the growth, capacity and quantum of the single-cell fixture.
const addedInitial: Readonly<Partial<Record<string, number>>> = {
  C03: 60, C13: 150, C23: 300, C30: 80, C31: 380, C32: 220, C33: 270,
};

export function spatialRequest(dimension: SpatialDimension = 3): RunRequest {
  const cellCount = dimension * dimension;
  const template = single.model;
  if (Number.isInteger(dimension) && dimension > 0 && (
    cellCount * template.components.length > caps.maxComponents ||
    cellCount * template.connections.length > caps.maxConnections
  )) {
    throw new ApiError('LIMIT_EXCEEDED', `La grille ${dimension} × ${dimension} dépasse le budget de taille du runner.`);
  }
  if (dimension !== 2 && dimension !== 3 && dimension !== 4) {
    throw new RangeError('Choisissez une grille de 2 × 2, 3 × 3 ou 4 × 4 cellules.');
  }

  const model: RunRequest['model'] = {
    id: modelIds[dimension], components: [], connections: [], observations: [],
  };
  for (let row = 0; row < dimension; row++) {
    for (let column = 0; column < dimension; column++) {
      const id = `C${row}${column}`;
      const initial = referenceInitial.get(`${id}-N`) ?? addedInitial[id];
      if (initial === undefined) throw new Error(`Biomasse initiale manquante pour ${id}.`);

      for (const atom of template.components) {
        const parameters = { ...atom.parameters } as Record<string, number>;
        if (atom.id === 'N') parameters.X = initial;
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
  }

  const request: RunRequest = { schemaVersion: 1, model, simulation: { ...reference.simulation } };
  validateRequest(request);
  return request;
}
