import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalog, validateRequest, type RunRequest } from '@contracts';
import { deserializeModel, fingerprint, renameComponent, serializeModel, validateEditorDocument } from '@/lib/modeling/model';
import { applyScopeView, atomicPaths, deletePort, renameObservationPaths, rootScope, scopeCatalog, scopeView } from '@/lib/modeling/hierarchy';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
const example = (name: string): RunRequest => JSON.parse(readFileSync(resolve(`../../examples/${name}.json`), 'utf8'));
describe('édition hiérarchique et sérialisation scientifique', () => {
  it('préserve v1, v2 et les trajectoires visées dans les allers-retours', () => {
    for (const name of ['sum3', 'hierarchy-sum', 'hierarchy-nested', 'hierarchy-independent']) {
      const request = example(name); expect(serializeModel(deserializeModel(request))).toEqual(request);
    }
  });
  it('sépare les positions et la caméra de chaque définition', () => {
    const initial = deserializeModel(example('hierarchy-nested'));
    const fingerprintBefore = fingerprint(initial.request);
    const view = scopeView(initial, 'Sum2Block'); view.positions.sum = { x: 900, y: -200 }; view.viewport = { x: 12, y: 45, zoom: .8 };
    const edited = applyScopeView(initial, 'Sum2Block', view);
    expect(fingerprint(edited.request)).toBe(fingerprintBefore);
    expect(scopeView(edited, 'Sum2Block').positions.sum).toEqual({ x: 900, y: -200 });
    expect(scopeView(edited, 'CompositeBlock').positions.sum).toBeUndefined();
  });
  it('conserve les niveaux ouverts et dispositions dans le workspace v2', () => {
    let state = deserializeModel(example('hierarchy-nested'));
    const view = scopeView(state, 'Sum2Block'); view.positions.sum = { x: 13, y: 29 };
    state = { ...applyScopeView(state, 'Sum2Block', view), activeScope: 'Sum2Block', scopeTrail: ['CompositeBlock', 'Sum2Block'] };
    const restored = loadWorkspace(saveWorkspace(state));
    expect(restored.activeScope).toBe('Sum2Block'); expect(restored.scopeTrail).toEqual(state.scopeTrail); expect(restored.scopes?.Sum2Block?.positions.sum).toEqual({ x: 13, y: 29 }); expect(restored.request).toEqual(state.request);
  });
  it('migre un workspace v1 sans changer son modèle ni sa caméra', () => {
    const state = deserializeModel(example('sum3')); state.positions.c1 = { x: 8, y: 9 }; state.viewport = { x: 4, y: 5, zoom: .7 };
    const raw = JSON.stringify({ ...state, workspaceVersion: 1 }); const restored = loadWorkspace(raw);
    expect(restored.request).toEqual(state.request); expect(restored.positions).toEqual(state.positions); expect(restored.viewport).toEqual(state.viewport); expect(raw).toContain('"workspaceVersion":1');
  });
  it('une définition vide est éditable mais non exécutable seule', () => {
    const state = deserializeModel(example('hierarchy-sum')); state.request.model.components = []; state.request.model.connections = []; state.request.model.observations = [];
    validateEditorDocument(state.request); expect(() => validateRequest(state.request)).toThrow();
  });
  it('supprime les connexions de tous les usages d’un port sans réindexer', () => {
    const r = example('hierarchy-sum');
    const result = deletePort(r, 'Sum2Block', 'inputs', 0);
    expect(result.removed).toBe(3); // one EIC, c1→sumA, sumA→sumB
    expect(result.request.model.definitions![0]!.inputs.map(p => p.port)).toEqual([1]);
    expect(result.request.model.connections.map(e => e.to.port)).toEqual([1, 1]);
    expect(r.model.definitions![0]!.inputs).toHaveLength(2);
  });
  it('la modification d’un enfant porte sur la définition partagée, sans copier les états', () => {
    const state = deserializeModel(example('hierarchy-sum'));
    const view = scopeView(state, 'Sum2Block'); view.request.model.components[0]!.type = 'qss1_multiplier';
    const next = applyScopeView(state, 'Sum2Block', view);
    expect(next.request.model.components.filter(c => c.type === 'coupled').map(c => c.definition)).toEqual(['Sum2Block', 'Sum2Block']);
    expect(next.request.model.definitions![0]!.components[0]!.type).toBe('qss1_multiplier');
    expect(state.request.model.definitions![0]!.components[0]!.type).toBe('qss1_sum_2');
  });
  it('remappe les observations lors du renommage d’une instance et d’un enfant partagé', () => {
    const state = deserializeModel(example('hierarchy-sum'));
    const rootEdit = applyScopeView(state, rootScope, renameComponent(scopeView(state, rootScope), 'sumB', 'result'));
    const r = renameObservationPaths(state.request, rootEdit.request, rootScope, 'sumB', 'result'); expect(r.model.observations[0]!.component).toBe('result/sum'); validateRequest(r);
    const view = renameComponent(scopeView(state, 'Sum2Block'), 'sum', 'adder'); const changed = applyScopeView(state, 'Sum2Block', view);
    const r2 = renameObservationPaths(state.request, changed.request, 'Sum2Block', 'sum', 'adder'); expect(r2.model.observations[0]!.component).toBe('sumB/adder'); validateRequest(r2);
  });
  it('résout les métadonnées des interfaces dans la portée courante seulement', () => {
    const r = example('hierarchy-sum'); const root = scopeCatalog(r, catalog, rootScope)!; const child = scopeCatalog(r, catalog, 'Sum2Block')!;
    expect(root.components.some(s => s.type === '$input')).toBe(false); expect(child.components.find(s => s.type === '$input')!.outputs.map(p => p.port)).toEqual([0, 1]);
    expect(atomicPaths(r)).toEqual(['c1', 'c2', 'c3', 'sumA/sum', 'sumB/sum']);
  });
  it('rejette un port déclaré sans couplage à l’exécution, en autorisant le brouillon', () => {
    const r = example('hierarchy-sum'); r.model.definitions![0]!.inputs.push({ port: 7, name: 'unused' });
    validateEditorDocument(r); expect(() => validateRequest(r)).toThrowError(/no atomic endpoint/);
  });
});
