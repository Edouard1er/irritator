import { ApiError, catalog, parseResult, validateHierarchy, type Component, type CoupledDefinition, type RunRequest, type RunResult } from './index.js';

export const wrapperCaps = { maxWrappers: 8, maxScenarios: 128, maxTotalScenarios: 256, maxTotalModels: 8192, maxTotalConnections: 32768, maxInternalPoints: 200000, maxResultEvents: 20000 };
export const randomDistributions = ['uniform-int','uniform-real','bernoulli','binomial','negative-binomial','geometric','poisson','exponential','gamma','weibull','extreme-value','normal','lognormal','chi-squared','cauchy','fisher-f','student-t'] as const;
export type RandomDistribution = typeof randomDistributions[number];
export type RandomPlan = { type: 'random' | 'random-add' | 'random-mult'; count: number; distribution: RandomDistribution; reals: [number, number]; ints: [number, number] };
export type FactorPlan = { id: string } & ({ type: 'single' | 'single-add' | 'single-mult'; value: number } | { type: 'fixed' | 'fixed-add' | 'fixed-mult'; values: number[] } | RandomPlan);
export const factorCardinality = (f: FactorPlan) => 'count' in f ? f.count : 'values' in f ? f.values.length : 1;
export type WrapperSeed = [string,string,string,string,string,string];
export const validU64 = (v: string) => v.trim() === v && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
// Names follow the actual random_factor::gen array positions. Unused slots persist.
export const distributionParameters: Record<RandomDistribution, { reals: string[]; ints: string[] }> = {
  'uniform-int': { reals: [], ints: ['borne inférieure','borne supérieure'] },
  'uniform-real': { reals: ['borne inférieure','borne supérieure'], ints: [] },
  bernoulli: { reals: ['probabilité p'], ints: [] }, binomial: { reals: ['probabilité p'], ints: ['nombre d’essais'] },
  'negative-binomial': { reals: ['probabilité p'], ints: ['nombre de succès'] }, geometric: { reals: ['probabilité p'], ints: [] },
  poisson: { reals: ['moyenne'], ints: [] }, exponential: { reals: ['taux λ'], ints: [] },
  gamma: { reals: ['forme α','échelle β'], ints: [] }, weibull: { reals: ['forme a','échelle b'], ints: [] },
  'extreme-value': { reals: ['position a','échelle b'], ints: [] }, normal: { reals: ['moyenne','écart-type'], ints: [] },
  lognormal: { reals: ['moyenne du logarithme','écart-type du logarithme'], ints: [] },
  'chi-squared': { reals: ['degrés de liberté'], ints: [] }, cauchy: { reals: ['position a','échelle b'], ints: [] },
  'fisher-f': { reals: ['degrés de liberté m','degrés de liberté n'], ints: [] }, 'student-t': { reals: ['degrés de liberté'], ints: [] }
};
export function validateRandomPlan(f: RandomPlan): void {
  const [a,b]=f.reals, [i,j]=f.ints;
  let valid=false;
  switch(f.distribution) {
    case 'uniform-int': valid=i<=j; break;
    case 'uniform-real': valid=a<=b; break;
    case 'bernoulli': valid=a>=0&&a<=1; break;
    case 'binomial': valid=i>=0&&a>=0&&a<=1; break;
    case 'negative-binomial': valid=i>0&&a>0&&a<=1; break;
    case 'geometric': valid=a>0&&a<1; break;
    case 'poisson': case 'exponential': case 'chi-squared': case 'student-t': valid=a>0; break;
    case 'gamma': case 'weibull': case 'fisher-f': valid=a>0&&b>0; break;
    case 'extreme-value': case 'normal': case 'lognormal': case 'cauchy': valid=b>0; break;
  }
  if(!valid) fail('INVALID_FACTOR', `Invalid ${f.distribution} parameter domain`);
}
export type WrapperFactor = FactorPlan & { name?: string; target: string; parameter: 'value' | 'X' };
export interface WrapperSelection { id: string; name?: string; target: string; criteria: 'min' | 'max' | 'min-last' | 'max-last' }
export type OptimizationType = 'maximize' | 'minimize';
export type ConstraintOperation = 'equal' | 'not-equal' | 'greater-equal' | 'less-equal';
export type WrapperObjective = { type: OptimizationType } & (
  { method: 'simple'; primary: string } |
  { method: 'weighted-sum'; primary?: string; weights: number[]; types: OptimizationType[]; norm: 'min-max' | 'z-score' } |
  { method: 'epsilon-constrained'; primary: string; epsilons: number[]; operations: ConstraintOperation[] });
export interface WrapperExperiment {
  execution?: { failurePolicy?: 'fail-fast' | 'isolate'; resultMode?: 'optimize' | 'collect'; maxChildRunCalls?: number; maxCampaignRunCalls?: number };
  dynamicPlan?: boolean;
  scenarioResults?: boolean;
  requiredInputs?: string[];
  definition: string; simulation: { start: number; end: number }; run: 'complete' | 'bag' | 'time' | 'until' | 'during';
  seed?: WrapperSeed;
  factors: WrapperFactor[]; selections: WrapperSelection[];
  objective: WrapperObjective;
}
// Relative to a coupled occurrence; only factor values/types can change.
export interface ExperimentOverride { target: string; factors: FactorPlan[] }
export interface WrapperOccurrence { component: string; experiment: WrapperExperiment }
export interface WrapperEvent { component: string; time: number; port: number; bag: number; value: [number, number, number] }
export interface WrapperLayout { component: string; inputs: number; scenarioCount: number; criteriaScale?: 'raw' | 'normalized'; outputs: { port: number; kind: 'selection' | 'factor' | 'scenario-status' | 'scenario-factor' | 'scenario-selection' | 'campaign-end' | 'plan-ready' | 'scenario-outcome' | 'scenario-run-calls' | 'scenario-horizon' | 'campaign-run-calls' | 'campaign-end-total'; id: string }[] }
export function wrapperOutputs(e: WrapperExperiment): WrapperLayout['outputs'] {
  const out: Omit<WrapperLayout['outputs'][number], 'port'>[] = [...e.selections.map(s => ({ kind: 'selection' as const, id: s.id })), ...e.factors.map(f => ({ kind: 'factor' as const, id: f.id }))];
  if (e.scenarioResults) out.push({ kind: 'scenario-status', id: 'scenario-status' }, ...e.factors.map(f => ({ kind: 'scenario-factor' as const, id: f.id })), ...e.selections.map(s => ({ kind: 'scenario-selection' as const, id: s.id })), { kind: 'campaign-end', id: 'campaign-end' });
  if (e.dynamicPlan) out.push({ kind: 'plan-ready', id: 'plan-ready' });
  if (e.execution) out.push(...(['scenario-outcome', 'scenario-run-calls', 'scenario-horizon', 'campaign-run-calls', 'campaign-end-total'] as const).map(kind => ({ kind, id: kind })));
  return out.map((p, port) => ({ port, ...p }));
}
export interface RunResultV2 extends Omit<RunResult, 'schemaVersion'> { schemaVersion: 2; resultEvents: WrapperEvent[]; wrappers: WrapperLayout[] }
const fail = (code: string, message: string): never => { throw new ApiError(code, message); };
type Scope = Pick<CoupledDefinition, 'components' | 'connections'>;
function context(r: RunRequest) {
  const defs = new Map<string, CoupledDefinition>();
  for (const d of r.model.definitions ?? []) {
    if (defs.has(d.id)) fail('INVALID_MODEL', 'Duplicate definition');
    defs.set(d.id, d);
  }
  const definition = (id: string) => defs.get(id) ?? fail('DEFINITION_NOT_FOUND', `Unknown definition: ${id}`);
  function target(scope: Scope, path: string, code: string): Component {
    const parts = path.split('/'); let current = scope;
    for (let i = 0; i < parts.length; ++i) {
      const c = current.components.find(x => x.id === parts[i]) ?? fail(code, `Unknown instance path: ${path}`);
      if (i === parts.length - 1) return c;
      if (c.type !== 'coupled') fail(code, 'Instance path traverses an atomic model');
      current = definition(c.definition!);
    }
    return fail(code, 'Empty target path');
  }
  return { defs, definition, target };
}
function cardinality(e: WrapperExperiment, max: number): number {
  let count = 1;
  for (const f of e.factors) {
    const n = factorCardinality(f);
    if (!n || count > Math.floor(max / n)) fail('LIMIT_EXCEEDED', 'Cartesian scenario product exceeds maxScenarios');
    count *= n;
  }
  return count;
}
function values(f: FactorPlan) { return 'value' in f ? [f.value] : 'values' in f ? f.values : []; }
function factorValues(f: FactorPlan, atom: Component) {
  if ('count' in f) validateRandomPlan(f);
  const spec = catalog.components.find(c => c.type === atom.type) ?? fail('INVALID_FACTOR', 'Unsupported factor model');
  const p = atom.type === 'constant' ? 'value' : 'X';
  const b = (spec.parameters as Record<string, { minimum: number; maximum: number }>)[p]!;
  if (!b || values(f).some(v => !Number.isFinite(v) || v < b.minimum || v > b.maximum)) fail('INVALID_FACTOR', 'Factor value outside target parameter bounds');
}
export function wrapperOccurrences(r: RunRequest, scope: Scope = r.model): WrapperOccurrence[] {
  const { definition } = context(r);
  const max = r.limits?.maxWrappers ?? wrapperCaps.maxWrappers;
  function expand(scope: Scope, prefix = ''): WrapperOccurrence[] {
    const out: WrapperOccurrence[] = []; const overrides = new Map<string, ExperimentOverride>();
    for (const c of scope.components) {
      const path = prefix + c.id;
      if (c.type === 'simulation_wrapper') out.push({ component: path, experiment: c.experiment! });
      else if (c.type === 'coupled') {
        out.push(...expand(definition(c.definition!), path + '/'));
        for (const o of c.experimentOverrides ?? []) {
          const dest = path + '/' + o.target;
          if (overrides.has(dest)) fail('INVALID_EXPERIMENT', 'Duplicate occurrence override');
          overrides.set(dest, o);
        }
      }
      if (out.length > max) fail('LIMIT_EXCEEDED', 'Expanded wrapper budget exceeded');
    }
    for (const [path, override] of overrides) {
      const o = out.find(o => o.component === path) ?? fail('INVALID_REFERENCE', 'Override target is not a wrapper instance');
      if (override.factors.length !== o.experiment.factors.length || override.factors.some((f, i) => f.id !== o.experiment.factors[i]!.id)) fail('INVALID_FACTOR', 'Override must preserve factor ids/count/order');
      o.experiment = { ...o.experiment, factors: o.experiment.factors.map((f, i) => {
        const plan = override.factors[i]!;
        // Do not retain stale value/values fields from the original union arm.
        return { target: f.target, parameter: f.parameter, ...plan };
      }) };
    }
    return out;
  }
  return expand(scope);
}
export function validateWrapperRequest(r: RunRequest): void {
  const { defs, definition, target } = context(r);
  const limits = { ...wrapperCaps, ...r.limits };
  const active = new Set<string>(), done = new Set<string>();
  function dependency(id: string) {
    if (active.has(id)) fail('RECURSIVE_DEFINITION', `Recursive prospective/coupled definition: ${id}`);
    if (done.has(id)) return;
    active.add(id);
    if (active.size > 16) fail('HIERARCHY_DEPTH', 'Combined dependency depth exceeds 16');
    for (const c of definition(id).components) {
      if (c.type === 'coupled') dependency(c.definition!);
      else if (c.type === 'simulation_wrapper') dependency(c.experiment!.definition);
    }
    active.delete(id); done.add(id);
  }
  for (const id of defs.keys()) dependency(id);
  function hasWrapper(s: Scope): boolean { return s.components.some(c => c.type === 'simulation_wrapper' || (c.type === 'coupled' && hasWrapper(definition(c.definition!)))); }
  const declared = [r.model, ...defs.values()].flatMap(s => s.components.filter(c => c.type === 'simulation_wrapper').map(c => c.experiment!));
  for (const e of declared) {
    const f = e.factors.length, s = e.selections.length;
    if (f < 1 || f > 10 || s < 1 || f + s < 3 || f + s > 12) fail('INVALID_EXPERIMENT', 'Require 1<=F<=10, S>=1, 3<=F+S<=12');
  }
  const sizes = validateHierarchy(r);
  if (declared.length > limits.maxWrappers) fail('LIMIT_EXCEEDED', 'Declared wrapper budget exceeded');
  function validate(e: WrapperExperiment) {
    if (e.execution && (e.run !== 'complete' || !e.scenarioResults)) fail('INVALID_EXPERIMENT', 'Execution control requires complete mode and scenarioResults');
    if (e.requiredInputs?.length && (e.run !== 'complete' || new Set(e.requiredInputs).size !== e.requiredInputs.length || e.requiredInputs.some(id => !e.factors.some(f => f.id === id)))) fail('INVALID_EXPERIMENT', 'Required inputs must name distinct factors in complete mode');
    if (e.dynamicPlan && (e.factors.length > 9 || e.run !== 'complete' || !e.scenarioResults || e.factors.some(f => f.type !== 'single' && f.type !== 'fixed') || e.factors.filter(f => f.type === 'single').some(f => !e.requiredInputs?.includes(f.id)) || e.requiredInputs?.some(id => e.factors.find(f => f.id === id)?.type !== 'single'))) fail('INVALID_EXPERIMENT', 'Dynamic plans require F<=9, complete mode, scenarioResults, all direct single factors as required inputs, and direct fixed domains');
    if(e.seed && !e.seed.every(validU64)) fail('INVALID_EXPERIMENT', 'Seed must contain six exact unsigned 64-bit decimal strings');
    const { start, end } = e.simulation;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start) || end - start > 1e9 || !(start + .1 > start) || !(end + .1 > end)) fail('INVALID_TIME', 'Invalid prospective horizon');
    const scope = definition(e.definition), f = e.factors.length, s = e.selections.length;
    if (f < 1 || f > 10 || s < 1 || f + s < 3 || f + s > 12) fail('INVALID_EXPERIMENT', 'Require 1<=F<=10, S>=1, 3<=F+S<=12');
    if (hasWrapper(scope)) fail('UNSUPPORTED_EXPERIMENT', 'Prospective wrappers are outside the validated single-level domain');
    if (new Set(e.factors.map(f => f.id)).size !== f || new Set(e.factors.map(f => f.target)).size !== f) fail('INVALID_FACTOR', 'Duplicate factor id or target');
    for (const f of e.factors) {
      const atom = target(scope, f.target, 'INVALID_FACTOR');
      if (!((atom.type === 'constant' && f.parameter === 'value') || (['qss1_integrator', 'qss2_integrator', 'qss3_integrator'].includes(atom.type) && f.parameter === 'X'))) fail('INVALID_FACTOR', 'Factor parameter must map to a validated reals[0]');
      factorValues(f, atom);
    }
    if (new Set(e.selections.map(s => s.id)).size !== s || (e.objective.method !== 'weighted-sum' && !e.selections.some(s => s.id === e.objective.primary))) fail('INVALID_SELECTION', 'Duplicate selection id or unknown primary');
    const o = e.objective;
    if (o.method === 'weighted-sum' && (o.weights.length !== s || o.types.length !== s || o.weights.some(v => !Number.isFinite(v)))) fail('INVALID_EXPERIMENT', 'Weighted-sum arrays must match selections');
    if (o.method === 'epsilon-constrained' && (o.epsilons.length !== s || o.operations.length !== s || o.epsilons.some(v => !Number.isFinite(v)))) fail('INVALID_EXPERIMENT', 'Epsilon arrays must cover all selections, including primary');
    for (const s of e.selections) {
      const atom = target(scope, s.target, 'INVALID_SELECTION');
      if (!catalog.components.some(c => c.type === atom.type)) fail('INVALID_SELECTION', 'Selection must target an observable catalogue atom');
    }
    cardinality(e, limits.maxScenarios);
  }
  for (const e of declared) validate(e);
  function budget(list: WrapperOccurrence[], graph: { atoms: number; connections: number }) {
    let scenarios = 0, models = graph.atoms + r.model.observations.reduce((n, o) => n + (o.eventPorts?.length ?? 0), 0), edges = graph.connections + r.model.observations.reduce((n, o) => n + (o.eventPorts?.length ?? 0), 0), points = 0;
    for (const e of declared) { const g = sizes.get(e.definition)!; models += 2 * g.atoms; edges += 2 * g.connections; }
    for (const o of list) {
      const e = o.experiment; validate(e);
      const n = cardinality(e, limits.maxScenarios), g = sizes.get(e.definition)!, ports = (e.dynamicPlan || e.execution) ? wrapperOutputs(e).length : e.factors.length + e.selections.length;
      scenarios += n; models += (n + 1) * g.atoms + ports; edges += (n + 1) * g.connections + ports;
      points += n * new Set(e.selections.map(s => s.target)).size * (Math.ceil((e.simulation.end - e.simulation.start) / .1) + 2);
    }
    if (scenarios > limits.maxTotalScenarios || models > limits.maxTotalModels || edges > limits.maxTotalConnections || points > limits.maxInternalPoints) fail('LIMIT_EXCEEDED', 'Cumulative prospective/scenario resource budget exceeded');
  }
  for (const d of defs.values()) budget(wrapperOccurrences(r, d), sizes.get(d.id)!);
  budget(wrapperOccurrences(r), sizes.get('$root')!);
}

// Request v3 explicitly selects this result-v2 parser in the HTTP adapter.
export function parseWrapperResult(input: unknown, request: RunRequest): RunResultV2 {
  const bad = (): never => { throw new ApiError('RUNNER_PROTOCOL_ERROR', 'Invalid wrapper result v2', 502); };
  if (request.schemaVersion !== 3 || typeof input !== 'object' || !input) return bad();
  const r = input as RunResultV2;
  if (r.schemaVersion !== 2 || !Array.isArray(r.resultEvents) || !Array.isArray(r.wrappers)) return bad();
  parseResult({ ...r, schemaVersion: 1 }, request);
  const eventRequests = request.model.observations.filter(o => o.eventPorts?.length);
  if (eventRequests.length && !Array.isArray(r.modelEvents)) return bad();
  let modelBag = 0, modelTime = -Infinity;
  const modelSeen = new Set<string>();
  for (const e of r.modelEvents ?? []) {
    if (!e || !eventRequests.some(o => o.component === e.component && o.eventPorts!.includes(e.port)) ||
        !Number.isFinite(e.time) || e.time < request.simulation.start || e.time >= request.simulation.end || e.time < modelTime ||
        !Number.isSafeInteger(e.bag) || e.bag < 1 || e.bag < modelBag || !Array.isArray(e.value) || e.value.length !== 3 || !e.value.every(Number.isFinite)) return bad();
    const key = JSON.stringify([e.bag, e.component, e.port]); if (modelSeen.has(key)) return bad(); modelSeen.add(key);
    modelTime = e.time; modelBag = e.bag;
  }
  if ((r.modelEvents?.length ?? 0) + r.resultEvents.length > (request.limits?.maxResultEvents ?? wrapperCaps.maxResultEvents)) return bad();
  const expected = wrapperOccurrences(request);
  if (r.wrappers.length !== expected.length) return bad();
  const layouts = new Map<string, number>();
  for (let i = 0; i < expected.length; ++i) {
    const o = expected[i]!, w = r.wrappers[i], e = o.experiment;
    const ports = wrapperOutputs(e);
    if (!w || w.component !== o.component || w.inputs !== e.factors.length + 2 + Number(!!e.dynamicPlan) || w.scenarioCount !== cardinality(e, request.limits?.maxScenarios ?? wrapperCaps.maxScenarios) || !Array.isArray(w.outputs) || w.outputs.length !== ports.length || w.outputs.some((p, j) => !p || p.port !== ports[j]!.port || p.kind !== ports[j]!.kind || p.id !== ports[j]!.id)) return bad();
    const scale=e.objective.method==='weighted-sum'?'normalized':'raw';
    if((w.criteriaScale!==undefined || scale==='normalized') && w.criteriaScale!==scale) return bad();
    layouts.set(w.component, ports.length);
  }
  if (r.resultEvents.length > (request.limits?.maxResultEvents ?? wrapperCaps.maxResultEvents)) return bad();
  let previousBag = 0, previousTime = -Infinity;
  const seen = new Set<string>();
  const campaigns = new Map<string, { fields: Set<string>; status: Map<number, number>; values: Map<string, number>; ended: boolean; planCount: number | undefined }>();
  for (const event of r.resultEvents) {
    if (!event || !layouts.has(event.component) || !Number.isInteger(event.port) || event.port < 0 || event.port >= layouts.get(event.component)! || !Number.isSafeInteger(event.bag) || event.bag < 1 || event.bag > r.simulation.runCalls || event.bag < previousBag || !Number.isFinite(event.time) || event.time < request.simulation.start || event.time >= request.simulation.end || event.time < previousTime || !Array.isArray(event.value) || event.value.length !== 3 || event.value.some(v => !Number.isFinite(v))) return bad();
    const key = JSON.stringify([event.component, event.port, event.bag]);
    if (seen.has(key)) return bad();
    seen.add(key); previousBag = event.bag; previousTime = event.time;
    const layout = r.wrappers.find(w => w.component === event.component)!;
    const kind = layout.outputs[event.port]!.kind;
    if (kind.startsWith('scenario-') || kind === 'campaign-end' || kind === 'plan-ready' || kind === 'campaign-run-calls' || kind === 'campaign-end-total') {
      const [value, candidate, campaign] = event.value;
      if (!Number.isSafeInteger(campaign) || campaign < 1) return bad();
      const campaignKey = JSON.stringify([event.component, campaign]);
      const state = campaigns.get(campaignKey) ?? { fields: new Set<string>(), status: new Map<number, number>(), values: new Map<string, number>(), ended: false, planCount: undefined };
      campaigns.set(campaignKey, state);
      if (state.ended) return bad();
      const experiment = expected.find(o => o.component === event.component)!.experiment;
      const dynamic = experiment.dynamicPlan, execution = experiment.execution;
      if (kind === 'campaign-run-calls' || kind === 'campaign-end-total') {
        const key = kind === 'campaign-run-calls' ? 'calls' : 'total';
        if (!execution || candidate !== 0 || !Number.isSafeInteger(value) || value < 0 || state.values.has(key)) return bad();
        state.values.set(key, value);
      } else if (kind === 'plan-ready') {
        if (!Number.isSafeInteger(value) || value < 1 || value > layout.scenarioCount || !Number.isSafeInteger(candidate) || candidate < 1 || state.planCount !== undefined || state.fields.size) return bad();
        state.planCount = value;
      } else if (kind === 'campaign-end') {
        const actual = dynamic ? candidate : layout.scenarioCount;
        if (!Number.isSafeInteger(actual) || actual < 1 || actual > layout.scenarioCount || candidate !== actual || (dynamic && state.planCount !== actual) || !Number.isSafeInteger(value) || value < 0 || value > actual || state.status.size !== actual || [...state.status.values()].filter(v => v === 1).length !== value) return bad();
        for (let id = 0; id < actual; ++id) if (!state.status.has(id)) return bad();
        if (execution) {
          const port = (kind: string) => layout.outputs.find(p => p.kind === kind)!.port;
          const field = (kind: string, id: number) => state.values.get(`${port(kind)}:${id}`);
          const factors = layout.outputs.filter(p => p.kind === 'scenario-factor');
          const selections = layout.outputs.filter(p => p.kind === 'scenario-selection');
          let calls = 0, horizon: number | undefined;
          for (const [id, valid] of state.status) {
            const outcome = field('scenario-outcome', id), count = field('scenario-run-calls', id), H = field('scenario-horizon', id);
            if (!Number.isSafeInteger(outcome) || outcome! < 1 || outcome! > 5 || valid !== Number(outcome === 1) || !Number.isSafeInteger(count) || count! < 0 || (outcome === 4 && count !== 0) || (execution.maxChildRunCalls && count! > execution.maxChildRunCalls) || H === undefined || H <= 0 || H > experiment.simulation.end - experiment.simulation.start || (horizon !== undefined && H !== horizon)) return bad();
            horizon = H; calls += count!;
            for (const p of factors) if (!state.fields.has(`${p.port}:${id}`)) return bad();
            for (const p of selections) {
              const has = state.fields.has(`${p.port}:${id}`);
              if ((valid === 1 && !has) || ((outcome === 3 || outcome === 4) && has)) return bad();
            }
            if ((outcome === 2 || outcome === 5) && selections.every(p => state.fields.has(`${p.port}:${id}`))) return bad();
            if (outcome === 3 && count === 0) return bad();
          }
          if (state.values.get('total') !== actual || state.values.get('calls') !== calls || (execution.maxCampaignRunCalls && calls > execution.maxCampaignRunCalls)) return bad();
        } else {
          if (state.fields.size !== state.status.size + value * layout.outputs.filter(p => p.kind === 'scenario-factor' || p.kind === 'scenario-selection').length) return bad();
          for (const [id, valid] of state.status) for (const port of layout.outputs.filter(p => p.kind === 'scenario-factor' || p.kind === 'scenario-selection'))
            if (state.fields.has(`${port.port}:${id}`) !== (valid === 1)) return bad();
        }
        state.ended = true;
      } else {
        if ((dynamic && state.planCount === undefined) || !Number.isSafeInteger(candidate) || candidate < 0 || candidate >= (state.planCount ?? layout.scenarioCount)) return bad();
        const field = `${event.port}:${candidate}`;
        if (state.fields.has(field)) return bad(); state.fields.add(field); state.values.set(field, value);
        if (kind === 'scenario-status') {
          if (value !== 0 && value !== 1) return bad(); state.status.set(candidate, value);
        }
      }
    }
  }
  return r;
}
