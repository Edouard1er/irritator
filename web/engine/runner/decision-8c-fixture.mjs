// Graph construction only; all reductions, joins and selections run in C++.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { schaeferExternal } from './decision-8b-fixture.mjs';
const ports = names => names.map((name, port) => ({ port, name }));
export const document = (id, components = [], connections = [], definitions = []) => ({ schemaVersion: 3, model: { id, definitions, components, connections, observations: [] }, simulation: { start: 0, end: 3 } });
export function source(m, target, port, value, identity = 0, campaign = 1, at = 0) {
  const id = 's' + m.model.components.length;
  m.model.components.push(atom(id, 'constant', { value, offset: at }), atom(id + 't', 'event_tag', { identity, campaign }));
  m.model.connections.push(edge(id, 0, id + 't', 0), edge(id + 't', 0, target, port));
}
export function observe(m, from, port, id) {
  m.model.components.push(atom(id, 'qss1_sum_2'));
  m.model.connections.push(edge(from, port, id, 0)); m.model.observations.push({ component: id, samplingInterval: .1 });
}
export function aggregation(values = [10, 20, 40]) {
  const m = document('campaign-aggregations');
  for (const [operation, name] of ['min', 'max', 'sum', 'mean', 'count'].entries()) {
    m.model.components.push(atom(name, 'campaign_aggregate', { operation }));
    values.forEach((v, i) => source(m, name, 0, v, i)); source(m, name, 1, values.length, 0, 1, .05);
    observe(m, name, 0, name + 'Result'); observe(m, name, 2, name + 'End'); observe(m, name, 1, name + 'Invalid');
  }
  return m;
}
export function normalizationDefinition() {
  return { id: 'NormalizeCampaign', name: 'NormalizeCampaign', inputs: ports(['values', 'end']), outputs: ports(['score', 'end']),
    components: [atom('max', 'campaign_aggregate', { operation: 1 }), atom('join', 'campaign_broadcast'), atom('ratio', 'event_operator', { operation: 4, required: 3 })],
    connections: [edge('$input', 0, 'max', 0), edge('$input', 1, 'max', 1), edge('$input', 0, 'join', 0), edge('$input', 1, 'join', 2), edge('max', 0, 'join', 1), edge('max', 2, 'join', 3), edge('join', 0, 'ratio', 0), edge('join', 1, 'ratio', 1), edge('join', 2, 'ratio', 3), edge('ratio', 0, '$output', 0), edge('ratio', 2, '$output', 1)] };
}
export function normalization(values = [10, 20, 40]) {
  const m = document('normalize-campaign', [{ id: 'normalize', type: 'coupled', parameters: {}, definition: 'NormalizeCampaign' }], [], [normalizationDefinition()]);
  values.forEach((v, i) => source(m, 'normalize', 0, v, i)); source(m, 'normalize', 1, values.length, 0, 1, .05);
  // Each identity has its own receiver, requested from the same keyed memory.
  m.model.components.push(atom('scores', 'value_memory'));
  m.model.connections.push(edge('normalize', 0, 'scores', 0));
  values.forEach((_, i) => { source(m, 'scores', 1, 0, i, 1, 1 + i * .3); });
  observe(m, 'scores', 0, 'ratioReceipt'); observe(m, 'normalize', 1, 'end');
  return m;
}
export function fallbackDefinition() {
  return { id: 'ConditionalDecision', name: 'ConditionalDecision', inputs: ports(['primary', 'secondary', 'action', 'condition', 'end']), outputs: ports(['action', 'identity', 'score', 'selected', 'taggedAction', 'secondary', 'end']),
    components: [atom('filter', 'candidate_filter', { required: 15 }), atom('primary', 'candidate_select', { emitFallback: 0, requireSecondary: 1 }), atom('secondary', 'candidate_select', { emitFallback: 0, requireSecondary: 1 }), atom('priority', 'selection_priority')],
    connections: [edge('$input', 0, 'filter', 0), edge('$input', 1, 'filter', 5), edge('$input', 2, 'filter', 1), edge('$input', 3, 'filter', 2), edge('$input', 4, 'filter', 3), edge('filter', 0, 'primary', 0), edge('filter', 1, 'primary', 1), edge('filter', 4, 'primary', 4), edge('filter', 2, 'primary', 2),
      edge('$input', 1, 'secondary', 0), edge('$input', 0, 'secondary', 4), edge('$input', 2, 'secondary', 1), edge('$input', 4, 'secondary', 2),
      ...['primary', 'secondary'].flatMap((id, i) => [[4, 0], [2, 1], [5, 2], [3, 3]].map(([op, ip]) => edge(id, op, 'priority', i * 4 + ip))),
      ...Array.from({ length: 7 }, (_, p) => edge('priority', p, '$output', p))] };
}
export function fallback(conditions = [0, 1, 1], scores = [10, 20, 20], secondary = [9, 2, 4], ids = [0, 1, 2]) {
  const m = document('conditional-real-candidate', [{ id: 'decide', type: 'coupled', parameters: {}, definition: 'ConditionalDecision' }], [], [fallbackDefinition()]);
  ids.forEach((id, i) => [scores[i], secondary[i], (id + 1) * 100, conditions[i]].forEach((v, p) => source(m, 'decide', p, v, id, 1, p === 2 ? .3 : 0)));
  source(m, 'decide', 4, ids.length, 0, 1, .05);
  ['action', 'identity', 'score', 'selected', 'taggedAction', 'secondary', 'end'].forEach((id, p) => observe(m, 'decide', p, id));
  return m;
}
export function schaeferCampaign({ weight = .5, threshold = 140, minimum = 140 } = {}) {
  const m = schaeferExternal();
  m.model.id = 'schaefer-campaign-decision';
  m.model.definitions = [m.model.definitions[0], normalizationDefinition(), fallbackDefinition()];
  const calc = { id: 'CampaignDecision', name: 'CampaignDecision', inputs: ports(['minimum', 'value', 'action', 'end']), outputs: ports(['action', 'identity', 'score', 'selected', 'taggedAction', 'secondary', 'end']),
    components: [{ id: 'relative', type: 'coupled', parameters: {}, definition: 'NormalizeCampaign' },
      atom('shift', 'event_operator', { operation: 2, right: minimum }), atom('scale', 'event_operator', { operation: 4, right: minimum }),
      atom('weightA', 'event_operator', { operation: 3, right: weight }), atom('weightB', 'event_operator', { operation: 3, right: 1 - weight }), atom('sum', 'event_operator', { operation: 1, required: 3 }),
      atom('condition', 'event_operator', { operation: 10, right: threshold }), { id: 'decide', type: 'coupled', parameters: {}, definition: 'ConditionalDecision' }],
    connections: [edge('$input', 1, 'relative', 0), edge('$input', 3, 'relative', 1),
      edge('$input', 0, 'shift', 0), edge('$input', 3, 'shift', 3), edge('shift', 0, 'scale', 0), edge('shift', 2, 'scale', 3),
      edge('relative', 0, 'weightA', 0), edge('relative', 1, 'weightA', 3), edge('scale', 0, 'weightB', 0), edge('scale', 2, 'weightB', 3),
      edge('weightA', 0, 'sum', 0), edge('weightB', 0, 'sum', 1), edge('weightA', 2, 'sum', 3),
      edge('$input', 0, 'condition', 0), edge('$input', 3, 'condition', 3), edge('sum', 0, 'decide', 0), edge('$input', 0, 'decide', 1), edge('$input', 2, 'decide', 2), edge('condition', 0, 'decide', 3), edge('sum', 2, 'decide', 4),
      ...Array.from({ length: 7 }, (_, p) => edge('decide', p, '$output', p))] };
  m.model.definitions.push(calc); m.model.components.find(c => c.id === 'external').definition = calc.id;
  // The existing four ports already carry minimum/value/action/end.
  for (const [id, p] of [['secondaryScore', 5], ['decisionEnd', 6]]) observe(m, 'external', p, id);
  return m;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
  for (const [name, model] of Object.entries({ aggregation: aggregation(), normalization: normalization(), fallback: fallback(), schaefer: schaeferCampaign() }))
    writeFileSync(new URL(`../../examples/decision-8c-${name}-v3.json`, import.meta.url), JSON.stringify(model, null, 2) + '\n');
}
