import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { catalog } from '@contracts';
import flat from '../../../examples/qss3-operators.json';
import nested from '../../../examples/qss3-operators-coupled.json';
import { ComponentLibrary } from '@/components/panels/component-library';
import { Inspector } from '@/components/panels/inspector';
import { IrritatorNodeView } from '@/components/nodes/irritator-node';
import { defaultParameters, deserializeModel, serializeModel, uniqueId } from '@/lib/modeling/model';
import { scopeCatalog, scopeView } from '@/lib/modeling/hierarchy';

const types = [
  ['qss3_multiplier', 2, []], ['qss3_wsum_2', 2, ['coeff-0', 'coeff-1']],
  ['qss3_power', 1, ['n']], ['qss3_inverse', 1, []], ['qss3_square', 1, []], ['qss3_sqrt', 1, []],
] as const;
describe('Catalogue QSS3 du Test 6.1', () => {
  it('affiche les treize types reçus et recherche les sept types QSS3', () => {
    render(<ComponentLibrary catalog={catalog} onAdd={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^Ajouter / })).toHaveLength(13);
    fireEvent.change(screen.getByLabelText('Rechercher un composant'), { target: { value: 'qss3' } });
    expect(screen.getAllByRole('button', { name: /^Ajouter / })).toHaveLength(7);
    for (const [type] of types) expect(screen.getByRole('button', { name: `Ajouter ${type}` })).toBeVisible();
  });
  for (const [type, inputs, keys] of types) it(`${type} : création, paramètres et ports React Flow natifs`, () => {
    const spec = catalog.components.find(c => c.type === type)!;
    const parameters = defaultParameters(spec), id = uniqueId(spec, []), onParameter = vi.fn();
    expect(Object.keys(parameters)).toEqual([...keys]);
    for (const key of keys) expect(parameters[key]).toBe(1);
    const component = { id, type, parameters };
    render(<><ReactFlowProvider><IrritatorNodeView {...({ data: { component, spec, observed: false }, selected: true } as Parameters<typeof IrritatorNodeView>[0])} /></ReactFlowProvider><Inspector component={component} spec={spec} onParameter={onParameter} onRename={vi.fn()} onObserve={vi.fn()} onDelete={vi.fn()} onDeleteEdge={vi.fn()} /></>);
    for (let i = 0; i < inputs; i++) expect(screen.getByLabelText(`${id} entrée ${i}`, { exact: true })).toHaveAttribute('data-handleid', `in:${i}`);
    expect(screen.queryByLabelText(`${id} entrée ${inputs}`, { exact: true })).not.toBeInTheDocument();
    expect(screen.getByLabelText(`${id} sortie 0`, { exact: true })).toHaveAttribute('data-handleid', 'out:0');
    for (const key of keys) {
      expect(screen.getByLabelText(key, { exact: true })).toHaveValue('1');
      fireEvent.change(screen.getByLabelText(key, { exact: true }), { target: { value: '-2.5' } });
      expect(onParameter).toHaveBeenCalledWith(key, -2.5);
    }
    if (!keys.length) expect(screen.getByText('Aucun paramètre pour ce composant.')).toBeVisible();
  });
  it.each([flat, nested])('préserve tous les nouveaux types et paramètres à travers import/export v$schemaVersion', request => {
    expect(serializeModel(deserializeModel(request))).toEqual(request);
    expect(serializeModel(deserializeModel(JSON.parse(JSON.stringify(request))))).toEqual(request);
  });
  it('retrouve les six opérateurs dans une définition réutilisée sans confondre les chemins', () => {
    const state = deserializeModel(nested), view = scopeView(state, 'Operators');
    const metadata = scopeCatalog(state.request, catalog, 'Operators')!;
    for (const [type] of types) {
      expect(view.request.model.components.some(c => c.type === type)).toBe(true);
      expect(metadata.components.find(c => c.type === type)).toEqual(catalog.components.find(c => c.type === type));
    }
    expect(state.request.model.observations.map(o => o.component)).toEqual(nested.model.observations.map(o => o.component));
  });
});
