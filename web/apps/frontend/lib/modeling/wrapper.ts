import { catalog, factorCardinality, wrapperOutputs, type Component, type FactorPlan, type RunRequest, type WrapperExperiment } from '@contracts';
import type { Catalog, ComponentSpec } from './model';

export const wrapperPaletteSpec: ComponentSpec = {
  type: 'simulation_wrapper', name: 'Simulation imbriquée', parameters: {}, required: [],
  inputs: [{ port: 0, name: 'init' }, { port: 1, name: 'run' }], outputs: [],
};
export const scenarioCount = (e: { factors: FactorPlan[] }): number => e.factors.reduce((n, f) => n * factorCardinality(f), 1);
export function wrapperSpec(e?: WrapperExperiment): ComponentSpec {
  return { type: wrapperPaletteSpec.type, name: wrapperPaletteSpec.name, parameters: {}, required: [],
    inputs: [...wrapperPaletteSpec.inputs, ...(e?.factors ?? []).map((f, i) => ({ port: i + 2, name: f.name || f.id })), ...(e?.dynamicPlan ? [{ port: e.factors.length + 2, name: 'plan' }] : [])],
    outputs: e ? wrapperOutputs(e).map(p => ({ port: p.port, name: p.kind === 'selection' ? (e.selections.find(s => s.id === p.id)?.name || p.id) : p.kind === 'factor' ? `${e.factors.find(f => f.id === p.id)?.name || p.id} choisi` : p.kind === 'scenario-selection' ? `${p.id} par scénario` : p.kind === 'scenario-factor' ? `${p.id} par scénario` : p.kind === 'campaign-end' ? 'Fin de campagne' : p.kind === 'plan-ready' ? 'Plan prêt' : p.kind === 'scenario-status' ? 'Validité du scénario' : p.id })) : [],
  };
}
export const componentSpec = (c: Component, metadata?: Catalog): ComponentSpec | undefined => c.type === 'simulation_wrapper' ? wrapperSpec(c.experiment) : metadata?.components.find(s => s.type === c.type);
export const promoteToV3 = (r: RunRequest): RunRequest => ({ ...structuredClone(r), schemaVersion: 3, model: { ...structuredClone(r.model), definitions: structuredClone(r.model.definitions ?? []) } });
export const emptyExperiment = (definition = 'Prospectif'): WrapperExperiment => ({ definition, simulation: { start: 0, end: 2 }, run: 'complete', factors: [], selections: [], objective: { method: 'simple', type: 'maximize', primary: 'selection' } });
export function newWrapperExperiment(r: RunRequest, ownerScope: string): WrapperExperiment {
  const defs = r.model.definitions ?? [];
  const eligible = (id: string, stack: Set<string>): boolean => {
    if (id === ownerScope || stack.has(id) || stack.size >= 8) return false;
    const d = defs.find(d => d.id === id);
    return !!d && d.components.every(c => c.type !== 'simulation_wrapper' && (c.type !== 'coupled' || eligible(c.definition!, new Set(stack).add(id))));
  };
  const definition = defs.find(d => eligible(d.id, new Set()));
  if (definition) return emptyExperiment(definition.id);
  // A missing local choice is a draft, never an accidental reference to a
  // wrapper-containing definition that would prevent opening the inspector.
  let pending = 'prospectif_a_configurer';
  let suffix = 1;
  while (defs.some(d => d.id === pending)) pending = `prospectif_a_configurer${suffix++}`;
  return emptyExperiment(pending);
}

const scopes = (r: RunRequest) => [{ ...r.model, id: '$root' }, ...(r.model.definitions ?? [])];
export function resolvePath(r: RunRequest, scopeId: string, path: string): { component: Component; scope: string } | undefined {
  let scope = scopes(r).find(s => s.id === scopeId);
  const parts = path.split('/');
  for (let i = 0; i < parts.length && scope; i++) {
    const c = scope.components.find(c => c.id === parts[i]);
    if (!c) return;
    if (i === parts.length - 1) return { component: c, scope: scope.id };
    scope = c.type === 'coupled' ? scopes(r).find(s => s.id === c.definition) : undefined;
  }
}
export function prospectiveAtoms(r: RunRequest, definition: string): { path: string; component: Component; parameter?: 'value' | 'X' }[] {
  const out: ReturnType<typeof prospectiveAtoms> = [];
  function visit(id: string, prefix: string, stack: Set<string>) {
    if (stack.has(id) || stack.size >= 8 || out.length >= 128) return;
    for (const c of r.model.definitions?.find(d => d.id === id)?.components ?? []) {
      if (c.type === 'coupled') visit(c.definition!, `${prefix}${c.id}/`, new Set(stack).add(id));
      else if (catalog.components.some(s => s.type === c.type)) out.push({ path: prefix + c.id, component: c,
        parameter: c.type === 'constant' ? 'value' : /^qss[123]_integrator$/.test(c.type) ? 'X' : undefined });
    }
  }
  visit(definition, '', new Set()); return out;
}
// Dependency checks apply to drafts too. Missing prospective choices can be corrected
// in the inspector; recursive or nested prospective wrappers cannot be introduced.
export function validateDependencies(r: RunRequest, draft = false): void {
  const defs = r.model.definitions ?? [];
  function visit(id: string, stack: Set<string>, prospective: boolean) {
    if (stack.has(id)) throw new Error(`Référence récursive vers ${id}.`);
    if (stack.size >= 16) throw new Error('Profondeur de définitions dépassée.');
    const d = defs.find(d => d.id === id);
    if (!d) { if (!draft) throw new Error(`Définition introuvable : ${id}.`); return; }
    for (const c of d.components) {
      if (c.type === 'coupled') visit(c.definition!, new Set(stack).add(id), prospective);
      if (c.type === 'simulation_wrapper') {
        if (prospective) throw new Error('Un prospectif ne peut pas contenir de simulation_wrapper.');
        visit(c.experiment!.definition, new Set(stack).add(id), true);
      }
    }
  }
  for (const d of defs) visit(d.id, new Set(), false);
  for (const c of r.model.components) if (c.experiment) visit(c.experiment.definition, new Set(), true);
}

export type IdentityRename = { factor?: [string, string]; selection?: [string, string] };
const planOnly = (f: FactorPlan): FactorPlan => 'values' in f ? { id: f.id, type: f.type, values: [...f.values] } : 'value' in f ? { id: f.id, type: f.type, value: f.value } : { id: f.id, type: f.type, count: f.count, distribution: f.distribution, reals: [...f.reals], ints: [...f.ints] };
export { planOnly };
function portKeys(e: WrapperExperiment, direction: 'in' | 'out', rename: IdentityRename = {}) {
  const factor = (id: string) => `factor:${id === rename.factor?.[0] ? rename.factor[1] : id}`;
  const selection = (id: string) => `selection:${id === rename.selection?.[0] ? rename.selection[1] : id}`;
  return direction === 'in' ? ['init', 'run', ...e.factors.map(f => factor(f.id)), ...(e.dynamicPlan ? ['plan'] : [])] : [...e.selections.map(s => selection(s.id)), ...e.factors.map(f => factor(f.id)), ...(e.scenarioResults ? ['scenario-status', ...e.factors.map(f => 'scenario-' + factor(f.id)), ...e.selections.map(s => 'scenario-' + selection(s.id)), 'campaign-end'] : []), ...(e.dynamicPlan ? ['plan-ready'] : []), ...(e.execution ? ['scenario-outcome', 'scenario-run-calls', 'scenario-horizon', 'campaign-run-calls', 'campaign-end-total'] : [])];
}
// Numeric handles are transport indices. Remap by logical identity in a single
// transaction, including coupled interface edges and plans on all occurrences.
export function updateExperiment(r: RunRequest, scopeId: string, componentId: string, experiment: WrapperExperiment, rename: IdentityRename = {}): RunRequest {
  const old = scopes(r).find(s => s.id === scopeId)?.components.find(c => c.id === componentId)?.experiment;
  if (!old) throw new Error('Expérience introuvable.');
  const result = structuredClone(r);
  const scope = scopes(result).find(s => s.id === scopeId)!;
  const next=structuredClone(experiment);
  if (next.requiredInputs) next.requiredInputs = next.requiredInputs
    .map(id => id === rename.factor?.[0] ? rename.factor[1] : id)
    .filter(id => next.factors.some(f => f.id === id));
  // Objective arrays follow selection identities too, including rename/add/remove.
  // UI structural edits supply the arrays in the previous selection order.
  if(old.objective.method===next.objective.method &&
     (old.selections.length!==next.selections.length || old.selections.some((s,i)=>s.id!==next.selections[i]?.id))) {
    const index=(id:string)=>old.selections.findIndex(s=>(s.id===rename.selection?.[0]?rename.selection[1]:s.id)===id);
    const o=next.objective;
    if(o.method==='weighted-sum') {
      o.weights=next.selections.map(s=>o.weights[index(s.id)]??1);
      o.types=next.selections.map(s=>o.types[index(s.id)]??'maximize');
    } else if(o.method==='epsilon-constrained') {
      o.epsilons=next.selections.map(s=>o.epsilons[index(s.id)]??0);
      o.operations=next.selections.map(s=>o.operations[index(s.id)]??'greater-equal');
    }
  }
  scope.components.find(c => c.id === componentId)!.experiment = next;
  for (const edge of scope.connections) for (const [endpoint, direction] of [[edge.from, 'out'], [edge.to, 'in']] as const) {
    if (endpoint.component !== componentId) continue;
    const key = portKeys(old, direction, rename)[endpoint.port];
    const port = key ? portKeys(experiment, direction).indexOf(key) : -1;
    if (port < 0) throw new Error('Ce port est connecté. Supprimez explicitement ses connexions avant de retirer le facteur ou la sélection.');
    endpoint.port = port;
  }
  for (const s of scopes(result)) for (const c of s.components) for (const override of c.experimentOverrides ?? []) {
    const target = resolvePath(r, c.definition!, override.target);
    if (target?.scope !== scopeId || target.component.id !== componentId) continue;
    const plans = override.factors.map(f => ({ ...f, id: f.id === rename.factor?.[0] ? rename.factor[1] : f.id }));
    override.factors = experiment.factors.map(f => planOnly(plans.find(p => p.id === f.id) ?? f));
  }
  validateDependencies(result, true); return result;
}

function remapPath(r: RunRequest, start: string, path: string, editedScope: string, previous: string, next: string): string {
  let scope = start;
  return path.split('/').map(part => {
    const replaced = scope === editedScope && part === previous ? next : part;
    const c = scopes(r).find(s => s.id === scope)?.components.find(c => c.id === part);
    scope = c?.type === 'coupled' ? c.definition! : '';
    return replaced;
  }).join('/');
}
export function renameExperimentPaths(before: RunRequest, after: RunRequest, scope: string, previous: string, next: string): RunRequest {
  const result = structuredClone(after);
  for (const s of scopes(result)) for (const c of s.components) {
    if (c.experiment) {
      const e = c.experiment;
      for (const f of [...e.factors, ...e.selections, ...(e.trajectoryObservations ?? [])]) f.target = remapPath(before, e.definition, f.target, scope, previous, next);
    }
    for (const o of c.experimentOverrides ?? []) o.target = remapPath(before, c.definition!, o.target, scope, previous, next);
  }
  return result;
}
export function assertCanRemove(r: RunRequest, scope: string, ids: Set<string>): void {
  for (const s of scopes(r)) for (const c of s.components) {
    // A wrapper being deleted no longer holds prospective references.
    if (s.id === scope && ids.has(c.id)) continue;
    for (const id of ids) {
      const e = c.experiment;
      if (e && [...e.factors, ...e.selections, ...(e.trajectoryObservations ?? [])].some(f => remapPath(r, e.definition, f.target, scope, id, '__removed__') !== f.target))
        throw new Error(`${id} est ciblé par l’expérience de ${c.id}. Corrigez ses facteurs/sélections avant la suppression.`);
      if (c.experimentOverrides?.some(o => remapPath(r, c.definition!, o.target, scope, id, '__removed__') !== o.target))
        throw new Error(`${id} est référencé par un plan d’occurrence de ${c.id}. Retirez ce plan avant la suppression.`);
    }
  }
}
// Safe enumeration for unfinished documents, unlike the strict runtime expander.
export function containedWrappers(r: RunRequest, definition: string): { path: string; experiment: WrapperExperiment }[] {
  const found: ReturnType<typeof containedWrappers> = [];
  function visit(id: string, prefix: string, stack: Set<string>) {
    if (stack.has(id) || stack.size >= 8 || found.length >= 8) return;
    for (const c of r.model.definitions?.find(d => d.id === id)?.components ?? []) {
      if (c.experiment) found.push({ path: prefix + c.id, experiment: c.experiment });
      if (c.type === 'coupled') {
        visit(c.definition!, prefix + c.id + '/', new Set(stack).add(id));
        for (const override of c.experimentOverrides ?? []) {
          const wrapper = found.find(w => w.path === prefix + c.id + '/' + override.target);
          if (wrapper) wrapper.experiment = { ...wrapper.experiment, factors: wrapper.experiment.factors.map(f => {
            const plan = override.factors.find(p => p.id === f.id);
            return plan ? { target: f.target, parameter: f.parameter, ...(f.name ? { name: f.name } : {}), ...planOnly(plan) } : f;
          }) };
        }
      }
    }
  }
  visit(definition, '', new Set()); return found;
}
