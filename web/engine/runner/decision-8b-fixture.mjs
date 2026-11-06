// Model construction only. Every prospective simulation and decision runs in C++.
import { readFileSync, writeFileSync } from 'node:fs';
import { atom, edge } from './decision-fixtures.mjs';

export function decisionFiltrage(threshold = 140) {
  return {
    id: 'DecisionFiltrage', name: 'DecisionFiltrage',
    inputs: ['Nmin', 'CH', 'E', 'end'].map((name, port) => ({ port, name })),
    outputs: ['action', 'identity', 'score', 'selected'].map((name, port) => ({ port, name })),
    components: [
      atom('admissible', 'event_operator', { operation: 10, right: threshold, required: 1 }),
      atom('filter', 'candidate_filter', { required: 7 }),
      atom('select', 'candidate_select', { emitFallback: 0 }),
    ],
    connections: [
      edge('$input', 0, 'admissible', 0), edge('$input', 3, 'admissible', 3),
      edge('$input', 1, 'filter', 0), edge('$input', 2, 'filter', 1),
      edge('admissible', 0, 'filter', 2), edge('admissible', 2, 'filter', 3),
      edge('filter', 0, 'select', 0), edge('filter', 1, 'select', 1), edge('filter', 2, 'select', 2),
      ...[0, 1, 2, 3].map(p => edge('select', p, '$output', p)),
    ],
  };
}
export function schaeferExternal(threshold = 140) {
  const m = JSON.parse(readFileSync(new URL('../../examples/wrapper-schaefer-v3.json', import.meta.url), 'utf8'));
  m.model.id = 'decision-schaefer-external';
  const w = m.model.components.find(c => c.type === 'simulation_wrapper');
  Object.assign(w.experiment, {
    simulation: { start: 0, end: 20 }, run: 'complete', scenarioResults: true,
    factors: [
      { id: 'effort', target: 'E', parameter: 'value', type: 'fixed', values: [80, 150, 260] },
      { id: 'capturabilite', target: 'q', parameter: 'value', type: 'fixed', values: [0.0008, 0.001] },
    ],
    selections: [{ id: 'Nmin', target: 'N', criteria: 'min' }, { id: 'CH', target: 'C', criteria: 'max-last' }],
    objective: { method: 'simple', type: 'maximize', primary: 'CH' },
  });
  m.model.definitions.push(decisionFiltrage(threshold));
  m.model.components = [m.model.components[0], w,
    { id: 'external', type: 'coupled', parameters: {}, definition: 'DecisionFiltrage' },
    ...['internalNmin', 'internalCH', 'internalE', 'internalQ', 'action'].map(id => atom(id, 'qss1_sum_2')),
    // A sentinel distinguishes no emission from an emitted action equal to zero.
    atom('actionReceipt', 'value_memory', { initial: -999, emitOnWrite: 1 }),
    ...['identity', 'score', 'selected'].map(id => atom(id, 'value_memory', { emitOnWrite: 1 })),
  ];
  m.model.connections = [edge('run', 0, 'decision', 1),
    ...['internalNmin', 'internalCH', 'internalE', 'internalQ'].map((id, p) => edge('decision', p, id, 0)),
    edge('decision', 7, 'external', 0), edge('decision', 8, 'external', 1),
    edge('decision', 5, 'external', 2), edge('decision', 9, 'external', 3),
    edge('external', 0, 'action', 0), edge('external', 0, 'actionReceipt', 0),
    ...['identity', 'score', 'selected'].map((id, i) => edge('external', i + 1, id, 0)),
  ];
  m.model.observations = ['internalNmin', 'internalCH', 'internalE', 'internalQ', 'action', 'actionReceipt', 'identity', 'score', 'selected'].map(component => ({ component, samplingInterval: 0.1 }));
  return m;
}
if (process.argv.includes('--write')) writeFileSync(new URL('../../examples/decision-schaefer-external-v3.json', import.meta.url), JSON.stringify(schaeferExternal(), null, 2) + '\n');
