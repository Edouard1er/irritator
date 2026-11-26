import { validateRequest, type RunRequest } from '../packages/contracts/index.js';
import type { LakeDomain } from './logistic-grid.js';

type LogisticCell = Pick<LakeDomain['cells'][number], 'id' | 'component' | 'initial' | 'quantum' |
  'growth' | 'capacity' | 'samplingInterval'>;

export function buildCompactLogisticRequest(id: string, cells: readonly LogisticCell[],
  simulation: RunRequest['simulation']): RunRequest {
  const model: RunRequest['model'] = { id, components: [], connections: [], observations: [] };
  for (const cell of cells) {
    const state = cell.component;
    const rate = `${cell.id}-r`;
    const linear = `${cell.id}-rN`;
    const quadratic = `${cell.id}-rNtimesN`;
    const sum = `${cell.id}-sum`;
    model.components.push(
      { id: state, type: 'qss3_integrator', parameters: { X: cell.initial, dQ: cell.quantum } },
      { id: rate, type: 'constant', parameters: { value: cell.growth, offset: 0 } },
      { id: linear, type: 'qss3_multiplier', parameters: {} },
      { id: quadratic, type: 'qss3_multiplier', parameters: {} },
      { id: sum, type: 'qss3_wsum_2', parameters: { 'coeff-0': 1, 'coeff-1': -1 / cell.capacity } },
    );
    const connect = (from: string, to: string, port: number) => {
      model.connections.push({ from: { component: from, port: 0 }, to: { component: to, port } });
    };
    connect(rate, linear, 0);
    connect(state, linear, 1);
    connect(linear, quadratic, 0);
    connect(state, quadratic, 1);
    connect(linear, sum, 0);
    connect(quadratic, sum, 1);
    connect(sum, state, 0);
    model.observations.push({ component: state, samplingInterval: cell.samplingInterval });
  }
  const request: RunRequest = { schemaVersion: 1, model, simulation };
  validateRequest(request);
  return request;
}
