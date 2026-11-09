// Graph construction only. Observations, planning, execution and decisions run in DEVS.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { uncertaintyTstar } from './decision-8g-fixture.mjs';
const ports = ns => ns.map((name, port) => ({ name, port }));
const coupled = (id, definition) => ({ id, type: 'coupled', parameters: {}, definition });

// All payloads are editable ordinary event_operator parameters. Retagging preserves
// the observation's campaign; no campaign or scientific choice is made by JS.
export function planningDefinition({ threshold, factorIndex, low, high, lowH, highH, context = [] }) {
  const d = { id: 'BuildPlan', name: 'Construction générique de Pk', inputs: ports(['observation', 'reset']), outputs: ports(['domain', 'plan', ...context.map((_, i) => 'context' + i)]),
    components: [atom('less', 'event_operator', { operation: 8, right: threshold }), atom('otherwise', 'event_operator', { operation: 15 }), atom('singleton', 'event_operator', { left: 1, required: 0, automatic: 0 }),
      atom('low', 'candidate_filter', { required: 5 }), atom('high', 'candidate_filter', { required: 5 })],
    connections: [edge('$input', 0, 'less', 0), edge('less', 0, 'otherwise', 0),
      edge('$input', 0, 'singleton', 2), ...['low', 'high'].flatMap(id => [edge('$input', 0, id, 0), edge('singleton', 0, id, 3)]), edge('less', 0, 'low', 2), edge('otherwise', 0, 'high', 2)] };
  function payload(branch, name, value, identity, output) {
    const id = branch + name;
    d.components.push(atom(id, 'event_operator', { left: value, required: 0, automatic: 0 }), atom(id + 'Tag', 'event_tag', { identity, preserveCampaign: 1 }));
    d.connections.push(edge(branch, 0, id, 2), edge(id, 0, id + 'Tag', 0), edge(id + 'Tag', 0, '$output', output));
  }
  for (const [branch, values, H, planId] of [['low', low, lowH, 1], ['high', high, highH, 2]]) {
    for (const [name, value, field] of [['Identity', planId, 0], ['Version', 1, 1], ['Horizon', H, 2], ['Seal', 0, 3], ['Count', values.length, 5 + factorIndex]]) payload(branch, name, value, field, 1);
    values.forEach((v, i) => payload(branch, 'Value' + i, v, i, 0));
    context.forEach((f, j) => {
      payload(branch, 'ContextCount' + j, f.values.length, 5 + f.index, 1);
      f.values.forEach((v, i) => payload(branch, 'Context' + j + 'Value' + i, v, i, j + 2));
    });
  }
  d.connections.push(...d.components.filter(c => c.type !== 'event_tag').map(c => edge('$input', 1, c.id, 4)));
  return d;
}
function readyRun(scope, input, output) {
  scope.components.push(atom('execute', 'event_operator', { left: 0, required: 0, automatic: 0 }), atom('executeTag', 'event_tag', { preserveCampaign: 1 }));
  scope.connections.push(edge('$input', input, 'execute', 2), edge('execute', 0, 'executeTag', 0), edge('executeTag', 0, '$output', output));
}
export function dynamicSchaefer({ secondDomain = [80, 150], planningThreshold = 140, delay = 0 } = {}) {
  // Retain the 8G grouped decision, but a single q hypothesis gives exactly 3/2
  // children; q is still an explicitly transmitted contextual factor.
  const m = uncertaintyTstar(); m.model.id = 'tstar-schaefer-dynamic-plan';
  const w = m.model.components.find(c => c.id === 'forecast');
  w.experiment.dynamicPlan = true;
  w.experiment.factors.find(f => f.id === 'qHypothesis').values = [.001];
  const b = m.model.definitions.find(d => d.id === 'ObserverDecision');
  b.inputs.push({ name: 'planReady', port: 12 });
  b.outputs.push({ name: 'domain', port: 14 }, { name: 'plan', port: 15 }, { name: 'context', port: 16 });
  b.components.push(coupled('planner', 'BuildPlan'));
  b.connections = b.connections.filter(e => !(e.from.component === 'synchronize' && e.to.component === '$output' && e.to.port === 4));
  b.connections.push(edge('synchronize', 0, 'planner', 0), edge('$input', 8, 'planner', 1),
    ...[0, 1, 2].map(p => edge('planner', p, '$output', 14 + p)));
  readyRun(b, 12, 4);
  b.components.find(c => c.id === 'execute').parameters.left = delay;
  m.model.definitions.push(planningDefinition({ threshold: planningThreshold, factorIndex: 2, low: [80, 150, 260], high: secondDomain, lowH: 20, highH: 10, context: [{ index: 3, values: [.001] }] }));
  m.model.connections = m.model.connections.filter(e => !(e.from.component === 'observer' && e.to.component === 'forecast' && [0, 1].includes(e.to.port)));
  m.model.connections.push(edge('observer', 4, 'forecast', 1), edge('observer', 14, 'forecast', 4), edge('observer', 15, 'forecast', 6), edge('observer', 16, 'forecast', 5), edge('forecast', 14, 'observer', 12));
  return m;
}
export function dynamicMinimal({ secondDomain = [-1, 0], threshold = 0, delay = 0 } = {}) {
  const plant = { id: 'LinearPlant', name: 'dX/dt = u(t)', inputs: ports(['read', 'action']), outputs: ports(['X']),
    components: [atom('X', 'qss3_integrator', { X: -1, dQ: .001 }), atom('hold', 'zero_order_hold'), atom('observe', 'state_observer')],
    connections: [edge('$input', 1, 'hold', 0), edge('hold', 0, 'X', 0), edge('X', 0, 'observe', 0), edge('$input', 0, 'observe', 1), edge('observe', 0, '$output', 0)] };
  const prospect = { id: 'LinearProspect', name: 'Prospectif linéaire', inputs: [], outputs: [], components: [atom('X', 'qss3_integrator', { X: -999, dQ: .001 }), atom('u', 'constant')], connections: [edge('u', 0, 'X', 0)] };
  const b = { id: 'LinearDecision', name: 'B* générique', inputs: ports(['trigger', 'X', 'ready', 'score', 'u', 'end']), outputs: ports(['read', 'initial', 'domain', 'plan', 'run', 'action']),
    components: [coupled('planner', 'BuildPlan'), atom('read', 'event_operator'), atom('initial', 'event_operator'), atom('choose', 'candidate_select', { emitFallback: 0 })],
    connections: [edge('$input', 0, 'read', 0), edge('read', 0, '$output', 0), edge('$input', 1, 'initial', 0), edge('initial', 0, '$output', 1), edge('$input', 1, 'planner', 0), edge('planner', 0, '$output', 2), edge('planner', 1, '$output', 3),
      edge('$input', 3, 'choose', 0), edge('$input', 4, 'choose', 1), edge('$input', 5, 'choose', 2), edge('choose', 0, '$output', 5)] };
  readyRun(b, 2, 4); b.components.find(c => c.id === 'execute').parameters.left = delay;
  const m = { schemaVersion: 3, model: { id: 'decision-dynamic-plan-minimal', definitions: [plant, prospect, b, planningDefinition({ threshold, factorIndex: 1, low: [-1, 0, 1], high: secondDomain, lowH: 2, highH: 1 })],
    components: [coupled('plant', plant.id), coupled('observer', b.id), atom('initialCommand', 'constant', { value: 0 }),
      ...[1, 3].flatMap((offset, i) => [atom('read' + i, 'constant', { value: 1, offset }), atom('cycle' + i, 'event_tag', { campaign: i + 1 })]),
      { id: 'forecast', type: 'simulation_wrapper', parameters: {}, experiment: { definition: prospect.id, simulation: { start: 0, end: 2 }, run: 'complete', scenarioResults: true, dynamicPlan: true, requiredInputs: ['initial'],
        factors: [{ id: 'initial', type: 'single', value: -999, target: 'X', parameter: 'X' }, { id: 'control', type: 'fixed', values: [-1, 0, 1], target: 'u', parameter: 'value' }], selections: [{ id: 'terminal', target: 'X', criteria: 'max-last' }], objective: { method: 'simple', type: 'maximize', primary: 'terminal' } } }],
    connections: [edge('initialCommand', 0, 'plant', 1), ...[0, 1].flatMap(i => [edge('read' + i, 0, 'cycle' + i, 0), edge('cycle' + i, 0, 'observer', 0)]),
      edge('observer', 0, 'plant', 0), edge('plant', 0, 'observer', 1), edge('observer', 1, 'forecast', 2), edge('observer', 2, 'forecast', 3), edge('observer', 3, 'forecast', 4), edge('observer', 4, 'forecast', 1), edge('observer', 5, 'plant', 1),
      ...[[8, 2], [6, 3], [5, 4], [7, 5]].map(([p, q]) => edge('forecast', p, 'observer', q))],
    observations: ['plant/X', 'plant/hold', 'plant/observe', 'observer/planner/less', 'observer/choose'].map(component => ({ component, samplingInterval: .1 })) }, simulation: { start: 0, end: 5 } };
  return m;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write')) {
  for (const [file, graph] of [['decision-dynamic-plan-minimal-v3.json', dynamicMinimal()], ['tstar-schaefer-dynamic-plan-v3.json', dynamicSchaefer()], ['tstar-schaefer-dynamic-plan-single-v3.json', dynamicSchaefer({ secondDomain: [80] })]])
    writeFileSync(new URL('../../examples/' + file, import.meta.url), JSON.stringify(graph, null, 2) + '\n');
}
