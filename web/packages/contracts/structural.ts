import { ApiError, catalog, validateHierarchy, type Component, type CoupledDefinition, type Endpoint, type RunRequest } from './index.js';
export interface StructuralDiagnostic {
  code: string; severity: 'error' | 'warning'; path: string; definition: string | null; instance: string;
  connection: { from: Endpoint; to: Endpoint } | null; parameter: string | null; found: unknown; expected: string; message: string;
}
type Scope = Pick<CoupledDefinition, 'components' | 'connections'>;
type Context = { prefix: string; definition: string | null };
// Catalogue constraints are consumed by the C++ compiler and the editor/API.
// Native initialization independently enforces the source-binding invariant.
export function inspectStructure(r: RunRequest, includeBindings = true): StructuralDiagnostic[] {
  const defs = new Map<string, CoupledDefinition>();
  const reject = (code: string, message: string, ctx: Context, instance: string, found: unknown, expected: string, parameter: string | null = null, connection: StructuralDiagnostic['connection'] = null): never => {
    throw { code, severity: 'error', path: ctx.prefix + instance, definition: ctx.definition, instance, connection, parameter, found, expected, message } satisfies StructuralDiagnostic;
  };
  const root: Context = { prefix: '', definition: null };
  try {
    for (const d of r.model.definitions ?? []) {
      if (defs.has(d.id)) reject('DUPLICATE_DEFINITION', 'Definition identifiers must be unique', root, '', d.id, 'unique definition id');
      defs.set(d.id, d);
    }
    for (const d of defs.values()) for (const ports of [d.inputs, d.outputs]) {
      if (new Set(ports.map(p => p.port)).size !== ports.length || new Set(ports.map(p => p.name)).size !== ports.length)
        reject('DUPLICATE_INTERFACE_PORT', 'Coupled interface ports and names must be unique', {prefix:`@${d.id}/`,definition:d.id}, '', null, 'unique interface port and name');
    }
    const definition = (id: string, ctx: Context, instance: string) => defs.get(id) ?? reject('DEFINITION_NOT_FOUND', 'Referenced definition does not exist', ctx, instance, id, 'declared coupled definition', 'definition');
    function target(scope: Scope, path: string, ctx: Context, owner: string, parameter: string): Component {
      const parts = path.split('/'); let s = scope;
      for (let i = 0; i < parts.length; ++i) {
        const c = s.components.find(c => c.id === parts[i]);
        if (!c) reject('TARGET_NOT_FOUND', 'Target path does not resolve to a component', ctx, owner, path, 'existing atomic instance path', parameter);
        if (i === parts.length - 1) return c!;
        if (c!.type !== 'coupled') reject('TARGET_NOT_FOUND', 'Target path does not resolve to a component', ctx, owner, path, 'existing atomic instance path', parameter);
        s = definition(c!.definition!, ctx, owner);
      }
      throw new Error('empty target');
    }
    function local(scope: Scope, ctx: Context, experiments = true) {
      const ids = new Set<string>();
      for (const c of scope.components) {
        if (ids.has(c.id)) reject('DUPLICATE_INSTANCE', 'Component identifiers must be unique in their scope', ctx, c.id, c.id, 'unique local id');
        ids.add(c.id);
        if (c.type === 'coupled') { definition(c.definition!, ctx, c.id); continue; }
        if (c.type === 'simulation_wrapper' && r.schemaVersion === 3) {
          const e = c.experiment!; const d = definition(e.definition, ctx, c.id);
          if (!experiments) continue;
          const f = e.factors.length, count = e.selections.length;
          if (f < 1 || f > 10 || count < 1 || f + count < 3 || f + count > 12) reject('WRAPPER_DIMENSIONS', 'Native wrapper dimensions require 1<=F<=10, S>=1, 3<=F+S<=12', ctx, c.id, f+count, '1<=F<=10, S>=1, 3<=F+S<=12', 'experiment');
          if (containsWrapper(d)) reject('WRAPPER_NESTING', 'Prospective wrappers are outside the validated single-level domain', ctx, c.id, e.definition, 'wrapper nesting <= 1', 'definition');
          for (const f of e.factors) {
            const atom = target(d, f.target, ctx, c.id, `factors.${f.id}.target`);
            if (!((atom.type === 'constant' && f.parameter === 'value') || (/^qss[123]_integrator$/.test(atom.type) && f.parameter === 'X')))
              reject('FACTOR_PARAMETER', 'Factor parameter has no supported native reals[0] binding', ctx, c.id, f.parameter, 'constant.value or QSS integrator.X', `factors.${f.id}.parameter`);
            if ('values' in f && !f.values.length) reject('FACTOR_DOMAIN', 'Factor domain must be nonempty', ctx, c.id, f.values, 'nonempty numeric domain', `factors.${f.id}.values`);
          }
          for (const s of e.selections) {
            const atom = target(d, s.target, ctx, c.id, `selections.${s.id}.target`);
            if (!catalog.components.some(c => c.type === atom.type)) reject('SELECTION_TARGET', 'Selection requires an observable catalogue atom', ctx, c.id, s.target, 'observable atomic path', `selections.${s.id}.target`);
          }
          if (e.objective.method !== 'weighted-sum' && !e.selections.some(s => s.id === e.objective.primary)) reject('OBJECTIVE_CRITERION', 'Objective primary does not name a declared selection', ctx, c.id, e.objective.primary, 'declared selection id', 'objective.primary');
          if (e.execution && (e.run !== 'complete' || !e.scenarioResults)) reject('WRAPPER_EXECUTION', 'Execution control requires complete mode and scenarioResults', ctx, c.id, e.run, 'complete with scenarioResults', 'execution');
          continue;
        }
        const spec = catalog.components.find(s => s.type === c.type);
        if (!spec) reject('UNKNOWN_COMPONENT', 'Atomic type is absent from the executable catalogue', ctx, c.id, c.type, 'catalogue atomic type');
        for (const name of spec!.required) if (!Object.hasOwn(c.parameters, name)) reject('PARAMETER_REQUIRED', 'Required atomic parameter is missing', ctx, c.id, null, 'required parameter', name);
        for (const [name, value] of Object.entries(c.parameters)) {
          const b = Object.hasOwn(spec!.parameters, name) ? spec!.parameters[name] : undefined;
          if (!b || !Number.isFinite(value) || value < b.minimum || value > b.maximum || (b.type === 'integer' && !Number.isInteger(value)))
            reject('PARAMETER_DOMAIN', 'Parameter violates the executable catalogue domain', ctx, c.id, value, b ? `${b.type} in [${b.minimum},${b.maximum}]` : 'declared parameter', name);
        }
      }
      if (!experiments) return;
      for (const edge of scope.connections) {
        for (const [ep, dir] of [[edge.from, 'outputs'], [edge.to, 'inputs']] as const) {
          if (ep.component.startsWith('$')) {
            const d = ctx.definition ? defs.get(ctx.definition) : undefined;
            if (!d || ep.component !== (dir === 'outputs' ? '$input' : '$output') || !d[dir === 'outputs' ? 'inputs' : 'outputs'].some(p => p.port === ep.port))
              reject('CONNECTION_DIRECTION', 'Endpoint violates the coupled interface direction or port contract', ctx, ep.component, ep, 'source output to destination input', null, edge);
          } else {
            const c = scope.components.find(c => c.id === ep.component);
            if (!c) reject('CONNECTION_REFERENCE', 'Connection endpoint is outside its local scope', ctx, ep.component, ep, 'existing local component', null, edge);
            const spec = c!.type === 'coupled' ? definition(c!.definition!, ctx, c!.id) : catalog.components.find(s => s.type === c!.type);
            const e = c!.experiment;
            const count = e ? (dir === 'inputs' ? e.factors.length + 2 + Number(!!e.dynamicPlan) : (e.scenarioResults ? 2*(e.factors.length+e.selections.length)+2 : e.factors.length+e.selections.length) + Number(!!e.dynamicPlan) + (e.execution ? 5 : 0)) : 0;
            if (!Number.isInteger(ep.port) || ep.port < 0 || !(e ? ep.port < count : spec?.[dir].some(p => p.port === ep.port))) reject('CONNECTION_PORT', 'Port is absent in the required direction', ctx, ep.component, ep, `${dir} port`, null, edge);
          }
        }
      }
    }
    function containsWrapper(scope: Scope, visited = new Set<string>()): boolean {
      for (const c of scope.components) {
        if (c.type === 'simulation_wrapper') return true;
        if (c.type === 'coupled' && !visited.has(c.definition!)) { visited.add(c.definition!); if (containsWrapper(defs.get(c.definition!)!, visited)) return true; }
      }
      return false;
    }
    const active = new Set<string>(), finished = new Set<string>();
    function dependencies(scope: Scope, ctx: Context) {
      for (const c of scope.components) if (c.type === 'coupled' || c.type === 'simulation_wrapper') {
        const id = c.type === 'coupled' ? c.definition! : c.experiment!.definition;
        if (active.has(id)) reject('RECURSIVE_DEFINITION', 'Recursive coupled/prospective definition', ctx, c.id, id, 'acyclic definition dependencies', 'definition');
        if (finished.has(id)) continue;
        active.add(id);
        if (active.size > 16) reject('HIERARCHY_DEPTH', 'Combined dependency depth exceeds 16', ctx, c.id, active.size, 'combined definition dependency depth <= 16', 'definition');
        dependencies(definition(id, ctx, c.id), {prefix:`@${id}/`,definition:id});
        active.delete(id); finished.add(id);
      }
    }
    // Declarations precede references and port arithmetic, including prototypes.
    local(r.model, root, false);
    for (const d of defs.values()) local(d, {prefix:`@${d.id}/`,definition:d.id}, false);
    dependencies(r.model, root);
    for (const d of defs.values()) dependencies(d, {prefix:`@${d.id}/`,definition:d.id});
    // Validate every definition's local contracts even when it is unused.
    local(r.model, root);
    for (const d of defs.values()) local(d, { prefix: `@${d.id}/`, definition: d.id });
    if (!includeBindings) return [];
    // Establish expansion budgets before following fanout through interfaces.
    if (r.schemaVersion >= 2) validateHierarchy(r, true);
    type Leaf = { component: Component; path: string; ctx: Context; port: number };
    function endpoint(scope: Scope, ep: Endpoint, output: boolean, ctx: Context, depth = 0): Leaf[] {
      if (ep.component.startsWith('$') || depth > 16) return [];
      const c = scope.components.find(c => c.id === ep.component)!;
      if (c.type !== 'coupled') return [{ component: c, path: ctx.prefix + c.id, ctx, port: ep.port }];
      const d = definition(c.definition!, ctx, c.id); const sub = { prefix: ctx.prefix+c.id+'/', definition: d.id };
      return d.connections.flatMap(edge => {
        const external = output ? edge.to : edge.from;
        return external.component === (output ? '$output' : '$input') && external.port === ep.port ? endpoint(d, output ? edge.from : edge.to, output, sub, depth+1) : [];
      });
    }
    const done = new Set<string>();
    function graph(scope: Scope, ctx: Context, stack: Set<string>, bindings: Map<string, number>) {
      if (stack.size > 16) return; // Existing hierarchy validator reports depth/budgets.
      if (ctx.definition) { if (stack.has(ctx.definition)) return; stack = new Set(stack).add(ctx.definition); done.add(ctx.definition); }
      for (const edge of scope.connections) {
        const from = endpoint(scope, edge.from, true, ctx), to = endpoint(scope, edge.to, false, ctx);
        for (const dst of to) {
          const rules = catalog.components.find(s => s.type === dst.component.type)?.sourceContracts ?? [];
          for (const rule of rules) {
            if (dst.port !== rule.port) continue;
            for (const src of from) {
              if (!rule.types.includes(src.component.type)) reject('STATE_OBSERVER_SOURCE_TYPE', 'Source binding requires a compatible native continuous-state integrator', dst.ctx, dst.component.id, src.component.type, rule.types.join('|'), 'source', edge);
              const n = (bindings.get(dst.path) ?? 0) + 1; bindings.set(dst.path, n);
              if (n > rule.maximum) reject('STATE_OBSERVER_SOURCE_COUNT', 'Source binding is ambiguous', dst.ctx, dst.component.id, n, `at most ${rule.maximum} source binding`, 'source', edge);
            }
          }
        }
      }
      for (const c of scope.components) {
        if (c.type === 'coupled') graph(definition(c.definition!, ctx, c.id), {prefix:ctx.prefix+c.id+'/',definition:c.definition!}, stack, bindings);
        else if (c.experiment) graph(definition(c.experiment.definition, ctx, c.id), {prefix:ctx.prefix+c.id+`/@${c.experiment.definition}/`,definition:c.experiment.definition}, stack, new Map());
      }
    }
    graph(r.model, root, new Set(), new Map());
    for (const d of defs.values()) if (!done.has(d.id)) graph(d, {prefix:`@${d.id}/`,definition:d.id}, new Set(), new Map());
    return [];
  } catch (d) {
    if (d && typeof d === 'object' && 'severity' in d) return [d as StructuralDiagnostic];
    throw d;
  }
}
export function validateStructure(r: RunRequest, includeBindings = true): void {
  const diagnostics = inspectStructure(r, includeBindings), d = diagnostics.find(d => d.severity === 'error');
  if (d) {
    const codes: Record<string, string> = {
      CONNECTION_REFERENCE: r.schemaVersion === 1 ? 'INVALID_REFERENCE' : 'INVALID_SCOPE',
      CONNECTION_DIRECTION: 'INVALID_EXTERNAL_PORT', DUPLICATE_INTERFACE_PORT: 'INVALID_EXTERNAL_PORT',
      TARGET_NOT_FOUND: d.parameter?.startsWith('selections.') ? 'INVALID_SELECTION' : 'INVALID_FACTOR',
      FACTOR_PARAMETER: 'INVALID_FACTOR', FACTOR_DOMAIN: 'INVALID_FACTOR', OBJECTIVE_CRITERION: 'INVALID_SELECTION',
      SELECTION_TARGET: 'INVALID_SELECTION', WRAPPER_EXECUTION: 'INVALID_EXPERIMENT', WRAPPER_DIMENSIONS: 'INVALID_EXPERIMENT', WRAPPER_NESTING: 'UNSUPPORTED_EXPERIMENT',
    };
    const legacy = codes[d.code] ?? (d.code.startsWith('PARAMETER_') ? 'INVALID_PARAMETER'
      : d.code.startsWith('CONNECTION_') ? 'INVALID_CONNECTION'
      : d.code.startsWith('DUPLICATE_') ? 'INVALID_MODEL'
      : d.code.startsWith('STATE_OBSERVER_') ? 'STRUCTURAL_INCOMPATIBILITY' : d.code);
    throw new ApiError(legacy, `${d.path}: ${d.message}`, legacy === 'STRUCTURAL_INCOMPATIBILITY' ? 422 : 400, undefined, diagnostics);
  }
}
