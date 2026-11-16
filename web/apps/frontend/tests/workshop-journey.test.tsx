import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LevelTwoJourney } from '@/components/workshop/level-two-journey';
import { decisionsStorageKey, parseSession } from '@/lib/serialization/workshop-session';
import model from '../../../examples/atelier-interventions-month-v3.json';
import type { RunRequest } from '@contracts';
const request = model as unknown as RunRequest;
function mount() { return render(<LevelTwoJourney request={request} busy={false} territory={() => <p>Carte existante</p>} simulation={active => active && <p>Résultat du moteur</p>} onRun={vi.fn()} onAudience={vi.fn()}/>); }
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const navigate = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Étapes de l’atelier' })).getByRole('button', { name: new RegExp(name) }));
function prepare() { click('Scientifique'); fireEvent.click(screen.getByRole('checkbox', { name: /Je confirme/ })); fireEvent.change(screen.getByLabelText('Code participant (pseudonyme)'), { target: { value: 'P-01' } }); navigate('Votre premier choix'); }
beforeEach(() => { localStorage.clear(); vi.spyOn(window, 'confirm').mockReturnValue(true); });
it('demonstrates all six steps without persisting or exporting individual answers', () => {
  mount(); navigate('Votre premier choix'); expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  navigate('Voyons ce qui se passe'); expect(screen.getByText('Support de discussion')).toBeVisible(); navigate('Votre choix maintenant'); navigate('Ce qu');
  expect(localStorage.getItem(decisionsStorageKey)).toBeNull(); expect(screen.queryByRole('button', { name: 'Exporter les réponses de l’atelier' })).not.toBeInTheDocument();
});
it('guards exposure and D2, preserves drafts and records explicit discussion before D2', () => {
  mount(); prepare(); expect(within(screen.getByRole('navigation', { name: 'Étapes de l’atelier' })).getByRole('button', { name: /Votre choix maintenant/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: 'Rechercher plus d’informations' })); fireEvent.change(screen.getByLabelText('Pourquoi ce choix ? (facultatif)'), { target: { value: 'À vérifier' } });
  navigate('Notre lac'); navigate('Votre premier choix'); expect(screen.getByLabelText('Pourquoi ce choix ? (facultatif)')).toHaveValue('À vérifier'); expect(screen.queryByText('Résultat du moteur')).not.toBeInTheDocument();
  click('Enregistrer mon premier choix'); expect(parseSession(localStorage.getItem(decisionsStorageKey)!).records[0]!.presentation).toBeUndefined();
  click('Confirmer que ce support a été présenté'); expect(screen.getByText('Après la discussion')).toBeVisible(); fireEvent.click(screen.getByRole('radio', { name: 'Réduire les sorties' })); click('Enregistrer mon choix maintenant');
  const saved = parseSession(localStorage.getItem(decisionsStorageKey)!); expect(saved.records[0]!.after?.choiceId).toBe('reduce-trips'); expect(saved.records[0]!.before.reasons).toBe('À vérifier');
  click('Afficher la restitution anonyme'); click('Revenir à la carte');
  expect(screen.getByRole('group', { name: 'Lecture de l’atelier' })).toBeVisible();
  navigate('Votre premier choix'); expect(screen.getByRole('radio', { name: 'Rechercher plus d’informations' })).toBeDisabled();
  click('Nouvel essai chaîné'); fireEvent.click(screen.getByRole('radio', { name: 'Continuer comme d’habitude' })); click('Enregistrer mon premier choix');
  expect(parseSession(localStorage.getItem(decisionsStorageKey)!).records[1]!.attemptsPreviousId).toBe(saved.records[0]!.id);
});
it('cannot attest a native simulation without an actual result', () => {
  mount(); prepare(); fireEvent.click(screen.getByRole('radio', { name: 'Je ne sais pas' })); click('Enregistrer mon premier choix');
  fireEvent.change(screen.getByLabelText('Support à présenter'), { target: { value: 'native-simulation' } }); expect(screen.getByRole('button', { name: 'Confirmer que ce support a été présenté' })).toBeDisabled();
});
it.each(['S2-reserve', 'S3-couts'])('keeps %s discussion-only', scenarioId => {
  mount(); prepare(); fireEvent.change(screen.getByLabelText('Situation de discussion'), { target: { value: scenarioId } }); fireEvent.click(screen.getByRole('radio', { name: 'Je ne sais pas' })); click('Enregistrer mon premier choix');
  expect(screen.queryByRole('option', { name: 'Simulation calculée par Irritator' })).not.toBeInTheDocument(); click('Confirmer que ce support a été présenté'); expect(screen.getByText('Après la discussion')).toBeVisible();
});
it('preserves an unreadable local archive until explicit replacement', () => {
  localStorage.setItem(decisionsStorageKey, '{broken'); mount(); prepare(); click('Restaurer la séance locale');
  fireEvent.click(screen.getByRole('radio', { name: 'Je ne sais pas' })); click('Enregistrer mon premier choix'); expect(localStorage.getItem(decisionsStorageKey)).toBe('{broken');
  expect(screen.getByRole('alert')).toHaveTextContent('sauvegarde illisible');
});
it('keeps a quota error visible after moving to presentation and keeps the in-memory first choice', () => {
  mount(); prepare(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  fireEvent.click(screen.getByRole('radio', { name: 'Je ne sais pas' })); click('Enregistrer mon premier choix');
  expect(screen.getByRole('alert')).toHaveTextContent('Sauvegarde locale impossible');
  expect(screen.getByRole('button', { name: 'Confirmer que ce support a été présenté' })).toBeEnabled();
});
