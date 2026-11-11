// Document construction only. Native DEVS atoms evaluate, retain and select.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { forecastValidation } from './decision-8m-fixture.mjs';
const def = (m, id) => m.model.definitions.find(d => d.id === id);
const ports = names => names.map((name, port) => ({ name: name.replace(/[^A-Za-z0-9_-]+/g, '_'), port }));
const observed = (component, eventPorts = [0]) => ({ component, samplingInterval: .1, eventPorts });

// Each occurrence owns one explicitly declared paired cohort. The original
// streaming rows retain their window keys/campaigns. The normalized key (0,0)
// is only a latest-value register, never the identity of a historical result.
export function adaptiveSelector({ nMin = 1, initial = 2, adaptive = true, refuse = false } = {}) {
  const d = { id: 'SelectProspective', name: 'B* — sélection sur performances vérifiées',
    inputs: ports(['state', 'context', 'reset', 'snapshotCampaign', 'M1 loss', 'M1 count', 'M2 loss', 'M2 count']),
    outputs: ports(['M1 state', 'M1 context', 'M2 state', 'M2 context', 'modelRef']),
    components: [atom('once', 'group_aggregate', { operation: 0, required: 1, endCount: 0 }),
      atom('key', 'event_operator', { left: 0, required: 0, automatic: 0 }),
      atom('count', 'event_operator', { left: 1, required: 0, automatic: 0 }),
      atom('one', 'event_operator', { left: 1, required: 0, automatic: 0 }),
      atom('readHistory', 'event_tag'), atom('chooseModel', 'candidate_select', { direction: 1, fallback: initial, emitFallback: refuse ? 0 : 1 }),
      atom('candidates', 'candidate_filter', { required: 7 }),
      atom('selected', 'event_tag'), atom('modelCount', 'event_operator', { left: 2, required: 0, automatic: 0 })],
    connections: [edge('$input', 0, 'once', 2), edge('$input', 0, 'key', 2), edge('key', 0, 'once', 0),
      edge('$input', 0, 'count', 2), edge('count', 0, 'once', 5), edge('once', 0, 'one', 2),
      edge('$input', 3, 'readHistory', 0), edge('$input', 3, 'selected', 2),
      edge('once', 0, 'modelCount', 2), edge('modelCount', 0, 'candidates', 3),
      edge('candidates', 0, 'chooseModel', 0), edge('candidates', 1, 'chooseModel', 1), edge('candidates', 2, 'chooseModel', 2),
      edge('chooseModel', 0, 'selected', 0), edge('selected', 0, '$output', 4)] };
  for (let model = 1; model <= 2; ++model) {
    const p = 'M' + model;
    for (const [j, field] of ['loss', 'count'].entries()) {
      d.components.push(atom(p + field + 'Key', 'event_tag'), atom(p + field, 'value_memory'),
        atom(p + field + 'Read', 'event_tag', { identity: model }));
      d.connections.push(edge('$input', 4 + 2 * (model - 1) + j, p + field + 'Key', 0),
        edge(p + field + 'Key', 0, p + field, 0), edge('readHistory', 0, p + field, 1),
        edge(p + field, 0, p + field + 'Read', 0), edge('$input', 3, p + field + 'Read', 2));
    }
    d.components.push(atom(p + 'admissible', 'event_operator', { operation: 10, right: adaptive ? nMin : 4097 }),
      atom(p + 'identity', 'event_operator', { left: model, required: 0, automatic: 0, outputIdentity: model }),
      atom(p + 'route', 'event_operator', { operation: 9, right: model }));
    d.connections.push(edge(p + 'lossRead', 0, 'candidates', 0), edge(p + 'countRead', 0, p + 'admissible', 0),
      edge(p + 'admissible', 0, 'candidates', 2), edge('once', 0, p + 'identity', 2), edge(p + 'identity', 0, 'candidates', 1),
      edge('selected', 0, p + 'route', 0));
    for (let field = 0; field < 2; ++field) {
      const id = p + 'route' + field;
      d.components.push(atom(id, 'candidate_filter', { required: 5 }));
      d.connections.push(edge(field ? '$input' : 'once', field ? 1 : 0, id, 0), edge(p + 'route', 0, id, 2),
        edge('one', 0, id, 3), edge(id, 0, '$output', 2 * (model - 1) + field));
    }
  }
  // Paired admission advances both histories together: one count register is
  // sufficient. Both native aggregate counts remain observable independently.
  remove(d, ['M2countKey', 'M2count']);
  d.connections.push(edge('M1count', 0, 'M2countRead', 0));
  d.inputs = d.inputs.filter(p => p.port !== 7);
  for (const c of d.components) if (c.type !== 'event_tag') d.connections.push(edge('$input', 2, c.id,
    c.type === 'value_memory' || c.type === 'campaign_aggregate' ? 2 : c.type === 'candidate_select' ? 3 : c.type === 'group_aggregate' ? 7 : 4));
  return d;
}

function remove(scope, ids) {
  const gone = new Set(ids);
  scope.components = scope.components.filter(c => !gone.has(c.id));
  scope.connections = scope.connections.filter(e => !gone.has(e.from.component) && !gone.has(e.to.component));
  if (scope.observations) scope.observations = scope.observations.filter(o => !gone.has(o.component));
}

export function adaptiveProspect({ schaefer = false, alternative = false, adaptive = true, nMin = 1, initial = 2, refuse = false, lambda = .5, delta } = {}) {
  const m = forecastValidation({ diagnostic: true, schaefer, lambda });
  m.model.id = schaefer ? 'tstar-schaefer-adaptive-prospect' : alternative ? 'decision-adaptive-prospect-alternative-plant' : adaptive ? 'decision-adaptive-prospect-selection' : 'decision-adaptive-prospect-baseline';
  const b = def(m, schaefer ? 'ObserverDecision' : 'LinearDecision');
  const plant = def(m, schaefer ? 'SchaeferPlant' : 'LinearPlant');
  m.model.definitions = m.model.definitions.filter(d => d.id !== 'SelectProspective');
  m.model.definitions.push(adaptiveSelector({ nMin, initial, adaptive, refuse }));
  const base = Math.max(...b.inputs.map(p => p.port)) + 1;
  b.inputs.push(...ports(['M1 loss', 'paired count', 'M2 loss']).map(p => ({ ...p, port: p.port + base })));
  b.connections.push(edge('$input', 0, 'selector', 3), ...[0, 1, 2].map(i => edge('$input', base + i, 'selector', 4 + i)));
  // Trigger payload explicitly carries the NEW selection campaign. Historical
  // records never pass through these tags; only the requested snapshot does.
  m.model.components.filter(c => /^read\d+$/.test(c.id)).forEach((c, i) => { c.parameters.value = i + 1; });
  if (!schaefer) {
    b.components.find(c => c.id === 'targetDistance').parameters.right = 1.25;
    const plan = def(m, 'BuildPlan');
    for (const c of plan.components) {
      if (/Value0$/.test(c.id)) c.parameters.left = 0;
      if (/Value1$/.test(c.id)) c.parameters.left = 1;
      if (/Count$/.test(c.id)) c.parameters.left = 2;
      if (/Horizon$/.test(c.id)) c.parameters.left = 1;
    }
    remove(plan, plan.components.filter(c => /Value2$/.test(c.id)).map(c => c.id));
  } else {
    // Diagnostic [3,4] is used for the following campaign at 5. Keep the full
    // 8M document intact; omit capture-only diagnostics in this adaptive copy.
    m.simulation.end = 7;
    m.model.components.push(atom('read3', 'constant', { value: 3, offset: 5 }), atom('cycle3', 'event_tag', { campaign: 3 }));
    m.model.connections.push(edge('read3', 0, 'cycle3', 0), edge('cycle3', 0, 'observer', 0));
    m.model.connections = m.model.connections.filter(e => e.to.component !== 'verificationWindow');
    m.model.connections.push(edge('cycle2', 0, 'verificationWindow', 0));
    remove(m.model, m.model.components.filter(c => /^M[12]C/.test(c.id) || c.id === 'futureCapture').map(c => c.id));
    m.model.forecastContracts = m.model.forecastContracts.filter(c => !/^M[12]C/.test(c.pair));
    const plan = def(m, 'BuildPlan');
    remove(plan, ['lowContext0Value1', 'highContext0Value1']);
    for (const c of plan.components) {
      if (/ContextCount0$/.test(c.id)) c.parameters.left = 1;
      if (/Context0Value0$/.test(c.id)) c.parameters.left = .001;
    }
  }
  const prefixes = [1, 2].map(i => 'M' + i + (schaefer ? 'N' : 'X'));
  for (const [i, prefix] of prefixes.entries()) {
    remove(m.model, ['SE', 'MSE', 'RMSE'].map(s => prefix + s));
    // Both scores for the same window must exist before either streaming
    // history advances. Unmatched valid errors remain archived at AE/pair.
    const paired = prefix + 'paired';
    m.model.components.push(atom(paired, 'event_operator', { required: 3 }));
    m.model.connections = m.model.connections.filter(e => !(e.to.component === prefix + 'MAE' && e.to.port === 0));
    m.model.connections.push(edge(prefix + 'AE', 0, paired, 0), edge(prefixes[1 - i] + 'AE', 0, paired, 1),
      edge(paired, 0, prefix + 'MAE', 0), edge(prefix + 'MAE', 0, 'observer', base + i * 2));
    if (i === 0) m.model.connections.push(edge(prefix + 'MAE', 2, 'observer', base + 1));
    m.model.observations.push(observed(paired));
  }
  const cohort = (schaefer ? 'biomass' : 'state-X') + '-paired-H1-fixed-laws';
  m.model.forecastContracts.forEach(c => { c.cohort = cohort; });
  if (alternative) {
    const source = def(m, schaefer ? 'SchaeferMortality' : 'DampedProspect');
    const ids = schaefer ? ['mortality', 'loss', 'rate'] : ['lambda', 'loss', 'rate'];
    plant.components.push(...structuredClone(source.components.filter(c => ids.includes(c.id))));
    const state = schaefer ? 'N' : 'X';
    const derivative = plant.connections.find(e => e.to.component === state && e.to.port === 0);
    plant.connections = plant.connections.filter(e => e !== derivative);
    plant.connections.push(edge(state, 0, 'loss', 0), edge(ids[0], 0, 'loss', 1), edge(derivative.from.component, derivative.from.port, 'rate', 0),
      edge('loss', 0, 'rate', 1), edge('rate', 0, state, 0));
  }
  m.model.observations.push(observed('observer/selector/selected'), observed('observer/selector/chooseModel', [1, 2, 3, 4, 6]),
    ...[1, 2].flatMap(i => ['lossRead', 'countRead', 'admissible'].map(s => observed('observer/selector/M' + i + s))),
    observed(schaefer ? 'observer/decide/evaluate/choose/priority' : 'observer/choose', [0, 4]));
  if (delta !== undefined) hysteresis(m, delta, initial);
  return m;
}

// Optional, editable switching cost. At equal adjusted losses the incumbent
// wins via the ordinary secondary comparator, so a switch requires > delta.
export function hysteresis(m, delta, initial = 2) {
  const d = def(m, 'SelectProspective');
  d.components.push(atom('previousKey', 'event_tag'), atom('previous', 'value_memory', { initial }), atom('previousRead', 'event_tag'));
  d.connections.push(edge('selected', 0, 'previousKey', 0), edge('previousKey', 0, 'previous', 0),
    edge('readHistory', 0, 'previous', 1), edge('previous', 0, 'previousRead', 0), edge('$input', 3, 'previousRead', 2));
  d.components.find(c => c.id === 'candidates').parameters.required = 15;
  d.components.find(c => c.id === 'chooseModel').parameters.requireSecondary = 1;
  d.connections.push(edge('candidates', 4, 'chooseModel', 4));
  for (const i of [1, 2]) {
    const p = 'M' + i;
    d.components.push(atom(p + 'incumbent', 'event_operator', { operation: 9, right: i, outputIdentity: i }),
      atom(p + 'switchCost', 'event_operator', { operation: 3, right: -delta }), atom(p + 'adjustedLoss', 'event_operator', { operation: 1, required: 3 }));
    d.connections = d.connections.filter(e => !(e.from.component === p + 'lossRead' && e.to.component === 'candidates'));
    d.connections.push(edge('previousRead', 0, p + 'incumbent', 0), edge(p + 'incumbent', 0, 'candidates', 5),
      edge(p + 'incumbent', 0, p + 'switchCost', 0), edge(p + 'switchCost', 0, p + 'adjustedLoss', 1),
      edge(p + 'lossRead', 0, p + 'adjustedLoss', 0), edge(p + 'adjustedLoss', 0, 'candidates', 0));
  }
  for (const c of d.components.filter(c => ['previous', 'previousRead'].includes(c.id) || /incumbent|switchCost|adjustedLoss/.test(c.id)))
    if (c.type !== 'event_tag') d.connections.push(edge('$input', 2, c.id, c.type === 'value_memory' ? 2 : 4));
  return m;
}

if (process.argv.includes('--write') && import.meta.url === pathToFileURL(process.argv[1]).href)
  for (const options of [{}, { adaptive: false }, { alternative: true }, { schaefer: true }]) {
    const graph = adaptiveProspect(options);
    writeFileSync(new URL('../../examples/' + graph.model.id + '-v3.json', import.meta.url), JSON.stringify(graph, null, 2) + '\n');
  }

