import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { catalog, type RunRequest, type WrapperExperiment } from '@contracts';
import { ComponentLibrary } from '@/components/panels/component-library';
import { WrapperInspector } from '@/components/panels/wrapper-inspector';
import { WrapperResults } from '@/components/panels/wrapper-results';
import { ExperimentOverridesEditor } from '@/components/panels/experiment-overrides';
import { ResultsPanel } from '@/components/panels/results-panel';
import { IrritatorNodeView } from '@/components/nodes/irritator-node';
import { updateExperiment, wrapperSpec, type IdentityRename } from '@/lib/modeling/wrapper';
import { affine, experiment, pair, resultFixture } from './wrapper-fixtures';

function InspectorHarness({ initial = affine(), onOpen = vi.fn() }: { initial?: RunRequest; onOpen?: (id: string) => void }) {
  const [r, setR] = useState(initial), e = experiment(r);
  return <WrapperInspector component={r.model.components.find(c => c.experiment)!} spec={wrapperSpec(e)} request={r} onRename={vi.fn()} onDelete={vi.fn()} onOpen={onOpen}
    onExperiment={(e: WrapperExperiment, rename?: IdentityRename) => { try { setR(updateExperiment(r, '$root', 'decision', e, rename)); } catch (error) { return (error as Error).message; } }} />;
}
const input = (label: string, value: string, container: HTMLElement = document.body) => fireEvent.change(within(container).getByLabelText(label, { exact: true }), { target: { value } });

describe('palette et inspecteur dédiés', () => {
  it('ajoute le wrapper dans une catégorie séparée uniquement après confirmation des capacités', () => {
    const onAdd = vi.fn(); const view = render(<ComponentLibrary catalog={catalog} onAdd={onAdd} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Ajouter simulation_wrapper' })).not.toBeInTheDocument();
    view.rerender(<ComponentLibrary catalog={catalog} wrapperAvailable onAdd={onAdd} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter simulation_wrapper' })); expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ type: 'simulation_wrapper' })); expect(catalog.components).toHaveLength(25);
  });
  it('affiche nom, prospectif et ports variables dans un nœud sélectionnable', () => {
    const component = affine().model.components[1]!, open = vi.fn();
    render(<ReactFlowProvider><IrritatorNodeView {...({ id: component.id, data: { component, spec: wrapperSpec(component.experiment!), observed: false, prospectiveName: 'Intégrale prospective', onOpen: open }, selected: true } as unknown as Parameters<typeof IrritatorNodeView>[0])} /></ReactFlowProvider>);
    expect(screen.getByTestId('node-decision')).toHaveClass('wrapper-node', 'is-selected'); expect(screen.getByText('Prospectif : Intégrale prospective')).toBeVisible();
    expect(screen.getByLabelText('decision entrée 1')).toHaveAttribute('data-handleid', 'in:1'); expect(screen.getByLabelText('decision sortie 2')).toHaveAttribute('data-handleid', 'out:2');
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le prospectif' })); expect(open).toHaveBeenCalledOnce();
  });
  it('sélectionne et ouvre le prospectif, conserve les horizons et exclut le formulaire numérique générique', () => {
    const open = vi.fn(); render(<InspectorHarness onOpen={open} />);
    expect(screen.getByLabelText('Définition prospective')).toHaveValue('Prospectif'); expect(screen.getByLabelText('Début prospectif')).toHaveValue('0'); expect(screen.getByLabelText('Fin prospective')).toHaveValue('2');
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le prospectif' })); expect(open).toHaveBeenCalledWith('Prospectif');
    expect(screen.queryByLabelText('experiment')).not.toBeInTheDocument(); expect(screen.queryByLabelText('dQ')).not.toBeInTheDocument(); expect(screen.queryByLabelText('offset')).not.toBeInTheDocument();
    expect(screen.getByTestId('factor-rate').getElementsByTagName('option')).toHaveLength(11); // two target choices plus nine native factor types
  });
  it('édite single/fixed, valeurs et cardinalités sans calculer de critères', () => {
    render(<InspectorHarness />); const factor = screen.getByTestId('factor-rate');
    input('Type du facteur', 'single', factor); expect(within(factor).getByLabelText('Valeur unique')).toHaveValue('-1'); input('Valeur unique', '2', factor);
    expect(screen.getByText(/1 scénario\(s\) configuré/)).toBeVisible(); input('Type du facteur', 'fixed', factor); input('Valeurs fixes', '-2; 0; 2; 4', factor); expect(screen.getByText(/4 scénario\(s\) configuré/)).toBeVisible();
    input('Valeurs fixes', 'NaN', factor); expect(within(factor).getByLabelText('Valeurs fixes')).toHaveAttribute('aria-invalid', 'true'); expect(screen.getByText(/Document à compléter/)).toBeVisible();
    input('Valeurs fixes', ',', factor); expect(within(factor).getByLabelText('Valeurs fixes')).toHaveAttribute('aria-invalid', 'true'); expect(within(factor).getByLabelText('Valeurs fixes')).toHaveValue(',');
  });
  it('ajoute, réordonne, renomme et retire des facteurs non connectés', () => {
    const r = affine(); r.model.connections = r.model.connections.filter(c => c.from.component !== 'decision'); render(<InspectorHarness initial={r} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un facteur' })); expect(screen.getByTestId('factor-factor1')).toHaveTextContent('Paramètre : X');
    fireEvent.click(screen.getByRole('button', { name: 'Monter facteur factor1' })); expect(screen.getAllByTestId(/^factor-/)[0]).toHaveAttribute('data-testid', 'factor-factor1');
    input('Id du facteur', 'initial', screen.getByTestId('factor-factor1')); fireEvent.blur(within(screen.getByTestId('factor-factor1')).getByLabelText('Id du facteur'));
    expect(screen.getByTestId('factor-initial')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Supprimer facteur initial' })); expect(screen.queryByTestId('factor-initial')).not.toBeInTheDocument();
  });
  it('édite les sélections, remappe les sorties et maintient la primaire lors du renommage', () => {
    render(<InspectorHarness />); input('Id de la sélection', 'final', screen.getByTestId('selection-terminal')); fireEvent.blur(within(screen.getByTestId('selection-terminal')).getByLabelText('Id de la sélection'));
    expect(screen.getByLabelText('Sélection primaire')).toHaveValue('final'); expect(screen.getByTestId('selection-final').querySelector('legend')).toHaveTextContent('primaire');
    input('Critère', 'min-last', screen.getByTestId('selection-final')); input('Sens de l’objectif', 'minimize'); expect(screen.getByLabelText('Sens de l’objectif')).toHaveValue('minimize');
    fireEvent.click(screen.getByRole('button', { name: 'Monter sélection minimum' })); expect(screen.getAllByTestId(/^selection-/)[0]).toHaveAttribute('data-testid', 'selection-minimum');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer sélection minimum' })); expect(screen.getByText(/Ce port est connecté/)).toBeVisible(); expect(screen.getByTestId('selection-minimum')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une sélection' })); input('Cible observable', 'u', screen.getByTestId('selection-selection1')); expect(within(screen.getByTestId('selection-selection1')).getByLabelText('Cible observable')).toHaveValue('u');
  });
  it('signale un chemin invalide et permet de sélectionner une cible admissible', () => {
    const r = affine(); experiment(r).factors[0]!.target = 'deleted'; render(<InspectorHarness initial={r} />);
    expect(within(screen.getByTestId('factor-rate')).getByLabelText('Cible du facteur')).toHaveAttribute('aria-invalid', 'true');
    input('Cible du facteur', 'u', screen.getByTestId('factor-rate')); expect(within(screen.getByTestId('factor-rate')).getByLabelText('Cible du facteur')).toHaveAttribute('aria-invalid', 'false'); expect(screen.queryByText(/Document à compléter/)).not.toBeInTheDocument();
  });
  it('offre trois méthodes et cinq modes et refuse les identifiants dupliqués', () => {
    render(<InspectorHarness />); expect(screen.getByLabelText('Méthode').querySelectorAll('option')).toHaveLength(3); expect(screen.getByLabelText('Mode d’exécution').querySelectorAll('option')).toHaveLength(5);
    input('Id de la sélection', 'minimum', screen.getByTestId('selection-terminal')); fireEvent.blur(within(screen.getByTestId('selection-terminal')).getByLabelText('Id de la sélection')); expect(screen.getByRole('alert')).toHaveTextContent('Cet identifiant existe déjà');
  });
  it('édite les plans par occurrence sans offrir de changement des dimensions ni des critères', () => {
    const r = pair(), change = vi.fn(); const view = render(<ExperimentOverridesEditor component={r.model.components[1]!} request={r} onChange={change} />);
    fireEvent.click(screen.getByLabelText('Personnaliser decision')); expect(change).toHaveBeenLastCalledWith([{ target: 'decision', factors: [{ id: 'rate', type: 'fixed', values: [-1, 0, 1] }] }]);
    view.rerender(<ExperimentOverridesEditor component={r.model.components[2]!} request={r} onChange={change} />);
    input('Valeurs fixes', '-3,3'); expect(change).toHaveBeenLastCalledWith([{ target: 'decision', factors: [{ id: 'rate', type: 'fixed', values: [-3, 3] }] }]);
    expect(screen.queryByRole('button', { name: 'Ajouter un facteur' })).not.toBeInTheDocument(); expect(screen.queryByLabelText('Critère')).not.toBeInTheDocument();
  });
});
describe('journal natif distinct des observations parent', () => {
  it('indique les critères normalisés sans les recalculer', () => {
    const result=resultFixture();result.wrappers[0]!.criteriaScale='normalized';render(<WrapperResults result={result}/>);
    expect(screen.getByTestId('wrapper-summary-decision')).toHaveTextContent('critères normalisés (weighted-sum)');
  });
  it('préserve l’ordre, les sacs, les dates répétées et les trois valeurs du triplet', () => {
    const result = resultFixture(); result.resultEvents.push({ component: 'decision', time: 1, port: 2, bag: 4, value: [2, .01, 7] }); render(<WrapperResults result={result} />);
    const rows = within(screen.getByTestId('wrapper-events')).getAllByRole('row').slice(1); expect(rows).toHaveLength(4);
    expect(rows.map(row => row.children[1]!.textContent)).toEqual(['1', '1', '1', '1']); expect(rows.map(row => row.children[6]!.textContent)).toEqual(['3', '3', '3', '4']); expect(rows[3]!.children[5]!.textContent).toBe('[2, 0.01, 7]');
    expect(screen.getByTestId('wrapper-summary-decision')).toHaveTextContent('3 scénarios configurés');
  });
  it('explique le journal vide et n’invente aucune décision numérique', () => {
    const result = resultFixture(); result.resultEvents = []; render(<WrapperResults result={result} />);
    expect(screen.getByRole('status')).toHaveTextContent('Sans commande DEVS sur run'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('présente les erreurs Fastify et conserve les décisions précédentes marquées obsolètes', () => {
    render(<ResultsPanel result={{ ...resultFixture(), runId: 'unit-only' }} stale status="Échec" error="EXECUTION_ERROR · commande négative (moteur 2/3)" />);
    expect(screen.getByRole('alert')).toHaveTextContent('EXECUTION_ERROR'); expect(screen.getByText(/version précédente/)).toBeVisible(); expect(screen.getByTestId('wrapper-events')).toBeVisible();
  });
});

describe('configuration native 7F',()=>{
  it('édite poids, directions et normalisation, puis toutes les contraintes',()=>{
    render(<InspectorHarness/>);input('Méthode','weighted-sum');input('Poids terminal','2');input('Sens du critère minimum','minimize');input('Normalisation','z-score');
    expect(screen.getByText(/Les critères émis sont normalisés/)).toBeVisible();expect(screen.queryByLabelText('Sélection primaire')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Monter sélection minimum'}));expect(screen.getByLabelText('Poids terminal')).toHaveValue('2');expect(screen.getByLabelText('Sens du critère minimum')).toHaveValue('minimize');
    input('Id de la sélection','low',screen.getByTestId('selection-minimum'));fireEvent.blur(within(screen.getByTestId('selection-minimum')).getByLabelText('Id de la sélection'));
    expect(screen.getByTestId('selection-terminal').querySelector('legend')).not.toHaveTextContent('primaire');
    input('Méthode','epsilon-constrained');input('Opération terminal','less-equal');input('Epsilon terminal','1');
    expect(screen.getByLabelText('Sélection primaire')).toHaveValue('low');
    expect(screen.getByLabelText('Opération low')).toBeVisible();expect(screen.getByText(/y compris la primaire/)).toBeVisible();
  });
  it('édite les paramètres aléatoires, domaines et six entiers exacts',()=>{
    render(<InspectorHarness/>);const factor=screen.getByTestId('factor-rate');input('Type du facteur','random-add',factor);input('Distribution','uniform-int',factor);input('Nombre de tirages','4',factor);
    input('ints[0] · borne inférieure','2',factor);input('ints[1] · borne supérieure','2',factor);
    fireEvent.click(screen.getByLabelText('Configurer la graine native'));input('seed[0]','18446744073709551615');fireEvent.blur(screen.getByLabelText('seed[0]'));
    expect(screen.getByLabelText('seed[0]')).toHaveValue('18446744073709551615');expect(screen.getByText(/4 scénario/)).toBeVisible();
    input('Distribution','normal',factor);input('reals[1] · écart-type','0',factor);expect(screen.getByText(/Invalid normal parameter domain/)).toBeVisible();
    input('reals[1] · écart-type','1',factor);expect(screen.queryByText(/Document à compléter/)).not.toBeInTheDocument();
  });
});
