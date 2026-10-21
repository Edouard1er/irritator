import { describe, expect, it } from 'vitest';
import { catalog, validateRequest } from '@contracts';
import sum from '../../../examples/sum3.json';
import qss from '../../../examples/qss3_integrator.json';
import { connectionError, defaultParameters, deserializeModel, edgeId, emptyModel, fingerprint, handleId, parameterError, portIndex, removeComponents, renameComponent, serializeModel, toConnection, uniqueId } from '@/lib/modeling/model';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import { resultCsv } from '@/lib/serialization/csv';
import type { RunResult } from '@contracts';

describe('Contrat scientifique v1 et état graphique', () => {
  it('reconstruit tous les paramètres, observations et indices de ports', () => {
    const editor = deserializeModel(sum);
    expect(editor.request).toEqual(sum);
    expect(Object.keys(editor.positions)).toHaveLength(4);
    expect(editor.request.model.connections.map(c => c.to.port)).toEqual([0, 1, 2]);
  });
  it.each([sum, qss])('préserve le modèle dans un aller-retour export/import', source => {
    const first = serializeModel(deserializeModel(source));
    expect(serializeModel(deserializeModel(first))).toEqual(source);
    expect(() => validateRequest(first)).not.toThrow();
  });
  it('exclut position, sélection, caméra et dimensions du JSON scientifique', () => {
    const editor = deserializeModel(sum), before = serializeModel(editor);
    editor.positions.c1 = { x: 999, y: -125 };
    editor.viewport = { x: -40, y: 7, zoom: 0.5 };
    expect(serializeModel(editor)).toEqual(before);
    expect(fingerprint(editor.request)).toBe(fingerprint(before));
  });
  it('place un graphe de façon déterministe', () => expect(deserializeModel(sum).positions).toEqual(deserializeModel(sum).positions));
  it('ouvre un modèle vide et refuse son exécution', () => {
    expect(deserializeModel(emptyModel().request).request.model.components).toHaveLength(0);
    expect(() => serializeModel(emptyModel())).toThrow();
  });
  it('rejette les propriétés inconnues à l’import', () => expect(() => deserializeModel({ ...sum, position: 5 })).toThrow());
  it('rejette les paramètres non finis', () => {
    const editor = deserializeModel(sum); editor.request.model.components[0]!.parameters.value = NaN;
    expect(() => serializeModel(editor)).toThrow();
    expect(() => saveWorkspace(editor)).toThrow();
  });
  it('génère des identifiants uniques même après suppression', () => {
    const spec = catalog.components[0]!;
    expect(uniqueId(spec, deserializeModel(sum).request.model.components)).toBe('c4');
    expect(uniqueId(spec, [{ id: 'c2', type: spec.type, parameters: {} }])).toBe('c1');
  });
  it('initialise uniquement les paramètres réellement décrits par le catalogue', () => {
    for (const spec of catalog.components) expect(Object.keys(defaultParameters(spec))).toEqual(Object.keys(spec.parameters));
    expect(defaultParameters(catalog.components[3]!).dQ).toBeGreaterThan(0);
  });
  it('renomme toutes les références scientifiques et graphiques', () => {
    const changed = renameComponent(deserializeModel(sum), 'sum', 'total');
    expect(changed.request.model.connections.every(c => c.to.component === 'total')).toBe(true);
    expect(changed.request.model.observations[0]!.component).toBe('total');
    expect(changed.positions.total).toBeDefined();
    expect(() => serializeModel(changed)).not.toThrow();
  });
  it('rejette un renommage dupliqué ou invalide', () => {
    expect(() => renameComponent(deserializeModel(sum), 'c1', 'c2')).toThrow();
    expect(() => renameComponent(deserializeModel(sum), 'c1', 'bad id')).toThrow();
  });
  it('supprime les connexions et observations associées à un composant', () => {
    const changed = removeComponents(deserializeModel(sum), new Set(['sum']));
    expect(changed.request.model.components).toHaveLength(3);
    expect(changed.request.model.connections).toHaveLength(0);
    expect(changed.request.model.observations).toHaveLength(0);
    expect(changed.positions.sum).toBeUndefined();
  });
  it('sépare la sauvegarde locale du contrat exporté', () => {
    const editor = deserializeModel(sum); editor.viewport.zoom = 0.7;
    expect(loadWorkspace(saveWorkspace(editor))).toEqual(editor);
    expect(() => loadWorkspace('{"workspaceVersion":2}')).toThrow();
  });
  it('ignore une caméra corrompue sans perdre le modèle', () => {
    const workspace = JSON.parse(saveWorkspace(deserializeModel(sum)));
    workspace.viewport = { x: 'bad', y: 0, zoom: 20 };
    expect(loadWorkspace(JSON.stringify(workspace)).request).toEqual(sum);
    expect(loadWorkspace(JSON.stringify(workspace)).viewport.zoom).toBe(1);
  });
});
describe('Ports et connexions DEVS', () => {
  const request = deserializeModel(sum).request;
  const valid = { source: 'c1', target: 'sum', sourceHandle: 'out:0', targetHandle: 'in:2' };
  it('convertit les handles en indices exacts', () => {
    expect(handleId('in', 2)).toBe('in:2');
    expect(toConnection(valid)).toEqual({ from: { component: 'c1', port: 0 }, to: { component: 'sum', port: 2 } });
    expect(edgeId(toConnection(valid))).toBe('c1:0>sum:2');
  });
  it.each(['in:02', 'out:2', 'in:-1', 'in:NaN', '2', 'in:1.5'])('rejette le handle d’entrée %s', id => expect(portIndex(id, 'in')).toBeUndefined());
  it('accepte un autre couplage vers une entrée déjà alimentée', () => expect(connectionError(valid, request, catalog)).toBeUndefined());
  it.each([
    { ...valid, source: 'missing' }, { ...valid, targetHandle: 'in:3' }, { ...valid, sourceHandle: 'in:0' },
    { ...valid, targetHandle: 'out:0' }, { ...valid, targetHandle: 'in:0' }, { ...valid, source: 'sum' },
  ])('rejette un port, sens, identifiant, doublon ou auto-connexion invalide', connection => expect(connectionError(connection, request, catalog)).toBeTruthy());
  it('autorise les cycles entre deux composants', () => {
    const editor = emptyModel();
    editor.request.model.components = ['a', 'b'].map(id => ({ id, type: 'qss1_sum_2', parameters: {} }));
    editor.request.model.connections.push({ from: { component: 'a', port: 0 }, to: { component: 'b', port: 0 } });
    const back = { source: 'b', target: 'a', sourceHandle: 'out:0', targetHandle: 'in:0' };
    expect(connectionError(back, editor.request, catalog)).toBeUndefined();
    editor.request.model.connections.push(toConnection(back));
    expect(() => serializeModel(deserializeModel(editor.request))).not.toThrow();
  });
  it('refuse un pas trop petit ou une grille hors budget', () => {
    const editor = deserializeModel(sum); editor.request.model.observations[0]!.samplingInterval = 1e-7;
    expect(() => serializeModel(editor)).toThrow();
    editor.request.model.observations[0]!.samplingInterval = 1e-6;
    expect(() => serializeModel(editor)).toThrow(/maxPoints/);
  });
  it('contrôle les bornes numériques des paramètres', () => {
    expect(parameterError(Infinity, { minimum: 0, maximum: 1 })).toBeTruthy();
    expect(parameterError(-1, { minimum: 0, maximum: 1 })).toBeTruthy();
    expect(parameterError(0.5, { minimum: 0, maximum: 1 })).toBeUndefined();
  });
});
it('exporte exactement les valeurs et dates reçues, même irrégulières', () => {
  const result = { observations: [{ component: 'a', samples: [{ time: 0.1, value: 5 }, { time: 0.30000000000000004, value: 1.2345678901234567 }] }] } as RunResult;
  expect(resultCsv(result)).toBe('component,time,value\r\n"a",0.1,5\r\n"a",0.30000000000000004,1.2345678901234567\r\n');
});
