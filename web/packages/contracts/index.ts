import { Ajv } from 'ajv';
import catalogData from './catalog.json' with { type: 'json' };
import schemaData from './request.schema.json' with { type: 'json' };

export const catalog = catalogData;
// Both Ajv (draft 7) and RapidJSON (draft 4) support this common subset.
const { $schema: _dialect, ...schema } = schemaData;
export const requestSchema = schema;
export const caps = { maxComponents: 128, maxConnections: 512, maxRunCalls: 100000, maxPoints: 20000 };
export interface Component { id: string; type: string; parameters: Record<string, number> }
export interface Endpoint { component: string; port: number }
export interface RunRequest {
  schemaVersion: 1;
  model: { id: string; components: Component[]; connections: { from: Endpoint; to: Endpoint }[]; observations: { component: string; samplingInterval: number }[] };
  simulation: { start: number; end: number };
  limits?: Partial<typeof caps>;
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
export function validateRequest(input: unknown): asserts input is RunRequest {
  if (!validate(input)) throw new ApiError('INVALID_MODEL', `JSON schema: ${validate.errors?.[0]?.instancePath ?? ''} ${validate.errors?.[0]?.message ?? ''}`);
  validateGraph(input);
}
export function validateGraph(request: RunRequest): void {
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
      const bounds = (found.parameters as Record<string, { minimum: number; maximum: number }>)[name];
      if (!Object.hasOwn(found.parameters,name) || !bounds) fail('INVALID_PARAMETER', `Unknown parameter: ${name}`);
      if (!Number.isFinite(value) || value < bounds!.minimum || value > bounds!.maximum) fail('INVALID_PARAMETER', `Parameter out of bounds: ${name}`);
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
