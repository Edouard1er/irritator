// Graph construction only. Every reduction and decision executes in C++.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { schaeferExternal } from './decision-8b-fixture.mjs';
import { tstarSchaefer } from './decision-8f-fixture.mjs';
import { fallbackDefinition } from './decision-8c-fixture.mjs';
const ports = ns => ns.map((name, port) => ({ name, port }));
const coupled = (id, definition) => ({ id, type: 'coupled', parameters: {}, definition });

export function groupedDefinition({ threshold = 140, operation = 0, constrained = true } = {}) {
  const names = ['minCH', 'maxCH', 'minN', 'count'];
  const d = { id: 'GroupedDecision', name: 'Actions regroupées — critères configurables',
    inputs: ports(['Nmin', 'CH', 'E', 'valid', 'end', 'reset', 'weight', 'seal']),
    outputs: ports(['action', 'identity', 'score', 'selected', 'taggedAction', 'secondary', 'end', 'primarySelected', 'secondarySelected']),
    components: [atom('minCH', 'group_aggregate', { operation }), atom('maxCH', 'group_aggregate', { operation: 1 }),
      atom('minN', 'group_aggregate'), atom('count', 'group_aggregate', { operation: 4 }),
      atom('chReady', 'event_operator', { operation: 3, right: 0 }),
      atom('joinCH', 'event_operator', { operation: 1, required: 3 }), atom('joinN', 'event_operator', { required: 3 }),
      atom('scoreReady', 'event_operator', { operation: 3, right: 0 }), atom('joinGroups', 'event_operator', { operation: 1, required: 3 }),
      atom('admissible', 'event_operator', { operation: 10, right: threshold }), coupled('choose', 'ConditionalDecision')],
    connections: [
      ...names.flatMap(id => [edge('$input', 2, id, 0), edge('$input', 2, id, 1), edge('$input', id === 'minN' ? 0 : 1, id, 2),
        edge('joinN', 0, id, 3), edge('$input', 4, id, 5), edge('$input', 5, id, 7), edge('$input', 6, id, 4), edge('$input', 7, id, 6)]),
      // Wrapper end counts transmitted numeric results in its first real;
      // invalid status-only rows must not be counted as numeric results.
      edge('$input', 1, 'chReady', 0), edge('$input', 4, 'chReady', 3), edge('$input', 5, 'chReady', 4),
      edge('chReady', 0, 'joinCH', 0), edge('$input', 3, 'joinCH', 1), edge('chReady', 2, 'joinCH', 3), edge('$input', 5, 'joinCH', 4),
      edge('joinCH', 0, 'joinN', 0), edge('$input', 0, 'joinN', 1), edge('joinCH', 2, 'joinN', 3), edge('$input', 5, 'joinN', 4),
      // Gate the secondary metric by actual primary-score identities. A zero
      // readiness token is emitted only for an available primary aggregate;
      // required=3 then returns the real secondary value, never a substitute.
      edge('minCH', 0, 'scoreReady', 0), edge('minCH', 2, 'scoreReady', 3), edge('$input', 5, 'scoreReady', 4),
      edge('scoreReady', 0, 'joinGroups', 0), edge('minN', 0, 'joinGroups', 1), edge('scoreReady', 2, 'joinGroups', 3), edge('$input', 5, 'joinGroups', 4),
      edge('joinGroups', 0, 'admissible', 0), edge('joinGroups', 2, 'admissible', 3), edge('$input', 5, 'admissible', 4),
      edge('minCH', 0, 'choose', 0), edge('joinGroups', 0, 'choose', 1), edge('minCH', 1, 'choose', 2),
      edge('admissible', 0, 'choose', 3), edge('joinGroups', 2, 'choose', 4), edge('$input', 5, 'choose', 5),
      ...ports(['action', 'identity', 'score', 'selected', 'taggedAction', 'secondary', 'end', 'primarySelected', 'secondarySelected']).map(p => edge('choose', p.port, '$output', p.port))] };
  if (!constrained) {
    d.components = d.components.filter(c => c.id !== 'admissible');
    d.connections = d.connections.filter(e => e.from.component !== 'admissible' && e.to.component !== 'admissible');
  }
  return d;
}
function conditional(constrained = true) {
  const d = fallbackDefinition();
  if (!constrained) d.components.find(c => c.id === 'filter').parameters.required = 11;
  d.inputs.push({ name: 'reset', port: 5 });
  d.connections.push(...d.components.map(c => edge('$input', 5, c.id, c.type === 'candidate_filter' ? 4 : c.type === 'selection_priority' ? 8 : 3)));
  d.outputs.push({ name: 'primarySelected', port: 7 }, { name: 'secondarySelected', port: 8 });
  d.connections.push(edge('primary', 3, '$output', 7), edge('secondary', 3, '$output', 8));
  return d;
}
export function groupedSchaefer(options = {}) {
  const m = schaeferExternal(); m.model.id = 'decision-grouped-schaefer';
  m.model.definitions = [m.model.definitions[0], conditional(options.constrained !== false), groupedDefinition(options)];
  m.model.components.find(c => c.id === 'external').definition = 'GroupedDecision';
  m.model.connections = m.model.connections.filter(e => e.to.component !== 'external');
  m.model.connections.push(...[[7, 0], [8, 1], [5, 2], [4, 3], [9, 4]].map(([a, b]) => edge('decision', a, 'external', b)));
  for (const name of ['minCH', 'maxCH', 'minN', 'count']) m.model.observations.push({ component: 'external/' + name, samplingInterval: .1 });
  return m;
}
export function uncertaintyTstar(options = {}) {
  const m = tstarSchaefer(options); m.model.id = 'tstar-schaefer-uncertainty';
  const w = m.model.components.find(c => c.id === 'forecast');
  w.experiment.factors.push({ id: 'qHypothesis', target: 'q', parameter: 'value', type: 'fixed', values: [.0008, .001] });
  const b = m.model.definitions.find(d => d.id === 'ObserverDecision');
  b.inputs = ports(['trigger', 'N', 'C', 'Nmin', 'CH', 'C0', 'E', 'end', 'reset', 'valid', 'weight', 'seal']);
  b.components.find(c => c.id === 'decide').definition = 'GroupedDecision';
  // Keep the 8F C0 interface without retaining six new history rows per cycle.
  b.components.push(atom('baselineC', 'event_operator'));
  b.connections = b.connections.filter(e => e.to.component !== 'decide');
  b.connections.push(...[[3, 0], [4, 1], [6, 2], [9, 3], [7, 4], [8, 5], [10, 6], [11, 7]].map(([a, p]) => edge('$input', a, 'decide', p)));
  b.connections.push(edge('$input', 5, 'baselineC', 0), edge('$input', 7, 'baselineC', 3), edge('$input', 8, 'baselineC', 4));
  m.model.definitions = m.model.definitions.filter(d => !['EvaluateCandidates', 'ConditionalDecision'].includes(d.id));
  m.model.definitions.push(conditional(options.constrained !== false), groupedDefinition(options));
  m.model.connections = m.model.connections.filter(e => !(e.from.component === 'forecast' && e.to.component === 'observer'));
  m.model.connections.push(...[[11, 3], [12, 4], [8, 5], [9, 6], [13, 7], [6, 9]].map(([a, p]) => edge('forecast', a, 'observer', p)));
  // Historical winner E moved from port 4 to port 4 (S + factor index 2).
  m.model.observations = m.model.observations.filter(o => o.component !== 'observer/decide/deltaC');
  for (const name of ['minCH', 'maxCH', 'minN', 'count']) m.model.observations.push({ component: 'observer/decide/' + name, samplingInterval: .1 });
  return m;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
  writeFileSync(new URL('../../examples/decision-grouped-schaefer-v3.json', import.meta.url), JSON.stringify(groupedSchaefer(), null, 2) + '\n');
  writeFileSync(new URL('../../examples/tstar-schaefer-uncertainty-v3.json', import.meta.url), JSON.stringify(uncertaintyTstar(), null, 2) + '\n');
}
