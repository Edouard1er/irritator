// Document composition only: all observations, plans, metrics and choices run in DEVS.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { dynamicSchaefer, planningDefinition } from './decision-8h-fixture.mjs';
import { groupedSchaefer, groupedDefinition } from './decision-8g-fixture.mjs';
const ports = names => names.map((name, port) => ({ name, port }));
const coupled = (id, definition) => ({ id, type: 'coupled', parameters: {}, definition });

// Extract the existing 8G subgraphs into reusable coupled definitions. Their
// native atoms and connections retain their original semantics and parameters.
function decisionDefinitions(options) {
  const original = groupedDefinition(options);
  const receiveIds = ['chReady', 'joinCH', 'joinN'];
  const groupIds = ['minCH', 'maxCH', 'minN', 'count'];
  const evaluateIds = ['scoreReady', 'joinGroups', 'admissible', 'choose'];
  const receive = { id: 'ReceiveResults', name: 'Réception, DeltaC et validité commune',
    inputs: ports(['Nmin', 'CH', 'C0', 'valid', 'end', 'reset']), outputs: ports(['DeltaC', 'valid']),
    components: [atom('deltaC', 'event_operator', { operation: 2, required: 3 }), ...original.components.filter(c => receiveIds.includes(c.id))], connections: [] };
  receive.connections.push(edge('$input', 1, 'deltaC', 0), edge('$input', 2, 'deltaC', 1), edge('$input', 4, 'deltaC', 3), edge('$input', 5, 'deltaC', 4), edge('deltaC', 0, '$output', 0), edge('joinN', 0, '$output', 1));
  for (const e of original.connections.filter(e => receiveIds.includes(e.to.component))) {
    const next = structuredClone(e);
    if (next.from.component === '$input') {
      if (next.from.port === 1) next.from = { component: 'deltaC', port: 0 };
      else if (next.to.component === 'chReady' && next.to.port === 3) next.from = { component: 'deltaC', port: 2 };
      else next.from.port = ({ 0: 0, 3: 3, 4: 4, 5: 5 })[next.from.port];
    }
    receive.connections.push(next);
  }
  const groups = { id: 'AggregateActions', name: 'Indicateurs par valeur d’action',
    inputs: ports(['Nmin', 'DeltaC', 'E', 'valid', 'end', 'reset', 'weight', 'seal']),
    outputs: ports(['Crob', 'Cmax', 'Nrob', 'count', 'action', 'end', 'status', 'validCount', 'totalCount', 'member', 'campaignStatus']),
    components: original.components.filter(c => groupIds.includes(c.id)), connections: [] };
  groups.connections = original.connections.filter(e => groupIds.includes(e.to.component)).map(e => {
    const next = structuredClone(e);
    if (next.from.component === 'joinN') next.from = { component: '$input', port: 3 };
    return next;
  });
  groupIds.forEach((id, p) => groups.connections.push(edge(id, 0, '$output', p)));
  for (const [out, p] of [[4, 1], [5, 2], [6, 3], [7, 4], [8, 5], [9, 6], [10, 8]]) groups.connections.push(edge('minCH', p, '$output', out));
  const evaluate = { id: 'EvaluateGroups', name: 'Contrainte configurable et sélection avec repli',
    inputs: ports(['Crob', 'Nrob', 'action', 'end', 'reset']), outputs: structuredClone(original.outputs),
    components: original.components.filter(c => evaluateIds.includes(c.id)), connections: [] };
  for (const e of original.connections.filter(e => evaluateIds.includes(e.to.component) || e.to.component === '$output')) {
    const next = structuredClone(e);
    if (next.from.component === 'minCH') next.from = { component: '$input', port: ({ 0: 0, 1: 2, 2: 3 })[next.from.port] };
    else if (next.from.component === 'minN') next.from = { component: '$input', port: 1 };
    else if (next.from.component === '$input') next.from.port = 4;
    evaluate.connections.push(next);
  }
  const d = { id: 'GroupedDecision', name: 'Résultats, groupes d’action et décision génériques',
    inputs: [...original.inputs, { name: 'C0', port: 8 }], outputs: original.outputs,
    components: [coupled('receive', receive.id), coupled('groups', groups.id), coupled('evaluate', evaluate.id)],
    connections: [
      ...[[0, 0], [1, 1], [8, 2], [3, 3], [4, 4], [5, 5]].map(([a, b]) => edge('$input', a, 'receive', b)),
      edge('$input', 0, 'groups', 0), edge('receive', 0, 'groups', 1), edge('receive', 1, 'groups', 3),
      ...[2, 4, 5, 6, 7].map(p => edge('$input', p, 'groups', p)),
      ...[[0, 0], [2, 1], [4, 2], [5, 3]].map(([a, b]) => edge('groups', a, 'evaluate', b)), edge('$input', 5, 'evaluate', 4),
      ...original.outputs.map(p => edge('evaluate', p.port, '$output', p.port))] };
  return [receive, groups, evaluate, d];
}

export function dynamicUncertainty({ secondDomain = [80, 150], secondQ = [.0008, .001], constrained = true, threshold = 140, delay = 0 } = {}) {
  const m = dynamicSchaefer({ secondDomain, delay });
  m.model.id = 'tstar-schaefer-dynamic-uncertainty';
  const w = m.model.components.find(c => c.id === 'forecast');
  w.experiment.factors.find(f => f.id === 'qHypothesis').values = [.0008, .001];
  const planner = planningDefinition({ threshold: 140, factorIndex: 2, low: [80, 150, 260], high: secondDomain, lowH: 20, highH: 10, context: [{ index: 3, values: [.0008, .001] }] });
  planner.components.find(c => c.id === 'highContextCount0').parameters.left = secondQ.length;
  for (let i = 0; i < 2; ++i) {
    const id = 'highContext0Value' + i;
    if (i < secondQ.length) planner.components.find(c => c.id === id).parameters.left = secondQ[i];
    else {
      planner.components = planner.components.filter(c => ![id, id + 'Tag'].includes(c.id));
      planner.connections = planner.connections.filter(e => ![id, id + 'Tag'].includes(e.from.component) && ![id, id + 'Tag'].includes(e.to.component));
    }
  }
  m.model.definitions = m.model.definitions.filter(d => !['BuildPlan', 'GroupedDecision', 'ConditionalDecision'].includes(d.id));
  m.model.definitions.push(planner, ...decisionDefinitions({ threshold, constrained }), groupedSchaefer({ constrained }).model.definitions.find(d => d.id === 'ConditionalDecision'));
  const b = m.model.definitions.find(d => d.id === 'ObserverDecision');
  b.components = b.components.filter(c => c.id !== 'baselineC');
  b.connections = b.connections.filter(e => e.to.component !== 'baselineC');
  b.connections.push(edge('$input', 5, 'decide', 8));
  m.model.observations = m.model.observations.map(o => {
    if (/observer\/decide\/(minCH|maxCH|minN|count)$/.test(o.component)) return { ...o, component: o.component.replace('/decide/', '/decide/groups/') };
    return o;
  });
  return m;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
  for (const [file, graph] of [
    ['tstar-schaefer-dynamic-uncertainty-v3.json', dynamicUncertainty()],
    ['tstar-schaefer-dynamic-uncertainty-single-v3.json', dynamicUncertainty({ secondDomain: [80] })],
    ['tstar-schaefer-dynamic-uncertainty-context-v3.json', dynamicUncertainty({ secondQ: [.0008] })],
  ]) writeFileSync(new URL('../../examples/' + file, import.meta.url), JSON.stringify(graph, null, 2) + '\n');
}
