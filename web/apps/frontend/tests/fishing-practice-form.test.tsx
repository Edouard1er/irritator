import React from 'react';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {conditionsAt,type RunRequest} from '@contracts';
import source from '../../../examples/atelier-interventions-month-v3.json';
import {ConditionsEditor} from '@/components/simulation/conditions-editor';
import {applyFishingPractice,initializePracticeHistory,type PracticeHistory} from '@/lib/simulation/fishing-effort';
const fixture=()=>structuredClone(source) as unknown as RunRequest;
function start(request=fixture(),history:PracticeHistory=initializePracticeHistory(request.temporal!),scientific=false,busy=false){
  const onApply=vi.fn(),onCancel=vi.fn();return {...render(<ConditionsEditor request={request} experiment={request.temporal!} history={history} time={3.8} scientific={scientific} busy={busy} onApply={onApply} onCancel={onCancel}/>),request,history,onApply,onCancel};
}
const change=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}});
describe('Fishing practice in the existing inline conditions editor (UI-01–07)',()=>{
  it('preserves rain, salinity, access and exposes live model effort as an output, never an input',()=>{
    start();expect(screen.getByLabelText('Sorties par semaine')).toHaveValue(4);for(const label of ['Pluie','Salinité','Accessibilité'])expect(screen.getByLabelText(label,{exact:true})).toBeInTheDocument();
    const output=screen.getByLabelText('Effort calculé pour le modèle');expect(output.tagName).toBe('OUTPUT');expect(output).toHaveTextContent('150 unités d’effort du modèle');
    expect(screen.queryByLabelText('Effort souhaité')).not.toBeInTheDocument();expect(screen.queryByText('Composition des pirogues')).not.toBeInTheDocument();
    change('Sorties par semaine','8');expect(output).toHaveTextContent('300');expect(screen.getByText(/× 2 par rapport/)).toBeInTheDocument();
    change('Longueur de chaque filet (m)','25');expect(output).toHaveTextContent('150');change('Durée d’immersion (h par sortie)','8');expect(output).toHaveTextContent('300');
  });
  it('retains hidden gear answers, requires dedicated line hours, retains hidden answers and standardizes supported gears',()=>{
    const {onApply}=start();change('Longueur de chaque filet (m)','60');change('Engin principal','longline');
    expect(screen.queryByLabelText('Longueur de chaque filet (m)')).not.toBeInTheDocument();expect(screen.getByLabelText('Hameçons par ligne')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Durée effective');expect(screen.getByRole('button',{name:/Appliquer/})).toBeDisabled();
    fireEvent.submit(screen.getByRole('form'));expect(onApply).not.toHaveBeenCalled();
    change('Durée effective d’utilisation des lignes (h par sortie)','4');change('Hameçons par ligne','20');expect(screen.getByLabelText('Effort calculé pour le modèle')).toHaveTextContent('120');
    change('Engin principal','seine');expect(screen.getByLabelText('Opérations par senne et par sortie')).toBeInTheDocument();expect(screen.queryByLabelText('Durée d’immersion (h par sortie)')).not.toBeInTheDocument();
    change('Engin principal','other');change('Nom local de l’engin','Engin local');expect(screen.getByRole('alert')).toHaveTextContent('règle validée');
    change('Engin principal','gillnet');expect(screen.getByLabelText('Longueur de chaque filet (m)')).toHaveValue(60);expect(screen.getByRole('button',{name:/Appliquer/})).toBeEnabled();
  });
  it('treats empty, zero duration, unknown units and engine bounds explicitly; busy never submits',()=>{
    const {onApply}=start();change('Sorties par semaine','');expect(screen.getByRole('button',{name:/Appliquer/})).toBeDisabled();expect(screen.getByLabelText('Effort calculé pour le modèle')).toHaveTextContent('Non calculable');
    change('Sorties par semaine','1000');expect(screen.getByRole('alert')).toHaveTextContent('10000');change('Sorties par semaine','0');expect(screen.getByRole('button',{name:/Appliquer/})).toBeEnabled();
    change('Durée d’une sortie (h)','0');fireEvent.submit(screen.getByRole('form'));expect(onApply).not.toHaveBeenCalled();
  });
  it('cancels without applying; a fresh open restores the actual applied values and environment',()=>{
    const request=fixture(),before=JSON.stringify(request),first=start(request);change('Sorties par semaine','8');change('Pluie','7');fireEvent.click(screen.getByRole('button',{name:'Annuler'}));
    expect(first.onApply).not.toHaveBeenCalled();expect(first.onCancel).toHaveBeenCalledOnce();expect(JSON.stringify(request)).toBe(before);first.unmount();
    const second=start(request);expect(screen.getByLabelText('Sorties par semaine')).toHaveValue(4);change('Sorties par semaine','8');fireEvent.submit(screen.getByRole('form'));
    const [p,practice,history]=second.onApply.mock.calls[0]!;const applied=applyFishingPractice(request,3.8,p,practice,history);expect(applied.request.temporal!.interventions[0]!.time).toBe(3.8);second.unmount();
    start(applied.request,applied.history);expect(screen.getByLabelText('Sorties par semaine')).toHaveValue(8);expect(screen.getByLabelText('Effort calculé pour le modèle')).toHaveTextContent('300');
  });
  it('keeps scientific conditions available and refuses submission during recalculation',()=>{
    const {onApply}=start(fixture(),undefined,true,true);expect(screen.getByLabelText('Influence de la pluie βp')).toBeDisabled();
    expect(screen.getByLabelText('Nombre de pirogues')).toBeDisabled();fireEvent.submit(screen.getByRole('form'));expect(onApply).not.toHaveBeenCalled();
  });
  it('states reference convention, nominal unit, sidecar export limitation and technical allocation distinction',()=>{
    const {container}=start();expect(container.querySelector('.practice-result')).toHaveTextContent('6 933,33 m·h/mois');
    const details=container.querySelector('details')!;expect(within(details).getByText(/convention explicite initialise/)).toBeInTheDocument();expect(details).toHaveTextContent('50/30/20');expect(details).toHaveTextContent('fichier annexe');
    change('Unité des mailles','cm');expect(screen.getByRole('alert')).toHaveTextContent('Vérifier la taille et l’unité des mailles');expect(screen.getByRole('button',{name:/Appliquer/})).toBeDisabled();change('Taille des mailles','4.6');expect(screen.getByLabelText('Effort calculé pour le modèle')).toHaveTextContent('150');
  });
});

it('rounds only the visible weekly frequency and submits the exact stored value',()=>{
  const r=fixture(),h=initializePracticeHistory(r.temporal!);const applied=applyFishingPractice(r,3.8,conditionsAt(r.temporal!,3.8),{...h.reference.practice,tripsPerWeek:8/3},h);
  const {onApply}=start(applied.request,applied.history);expect(screen.getByLabelText('Sorties par semaine')).toHaveValue(2.666667);
  fireEvent.submit(screen.getByRole('form'));expect(onApply.mock.calls[0]![1].tripsPerWeek).toBe(8/3);
});
it('keeps mesh and motor factors visible in scientific view and numeric decomposition in details',()=>{
  const {container}=start(fixture(),undefined,true);change('Type de pirogue','yes');change('Taille des mailles','35');
  expect(screen.getByLabelText('Effort calculé pour le modèle')).toHaveTextContent('162');
  expect(container.querySelector('.practice-result')).toHaveTextContent('1 × 1,2 × 0,9');
  expect(container.querySelector('details')).toHaveTextContent('hypotheses_de_scenario_a_valider');
  expect(container.querySelector('details')).toHaveTextContent('biomasse agrégée, sans classes de tailles');
});
