// Composition only: all dynamics, joins and decisions execute natively.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { schaeferFeedback } from './decision-8e-fixture.mjs';
import { atom, edge } from './decision-fixtures.mjs';
const ports = names => names.map((name, port) => ({ port, name }));
const coupled = (id, definition) => ({ id, type: 'coupled', parameters: {}, definition });

export function tstarSchaefer(options = {}) {
  const m = schaeferFeedback(options);
  m.model.id = 'tstar-schaefer-three-coupled';
  const decision = m.model.definitions.find(d => d.id === 'EvaluateCandidates');
  const b = {
    id: 'ObserverDecision', name: 'B* — Observation et décision génériques',
    inputs: ports(['trigger', 'N', 'C', 'Nmin', 'CH', 'C0', 'E', 'end', 'reset']),
    outputs: ports(['read', 'initialN', 'initialC', 'init', 'run', ...decision.outputs.map(p => p.name)]),
    components: [atom('request', 'event_operator'), coupled('synchronize', 'SynchronizePair'), coupled('decide', 'EvaluateCandidates')],
    connections: [edge('$input', 0, 'request', 0), edge('request', 0, '$output', 0),
      edge('request', 0, 'synchronize', 2), edge('$input', 1, 'synchronize', 0), edge('$input', 2, 'synchronize', 1),
      ...[0, 1, 2, 3].map(p => edge('synchronize', p, '$output', p + 1)),
      ...[0, 1, 2, 3, 4].map(p => edge('$input', p + 3, 'decide', p)),
      ...decision.outputs.map(({ port }) => edge('decide', port, '$output', port + 5)), edge('$input', 8, 'request', 4)]
  };
  // Reset is a generic explicit port throughout the decision subgraph.
  const sync = m.model.definitions.find(d => d.id === 'SynchronizePair');
  sync.inputs.push({ port: 3, name: 'reset' });
  sync.connections.push(...sync.components.map(c => edge('$input', 3, c.id, c.type === 'value_memory' ? 2 : 4)));
  const conditional = m.model.definitions.find(d => d.id === 'ConditionalDecision');
  conditional.inputs.push({ port: 5, name: 'reset' });
  conditional.connections.push(...conditional.components.map(c => edge('$input', 5, c.id, c.type === 'candidate_filter' ? 4 : c.type === 'selection_priority' ? 8 : 3)));
  decision.inputs.push({ port: 5, name: 'reset' });
  decision.connections.push(edge('$input', 5, 'deltaC', 4), edge('$input', 5, 'admissible', 4), edge('$input', 5, 'choose', 5));
  b.connections.push(edge('$input', 8, 'synchronize', 3), edge('$input', 8, 'decide', 5));
  m.model.definitions.push(b);
  m.model.components = m.model.components.filter(c => !['synchronize', 'decide'].includes(c.id));
  m.model.components.push(coupled('observer', b.id));
  m.model.connections = m.model.connections.filter(e => !['synchronize', 'decide'].includes(e.from.component) && !['synchronize', 'decide'].includes(e.to.component) && !(e.to.component === 'plant' && e.to.port === 0));
  const times = options.times ?? [1, 3];
  m.model.connections.push(...times.map((_, i) => edge('cycle' + (i + 1), 0, 'observer', 0)),
    edge('observer', 0, 'plant', 0), edge('plant', 0, 'observer', 1), edge('plant', 1, 'observer', 2),
    ...[[1, 2], [2, 3], [3, 0], [4, 1]].map(([a, p]) => edge('observer', a, 'forecast', p)),
    ...[[9, 3], [10, 4], [7, 5], [8, 6], [11, 7]].map(([a, p]) => edge('forecast', a, 'observer', p)),
    edge('observer', 5, 'plant', 1), edge('observer', 5, 'applied', 0),
    ...['identity', 'score', 'status'].map((id, i) => edge('observer', i + 6, id, 0)),
    edge('observer', 12, 'primarySelected', 0), edge('observer', 13, 'secondarySelected', 0));
  for (const o of m.model.observations) if (o.component.startsWith('synchronize/') || o.component.startsWith('decide/')) o.component = 'observer/' + o.component;
  m.model.observations.push({ component: 'observer/request', samplingInterval: .1 });
  return m;
}

// Native generator uses sigma += ta, so its unaided dates are 1,3,6,... .
// Generic feedback corrects the next delay by 0 on tick 1, then -1 on later
// ticks: next delays remain 2. No generator or scheduler algorithm is changed.
export function periodicTstar() {
  const m = tstarSchaefer({ times: [] });
  const b = m.model.definitions.find(d => d.id === 'ObserverDecision');
  b.components.push(atom('clock', 'generator', { period: 1, value: 1 }),
    atom('cycle', 'event_operator', { operation: 1, left: 0, right: 1, required: 0, automatic: 0 }),
    atom('tag', 'event_tag'), atom('afterFirst', 'event_operator', { operation: 2, right: 1 }),
    atom('capCorrection', 'event_operator', { operation: 5, right: 1 }),
    atom('delayCorrection', 'event_operator', { operation: 3, right: -1 }));
  b.connections.push(edge('clock', 0, 'cycle', 2),
    edge('cycle', 0, 'cycleMemory', 0));
  // No self connection: memory feeds the accumulator's a input in a later bag.
  b.components.push(atom('cycleMemory', 'value_memory', { emitOnWrite: 1 }));
  b.connections.push(edge('cycleMemory', 0, 'cycle', 0), edge('cycle', 0, 'tag', 2),
    edge('cycle', 0, 'tag', 0), edge('tag', 0, 'request', 0),
    edge('cycle', 0, 'afterFirst', 0), edge('afterFirst', 0, 'capCorrection', 0),
    edge('capCorrection', 0, 'delayCorrection', 0), edge('delayCorrection', 0, 'clock', 2),
    edge('$input', 8, 'cycle', 4), edge('$input', 8, 'cycleMemory', 2));
  return m;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write'))
  writeFileSync(new URL('../../examples/tstar-schaefer-three-coupled-v3.json', import.meta.url), JSON.stringify(tstarSchaefer(), null, 2) + '\n');
