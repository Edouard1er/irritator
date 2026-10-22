import { describe, expect, it } from 'vitest';
import { catalog, validateRequest } from '@contracts';
import sum from '../../../examples/sum3.json';
import hierarchy from '../../../examples/hierarchy-nested.json';
import { connectionError, deserializeModel, emptyModel, renameComponent, serializeModel, validateEditorDocument } from '@/lib/modeling/model';
import { applyScopeView, atomicPaths, rootScope, scopeCatalog, scopeView } from '@/lib/modeling/hierarchy';
import { assertCanRemove, componentSpec, emptyExperiment, newWrapperExperiment, planOnly, promoteToV3, prospectiveAtoms, renameExperimentPaths, scenarioCount, updateExperiment, validateDependencies, wrapperSpec } from '@/lib/modeling/wrapper';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import { affine, experiment, pair } from './wrapper-fixtures';

describe('document v3, ports et identités expérimentales', () => {
  it.each(['weighted-sum','epsilon-constrained'] as const)('remappe les tableaux %s avec les identités des sélections',method=>{
    const r=affine(),e=experiment(r);e.objective=method==='weighted-sum'?{method,type:'maximize',weights:[2,7],types:['maximize','minimize'],norm:'z-score'}:{method,type:'maximize',primary:'terminal',epsilons:[3,9],operations:['equal','less-equal']};
    let next=updateExperiment(r,rootScope,'decision',{...e,selections:[...e.selections].reverse()});
    let o=experiment(next).objective;
    if(o.method==='weighted-sum'){expect(o.weights).toEqual([7,2]);expect(o.types).toEqual(['minimize','maximize']);}
    if(o.method==='epsilon-constrained'){expect(o.epsilons).toEqual([9,3]);expect(o.operations).toEqual(['less-equal','equal']);}
    const n=experiment(next);next=updateExperiment(next,rootScope,'decision',{...n,selections:n.selections.map(s=>s.id==='minimum'?{...s,id:'low'}:s)},{selection:['minimum','low']});
    expect(experiment(next).objective).toEqual(o);validateRequest(next);expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(next))))).toEqual(next);
  });
  it('préserve les trois plans aléatoires, les tableaux et les u64 dans le workspace et les overrides',()=>{
    const r=pair(),e=r.model.definitions![1]!.components[0]!.experiment!;
    e.factors[0]={id:'rate',target:'u',parameter:'value',type:'random-mult',count:3,distribution:'normal',reals:[0,1],ints:[17,23]};
    e.seed=['18446744073709551615','9007199254740993','3','2','4','5'];
    r.model.components[2]!.experimentOverrides![0]!.factors=[{id:'rate',type:'random-add',count:2,distribution:'uniform-int',reals:[0,1],ints:[1,2]}];
    expect(planOnly(e.factors[0])).toEqual({id:'rate',type:'random-mult',count:3,distribution:'normal',reals:[0,1],ints:[17,23]});
    validateRequest(r);expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(r))))).toEqual(r);expect(scenarioCount(e)).toBe(3);
  });
  it('conserve un brouillon weighted-sum avant l’ajout des sélections',()=>{
    const r=affine(),e=experiment(r);e.selections=[];e.objective={method:'weighted-sum',type:'maximize',weights:[],types:[],norm:'min-max'};r.model.connections.length=1;
    expect(()=>validateEditorDocument(r)).not.toThrow();expect(loadWorkspace(saveWorkspace({request:r,positions:{},viewport:{x:0,y:0,zoom:1}})).request).toEqual(r);
    expect(()=>validateRequest(r)).toThrow();
  });
  it('crée le brouillon indépendamment de l’ordre des définitions et évite les prospectifs contenant un wrapper', () => {
    const r = pair(); r.model.definitions!.reverse(); expect(newWrapperExperiment(r, rootScope).definition).toBe('Prospectif');
    const draft = newWrapperExperiment(r, 'Prospectif'); expect(r.model.definitions!.some(d => d.id === draft.definition)).toBe(false);
    expect(draft.factors).toEqual([]); expect(draft.selections).toEqual([]);
  });
  it('importe et exporte exactement le document affine complet, ses ordres et ses horizons', () => {
    const r = affine(), state = deserializeModel(r);
    expect(serializeModel(state)).toEqual(r); expect(serializeModel(loadWorkspace(saveWorkspace(state)))).toEqual(r);
    expect(atomicPaths(r)).not.toContain('decision');
    const spec = componentSpec(r.model.components[1]!, catalog)!;
    expect(spec.inputs.map(p => p.name)).toEqual(['init', 'run', 'Debit']); expect(spec.outputs.map(p => p.name)).toEqual(['terminal', 'minimum', 'Debit choisi']);
    expect(catalog.components).toHaveLength(13); expect(catalog.components.some(c => c.type === 'simulation_wrapper')).toBe(false);
  });
  it('calcule les ports par occurrence et les 12 ports de la borne supérieure', () => {
    const r = affine(), e = experiment(r), bigger = structuredClone(e);
    bigger.factors = Array.from({ length: 10 }, (_, i) => ({ ...e.factors[0]!, id: `f${i}`, target: `t${i}` }));
    expect(wrapperSpec(bigger).inputs).toHaveLength(12); expect(wrapperSpec(bigger).outputs).toHaveLength(12);
    expect(wrapperSpec(e).inputs).toHaveLength(3); expect(wrapperSpec(e).outputs).toHaveLength(3);
    expect(connectionError({ source: 'run', sourceHandle: 'out:0', target: 'decision', targetHandle: 'in:2' }, r, catalog)).toBeUndefined();
    expect(connectionError({ source: 'run', sourceHandle: 'out:0', target: 'decision', targetHandle: 'in:3' }, r, catalog)).toBeTruthy();
  });
  it('remappe la permutation des sélections, les facteurs et les interfaces couplées par identité', () => {
    const r = affine(), e = experiment(r);
    let next = updateExperiment(r, rootScope, 'decision', { ...e, selections: [...e.selections].reverse() });
    expect(next.model.connections.slice(1).map(c => c.from.port)).toEqual([1, 0, 2]);
    next = updateExperiment(r, rootScope, 'decision', { ...e, factors: [...e.factors, { id: 'initial', type: 'single', value: 1, target: 'X', parameter: 'X' }] });
    next.model.connections.push({ from: { component: 'run', port: 0 }, to: { component: 'decision', port: 2 } });
    const e2 = experiment(next); next = updateExperiment(next, rootScope, 'decision', { ...e2, factors: [...e2.factors].reverse() });
    expect(next.model.connections.at(-1)!.to.port).toBe(3); expect(next.model.connections[3]!.from.port).toBe(3); validateRequest(next);
    const coupled = pair(), cell = coupled.model.definitions![1]!;
    cell.outputs = [{ port: 0, name: 'terminal' }]; cell.connections.push({ from: { component: 'decision', port: 0 }, to: { component: '$output', port: 0 } });
    const changed = updateExperiment(coupled, 'Cell', 'decision', { ...e, selections: [...e.selections].reverse() });
    expect(changed.model.definitions![1]!.connections[1]!.from.port).toBe(1); expect(changed.model.definitions![1]!.connections[0]!.to.port).toBe(1);
  });
  it('bloque la suppression d’un port connecté sans muter le document, puis autorise son retrait explicite', () => {
    const r = affine(), e = experiment(r), snapshot = JSON.stringify(r);
    expect(() => updateExperiment(r, rootScope, 'decision', { ...e, selections: e.selections.slice(0, 1) })).toThrow(/Ce port est connecté/);
    expect(JSON.stringify(r)).toBe(snapshot);
    r.model.connections = r.model.connections.filter(c => !(c.from.component === 'decision' && c.from.port === 1));
    const changed = updateExperiment(r, rootScope, 'decision', { ...e, selections: e.selections.slice(0, 1) });
    expect(changed.model.connections.at(-1)!.from.port).toBe(1); // selected factor follows the remaining selection
    expect(() => validateRequest(changed)).toThrow(/3<=F\+S/);
  });
  it('renomme un identifiant stable et sa primaire sans changer le sens de ses connexions', () => {
    const r = affine(), e = experiment(r);
    const changed = updateExperiment(r, rootScope, 'decision', { ...e, selections: e.selections.map(s => s.id === 'terminal' ? { ...s, id: 'final' } : s), objective: { ...e.objective, primary: 'final' } }, { selection: ['terminal', 'final'] });
    expect(changed.model.connections).toEqual(r.model.connections); validateRequest(changed);
  });
  it('préserve et adapte les plans de plusieurs occurrences lors de la réorganisation et du renommage de facteurs', () => {
    let r = pair(); const e = r.model.definitions![1]!.components[0]!.experiment!;
    r = updateExperiment(r, 'Cell', 'decision', { ...e, factors: [...e.factors, { id: 'initial', target: 'X', parameter: 'X', type: 'single', value: 1 }] });
    const e2 = r.model.definitions![1]!.components[0]!.experiment!;
    r = updateExperiment(r, 'Cell', 'decision', { ...e2, factors: [...e2.factors].reverse().map(f => f.id === 'rate' ? { ...f, id: 'u' } : f) }, { factor: ['rate', 'u'] });
    expect(r.model.components[2]!.experimentOverrides![0]!.factors).toEqual([{ id: 'initial', type: 'single', value: 1 }, { id: 'u', type: 'fixed', values: [-2, 2] }]);
    expect(serializeModel(deserializeModel(r))).toEqual(r); validateRequest(r);
  });
  it('conserve les plans expérimentaux et le workspace de chaque portée', () => {
    let s = deserializeModel(pair()); const view = scopeView(s, 'Cell'); view.positions.decision = { x: 321, y: -76 }; view.viewport = { x: 1, y: 2, zoom: .75 };
    s = { ...applyScopeView(s, 'Cell', view), activeScope: 'Cell', scopeTrail: ['Cell'] };
    const restored = loadWorkspace(saveWorkspace(s)); expect(restored.request).toEqual(s.request); expect(scopeView(restored, 'Cell').positions.decision).toEqual({ x: 321, y: -76 });
    const root = applyScopeView(s, rootScope, scopeView(s, rootScope)); expect(root.request.model.definitions).toEqual(s.request.model.definitions);
  });
  it('remappe les chemins imbriqués de facteurs/sélections et les cibles des overrides', () => {
    let r = pair(); const prospective = r.model.definitions![0]!;
    r.model.definitions!.push({ ...structuredClone(prospective), id: 'Inner' });
    prospective.components = [{ id: 'system', type: 'coupled', definition: 'Inner', parameters: {} }]; prospective.connections = [];
    const e = r.model.definitions![1]!.components[0]!.experiment!; e.factors[0]!.target = 'system/u'; for (const s of e.selections) s.target = 'system/X';
    let state = deserializeModel(r); let after = applyScopeView(state, 'Inner', renameComponent(scopeView(state, 'Inner'), 'u', 'flow'));
    r = renameExperimentPaths(state.request, after.request, 'Inner', 'u', 'flow'); expect(r.model.definitions![1]!.components[0]!.experiment!.factors[0]!.target).toBe('system/flow'); validateRequest(r);
    state = deserializeModel(r); after = applyScopeView(state, 'Prospectif', renameComponent(scopeView(state, 'Prospectif'), 'system', 'nested'));
    r = renameExperimentPaths(state.request, after.request, 'Prospectif', 'system', 'nested'); expect(r.model.definitions![1]!.components[0]!.experiment!.selections[0]!.target).toBe('nested/X'); validateRequest(r);
    state = deserializeModel(r); after = applyScopeView(state, 'Cell', renameComponent(scopeView(state, 'Cell'), 'decision', 'choice'));
    r = renameExperimentPaths(state.request, after.request, 'Cell', 'decision', 'choice'); expect(r.model.components[2]!.experimentOverrides![0]!.target).toBe('choice'); validateRequest(r);
  });
  it('bloque les suppressions de cibles utilisées et limite les paramètres aux quatre types natifs admissibles', () => {
    const r = affine(); expect(() => assertCanRemove(r, 'Prospectif', new Set(['u']))).toThrow(/ciblé/); expect(() => assertCanRemove(r, 'Prospectif', new Set(['X']))).toThrow(/ciblé/);
    expect(prospectiveAtoms(r, 'Prospectif').map(a => [a.path, a.parameter])).toEqual([['u', 'value'], ['X', 'X']]);
    r.model.definitions![0]!.components.push({ id: 'sum', type: 'qss1_sum_2', parameters: {} });
    expect(prospectiveAtoms(r, 'Prospectif').find(a => a.path === 'sum')!.parameter).toBeUndefined();
    expect(() => assertCanRemove(r, 'Prospectif', new Set(['sum']))).not.toThrow();
  });
  it('refuse récursivité prospective, couplée, et second niveau de wrappers dans les brouillons', () => {
    const r = pair(); r.model.definitions![0]!.components.push({ id: 'cycle', type: 'coupled', definition: 'Cell', parameters: {} }); expect(() => validateDependencies(r, true)).toThrow();
    const r2 = affine(); r2.model.definitions![0]!.components.push({ id: 'nested', type: 'simulation_wrapper', parameters: {}, experiment: emptyExperiment('Other') });
    r2.model.definitions!.push({ id: 'Other', name: 'Autre', inputs: [], outputs: [], components: [], connections: [] }); expect(() => validateDependencies(r2, true)).toThrow(/ne peut pas contenir/);
  });
  it('préserve un brouillon local v3 mais interdit son export scientifique et les références invalides importées', () => {
    const s = emptyModel(); s.request = promoteToV3(s.request); s.request.model.components.push({ id: 'wrapper', type: 'simulation_wrapper', parameters: {}, experiment: emptyExperiment() });
    expect(() => validateEditorDocument(s.request)).not.toThrow(); expect(loadWorkspace(saveWorkspace(s)).request).toEqual(s.request); expect(() => serializeModel(s)).toThrow(); expect(() => deserializeModel(s.request)).toThrow();
    const r = affine(); experiment(r).factors[0]!.target = 'missing'; expect(() => deserializeModel(r)).toThrow();
  });
  it.each([sum, hierarchy])('convertit explicitement v1/v2 en v3 sans perdre les composants et connexions', source => {
    const r = promoteToV3(deserializeModel(source).request); expect(r.model.components).toEqual(source.model.components); expect(r.model.connections).toEqual(source.model.connections); expect(r.schemaVersion).toBe(3); validateRequest(r);
    expect(serializeModel(deserializeModel(source))).toEqual(source);
  });
  it('compte uniquement les cardinalités du plan et extrait des overrides sans changer leurs dimensions', () => {
    const e = experiment(affine()); expect(scenarioCount(e)).toBe(3); expect(planOnly(e.factors[0]!)).toEqual({ id: 'rate', type: 'fixed', values: [-1, 0, 1] });
    expect(scopeCatalog(affine(), catalog, rootScope)!.components.filter(s => s.type === 'simulation_wrapper')).toHaveLength(0);
    const r = pair(); r.model.components[2]!.experimentOverrides![0]!.factors.push({ id: 'new', type: 'single', value: 0 }); expect(() => deserializeModel(r)).toThrow(/preserve factor/);
  });
});
