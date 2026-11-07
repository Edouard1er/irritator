// Graph construction only. State reads, forecasts, scores and actions run in C++.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
const ports = names => names.map((name, port) => ({ port, name }));
export function feedback({ times = [1, 3], delay = 0, initial = 10, command = 2, target = 10.5 } = {}) {
  const plant = { id: 'Plant', name: 'Système dynamique observable', inputs: ports(['read', 'action']), outputs: ports(['observation']),
    components: [atom('X', 'qss3_integrator', { X: initial, dQ: .01 }), atom('hold', 'zero_order_hold'), atom('sample', 'state_observer')],
    connections: [edge('$input', 0, 'sample', 1), edge('$input', 1, 'hold', 0), edge('hold', 0, 'X', 0), edge('X', 0, 'sample', 0), edge('sample', 0, '$output', 0)] };
  const prospect = { id: 'Prospect', name: 'Intégrale prospective', inputs: [], outputs: [],
    components: [atom('u', 'constant'), atom('X', 'qss3_integrator', { X: -777, dQ: .01 })], connections: [edge('u', 0, 'X', 0)] };
  const decide = { id: 'ChooseAction', name: 'Choix par composition', inputs: ports(['terminal', 'action', 'end']), outputs: ports(['action', 'identity', 'score', 'selected', 'taggedAction', 'end']),
    components: [atom('distance', 'event_operator', { operation: 2, right: target }), atom('absolute', 'event_operator', { operation: 16 }), atom('negative', 'event_operator', { operation: 3, right: -1 }), atom('filter', 'candidate_filter', { required: 3 }), atom('select', 'candidate_select', { emitFallback: 0 })],
    connections: [edge('$input', 0, 'distance', 0), edge('$input', 2, 'distance', 3), edge('distance', 0, 'absolute', 0), edge('distance', 2, 'absolute', 3), edge('absolute', 0, 'negative', 0), edge('absolute', 2, 'negative', 3), edge('negative', 0, 'filter', 0), edge('negative', 2, 'filter', 3), edge('$input', 1, 'filter', 1), edge('filter', 0, 'select', 0), edge('filter', 1, 'select', 1), edge('filter', 2, 'select', 2), ...[0, 1, 2, 3, 4, 6].map((p, i) => edge('select', p, '$output', i))] };
  const wrapper = { id: 'forecast', type: 'simulation_wrapper', parameters: {}, experiment: { definition: 'Prospect', simulation: { start: 0, end: 2 }, run: 'complete', scenarioResults: true,
    factors: [{ id: 'initial', target: 'X', parameter: 'X', type: 'single', value: -777 }, { id: 'rate', target: 'u', parameter: 'value', type: 'fixed', values: [-1, 0, 1] }],
    selections: [{ id: 'terminal', target: 'X', criteria: 'max-last' }], objective: { method: 'simple', type: 'maximize', primary: 'terminal' } } };
  return { schemaVersion: 3, model: { id: 'decision-feedback-minimal', definitions: [plant, prospect, decide],
    components: [{ id: 'plant', type: 'coupled', parameters: {}, definition: 'Plant' }, atom('initialCommand', 'constant', { value: command }),
      ...times.map((offset, i) => atom('read' + (i + 1), 'constant', { offset })), atom('observation', 'value_memory', { emitOnWrite: 1 }),
      atom('initValue', 'event_operator', { operation: 3, right: 0 }), atom('runValue', 'event_operator', { operation: 1, right: delay }), wrapper,
      { id: 'decide', type: 'coupled', parameters: {}, definition: 'ChooseAction' }, atom('applied', 'value_memory', { initial: command, emitOnWrite: 1 })],
    connections: [edge('initialCommand', 0, 'plant', 1), ...times.map((_, i) => edge('read' + (i + 1), 0, 'plant', 0)), edge('plant', 0, 'observation', 0),
      edge('observation', 0, 'forecast', 2), edge('observation', 0, 'initValue', 0), edge('initValue', 0, 'forecast', 0), edge('initValue', 0, 'runValue', 0), edge('runValue', 0, 'forecast', 1),
      edge('forecast', 6, 'decide', 0), edge('forecast', 5, 'decide', 1), edge('forecast', 7, 'decide', 2), edge('decide', 0, 'plant', 1), edge('decide', 0, 'applied', 0)],
    observations: ['plant/X', 'plant/hold', 'plant/sample', 'observation', 'applied', 'decide/select'].map(component => ({ component, samplingInterval: .1 })) }, simulation: { start: 0, end: 5 } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write'))
  writeFileSync(new URL('../../examples/decision-feedback-minimal-v3.json', import.meta.url), JSON.stringify(feedback(), null, 2) + '\n');
