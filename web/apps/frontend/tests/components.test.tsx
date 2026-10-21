import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { catalog } from '@contracts';
import { ComponentLibrary } from '@/components/panels/component-library';
import { Inspector } from '@/components/panels/inspector';
import { NumberField } from '@/components/panels/number-field';
import { IrritatorNodeView } from '@/components/nodes/irritator-node';

describe('Bibliothèque alimentée par API', () => {
  it('affiche une attente sans inventer de catalogue', () => { render(<ComponentLibrary onAdd={vi.fn()} onRetry={vi.fn()} />); expect(screen.getByText('Chargement du catalogue…')).toBeVisible(); expect(screen.queryByRole('button', { name: /Ajouter/ })).not.toBeInTheDocument(); });
  it('recherche les cinq types réellement transmis et les ajoute par clic', () => {
    const add = vi.fn(); render(<ComponentLibrary catalog={catalog} onAdd={add} onRetry={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Ajouter/ })).toHaveLength(5);
    fireEvent.change(screen.getByLabelText('Rechercher un composant'), { target: { value: 'qss3' } });
    expect(screen.getAllByRole('button', { name: /Ajouter/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter qss3_integrator' })); expect(add).toHaveBeenCalledWith(catalog.components[4]);
  });
  it('affiche un échec explicite et permet de réessayer', () => { const retry = vi.fn(); render(<ComponentLibrary error="ENGINE_UNAVAILABLE" onAdd={vi.fn()} onRetry={retry} />); fireEvent.click(screen.getByRole('button', { name: 'Réessayer' })); expect(retry).toHaveBeenCalledOnce(); expect(screen.getByRole('alert')).toHaveTextContent('ENGINE_UNAVAILABLE'); });
});
describe('Inspecteur des paramètres et observations', () => {
  const base = { component: { id: 'c1', type: 'constant', parameters: { value: 10, offset: 0 } }, spec: catalog.components[0], onParameter: vi.fn(), onRename: vi.fn(), onObserve: vi.fn(), onDelete: vi.fn(), onDeleteEdge: vi.fn() };
  it('affiche uniquement les paramètres déclarés par le catalogue', () => { render(<Inspector {...base} />); expect(screen.getByLabelText('value')).toHaveValue('10'); expect(screen.getByLabelText('offset')).toHaveValue('0'); expect(screen.queryByLabelText('dQ')).not.toBeInTheDocument(); });
  it('transmet les valeurs modifiées immédiatement', () => { const change = vi.fn(); render(<Inspector {...base} onParameter={change} />); fireEvent.change(screen.getByLabelText('value'), { target: { value: '-2' } }); expect(change).toHaveBeenCalledWith('value', -2); });
  it('active une observation avec son intervalle', () => { const observe = vi.fn(); render(<Inspector {...base} onObserve={observe} observation={{ component: 'c1', samplingInterval: 1 }} />); fireEvent.change(screen.getByLabelText('Pas d’observation'), { target: { value: '0.25' } }); expect(observe).toHaveBeenCalledWith(true, 0.25); fireEvent.click(screen.getByLabelText('Observer ce composant')); expect(observe).toHaveBeenCalledWith(false, 1); });
  it('supprime le composant sélectionné', () => { const remove = vi.fn(); render(<Inspector {...base} onDelete={remove} />); fireEvent.click(screen.getByRole('button', { name: 'Supprimer le composant' })); expect(remove).toHaveBeenCalledOnce(); });
  it('conserve les paramètres du composant même après un déplacement externe', () => { const view = render(<Inspector {...base} />); view.rerender(<Inspector {...base} component={{ ...base.component }} />); expect(screen.getByLabelText('value')).toHaveValue('10'); });
  it('signale une valeur non finie ou hors limites', () => { render(<NumberField label="dQ" value={NaN} minimum={1e-9} onChange={vi.fn()} />); expect(screen.getByLabelText('dQ')).toHaveAttribute('aria-invalid', 'true'); expect(screen.getByText('Saisir un nombre fini.')).toBeVisible(); });
  it('ne transforme pas une saisie vide en zéro', () => { const change = vi.fn(); render(<NumberField label="X" value={5} onChange={change} />); fireEvent.change(screen.getByLabelText('X'), { target: { value: '' } }); expect(change).toHaveBeenCalledWith(NaN); });
  it('affiche les handles avec leurs indices natifs stables', () => {
    render(<ReactFlowProvider><IrritatorNodeView {...({ data: { component: { id: 'sum', type: 'qss1_sum_3', parameters: {} }, spec: catalog.components[2], observed: true }, selected: true } as Parameters<typeof IrritatorNodeView>[0])} /></ReactFlowProvider>);
    for (let p = 0; p < 3; p++) expect(screen.getByLabelText(`sum entrée ${p}`)).toHaveAttribute('data-handleid', `in:${p}`);
    expect(screen.getByLabelText('sum sortie 0')).toHaveAttribute('data-handleid', 'out:0');
  });
});
