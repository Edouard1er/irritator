// Composition of existing DEVS atoms only. JavaScript builds documents; it never
// evaluates an observation, chooses a prospective, simulates, or chooses an action.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { dynamicMinimal } from './decision-8h-fixture.mjs';
import { safetySchaefer, execution } from './decision-8j-fixture.mjs';
const ports = names => names.map((name, port) => ({ name: name.replace(/[^A-Za-z0-9_-]+/g, '_'), port }));
const coupled = (id, definition) => ({ id, type: 'coupled', parameters: {}, definition });
const def = (m, id) => m.model.definitions.find(d => d.id === id);

// Two independently editable plan payloads, activated by the selected branch.
// Share their payload atoms instead of duplicating a whole observation planner.
function branchPlanner(d) {
  const n = d.outputs.length;
  d.outputs.push(...d.outputs.map(p => ({ name: 'M2_' + p.name, port: p.port + n })));
  d.components = d.components.filter(c => !['less', 'otherwise', 'singleton', 'low', 'high'].includes(c.id));
  d.connections = d.connections.filter(e => !['less', 'otherwise', 'singleton'].includes(e.from.component)
    && !['less', 'otherwise', 'singleton', 'low', 'high'].includes(e.to.component)
    && !(e.from.component === '$input' && e.from.port === 0));
  for (const e of d.connections) {
    if (['low', 'high'].includes(e.from.component)) e.from = { component: '$input', port: e.from.component === 'low' ? 0 : 1 };
    else if (e.from.component === '$input') e.from.port = 2;
    if (e.to.component === '$output' && e.from.component.startsWith('high')) e.to.port += n;
  }
  d.inputs = ports(['M1 state', 'M2 state', 'reset']);
}

function prunePorts(d) {
  d.inputs = d.inputs.filter(p => d.connections.some(e => e.from.component === '$input' && e.from.port === p.port));
  d.outputs = d.outputs.filter(p => d.connections.some(e => e.to.component === '$output' && e.to.port === p.port));
}

// A singleton reduction provides native duplicate/replay protection, including
// after closure, before either conditional branch can receive an observation.
export function selectionDefinition(threshold) {
  const d = { id: 'SelectProspective', name: 'Sélection exclusive par campagne',
    inputs: ports(['state [explicit contract]', 'context', 'reset']),
    outputs: ports(['M1 state', 'M1 context', 'M2 state', 'M2 context', 'modelRef']),
    components: [atom('once', 'group_aggregate', { operation: 0, required: 1, endCount: 0 }),
      atom('key', 'event_operator', { left: 0, required: 0, automatic: 0 }),
      atom('count', 'event_operator', { left: 1, required: 0, automatic: 0 }),
      atom('less', 'event_operator', { operation: 8, right: threshold }),
      atom('otherwise', 'event_operator', { operation: 15 }),
      atom('one', 'event_operator', { left: 1, required: 0, automatic: 0 })],
    connections: [edge('$input', 0, 'once', 2), edge('$input', 0, 'key', 2), edge('key', 0, 'once', 0),
      edge('$input', 0, 'count', 2), edge('count', 0, 'once', 5), edge('once', 0, 'less', 0),
      edge('less', 0, 'otherwise', 0), edge('once', 0, 'one', 2)] };
  for (let i = 0; i < 2; ++i) {
    for (let field = 0; field < 2; ++field) {
      const id = `route${i + 1}${field}`;
      d.components.push(atom(id, 'candidate_filter', { required: 5 }));
      d.connections.push(edge(field ? '$input' : 'once', field ? 1 : 0, id, 0),
        edge(i ? 'otherwise' : 'less', 0, id, 2), edge('one', 0, id, 3), edge(id, 0, '$output', 2 * i + field));
    }
    d.components.push(atom('identity' + i, 'event_operator', { left: i + 1, required: 0, automatic: 0 }));
    d.connections.push(edge(`route${i + 1}0`, 0, 'identity' + i, 2), edge('identity' + i, 0, '$output', 4));
  }
  for (const c of d.components) d.connections.push(edge('$input', 2, c.id,
    c.type === 'group_aggregate' ? 7 : 4));
  return d;
}

// Parallel wrappers are in the *parent* coupled environment, never inside a
// prospective child. Dynamic plans allocate zero child simulations at initialize.
function environment(experiment, secondDefinition, delay) {
  const inputCount = experiment.factors.length + 3;
  const outputCount = 2 * (experiment.factors.length + experiment.selections.length) + 8;
  const ready = 2 * (experiment.factors.length + experiment.selections.length) + 2;
  const d = { id: 'ProspectiveLibrary', name: 'A** — Bibliothèque prospective déclarée',
    inputs: ports(Array.from({ length: 2 * inputCount }, (_, i) => `M${Math.floor(i / inputCount) + 1} input ${i % inputCount}`)),
    outputs: ports(Array.from({ length: outputCount }, (_, i) => `Explicit common output ${i}`)), components: [], connections: [] };
  for (let i = 0; i < 2; ++i) {
    const e = structuredClone(experiment); if (i) e.definition = secondDefinition;
    e.execution = { ...execution, resultMode: 'collect' };
    d.components.push({ id: 'M' + (i + 1), type: 'simulation_wrapper', parameters: {}, experiment: e },
      atom('execute' + i, 'event_operator', { left: delay, required: 0, automatic: 0 }),
      atom('runTag' + i, 'event_tag', { preserveCampaign: 1 }));
    for (let p = 0; p < inputCount; ++p) d.connections.push(edge('$input', i * inputCount + p, 'M' + (i + 1), p));
    d.connections.push(edge('M' + (i + 1), ready, 'execute' + i, 2), edge('execute' + i, 0, 'runTag' + i, 0), edge('runTag' + i, 0, 'M' + (i + 1), 1));
    for (let p = 0; p < outputCount; ++p) d.connections.push(edge('M' + (i + 1), p, '$output', p));
  }
  return d;
}

export function selectMinimal({ threshold = 0, lambda = .5, delay = 0, controlled = false } = {}) {
  const m = dynamicMinimal(); m.model.id = 'decision-select-prospect-model';
  const w = m.model.components.find(c => c.id === 'forecast');
  w.experiment.execution = { ...execution, resultMode: 'collect' };
  // X0/u/H/X(H) have the same explicitly declared dimensionless state and time
  // scale in these two teaching models. Their atom counts and equations differ.
  w.experiment.factors[0].name = 'X0 [state-X; unit=1]';
  w.experiment.factors[1].name = 'u [state-X per time]';
  w.experiment.selections[0].name = 'X(H) [state-X; unit=1]';
  const second = structuredClone(def(m, 'LinearProspect')); second.id = 'DampedProspect'; second.name = 'M2 — dX/dt = u - lambda X';
  second.components.push(atom('lambda', 'constant', { value: lambda }), atom('loss', 'qss3_multiplier'), atom('rate', 'qss3_wsum_2', { 'coeff-0': 1, 'coeff-1': -1 }));
  second.connections = [edge('X', 0, 'loss', 0), edge('lambda', 0, 'loss', 1), edge('u', 0, 'rate', 0), edge('loss', 0, 'rate', 1), edge('rate', 0, 'X', 0)];
  const env = environment(w.experiment, second.id, delay);
  const b = def(m, 'LinearDecision');
  b.components = b.components.filter(c => !['execute', 'executeTag'].includes(c.id));
  b.components.push(coupled('selector', 'SelectProspective'),
    atom('targetDistance', 'event_operator', { operation: 2, right: 2 }), atom('distance', 'event_operator', { operation: 16 }), atom('score', 'event_operator', { operation: 3, right: -1 }));
  b.outputs.push(...ports(['M2 initial', 'M2 domain', 'M2 plan', 'modelRef']).map(p => ({ ...p, port: p.port + 6 })));
  b.connections = b.connections.filter(e => !['execute', 'executeTag'].includes(e.from.component) && !['execute', 'executeTag'].includes(e.to.component)
    && !(e.from.component === '$input' && e.from.port === 1) && !(e.from.component === '$input' && e.to.component === 'choose' && e.to.port === 0));
  b.connections.push(edge('$input', 1, 'selector', 0), edge('selector', 0, 'initial', 0), edge('selector', 0, 'planner', 0),
    edge('selector', 2, '$output', 6), edge('selector', 2, 'planner', 1), edge('planner', 2, '$output', 7), edge('planner', 3, '$output', 8), edge('selector', 4, '$output', 9),
    edge('$input', 3, 'targetDistance', 0), edge('targetDistance', 0, 'distance', 0), edge('distance', 0, 'score', 0), edge('score', 0, 'choose', 0));
  // End travels through the same metric chain; missing criteria cannot become 0.
  b.connections = b.connections.filter(e => !(e.from.component === '$input' && e.from.port === 5 && e.to.component === 'choose'));
  b.connections.push(edge('$input', 5, 'targetDistance', 3), edge('targetDistance', 2, 'distance', 3), edge('distance', 2, 'score', 3), edge('score', 2, 'choose', 2));
  branchPlanner(def(m, 'BuildPlan')); prunePorts(b);
  m.model.components = m.model.components.filter(c => c !== w); m.model.components.push(coupled('forecast', env.id), atom('selectedModel', 'value_memory', { emitOnWrite: 1 }));
  m.model.connections = m.model.connections.filter(e => !(e.to.component === 'forecast' && e.to.port === 1)
    && !(e.from.component === 'forecast' && e.to.component === 'observer' && e.to.port === 2));
  m.model.connections.push(edge('observer', 6, 'forecast', 7), edge('observer', 7, 'forecast', 8), edge('observer', 8, 'forecast', 9), edge('observer', 9, 'selectedModel', 0));
  m.model.definitions.push(second, env, selectionDefinition(threshold));
  m.model.observations = m.model.observations.filter(o => o.component !== 'observer/planner/less');
  m.model.observations.push(...['selectedModel', 'observer/selector/less', 'observer/targetDistance'].map(component => ({ component, samplingInterval: .1 })));
  if (controlled) {
    // Separate controlled fixture only: the delivered primary feedback graph
    // always uses genuine state_observer readings from the dynamic Plant.
    m.model.connections = m.model.connections.filter(e => !(e.from.component === 'plant' && e.to.component === 'observer' && e.to.port === 1));
    for (const [i, value] of [-1, 1].entries()) {
      m.model.components.push(atom('known' + i, 'constant', { value, offset: i ? 3 : 1 }), atom('knownTag' + i, 'event_tag', { campaign: i + 1 }));
      m.model.connections.push(edge('known' + i, 0, 'knownTag' + i, 0), edge('knownTag' + i, 0, 'observer', 1));
    }
  }
  return m;
}

export function selectSchaefer({ threshold = 140, mortality = .08, delay = 0 } = {}) {
  const m = safetySchaefer(); m.model.id = 'tstar-schaefer-select-prospect';
  const w = m.model.components.find(c => c.id === 'forecast');
  w.experiment.factors.forEach((f, i) => f.name = ['N0 [biomass]', 'C0 [capture]', 'E [effort]', 'q [per effort per time]'][i]);
  w.experiment.selections.forEach((s, i) => s.name = ['min N [biomass]', 'C(H) [capture]'][i]);
  const second = structuredClone(def(m, 'SchaeferProspect')); second.id = 'SchaeferMortality'; second.name = 'M2 — Schaefer + mortalité (test architectural)';
  const derivative = second.connections.find(e => e.to.component === 'N' && e.to.port === 0);
  second.connections = second.connections.filter(e => e !== derivative);
  second.components.push(atom('mortality', 'constant', { value: mortality }), atom('loss', 'qss3_multiplier'), atom('rate', 'qss3_wsum_2', { 'coeff-0': 1, 'coeff-1': -1 }));
  second.connections.push(edge('N', 0, 'loss', 0), edge('mortality', 0, 'loss', 1), edge(derivative.from.component, derivative.from.port, 'rate', 0), edge('loss', 0, 'rate', 1), edge('rate', 0, 'N', 0));
  const env = environment(w.experiment, second.id, delay), b = def(m, 'ObserverDecision');
  b.components = b.components.filter(c => !['execute', 'executeTag'].includes(c.id));
  b.components.push(coupled('selector', 'SelectProspective'));
  b.outputs.push(...ports(['M2 initialN', 'M2 initialC', 'M2 domain', 'M2 plan', 'M2 context', 'modelRef']).map(p => ({ ...p, port: p.port + 17 })));
  b.connections = b.connections.filter(e => !['execute', 'executeTag'].includes(e.from.component) && !['execute', 'executeTag'].includes(e.to.component)
    && !(e.from.component === 'synchronize' && ((e.to.component === '$output' && [1, 2].includes(e.to.port)) || e.to.component === 'planner')));
  b.connections.push(edge('synchronize', 0, 'selector', 0), edge('synchronize', 1, 'selector', 1), edge('$input', 8, 'selector', 2),
    edge('selector', 0, '$output', 1), edge('selector', 1, '$output', 2), edge('selector', 0, 'planner', 0),
    edge('selector', 2, '$output', 17), edge('selector', 3, '$output', 18), edge('selector', 2, 'planner', 1),
    ...[0, 1, 2].map(p => edge('planner', p + 3, '$output', 19 + p)), edge('selector', 4, '$output', 22));
  branchPlanner(def(m, 'BuildPlan'));
  b.connections.find(e => e.from.component === '$input' && e.to.component === 'planner' && e.to.port === 1).to.port = 2;
  prunePorts(b);
  m.model.components = m.model.components.filter(c => c !== w); m.model.components.push(coupled('forecast', env.id), atom('selectedModel', 'value_memory', { emitOnWrite: 1 }));
  m.model.connections = m.model.connections.filter(e => !(e.to.component === 'forecast' && e.to.port === 1) && !(e.from.component === 'forecast' && e.from.port === 14 && e.to.component === 'observer'));
  m.model.connections.push(...[[17, 9], [18, 10], [19, 11], [20, 13], [21, 12]].map(([p, q]) => edge('observer', p, 'forecast', q)), edge('observer', 22, 'selectedModel', 0));
  m.model.definitions.push(second, env, selectionDefinition(threshold));
  m.model.observations.push(...['selectedModel', 'observer/selector/less'].map(component => ({ component, samplingInterval: .1 })));
  return m;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--write'))
  for (const [file, graph] of [['decision-select-prospect-model-v3.json', selectMinimal()], ['tstar-schaefer-select-prospect-v3.json', selectSchaefer()]])
    writeFileSync(new URL('../../examples/' + file, import.meta.url), JSON.stringify(graph, null, 2) + '\n');
