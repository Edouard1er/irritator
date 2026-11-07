// Graph construction only. No forecast, score or action is computed here.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { fallbackDefinition } from './decision-8c-fixture.mjs';
const ports = names => names.map((name, port) => ({ port, name }));
const coupled = (id, definition) => ({ id, type: 'coupled', parameters: {}, definition });
export function schaeferFeedback({ times = [1, 3], delay = 0, initialN = 150, initialC = 0, command = 260, threshold = 140 } = {}) {
  const prospect = structuredClone(JSON.parse(readFileSync(new URL('../../model-test/schaefer-six-scenarios.source.json', import.meta.url), 'utf8')).model.definitions[0]);
  Object.assign(prospect, { id: 'SchaeferProspect', name: 'Schaefer prospectif' });
  prospect.components.find(c => c.id === 'N').parameters.X = -777;
  prospect.components.find(c => c.id === 'C').parameters.X = -888;
  const plant = structuredClone(prospect);
  Object.assign(plant, { id: 'SchaeferPlant', name: 'Schaefer observable et commandable', inputs: ports(['read', 'action']), outputs: ports(['N', 'C', 'missingN', 'missingC']) });
  plant.components.find(c => c.id === 'N').parameters.X = initialN;
  plant.components.find(c => c.id === 'C').parameters.X = initialC;
  plant.components = plant.components.filter(c => c.id !== 'E');
  plant.components.push(atom('effort', 'zero_order_hold'), atom('observeN', 'state_observer'), atom('observeC', 'state_observer'));
  plant.connections = plant.connections.map(e => e.from.component === 'E' ? edge('effort', 0, e.to.component, e.to.port) : e);
  plant.connections.push(edge('$input', 1, 'effort', 0), ...['N', 'C'].flatMap((id, p) => [edge('$input', 0, 'observe' + id, 1), edge(id, 0, 'observe' + id, 0), edge('observe' + id, 0, '$output', p), edge('observe' + id, 1, '$output', p + 2)]));
  const synchronize = { id: 'SynchronizePair', name: 'Deux facteurs du même cycle', inputs: ports(['N', 'C', 'end']), outputs: ports(['N', 'C', 'init', 'run']),
    components: [atom('memoryN', 'value_memory', { emitOnWrite: 1 }), atom('memoryC', 'value_memory', { emitOnWrite: 1 }), atom('pairN', 'event_operator', { operation: 0, required: 3 }), atom('pairC', 'event_operator', { operation: 0, required: 3 }), atom('ready', 'event_operator', { operation: 0, required: 3 }), atom('initValue', 'event_operator', { operation: 3, right: 0 }), atom('runValue', 'event_operator', { operation: 1, right: delay })],
    connections: [edge('$input', 0, 'memoryN', 0), edge('$input', 1, 'memoryC', 0), edge('memoryN', 0, 'pairN', 0), edge('memoryC', 0, 'pairN', 1), edge('memoryC', 0, 'pairC', 0), edge('memoryN', 0, 'pairC', 1), edge('$input', 2, 'pairN', 3), edge('$input', 2, 'pairC', 3), edge('pairN', 0, '$output', 0), edge('pairC', 0, '$output', 1), edge('pairN', 0, 'ready', 0), edge('pairC', 0, 'ready', 1), edge('pairN', 2, 'ready', 3), edge('ready', 0, 'initValue', 0), edge('ready', 2, 'initValue', 3), edge('initValue', 0, '$output', 2), edge('initValue', 0, 'runValue', 0), edge('initValue', 2, 'runValue', 3), edge('runValue', 0, '$output', 3)] };
  const decision = { id: 'EvaluateCandidates', name: 'Capture future et contrainte', inputs: ports(['Nmin', 'CH', 'C0', 'E', 'end']), outputs: ports(['action', 'identity', 'score', 'selected', 'taggedAction', 'secondary', 'end']),
    components: [atom('deltaC', 'event_operator', { operation: 2, required: 3 }), atom('admissible', 'event_operator', { operation: 10, right: threshold }), coupled('choose', 'ConditionalDecision')],
    connections: [edge('$input', 1, 'deltaC', 0), edge('$input', 2, 'deltaC', 1), edge('$input', 4, 'deltaC', 3), edge('$input', 0, 'admissible', 0), edge('$input', 4, 'admissible', 3), edge('deltaC', 0, 'choose', 0), edge('$input', 0, 'choose', 1), edge('$input', 3, 'choose', 2), edge('admissible', 0, 'choose', 3), edge('deltaC', 2, 'choose', 4), ...Array.from({ length: 7 }, (_, p) => edge('choose', p, '$output', p))] };
  const forecast = { id: 'forecast', type: 'simulation_wrapper', parameters: {}, experiment: { definition: prospect.id, simulation: { start: 0, end: 20 }, run: 'complete', scenarioResults: true, requiredInputs: ['initialN', 'initialC'],
    factors: [{ id: 'initialN', target: 'N', parameter: 'X', type: 'single', value: -777 }, { id: 'initialC', target: 'C', parameter: 'X', type: 'single', value: -888 }, { id: 'effort', target: 'E', parameter: 'value', type: 'fixed', values: [80, 150, 260] }],
    selections: [{ id: 'Nmin', target: 'N', criteria: 'min' }, { id: 'CH', target: 'C', criteria: 'max-last' }], objective: { method: 'simple', type: 'maximize', primary: 'CH' } } };
  const components = [coupled('plant', plant.id), atom('initialCommand', 'constant', { value: command }), ...times.flatMap((offset, i) => [atom('read' + (i + 1), 'constant', { value: 1, offset }), atom('cycle' + (i + 1), 'event_tag', { campaign: i + 1 })]), coupled('synchronize', synchronize.id), forecast, coupled('decide', decision.id), atom('applied', 'value_memory', { initial: command, emitOnWrite: 1 }), ...['identity', 'score', 'status', 'primarySelected', 'secondarySelected', 'internalE'].map(id => atom(id, 'qss1_sum_2'))];
  const connections = [edge('initialCommand', 0, 'plant', 1), ...times.flatMap((_, i) => [edge('read' + (i + 1), 0, 'cycle' + (i + 1), 0), edge('cycle' + (i + 1), 0, 'plant', 0), edge('cycle' + (i + 1), 0, 'synchronize', 2)]), edge('plant', 0, 'synchronize', 0), edge('plant', 1, 'synchronize', 1), ...[[0, 2], [1, 3], [2, 0], [3, 1]].map(([a, b]) => edge('synchronize', a, 'forecast', b)), ...[[9, 0], [10, 1], [7, 2], [8, 3], [11, 4]].map(([a, b]) => edge('forecast', a, 'decide', b)), edge('decide', 0, 'plant', 1), edge('decide', 0, 'applied', 0), ...['identity', 'score', 'status'].map((id, i) => edge('decide', i + 1, id, 0)), edge('forecast', 4, 'internalE', 0)];
  // Branch status remains available through ordinary coupled ports.
  const conditional = fallbackDefinition(); conditional.outputs.push(...ports(['primarySelected', 'secondarySelected']).map((p, i) => ({ ...p, port: i + 7 })));
  conditional.connections.push(edge('primary', 3, '$output', 7), edge('secondary', 3, '$output', 8));
  decision.outputs.push({ port: 7, name: 'primarySelected' }, { port: 8, name: 'secondarySelected' }); decision.connections.push(edge('choose', 7, '$output', 7), edge('choose', 8, '$output', 8));
  connections.push(edge('decide', 7, 'primarySelected', 0), edge('decide', 8, 'secondarySelected', 0));
  return { schemaVersion: 3, model: { id: 'decision-feedback-schaefer', definitions: [plant, prospect, synchronize, conditional, decision], components, connections,
    observations: ['plant/N', 'plant/C', 'plant/effort', 'plant/modelHalieutique', 'plant/observeN', 'plant/observeC', 'synchronize/memoryN', 'synchronize/memoryC', 'decide/deltaC', 'applied', 'identity', 'score', 'status', 'primarySelected', 'secondarySelected', 'internalE'].map(component => ({ component, samplingInterval: .1 })) }, simulation: { start: 0, end: 5 } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write'))
  writeFileSync(new URL('../../examples/decision-feedback-schaefer-v3.json', import.meta.url), JSON.stringify(schaeferFeedback(), null, 2) + '\n');
