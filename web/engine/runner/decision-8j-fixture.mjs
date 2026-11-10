// Graph construction only; execution, statuses, gates and decisions are native DEVS.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { dynamicUncertainty } from './decision-8i-fixture.mjs';
export const execution = { failurePolicy: 'isolate', maxChildRunCalls: 10000, maxCampaignRunCalls: 100000 };
export function faultMinimal({ budget = false } = {}) {
  const definition = { id: 'Prospect', name: budget ? 'dX/dt = u X' : 'Débordement contrôlé QSS3', inputs: [], outputs: [],
    components: [atom('X', 'qss3_integrator', { X: 7, dQ: .00001 }), atom('u', 'constant'), atom('criterion', budget ? 'qss3_multiplier' : 'qss3_power', budget ? {} : { n: 2000 })],
    connections: budget ? [edge('X', 0, 'criterion', 0), edge('u', 0, 'criterion', 1), edge('criterion', 0, 'X', 0)] : [edge('u', 0, 'X', 0), edge('u', 0, 'criterion', 0)] };
  return { schemaVersion: 3, model: { id: 'decision-fault-tolerant-minimal', definitions: [definition], components: [
    { id: 'forecast', type: 'simulation_wrapper', parameters: {}, experiment: { definition: 'Prospect', simulation: { start: 0, end: 2 }, run: 'complete', scenarioResults: true,
      execution: { ...execution, ...(budget ? { maxChildRunCalls: 10 } : {}) },
      factors: [{ id: 'initial', type: 'single', value: 7, target: 'X', parameter: 'X' }, { id: 'control', type: 'fixed', values: budget ? [0, -1] : [.5, 2], target: 'u', parameter: 'value' }],
      selections: [{ id: 'terminal', target: budget ? 'X' : 'criterion', criteria: 'max-last' }], objective: { method: 'simple', type: 'maximize', primary: 'terminal' } } },
    atom('run1', 'constant', { value: 0, offset: 1 }), atom('run2', 'constant', { value: 0, offset: 3 }), atom('choose', 'candidate_select', { emitFallback: 0 })],
    connections: [edge('run1', 0, 'forecast', 1), edge('run2', 0, 'forecast', 1), edge('forecast', 6, 'choose', 0), edge('forecast', 5, 'choose', 1), edge('forecast', 7, 'choose', 2)],
    observations: [{ component: 'choose', samplingInterval: .1 }] }, simulation: { start: 0, end: 5 } };
}
export function safetySchaefer(options = {}) {
  const m = dynamicUncertainty(options); m.model.id = 'tstar-schaefer-execution-safety';
  const w = m.model.components.find(c => c.id === 'forecast'); w.experiment.execution = { ...execution };
  // Keep partial raw criteria visible at the wrapper, then explicitly admit
  // complete valid scenarios into the existing scientific decision graph.
  for (const [id, port, input] of [['gateN', 11, 3], ['gateC', 12, 4], ['gateC0', 8, 5]]) {
    // The first barrier filters only validity tokens, so it needs no missing
    // scientific field. The second requires BOTH the accepted unit token and
    // the actual metric: a disconnected/missing valid metric cannot become 0.
    m.model.components.push(atom(id, 'candidate_filter', { required: 5 }), atom(id + 'Value', 'event_operator', { operation: 3, required: 3 }));
    m.model.connections = m.model.connections.filter(e => !(e.from.component === 'forecast' && e.to.component === 'observer' && e.to.port === input));
    m.model.connections.push(edge('forecast', 6, id, 0), edge('forecast', 6, id, 2), edge('forecast', 19, id, 3),
      edge(id, 0, id + 'Value', 0), edge('forecast', port, id + 'Value', 1), edge(id, 2, id + 'Value', 3), edge(id + 'Value', 0, 'observer', input));
  }
  const b = m.model.definitions.find(d => d.id === 'ObserverDecision');
  b.inputs.push({ name: 'invalidScenario', port: 13 }); b.connections.push(edge('$input', 13, 'decide', 9));
  const d = m.model.definitions.find(d => d.id === 'GroupedDecision');
  d.inputs.push({ name: 'invalidScenario', port: 9 }); d.connections.push(edge('$input', 9, 'groups', 3));
  m.model.connections.push(edge('gateC', 3, 'observer', 13));
  return m;
}
export function faultSchaefer({ all = false, ...options } = {}) {
  const m = safetySchaefer(options), w = m.model.components.find(c => c.id === 'forecast');
  const p = m.model.definitions.find(d => d.id === 'SchaeferProspect');
  // Diagnostic criterion added to the test prospective only. N/C equations,
  // parameters and the main Plant remain untouched. Cumulative C stays finite.
  p.components.push(atom('faultScale', 'qss3_wsum_2', { 'coeff-0': all ? .02 : .006, 'coeff-1': 600 }), atom('fault', 'qss3_power', { n: 2000 }));
  p.connections.push(edge('E', 0, 'faultScale', 0), edge('q', 0, 'faultScale', 1), edge('faultScale', 0, 'fault', 0));
  w.experiment.selections[0].target = 'fault';
  return m;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
  for (const [file, graph] of [['decision-fault-tolerant-minimal-v3.json', faultMinimal()], ['tstar-schaefer-execution-safety-v3.json', safetySchaefer()]])
    writeFileSync(new URL('../../examples/' + file, import.meta.url), JSON.stringify(graph, null, 2) + '\n');
}
