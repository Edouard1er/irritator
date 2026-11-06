import { Ajv } from 'ajv';
import catalogData from './catalog.json' with { type: 'json' };
import schemaData from './request.schema.json' with { type: 'json' };
import schemaV2Data from './request-v2.schema.json' with { type: 'json' };
import schemaV3Data from './request-v3.schema.json' with { type: 'json' };
import capabilitiesData from './runner-capabilities.json' with { type: 'json' };
import { validateWrapperRequest } from './wrapper-v3.js';
export * from './wrapper-v3.js';

export interface ParameterSpec { type: string; minimum: number; maximum: number; default?: number; description?: string; choices?: string[] }
export interface ComponentSpec { type: string; name: string; description?: string; parameters: Record<string, ParameterSpec>; required: string[]; inputs: { port: number; name: string }[]; outputs: { port: number; name: string }[] }
export interface Catalog { schemaVersion: number; adapterVersion: string; engineVersion: string; components: ComponentSpec[] }
export const catalog = catalogData as unknown as Catalog;
export const runnerCapabilities = capabilitiesData;
// Both Ajv (draft 7) and RapidJSON (draft 4) support this common subset.
const { $schema: _dialect, ...schema } = schemaData;
export const requestSchema = schema;
const { $schema: _v2dialect, ...v2schema } = schemaV2Data;
export const requestV2Schema = v2schema;
const { $schema: _v3dialect, ...v3schema } = schemaV3Data;
export const requestV3Schema = v3schema;
export const caps = { maxComponents: 128, maxConnections: 512, maxRunCalls: 100000, maxPoints: 20000 };
export interface Component { id: string; type: string; parameters: Record<string, number>; definition?: string; experiment?: import('./wrapper-v3.js').WrapperExperiment; experimentOverrides?: import('./wrapper-v3.js').ExperimentOverride[] }
export interface Endpoint { component: string; port: number }
export interface CoupledDefinition { id: string; name: string; inputs: { port: number; name: string }[]; outputs: { port: number; name: string }[]; components: Component[]; connections: { from: Endpoint; to: Endpoint }[] }
export interface RunRequest {
  schemaVersion: 1 | 2 | 3;
  model: { id: string; components: Component[]; connections: { from: Endpoint; to: Endpoint }[]; observations: { component: string; samplingInterval: number }[]; definitions?: CoupledDefinition[] };
  simulation: { start: number; end: number };
  limits?: Partial<typeof caps> & { maxDepth?: number; maxInstances?: number } & Partial<typeof import('./wrapper-v3.js').wrapperCaps>;
}
export interface RunResult {
  schemaVersion: 1; status: 'completed'; modelId: string;
  simulation: { start: number; end: number; finalTime: number; runCalls: number };
  observations: { component: string; samplingInterval: number; samples: { time: number; value: number }[] }[];
  diagnostics: { observationPolicy: string; engineVersion: string; adapterVersion: string };
}
export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 400,
    public readonly engine?: { engineCategory: number; engineCode: number }) { super(message); }
}
const validate = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile<RunRequest>(requestSchema);
const validateV2 = new Ajv({ strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile<RunRequest>(requestV2Schema);
const validateV3 = new Ajv({ strict: false, strictNumbers: true, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile<RunRequest>(requestV3Schema);
export function validateRequest(input: unknown): asserts input is RunRequest {
  const version = (input as { schemaVersion?: unknown } | null)?.schemaVersion;
  const check = version === 3 ? validateV3 : version === 2 ? validateV2 : validate;
  if (!check(input)) throw new ApiError('INVALID_MODEL', `JSON schema: ${check.errors?.[0]?.instancePath ?? ''} ${check.errors?.[0]?.message ?? ''}`);
  validateGraph(input);
}
export function validateGraph(request: RunRequest): void {
  if (request.schemaVersion === 3) { validateWrapperRequest(request); return; }
  if (request.schemaVersion === 2) { validateHierarchy(request); return; }
  const fail = (code: string, message: string): never => { throw new ApiError(code, message); };
  const { model, simulation: { start, end } } = request;
  if (!(end > start) || !Number.isFinite(end-start) || end-start > 1e9) fail('INVALID_TIME', 'Expected start < end and horizon <= 1e9');
  const limits = { ...caps, ...request.limits };
  if (model.components.length > limits.maxComponents || model.connections.length > limits.maxConnections) fail('LIMIT_EXCEEDED', 'Model size budget exceeded');
  const specs = new Map<string, (typeof catalog.components)[number]>();
  for (const c of model.components) {
    if (specs.has(c.id)) fail('INVALID_MODEL', `Duplicate component id: ${c.id}`);
    const desc = catalog.components.find(item => item.type === c.type);
    if (!desc) fail('UNKNOWN_COMPONENT', `Unsupported component type: ${c.type}`);
    const found = desc!;
    specs.set(c.id, found);
    for (const name of found.required) if (!Object.hasOwn(c.parameters, name)) fail('INVALID_PARAMETER', `Missing parameter: ${name}`);
    for (const [name, value] of Object.entries(c.parameters)) {
      const bounds = (found.parameters as Record<string, { type: string; minimum: number; maximum: number }>)[name];
      if (!Object.hasOwn(found.parameters,name) || !bounds) fail('INVALID_PARAMETER', `Unknown parameter: ${name}`);
      if ((bounds!.type === "integer" && !Number.isInteger(value)) || !Number.isFinite(value) || value < bounds!.minimum || value > bounds!.maximum) fail('INVALID_PARAMETER', `Parameter out of bounds: ${name}`);
    }
  }
  const get = (id: string) => specs.get(id) ?? fail('INVALID_REFERENCE', `Unknown component: ${id}`);
  const edges = new Set<string>();
  for (const { from, to } of model.connections) {
    if (from.port >= get(from.component).outputs.length || to.port >= get(to.component).inputs.length) fail('INVALID_CONNECTION','Invalid port number or direction');
    const key = `${from.component}:${from.port}>${to.component}:${to.port}`;
    if (edges.has(key)) fail('INVALID_CONNECTION', 'Duplicate connection');
    edges.add(key);
  }
  let estimated = 0;
  const observed = new Set<string>();
  for (const o of model.observations) {
    get(o.component);
    if (observed.has(o.component)) fail('OBSERVATION_ERROR','Duplicate observation');
    observed.add(o.component);
    if (!(start + o.samplingInterval > start) || !(end + o.samplingInterval > end)) fail('OBSERVATION_ERROR','Sampling interval cannot advance floating point time');
    estimated += Math.ceil((end-start)/o.samplingInterval)+2;
    if (estimated > limits.maxPoints) fail('LIMIT_EXCEEDED','Potential sampling grid exceeds maxPoints (including terminal margin)');
  }
}
const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
export function parseResult(input: unknown, request: RunRequest): RunResult {
  const bad = (): never => { throw new ApiError('RUNNER_PROTOCOL_ERROR','Invalid or inconsistent runner response',502); };
  if (!object(input) || input.schemaVersion !== 1 || input.status !== 'completed' || input.modelId !== request.model.id || !object(input.simulation) || !Array.isArray(input.observations) || !object(input.diagnostics)) return bad();
  const timing = input.simulation;
  if (timing.start !== request.simulation.start || timing.end !== request.simulation.end || timing.finalTime !== request.simulation.end || !Number.isSafeInteger(timing.runCalls) || Number(timing.runCalls) < 1 || Number(timing.runCalls) > (request.limits?.maxRunCalls ?? caps.maxRunCalls)) return bad();
  if (input.observations.length !== request.model.observations.length) return bad();
  let total = 0;
  for (let i=0; i<input.observations.length; i++) {
    const o: unknown = input.observations[i], expected = request.model.observations[i]!;
    if (!object(o) || o.component !== expected.component || o.samplingInterval !== expected.samplingInterval || !Array.isArray(o.samples) || o.samples.length === 0) return bad();
    let previous = -Infinity;
    for (const s of o.samples as unknown[]) {
      if (!object(s) || typeof s.time !== 'number' || typeof s.value !== 'number' || !Number.isFinite(s.time) || !Number.isFinite(s.value) || s.time < request.simulation.start || s.time > request.simulation.end || s.time <= previous) return bad();
      previous = s.time;
      if (++total > (request.limits?.maxPoints ?? caps.maxPoints)) return bad();
    }
  }
  if (input.diagnostics.engineVersion !== catalog.engineVersion || input.diagnostics.adapterVersion !== catalog.adapterVersion || input.diagnostics.observationPolicy !== 'engine-resampled-sealed-deduplicated') return bad();
  return input as unknown as RunResult;
}


const fail = (code: string, message: string): never => { throw new ApiError(code, message); };
export function validateHierarchy(r: RunRequest, editing = false): Map<string, { atoms: number; connections: number }> {
  const limits = { ...caps, maxDepth: 8, maxInstances: 512, ...r.limits };
  const { start, end } = r.simulation;
  if (!(end > start) || !Number.isFinite(end - start) || end - start > 1e9) fail('INVALID_TIME', 'Expected start < end and horizon <= 1e9');
  const definitions = new Map<string, CoupledDefinition>();
  for (const d of r.model.definitions ?? []) {
    if (definitions.has(d.id)) fail('INVALID_MODEL', `Duplicate definition: ${d.id}`);
    definitions.set(d.id, d);
    for (const ports of [d.inputs, d.outputs]) {
      if (new Set(ports.map(p => p.port)).size !== ports.length || new Set(ports.map(p => p.name)).size !== ports.length) fail('INVALID_EXTERNAL_PORT', `Duplicate external port: ${d.id}`);
    }
  }
  const getDefinition = (c: Component) => definitions.get(c.definition ?? '') ?? fail('DEFINITION_NOT_FOUND', `Unknown definition: ${c.definition}`);
  const ports = (c: Component, direction: 'inputs' | 'outputs') => {
    if (r.schemaVersion === 3 && c.type === 'simulation_wrapper') {
      const e = c.experiment!;
      return Array.from({ length: direction === 'inputs' ? e.factors.length + 2 : e.scenarioResults ? 2*(e.factors.length+e.selections.length)+2 : e.factors.length+e.selections.length }, (_, port) => ({ port, name: String(port) }));
    }
    const spec = c.type === 'coupled' ? getDefinition(c) : catalog.components.find(s => s.type === c.type) ?? fail('UNKNOWN_COMPONENT', `Unsupported component: ${c.type}`);
    return spec[direction];
  };
  function validateScope(scope: Pick<CoupledDefinition, 'components' | 'connections'>, d?: CoupledDefinition) {
    const children = new Map<string, Component>();
    for (const c of scope.components) {
      if (children.has(c.id)) fail('INVALID_MODEL', `Duplicate child: ${c.id}`);
      children.set(c.id, c);
      if (c.type === 'coupled') {
        getDefinition(c);
        if (Object.keys(c.parameters).length) fail('INVALID_PARAMETER', 'Coupled instances use shared definitions, without parameter overrides');
      } else if (r.schemaVersion === 3 && c.type === 'simulation_wrapper') {
        if (Object.keys(c.parameters).length) fail('INVALID_PARAMETER', 'Wrapper parameters must be empty; use experiment');
      } else {
        const spec = catalog.components.find(s => s.type === c.type) ?? fail('UNKNOWN_COMPONENT', `Unsupported component: ${c.type}`);
        for (const name of spec.required) if (!Object.hasOwn(c.parameters, name)) fail('INVALID_PARAMETER', `Missing parameter: ${name}`);
        for (const [name, value] of Object.entries(c.parameters)) {
          const b = (spec.parameters as Record<string, { type: string; minimum: number; maximum: number }>)[name];
          if (!Object.hasOwn(spec.parameters, name) || !b || (b.type === "integer" && !Number.isInteger(value)) || !Number.isFinite(value) || value < b.minimum || value > b.maximum) fail('INVALID_PARAMETER', `Invalid parameter: ${name}`);
        }
      }
    }
    const seen = new Set<string>();
    for (const e of scope.connections) {
      for (const [p, direction] of [[e.from, 'outputs'], [e.to, 'inputs']] as const) {
        if (p.component.startsWith('$')) {
          if (!d || (direction === 'outputs' ? p.component !== '$input' : p.component !== '$output')) fail('INVALID_EXTERNAL_PORT', 'Invalid interface direction or root interface');
          if (!(direction === 'outputs' ? d!.inputs : d!.outputs).some(x => x.port === p.port)) fail('INVALID_EXTERNAL_PORT', `Undeclared external port: ${p.port}`);
        } else {
          const c = children.get(p.component) ?? fail('INVALID_SCOPE', `Child outside this scope: ${p.component}`);
          if (!ports(c, direction).some(x => x.port === p.port)) fail('INVALID_CONNECTION', `Invalid child port: ${p.component}:${p.port}`);
        }
      }
      if (e.from.component === e.to.component || (e.from.component === '$input' && e.to.component === '$output')) fail('INVALID_CONNECTION', 'Self connections and direct interface passthrough are unsupported');
      const key = JSON.stringify(e);
      if (seen.has(key)) fail('INVALID_CONNECTION', 'Duplicate connection');
      seen.add(key);
    }
  }
  validateScope(r.model);
  for (const d of definitions.values()) validateScope(d, d);
  // Check every definition, including unused definitions. Connection cycles are legal.
  const depths = new Map<string, number>();
  function dependency(id: string, stack: Set<string>): number {
    if (stack.has(id)) fail('RECURSIVE_DEFINITION', `Recursive definition: ${id}`);
    const cached = depths.get(id);
    if (cached !== undefined) {
      if (stack.size + cached > limits.maxDepth) fail('HIERARCHY_DEPTH', 'Definition depth budget exceeded');
      return cached;
    }
    const next = new Set(stack).add(id);
    if (next.size > limits.maxDepth) fail('HIERARCHY_DEPTH', 'Definition depth budget exceeded');
    let depth = 1;
    for (const c of definitions.get(id)!.components) if (c.type === 'coupled') depth = Math.max(depth, 1 + dependency(c.definition!, next));
    depths.set(id, depth);
    return depth;
  }
  for (const id of definitions.keys()) dependency(id, new Set());
  let instances = 0, atoms = 0, connections = 0;
  function expand(scope: Pick<CoupledDefinition, 'components' | 'connections'>, depth: number): { inputs: Map<number, number>; outputs: Map<number, number> } {
    if (depth > limits.maxDepth) fail('HIERARCHY_DEPTH', 'Instance depth budget exceeded');
    const summaries = new Map<string, { inputs: Map<number, number>; outputs: Map<number, number> }>();
    for (const c of scope.components) {
      if (++instances > limits.maxInstances) fail('EXPANSION_LIMIT', 'Instance budget exceeded');
      if (c.type === 'coupled') summaries.set(c.id, expand(getDefinition(c), depth + 1));
      else {
        if (++atoms > limits.maxComponents) fail('EXPANSION_LIMIT', 'Expanded atomic model budget exceeded');
        summaries.set(c.id, { inputs: new Map(ports(c, 'inputs').map(p => [p.port, 1])), outputs: new Map(ports(c, 'outputs').map(p => [p.port, 1])) });
      }
    }
    const summary = { inputs: new Map<number, number>(), outputs: new Map<number, number>() };
    const count = (e: Endpoint, dir: 'inputs' | 'outputs') => summaries.get(e.component)![dir].get(e.port) ?? 0;
    for (const e of scope.connections) {
      if (e.from.component === '$input') summary.inputs.set(e.from.port, (summary.inputs.get(e.from.port) ?? 0) + count(e.to, 'inputs'));
      else if (e.to.component === '$output') summary.outputs.set(e.to.port, (summary.outputs.get(e.to.port) ?? 0) + count(e.from, 'outputs'));
      else connections += count(e.from, 'outputs') * count(e.to, 'inputs');
      if (connections > limits.maxConnections || [...summary.inputs.values(), ...summary.outputs.values()].some(n => n > caps.maxConnections)) fail('EXPANSION_LIMIT', 'Expanded connection budget exceeded');
    }
    if (!editing && 'inputs' in scope && 'outputs' in scope) {
      const d = scope as CoupledDefinition;
      if (d.inputs.some(p => !summary.inputs.get(p.port)) || d.outputs.some(p => !summary.outputs.get(p.port))) fail('INVALID_EXTERNAL_PORT', 'Declared external port has no atomic endpoint');
    }
    return summary;
  }
  // Unused definitions are validated too: a document is portable as a whole.
  const sizes = new Map<string, { atoms: number; connections: number }>();
  for (const d of definitions.values()) { instances = 0; atoms = 0; connections = 0; expand(d, 1); sizes.set(d.id, { atoms, connections }); }
  instances = 0; atoms = 0; connections = 0;
  expand(r.model, 0);
  sizes.set('$root', { atoms, connections });
  if (!editing && atoms === 0) fail('INVALID_MODEL', 'No executable atomic model');
  let points = 0;
  const observed = new Set<string>();
  for (const o of r.model.observations) {
    let scope: Pick<CoupledDefinition, 'components'> = r.model;
    const path = o.component.split('/');
    for (let i = 0; i < path.length; i++) {
      const c = scope.components.find(c => c.id === path[i]) ?? fail('OBSERVATION_ERROR', `Unresolved observation: ${o.component}`);
      if (i === path.length - 1) { if (c.type === 'coupled' || c.type === 'simulation_wrapper') fail('OBSERVATION_ERROR', 'Observe an atomic descendant with an observation function'); }
      else { if (c.type !== 'coupled') fail('OBSERVATION_ERROR', 'Observation traverses an atomic model'); scope = getDefinition(c); }
    }
    if (observed.has(o.component)) fail('OBSERVATION_ERROR', 'Duplicate observation');
    observed.add(o.component);
    if (!(start + o.samplingInterval > start) || !(end + o.samplingInterval > end)) fail('OBSERVATION_ERROR', 'Sampling interval cannot advance time');
    points += Math.ceil((end - start) / o.samplingInterval) + 2;
    if (points > limits.maxPoints) fail('LIMIT_EXCEEDED', 'Potential sampling grid exceeds maxPoints');
  }
  return sizes;
}
