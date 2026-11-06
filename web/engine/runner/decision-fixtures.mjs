import { readFileSync, writeFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync(new URL('../../packages/contracts/catalog.json', import.meta.url), 'utf8'));
export const atom = (id, type, parameters = {}) => ({ id, type, parameters: { ...Object.fromEntries(Object.entries(catalog.components.find(c => c.type === type).parameters).map(([key, b]) => [key, b.default ?? 0])), ...parameters } });
export const edge = (from, fp, to, tp) => ({ from: { component: from, port: fp }, to: { component: to, port: tp } });
const model = (id, components, connections, observed, definitions) => ({ schemaVersion: definitions ? 3 : 1, model: { id, components, connections, observations: observed.map(component => ({ component, samplingInterval: 0.1 })), ...(definitions ? { definitions } : {}) }, simulation: { start: 0, end: 3 } });
export const memory = () => model('memory-demand', [atom('input', 'constant', { value: 42 }), atom('read', 'constant', { offset: 1 }), atom('memory', 'value_memory'), atom('received', 'qss1_sum_2')], [edge('input', 0, 'memory', 0), edge('read', 0, 'memory', 1), edge('memory', 0, 'received', 0)], ['memory', 'received']);
export const comparison = () => model('comparisons', [atom('a', 'constant', { value: 5 }), atom('b', 'constant', { value: 3 }), ...[7, 8, 9].map((operation, i) => atom(['greater', 'less', 'equal'][i], 'event_operator', { operation, required: 3 }))], ['greater', 'less', 'equal'].flatMap(id => [edge('a', 0, id, 0), edge('b', 0, id, 1)]), ['greater', 'less', 'equal']);
export function decisionDefinition(id, direction = 0, threshold) {
  const components = [atom('filter', 'candidate_filter', { required: threshold === undefined ? 3 : 7 }), atom('select', 'candidate_select', { direction, fallback: -7 })];
  const connections = [edge('$input', 0, 'filter', 0), edge('$input', 1, 'filter', 1), edge('$input', 2, 'filter', 3), edge('filter', 0, 'select', 0), edge('filter', 1, 'select', 1), edge('filter', 2, 'select', 2), edge('select', 0, '$output', 0)];
  if (threshold !== undefined) { components.push(atom('condition', 'event_operator', { operation: 10, right: threshold })); connections.push(edge('$input', 0, 'condition', 0), edge('condition', 0, 'filter', 2)); }
  return { id, name: id, inputs: [{ port: 0, name: 'scores' }, { port: 1, name: 'actions' }, { port: 2, name: 'end' }], outputs: [{ port: 0, name: 'action' }], components, connections };
}
export function selection(threshold, reuse = false) {
  const defs = [decisionDefinition('Maximum', 0, threshold), ...(reuse ? [decisionDefinition('Minimum', 1, threshold)] : [])];
  const components = [], connections = [];
  for (const [i, id] of [20, 10, 30].entries()) {
    for (const [prefix, value] of [['score', [5, 9, 9][i]], ['action', [200, 100, 300][i]]]) {
      components.push(atom(`${prefix}${i}`, 'constant', { value }), atom(`${prefix}Tag${i}`, 'event_tag', { identity: id }));
      connections.push(edge(`${prefix}${i}`, 0, `${prefix}Tag${i}`, 0));
    }
  }
  components.push(atom('end', 'constant', { value: 3 }));
  for (const [i, d] of defs.entries()) {
    const id = `decision${i}`;
    components.push({ id, type: 'coupled', parameters: {}, definition: d.id }, atom(`received${i}`, 'qss1_sum_2'));
    for (let k = 0; k < 3; ++k) connections.push(edge(`scoreTag${k}`, 0, id, 0), edge(`actionTag${k}`, 0, id, 1));
    connections.push(edge('end', 0, id, 2), edge(id, 0, `received${i}`, 0));
  }
  return model(reuse ? 'reuse-decisions' : 'select-candidates', components, connections, defs.map((_, i) => `received${i}`), defs);
}
export function prospective() {
  const m = JSON.parse(readFileSync(new URL('../../examples/wrapper-affine-v3.json', import.meta.url), 'utf8'));
  m.model.id = 'prospective-external-decision';
  const wrapper = m.model.components.find(c => c.type === 'simulation_wrapper');
  wrapper.experiment.scenarioResults = true;
  m.model.definitions.push(decisionDefinition('External', 0));
  m.model.components.push(atom('score', 'event_operator', { operation: 3, right: -1 }), { id: 'external', type: 'coupled', parameters: {}, definition: 'External' }, atom('action', 'qss1_sum_2'));
  // F=1, S=2: raw factor port=4, raw terminal=5, raw minimum=6, end=7.
  m.model.connections.push(edge('decision', 5, 'score', 0), edge('decision', 7, 'score', 3), edge('score', 0, 'external', 0), edge('decision', 4, 'external', 1), edge('score', 2, 'external', 2), edge('external', 0, 'action', 0));
  m.model.observations.push({ component: 'action', samplingInterval: 0.1 });
  return m;
}
if (process.argv.includes('--write')) {
  for (const [name, m] of Object.entries({ memory: memory(), comparison: comparison(), selection: selection(), constraint: selection(8), fallback: selection(10), reuse: selection(undefined, true), prospective: prospective() }))
    writeFileSync(new URL(`../../examples/decision-${name}.json`, import.meta.url), JSON.stringify(m, null, 2) + '\n');
}
