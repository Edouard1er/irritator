import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type RunRequest } from '@contracts';
import { TerritoryWorkspace } from '@/components/territory/territory-workspace';
import { referenceActivity } from './fishing-fixture';

function Harness() {
  const initial = referenceActivity(); initial.fishingActivities!.activities[0]!.groups = [];
  const [request, setRequest] = useState(initial);
  return <><TerritoryWorkspace request={request} busy={false} onApply={setRequest} onSimulation={vi.fn()}/><output data-testid="request">{JSON.stringify(request)}</output></>;
}
const activity = () => fireEvent.click(screen.getByRole('button', { name: '2 · Décrire l’activité' }));
const value = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const current = () => JSON.parse(screen.getByTestId('request').textContent!) as RunRequest;
const add = () => { fireEvent.click(screen.getByRole('button', { name: '+ Ajouter un groupe' })); value('Nombre de pirogues', '2'); value('Pêcheurs mobilisés', '4'); value('Sorties par pirogue et par mois', '12'); value('Durée moyenne d’une sortie (h)', '6'); };

describe('Fishing activity navigation and editing', () => {
  it('shows a failed document import in both territory readings without exposing technical data to fishers', () => {
    render(<TerritoryWorkspace request={referenceActivity()} busy={false} onApply={vi.fn()} onSimulation={vi.fn()} documentError="Import impossible · JSON schema /fishingActivities"/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Votre document précédent est conservé');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/JSON|fishingActivities/);
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    expect(screen.getByRole('alert')).toHaveTextContent('JSON schema /fishingActivities');
  });
  it('saves a second non-overlapping rest period without losing the first period', () => {
    render(<Harness/>); activity();
    value('Activité enregistrée', ''); value('Début (mois)', '12'); value('Fin (mois, exclue)', '24');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la période' }));
    expect(current().fishingActivities!.activities).toHaveLength(2);
    expect(current().fishingActivities!.activities[1]!.period).toEqual({ start: 12, end: 24, unit: 'month' });
    expect(screen.getByLabelText('Résumé de l’activité').querySelectorAll('.activity-totals dd')[0]).toHaveTextContent('0');
  });
  it('creates, edits, confirms deletion and keeps both readings and zone navigation', () => {
    render(<Harness/>); activity(); add();
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    expect(screen.getByLabelText('Nombre de pirogues')).toHaveValue(2);
    expect(screen.getByText(/Identifiant stable du groupe/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '1 · Sélection de zone' })); activity();
    fireEvent.click(screen.getByRole('button', { name: 'Pêcheur' }));
    expect(screen.queryByText(/Identifiant stable/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le groupe' }));
    const groupId = current().fishingActivities!.activities[0]!.groups[0]!.id;
    expect(screen.getByLabelText('Résumé de l’activité')).toHaveTextContent('24');
    expect(screen.getByLabelText('Résumé de l’activité')).toHaveTextContent('144');
    expect(screen.getByLabelText('Activité de pêche')).not.toHaveTextContent(/E\(t\)|q\(t\)|Σ|Identifiant|Provenance|JSON/);
    fireEvent.click(screen.getByRole('button', { name: 'Consulter le résumé' }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le groupe 1' }));
    value('Pêcheurs mobilisés', '8'); fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le groupe' }));
    expect(current().fishingActivities!.activities[0]!.groups[0]!.id).toBe(groupId);
    expect(screen.getByLabelText('Résumé de l’activité')).toHaveTextContent('144');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le groupe 1' }));
    expect(current().fishingActivities!.activities[0]!.groups).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Conserver le groupe' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Conserver le groupe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le groupe 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    expect(current().fishingActivities!.activities[0]!.groups).toHaveLength(0);
  }, 15000);
  it('allows optional non-net gear and rejects inconsistent input without replacing saved data', () => {
    render(<Harness/>); activity(); add();
    value('Engin principal', 'line');
    expect(screen.queryByLabelText('Taille des mailles (mm)')).not.toBeInTheDocument();
    value('Pêcheurs mobilisés', '0'); const before = current();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le groupe' }));
    expect(screen.getByRole('alert')).toHaveTextContent('des sorties exigent'); expect(current()).toEqual(before);
    value('Pêcheurs mobilisés', '4'); value('Durée moyenne d’une sortie (h)', '48');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le groupe' }));
    expect(current().fishingActivities!.activities[0]!.groups[0]!.gear).toEqual({ category: 'line' });
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    expect(within(screen.getByLabelText('Résumé de l’activité')).getByText(/Données absentes/)).toHaveTextContent('pêche effective');
  });
});
