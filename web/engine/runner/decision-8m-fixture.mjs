// Document construction only. Every prediction, observation, pairing, error
// and statistical reduction is executed by native DEVS components.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { atom, edge } from './decision-fixtures.mjs';
import { selectMinimal, selectSchaefer } from './decision-8l-fixture.mjs';
const def = (m, id) => m.model.definitions.find(d => d.id === id);
const observed = (component, eventPorts) => ({ component, samplingInterval: .1, ...(eventPorts ? { eventPorts } : {}) });

// Fuse numeric protocol payload + tag using the numeric atom's optional
// outputIdentity. Remove display-only sinks. No scientific equation or budget
// changes; this leaves room under the existing 128-parent-atom ceiling.
function compact(m) {
  for (const d of m.model.definitions) {
    for (const tag of [...d.components].filter(c => c.type === 'event_tag' && c.parameters.preserveCampaign)) {
      const incoming = d.connections.filter(e => e.to.component === tag.id);
      if (incoming.length !== 1) continue;
      const e = incoming[0], source = d.components.find(c => c.id === e.from.component);
      if (source?.type !== 'event_operator' || d.connections.filter(e => e.from.component === source.id).length !== 1) continue;
      source.parameters.outputIdentity = tag.parameters.identity;
      d.connections = d.connections.filter(c => c !== e).map(c => c.from.component === tag.id ? { ...c, from: e.from } : c);
      d.components = d.components.filter(c => c !== tag);
    }
  }
  const remove = new Set(['identity', 'score', 'status', 'primarySelected', 'secondarySelected', 'internalE', 'applied', 'selectedModel']);
  m.model.components = m.model.components.filter(c => !remove.has(c.id));
  m.model.connections = m.model.connections.filter(e => !remove.has(e.from.component) && !remove.has(e.to.component));
  m.model.observations = m.model.observations.filter(o => !remove.has(o.component));
}

function metrics(m, id, prediction, port, observation, context, status, assumption, declared) {
  const add = (suffix, type, p = {}) => m.model.components.push(atom(id + suffix, type, p));
  add('pair', 'temporal_pair');
  add('error', 'event_operator', { operation: 2, required: 3 });
  add('AE', 'event_operator', { operation: 16 });
  add('SE', 'event_operator', { operation: 17, right: 2 });
  add('MAE', 'campaign_aggregate', { operation: 3, streaming: 1 });
  add('MSE', 'campaign_aggregate', { operation: 3, streaming: 1 });
  add('RMSE', 'event_operator', { operation: 18 });
  const experiment = m.model.components.find(c => c.id === prediction).experiment;
  m.model.forecastContracts ??= [];
  m.model.forecastContracts.push({ pair: id + 'pair', planId: prediction + '-verification', planVersion: 1,
    quantity: declared.quantity, unit: declared.unit,
    cohort: id + '-H' + experiment.simulation.end + '-fixed-law-and-context',
    mode: m.model.id === 'decision-forecast-validation-minimal' ? 'operational' : 'diagnostic',
    stateFactors: experiment.factors.slice(0, declared.stateCount).map(f => f.id),
    commandFactor: experiment.factors[declared.stateCount].id,
    contextFactors: experiment.factors.slice(declared.stateCount + 1).map(f => f.id) });
  m.model.connections.push(edge(prediction, port, id + 'pair', 0), edge(observation, 0, id + 'pair', 1),
    edge('calendar', 2, id + 'pair', 2), edge(assumption, 0, id + 'pair', 3), edge('plant', context, id + 'pair', 4),
    edge(prediction, status, id + 'pair', 5), edge(prediction, 2 * status + 4 + Number(!!experiment.dynamicPlan), id + 'pair', 9), edge(observation, 1, id + 'pair', 7),
    edge(id + 'pair', 1, id + 'error', 0), edge(id + 'pair', 0, id + 'error', 1),
    edge(id + 'error', 0, id + 'AE', 0), edge(id + 'error', 0, id + 'SE', 0),
    edge(id + 'AE', 0, id + 'MAE', 0), edge(id + 'SE', 0, id + 'MSE', 0), edge(id + 'MSE', 0, id + 'RMSE', 0));
  m.model.observations.push(observed(id + 'pair', [0, 1, 2, 3, 4, 5]), observed(id + 'error', [0]),
    observed(id + 'AE', [0]), observed(id + 'SE', [0]), observed(id + 'MAE', [0, 2]), observed(id + 'RMSE', [0]));
}

export function forecastValidation({ diagnostic = false, schaefer = false, lambda = .5, mortality = .08, horizon = 1 } = {}) {
  const m = schaefer ? selectSchaefer({ mortality }) : selectMinimal({ lambda }); compact(m);
  m.model.id = schaefer ? 'tstar-schaefer-forecast-validation' : diagnostic ? 'decision-forecast-comparison' : 'decision-forecast-validation-minimal';
  const plant = def(m, schaefer ? 'SchaeferPlant' : 'LinearPlant');
  const b = def(m, schaefer ? 'ObserverDecision' : 'LinearDecision');
  const actionPort = 23;
  b.outputs.push({ port: actionPort, name: 'appliedTaggedAction' });
  b.connections.push(edge(schaefer ? 'decide' : 'choose', 4, '$output', actionPort));
  plant.outputs.push({ port: 10, name: 'nativeState' }, { port: 12, name: 'actualCommand' });
  plant.connections.push(edge(schaefer ? 'N' : 'X', 0, '$output', 10), edge(schaefer ? 'effort' : 'hold', 0, '$output', 12));
  if (schaefer) { plant.outputs.push({ port: 11, name: 'nativeCapture' }); plant.connections.push(edge('C', 0, '$output', 11)); }
  m.model.observations = [observed(schaefer ? 'plant/N' : 'plant/X'), ...(schaefer ? [observed('plant/C')] : []), observed(schaefer ? 'plant/effort' : 'plant/hold', [0])];
  m.model.components.push(atom('actionKey', 'event_operator', { outputIdentity: 0 }), atom('verificationRun', 'event_operator', { left: 0, required: 0, automatic: 0, outputIdentity: 0 }),
    atom('verificationHorizon', 'event_operator', { left: horizon, required: 0, automatic: 0 }), atom('calendar', 'event_calendar', { relative: 1 }), atom('futureState', 'state_observer'));
  m.model.connections.push(edge('observer', actionPort, 'actionKey', 0), edge('verificationHorizon', 0, 'calendar', 0),
    edge('calendar', 0, 'futureState', 1), edge('plant', 10, 'futureState', 0));
  if (schaefer) { m.model.components.push(atom('futureCapture', 'state_observer')); m.model.connections.push(edge('calendar', 0, 'futureCapture', 1), edge('plant', 11, 'futureCapture', 0)); }
  let action = 'actionKey';
  if ((!diagnostic && !schaefer) || schaefer) {
    m.model.components.push(atom('verificationWindow', 'event_operator', { operation: 9, right: 2 }), atom('oneForecast', 'event_operator', { left: 1, required: 0, automatic: 0 }), atom('windowOnly', 'candidate_filter', { required: 5 }));
    m.model.connections.push(edge('observer', schaefer ? 22 : 9, 'verificationWindow', 0), edge('actionKey', 0, 'windowOnly', 0),
      edge('verificationWindow', 0, 'windowOnly', 2), edge('actionKey', 0, 'oneForecast', 2), edge('oneForecast', 0, 'windowOnly', 3));
    action = 'windowOnly';
  }
  m.model.connections.push(edge(action, 0, 'verificationRun', 2), edge(action, 0, 'verificationHorizon', 2));
  m.model.observations.push(observed('calendar', [0, 1, 2]));
  m.model.observations.push(observed('futureState', [0, 1]));
  if (schaefer) m.model.observations.push(observed('futureCapture', [0, 1]));
  for (const model of diagnostic || schaefer ? [1, 2] : [2]) {
    const definition = schaefer ? model === 1 ? 'SchaeferProspect' : 'SchaeferMortality' : model === 1 ? 'LinearProspect' : 'DampedProspect';
    const template = structuredClone(def(m, 'ProspectiveLibrary').components.find(c => c.id === 'M' + model).experiment);
    template.definition = definition; template.simulation = { start: 0, end: horizon }; delete template.dynamicPlan;
    template.factors.forEach((f, i) => { if (!schaefer || i < 3) { f.type = 'single'; f.value = -999; delete f.values; } else f.values = [.001]; });
    template.requiredInputs = template.factors.filter(f => f.type === 'single').map(f => f.id);
    template.selections.forEach((s, i) => { s.criteria = 'max-last'; if (schaefer) s.name = i ? 'C(H) [capture; unit=capture]' : 'N(H) [biomass; unit=biomass]'; });
    // Short verification forecasts have independent budgets and occurrences.
    // They receive the actual selected action; diagnostic outputs never feed B*.
    const id = 'verificationM' + model;
    m.model.components.push({ id, type: 'simulation_wrapper', parameters: {}, experiment: template });
    m.model.connections.push(edge('plant', 0, id, 2), edge(action, 0, id, schaefer ? 4 : 3), edge('verificationRun', 0, id, 1));
    if (!diagnostic && !schaefer) {
      // Mode A retains 8L's zero child allocation and exclusive input routing.
      // Store observations independently, then release only the selected cycle;
      // seal/ready acknowledge its fields before the wrapper can receive run.
      template.dynamicPlan = true;
      m.model.components.push(atom('selectedInitialState', 'value_memory'));
      m.model.connections = m.model.connections.filter(e => !(e.to.component === id && e.to.port === 2) && !(e.to.component === 'verificationRun' && e.to.port === 2));
      m.model.connections.push(edge('plant', 0, 'selectedInitialState', 0), edge(action, 0, 'selectedInitialState', 1), edge('selectedInitialState', 0, id, 2), edge(id, 2 * (template.factors.length + template.selections.length) + 2, 'verificationRun', 2));
      for (const [field, value] of [[0, 1], [1, 1], [2, horizon], [3, 0]]) {
        const payload = 'verificationPlan' + field;
        m.model.components.push(atom(payload, 'event_operator', { left: value, required: 0, automatic: 0, outputIdentity: field }));
        m.model.connections.push(edge(action, 0, payload, 2), edge(payload, 0, id, template.factors.length + 2));
      }
    }
    if (schaefer) m.model.connections.push(edge('plant', 1, id, 3));
    const f = template.factors.length, s = template.selections.length, status = f + s;
    metrics(m, 'M' + model + (schaefer ? 'N' : 'X'), id, 2 * f + s + 1, 'futureState', 12, status, action, { quantity: schaefer ? 'biomass' : 'state-X', unit: schaefer ? 'biomass' : '1', stateCount: schaefer ? 2 : 1 });
    if (schaefer) metrics(m, 'M' + model + 'C', id, 2 * f + s + 2, 'futureCapture', 12, status, action, { quantity: 'cumulative-capture', unit: 'capture', stateCount: 2 });
  }
  return m;
}

if (process.argv.includes('--write') && import.meta.url === pathToFileURL(process.argv[1]).href)
  for (const [file, options] of [['decision-forecast-validation-minimal', {}], ['decision-forecast-comparison', { diagnostic: true }], ['tstar-schaefer-forecast-validation', { schaefer: true, diagnostic: true }]])
    writeFileSync(new URL('../../examples/' + file + '-v3.json', import.meta.url), JSON.stringify(forecastValidation(options), null, 2) + '\n');
