import { Ajv } from 'ajv';
import { ApiError, catalog, requestSchema, requestV2Schema, requestV3Schema, validateGraph, validateRequest, type Component, type RunRequest } from '@contracts';
import { validateHierarchy } from '@contracts';
import { componentSpec, validateDependencies } from './wrapper';

export interface ParameterSpec { type: string; minimum: number; maximum: number; default?: number; description?: string; choices?: string[] }
export interface ComponentSpec { type: string; name: string; description?: string; parameters: Record<string, ParameterSpec>; required: string[]; inputs: { port: number; name: string }[]; outputs: { port: number; name: string }[] }
export interface Catalog { schemaVersion: number; adapterVersion: string; engineVersion: string; components: ComponentSpec[] }
export type Position = { x: number; y: number };
export type Viewport = Position & { zoom: number };
export interface EditorState {
  request: RunRequest;
  positions: Record<string, Position>;
  viewport: Viewport;
  scopes?: Record<string, { positions: Record<string, Position>; viewport: Viewport }>;
  activeScope?: string;
  scopeTrail?: string[];
}
export const initialViewport: Viewport = { x: 70, y: 45, zoom: 1 };
export const emptyModel = (): EditorState => ({
  request: { schemaVersion: 1, model: { id: 'nouveau-modele', components: [], connections: [], observations: [] }, simulation: { start: 0, end: 3 } },
  positions: {}, viewport: { ...initialViewport },
});

// Only the editor may hold an empty document. Execution/export use the unmodified v1 validator.
const editorSchema = structuredClone(requestSchema);
editorSchema.properties.model.properties.components.minItems = 0;
const checkEditor = new Ajv({ strict: true, strictNumbers: true }).compile<RunRequest>(editorSchema);
const v2EditorSchema = structuredClone(requestV2Schema);
v2EditorSchema.properties.model.properties.components.minItems = 0;
const checkEditorV2 = new Ajv({ strict: false, strictNumbers: true }).compile<RunRequest>(v2EditorSchema);
// Local drafts can have an unfinished plan. Scientific import/export/run remain strict.
const v3EditorSchema = structuredClone(requestV3Schema);
v3EditorSchema.properties.model.properties.components.minItems = 0;
v3EditorSchema.definitions.experiment.properties.factors.minItems = 0;
v3EditorSchema.definitions.experiment.properties.selections.minItems = 0;
for (const arm of v3EditorSchema.definitions.experiment.properties.objective.oneOf) {
  for(const key of ['weights','types','epsilons','operations'] as const) {
    const property=arm.properties[key];
    if(property) property.minItems=0;
  }
}
const checkEditorV3 = new Ajv({ strict: false, strictNumbers: true }).compile<RunRequest>(v3EditorSchema);
export function validateEditorDocument(input: unknown): asserts input is RunRequest {
  const version = (input as RunRequest | null)?.schemaVersion;
  const check = version === 3 ? checkEditorV3 : version === 2 ? checkEditorV2 : checkEditor;
  if (!check(input)) throw new ApiError('INVALID_MODEL', `JSON : ${check.errors?.[0]?.instancePath ?? ''} ${check.errors?.[0]?.message ?? ''}`);
  if (input.schemaVersion >= 2) { validateHierarchy(input, true); if (input.schemaVersion === 3) validateDependencies(input, true); } else validateGraph(input);
}

export function serializeModel(state: EditorState): RunRequest {
  const r = state.request;
  if (r.schemaVersion >= 2) { const result = structuredClone(r); validateRequest(result); return result; }
  const result: RunRequest = {
    schemaVersion: 1,
    model: {
      id: r.model.id,
      components: r.model.components.map(c => ({ id: c.id, type: c.type, parameters: { ...c.parameters } })),
      connections: r.model.connections.map(c => ({ from: { ...c.from }, to: { ...c.to } })),
      observations: r.model.observations.map(o => ({ ...o })),
    },
    simulation: { ...r.simulation },
    ...(r.limits ? { limits: { ...r.limits } } : {}),
  };
  validateRequest(result);
  for (const c of result.model.connections) if (c.from.component === c.to.component) throw new ApiError('INVALID_CONNECTION', 'Le moteur refuse une connexion du composant vers lui-même.');
  return result;
}

// Include the card's port rows and controls, with room between adjacent cards.
export function nodeRowSpacing(c: Component, request: RunRequest): number {
  const d = c.type === 'coupled' || c.type.startsWith('coupled:') ? request.model.definitions?.find(d => d.id === (c.definition ?? c.type.slice(8))) : undefined;
  const spec = d ?? componentSpec(c, catalog);
  const ports = Math.max(spec?.inputs.length ?? 0, spec?.outputs.length ?? 0, 1);
  return Math.max(170, 125 + ports * 25 + (c.experiment || d ? 30 : 0));
}
export function deserializeModel(input: unknown, draft = false): EditorState {
  validateEditorDocument(input);
  if (input.schemaVersion === 3 && !draft) validateRequest(input);
  const request = structuredClone(input);
  const positions: Record<string, Position> = {};
  // Deterministic layout, including cyclic graphs: each branch is visited only once.
  const byId = new Map(request.model.components.map(c => [c.id, c]));
  function depth(id: string, path = new Set<string>()): number {
    if (path.has(id) || path.size >= 4) return 0;
    const next = new Set(path).add(id);
    const parents = request.model.connections.filter(c => c.to.component === id && byId.has(c.from.component));
    return parents.length ? Math.min(4, 1 + Math.max(...parents.map(c => depth(c.from.component, next)))) : 0;
  }
  const rows = new Map<number, number>();
  for (const c of request.model.components) {
    const column = depth(c.id), row = rows.get(column) ?? 0;
    positions[c.id] = { x: column * 285, y: row };
    rows.set(column, row + nodeRowSpacing(c, request));
  }
  return { request, positions, viewport: { ...initialViewport } };
}

export const handleId = (direction: 'in' | 'out', port: number) => `${direction}:${port}`;
export function portIndex(handle: string | null | undefined, direction: 'in' | 'out'): number | undefined {
  const match = new RegExp(`^${direction}:(0|[1-9][0-9]*)$`).exec(handle ?? '');
  return match ? Number(match[1]) : undefined;
}
export interface FlowConnection { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null }
export function connectionError(connection: FlowConnection, request: RunRequest, metadata: Catalog): string | undefined {
  const from = request.model.components.find(c => c.id === connection.source);
  const to = request.model.components.find(c => c.id === connection.target);
  const output = portIndex(connection.sourceHandle, 'out'), input = portIndex(connection.targetHandle, 'in');
  if (!from || !to) return 'Composant introuvable.';
  if (from.id === to.id) return 'Le moteur refuse les auto-connexions.';
  const a = componentSpec(from, metadata), b = componentSpec(to, metadata);
  if (output === undefined || input === undefined || !a?.outputs.some(p => p.port === output) || !b?.inputs.some(p => p.port === input)) return 'Relier une sortie existante à une entrée existante.';
  if (request.model.connections.some(c => c.from.component === from.id && c.to.component === to.id && c.from.port === output && c.to.port === input)) return 'Cette connexion existe déjà.';
  if (request.model.connections.length >= (request.limits?.maxConnections ?? 512)) return 'Limite de connexions atteinte.';
  return undefined;
}
export function toConnection(c: FlowConnection): RunRequest['model']['connections'][number] {
  const output = portIndex(c.sourceHandle, 'out'), input = portIndex(c.targetHandle, 'in');
  if (!c.source || !c.target || output === undefined || input === undefined) throw new ApiError('INVALID_CONNECTION', 'Ports invalides.');
  return { from: { component: c.source, port: output }, to: { component: c.target, port: input } };
}
export const edgeId = (c: RunRequest['model']['connections'][number]) => `${c.from.component}:${c.from.port}>${c.to.component}:${c.to.port}`;
export function uniqueId(spec: ComponentSpec, components: Component[]): string {
  const base = spec.type.startsWith('coupled:') ? spec.type.slice(8) : spec.inputs.length === 0 ? 'c' : spec.type.includes('sum') ? 'sum' : spec.type.includes('multiplier') ? 'product' : spec.type.includes('integrator') ? 'integrator' : spec.type.replace(/^qss[123]_/, '');
  if (base !== 'c' && !components.some(c => c.id === base)) return base;
  let n = 1;
  while (components.some(c => c.id === `${base}${n}`)) n++;
  return `${base}${n}`;
}
export function defaultParameters(spec: ComponentSpec): Record<string, number> {
  return Object.fromEntries(Object.entries(spec.parameters).map(([name, bounds]) => {
    const initial = (bounds as { default?: number }).default ?? (name === 'dQ' ? 0.1 : 0);
    return [name, Math.min(bounds.maximum, Math.max(bounds.minimum, initial))];
  }));
}
export function parameterError(value: number, bounds: { minimum: number; maximum: number; type?: string }): string | undefined {
  if (!Number.isFinite(value)) return 'Saisir un nombre fini.';
  if (bounds.type === 'integer' && !Number.isInteger(value)) return 'Saisir un entier.';
  if (value < bounds.minimum || value > bounds.maximum) return `Valeur attendue entre ${bounds.minimum} et ${bounds.maximum}.`;
}
export function fingerprint(request: RunRequest): string { return JSON.stringify(request); }

export function renameComponent(state: EditorState, previous: string, next: string): EditorState {
  if (!new RegExp(requestSchema.definitions.id.pattern).test(next) || next.length > 64) throw new Error('Identifiant : 1 à 64 lettres, chiffres, tirets ou soulignés.');
  if (next !== previous && state.request.model.components.some(c => c.id === next)) throw new Error('Cet identifiant existe déjà.');
  const model = state.request.model;
  return { ...state, positions: Object.fromEntries(Object.entries(state.positions).map(([id, p]) => [id === previous ? next : id, p])), request: { ...state.request, model: {
    ...model,
    components: model.components.map(c => c.id === previous ? { ...c, id: next } : c),
    connections: model.connections.map(c => ({ from: { ...c.from, component: c.from.component === previous ? next : c.from.component }, to: { ...c.to, component: c.to.component === previous ? next : c.to.component } })),
    observations: model.observations.map(o => ({ ...o, component: o.component === previous ? next : o.component })),
  } } };
}
export function removeComponents(state: EditorState, ids: Set<string>): EditorState {
  const m = state.request.model;
  return { ...state, positions: Object.fromEntries(Object.entries(state.positions).filter(([id]) => !ids.has(id))), request: { ...state.request, model: { ...m,
    components: m.components.filter(c => !ids.has(c.id)),
    connections: m.connections.filter(c => !ids.has(c.from.component) && !ids.has(c.to.component)),
    observations: m.observations.filter(o => !ids.has(o.component)),
  } } };
}
