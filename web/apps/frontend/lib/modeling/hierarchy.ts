import type { Component, CoupledDefinition, RunRequest } from '@contracts';
import { initialViewport, type Catalog, type ComponentSpec, type EditorState } from './model';

export const rootScope = '$root';
export const definitions = (r: RunRequest) => r.model.definitions ?? [];
export const coupledSpec = (d: CoupledDefinition): ComponentSpec => ({ type: `coupled:${d.id}`, name: d.name, parameters: {}, required: [], inputs: d.inputs, outputs: d.outputs });
export function scopeCatalog(r: RunRequest, native: Catalog | undefined, id: string): Catalog | undefined {
  if (!native) return undefined;
  const d = definitions(r).find(d => d.id === id);
  return { ...native, components: [...native.components, ...definitions(r).map(coupledSpec), ...(d ? [
    { type: '$input', name: 'Entrées externes', parameters: {}, required: [], inputs: [], outputs: d.inputs },
    { type: '$output', name: 'Sorties externes', parameters: {}, required: [], inputs: d.outputs, outputs: [] },
  ] : [])] };
}
export const displayComponent = (c: Component): Component => ({ ...c, parameters: { ...c.parameters }, ...(c.type === 'coupled' ? { type: `coupled:${c.definition}` } : {}) });
const scientificComponent = (c: Component): Component => c.type.startsWith('coupled:') ? { ...c, type: 'coupled', definition: c.type.slice(8), parameters: {} } : c;
export function scopeView(state: EditorState, id: string): EditorState {
  const d = definitions(state.request).find(d => d.id === id);
  const scope = d ?? state.request.model;
  const layout = d ? state.scopes?.[id] : state;
  const defaults = d ? Object.fromEntries([...d.components.map((c, i) => [c.id, { x: (i % 2) * 285, y: Math.floor(i / 2) * 170 }]), ['$input', { x: -285, y: 0 }], ['$output', { x: 570, y: 0 }]]) : {};
  return { ...state, positions: { ...defaults, ...layout?.positions }, viewport: layout?.viewport ?? initialViewport, request: { ...state.request, model: {
    ...state.request.model, components: [...scope.components.map(displayComponent), ...(d ? [{ id: '$input', type: '$input', parameters: {} }, { id: '$output', type: '$output', parameters: {} }] : [])], connections: scope.connections,
    observations: d ? [] : state.request.model.observations.filter(o => !o.component.includes('/')),
  } } };
}
export function applyScopeView(state: EditorState, id: string, view: EditorState): EditorState {
  const components = view.request.model.components.filter(c => !c.id.startsWith('$')).map(scientificComponent);
  if (id === rootScope) return { ...state, positions: view.positions, viewport: view.viewport, request: { ...view.request, model: { ...view.request.model, ...(state.request.schemaVersion >= 2 ? { definitions: state.request.model.definitions } : {}), components,
    observations: [...view.request.model.observations, ...state.request.model.observations.filter(o => o.component.includes('/') && components.some(c => c.id === o.component.split('/')[0]))],
  } } };
  const next = { ...state, scopes: { ...state.scopes, [id]: { positions: view.positions, viewport: view.viewport } }, request: { ...state.request, model: { ...state.request.model,
    definitions: definitions(state.request).map(d => d.id === id ? { ...d, components, connections: view.request.model.connections } : d),
  } } };
  const paths = new Set(atomicPaths(next.request));
  next.request.model.observations = next.request.model.observations.filter(o => paths.has(o.component));
  return next;
}
export function renameObservationPaths(before: RunRequest, after: RunRequest, scopeId: string, previous: string, next: string): RunRequest {
  const observations = before.model.observations.map(o => {
    let scope = rootScope;
    let children = before.model.components;
    const parts = o.component.split('/');
    const remapped = parts.map(part => {
      const replacement = scope === scopeId && part === previous ? next : part;
      const c = children.find(c => c.id === part);
      if (c?.type === 'coupled') { scope = c.definition!; children = definitions(before).find(d => d.id === scope)?.components ?? []; }
      return replacement;
    });
    return { ...o, component: remapped.join('/') };
  });
  const paths = new Set(atomicPaths(after));
  return { ...after, model: { ...after.model, observations: observations.filter(o => paths.has(o.component)) } };
}
export function atomicPaths(r: RunRequest): string[] {
  const result: string[] = [];
  function visit(components: Component[], prefix: string, stack: Set<string>) {
    if (result.length > 128 || stack.size > 8) return;
    for (const c of components) {
      if (c.type !== 'coupled' && c.type !== 'simulation_wrapper') result.push(prefix + c.id);
      else if (c.type === 'coupled' && !stack.has(c.definition!)) {
        const d = definitions(r).find(d => d.id === c.definition);
        if (d) visit(d.components, prefix + c.id + '/', new Set(stack).add(d.id));
      }
    }
  }
  visit(r.model.components, '', new Set());
  return result.slice(0, 128);
}
export function deletePort(r: RunRequest, id: string, direction: 'inputs' | 'outputs', port: number): { request: RunRequest; removed: number } {
  let removed = 0;
  const clean = (components: Component[], connections: CoupledDefinition['connections'], internal: boolean) => connections.filter(e => {
    const affected = internal && (direction === 'inputs' ? e.from.component === '$input' && e.from.port === port : e.to.component === '$output' && e.to.port === port)
      || components.some(c => c.type === 'coupled' && c.definition === id && (direction === 'inputs' ? e.to.component === c.id && e.to.port === port : e.from.component === c.id && e.from.port === port));
    if (affected) removed++;
    return !affected;
  });
  return { request: { ...r, model: { ...r.model,
    connections: clean(r.model.components, r.model.connections, false),
    definitions: definitions(r).map(d => ({ ...d, [direction]: d.id === id ? d[direction].filter(p => p.port !== port) : d[direction], connections: clean(d.components, d.connections, d.id === id) })),
  } }, get removed() { return removed; } };
}
