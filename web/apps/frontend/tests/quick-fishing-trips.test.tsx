import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {conditionsAt,type RunRequest} from '@contracts';
import source from '../../../examples/atelier-interventions-month-v3.json';
import {QuickFishingTrips} from '@/components/simulation/quick-fishing-trips';
import {ConditionsEditor} from '@/components/simulation/conditions-editor';
import {applyFishingPractice,exportPracticeHistory,importPracticeHistory,initializePracticeHistory,normalizeFishingEffort,type FishingPractice} from '@/lib/simulation/fishing-effort';

const fixture=()=>structuredClone(source) as unknown as RunRequest;
function setup(patch:Partial<React.ComponentProps<typeof QuickFishingTrips>>={}){
  const request=fixture(),history=initializePracticeHistory(request.temporal!);
  history.habitualPractice={...history.reference.practice};
  const props={time:3.8,practice:{...history.reference.practice},history,conditions:conditionsAt(request.temporal!,3.8),disabled:false,busy:false,editing:false,onPrepare:vi.fn(),onCustomize:vi.fn(),onApply:vi.fn().mockResolvedValue(true),...patch};
  return {...render(<QuickFishingTrips {...props}/>),props,request};
}
const slider=()=>screen.getByRole('slider',{name:'Fréquence des sorties de pêche'});
const choose=(value:number)=>fireEvent.change(slider(),{target:{value:String(value)}});
const apply=()=>screen.getByRole('button',{name:/^Appliquer/});

describe('Quick decisions reuse the V2 derivation and only submit on Apply',()=>{
  it('pauses before editing with the pointer, keyboard or Habit, without applying',()=>{
    const {props}=setup();fireEvent.pointerDown(slider());expect(props.onPrepare).toHaveBeenCalledOnce();expect(slider()).toHaveValue('4');
    fireEvent.keyDown(slider(),{key:'ArrowRight'});expect(props.onPrepare).toHaveBeenCalledTimes(2);expect(slider()).toHaveValue('5');
    fireEvent.click(screen.getByRole('button',{name:'Habitude'}));expect(props.onPrepare).toHaveBeenCalledTimes(3);expect(props.onApply).not.toHaveBeenCalled();
  });
  it.each([[2,75],[3,112.5],[4,150],[5,187.5],[6,225],[8,300]])('%s weekly trips previews E=%s without an intervention', (trips,E)=>{
    const {props}=setup(),before={practice:structuredClone(props.practice),history:structuredClone(props.history)};
    choose(trips);
    expect(screen.getByLabelText('Sorties choisies')).toHaveTextContent(String(trips));
    expect(screen.getByLabelText('Aperçu de l’effort')).toHaveTextContent(new Intl.NumberFormat('fr-FR').format(E));
    expect(props.onApply).not.toHaveBeenCalled();expect(props.practice).toEqual(before.practice);expect(props.history).toEqual(before.history);
    expect(apply()).toHaveProperty('disabled',trips===4);
  });
  it('submits only the selected frequency, exact native time and the shared history',async()=>{
    const {props}=setup({time:3.800000000000002});choose(8);fireEvent.click(apply());
    expect(props.onApply).toHaveBeenCalledWith(props.time,props.conditions,{...props.practice,tripsPerWeek:8},props.history);
    await waitFor(()=>expect(screen.getByText(/Décision appliquée/)).toBeInTheDocument());
  });
  it('Habit returns to the fixed middle without applying, including after a previous reduction',()=>{
    const r=fixture(),h=initializePracticeHistory(r.temporal!);h.habitualPractice={...h.reference.practice};
    const {props}=setup({history:h,practice:{...h.reference.practice,tripsPerWeek:2}});
    fireEvent.click(screen.getByRole('button',{name:'Habitude'}));expect(slider()).toHaveValue('4');expect(props.onApply).not.toHaveBeenCalled();expect(apply()).toBeEnabled();
  });
  it('keeps a fractional middle exact, uses integer offsets and supports exact endpoints and keys',()=>{
    const r=fixture(),h=initializePracticeHistory(r.temporal!),usual=8/3;h.habitualPractice={...h.reference.practice,tripsPerWeek:usual};
    const {props}=setup({history:h,practice:{...h.reference.practice,tripsPerWeek:usual}});
    expect(Number(slider().getAttribute('max'))).toBe(2*usual);expect(Number((slider() as HTMLInputElement).value)).toBe(usual);
    fireEvent.keyDown(slider(),{key:'ArrowRight'});expect(Number((slider() as HTMLInputElement).value)).toBe(usual+1);
    fireEvent.click(apply());expect(vi.mocked(props.onApply).mock.calls[0]![2].tripsPerWeek).toBe(usual+1);
    fireEvent.keyDown(slider(),{key:'Home'});expect(slider()).toHaveValue('0');fireEvent.keyDown(slider(),{key:'End'});expect(Number((slider() as HTMLInputElement).value)).toBe(2*usual);
  });
  it('drops a draft immediately on a time change and rehydrates the applicable practice',()=>{
    const {props,rerender}=setup();choose(8);rerender(<QuickFishingTrips {...props} time={2} practice={{...props.practice,tripsPerWeek:3}}/>);
    expect(slider()).toHaveValue('3');expect(screen.getByText(/temps consulté a changé/)).toBeInTheDocument();
    fireEvent.click(apply());expect(props.onApply).not.toHaveBeenCalled();expect(screen.getByText('Habituel : 4 sorties/semaine')).toBeInTheDocument();
  });
  it('discards the quick draft when opening the single complete editor',()=>{
    const {props,rerender}=setup();choose(8);fireEvent.click(screen.getByRole('button',{name:'Personnaliser'}));expect(props.onCustomize).toHaveBeenCalledOnce();
    rerender(<QuickFishingTrips {...props} editing/>);rerender(<QuickFishingTrips {...props}/>);
    expect(slider()).toHaveValue('4');expect(screen.getByText(/formulaire complet a été ouvert/)).toBeInTheDocument();
  });
  it('retains a failed draft without changing the applied history',async()=>{
    const {props}=setup({onApply:vi.fn().mockResolvedValue(false)});choose(8);fireEvent.click(apply());
    await waitFor(()=>expect(props.onApply).toHaveBeenCalledOnce());expect(slider()).toHaveValue('8');expect(props.history.records).toEqual([]);
  });
  it.each(['longline','seine'] as const)('preserves all %s fields and custom factors',gearType=>{
    const r=fixture(),h=initializePracticeHistory(r.temporal!);h.habitualPractice={...h.reference.practice};
    h.configuration.motorRelativePower.line.yes=1.4;h.configuration.motorRelativePower.seine.yes=1.7;
    const p:FishingPractice={...h.reference.practice,gearType,motor:'yes',boats:3,tripScope:'perBoat',hooksPerLine:20,lineEffectiveHours:4,haulsPerTrip:2};
    const {props}=setup({history:h,practice:p});choose(6);fireEvent.click(apply());
    const proposed={...p,tripsPerWeek:6};expect(vi.mocked(props.onApply).mock.calls[0]![2]).toEqual(proposed);
    expect(screen.getByLabelText('Aperçu de l’effort').textContent).toBe('E = '+new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(normalizeFishingEffort(proposed,h.reference,props.conditions,h.configuration).modelEffort));
  });
  it('handles zero effort, absent practice, zero habit, busy and invalid configurations',()=>{
    const {props,rerender}=setup();choose(0);expect(screen.getByLabelText('Aperçu de l’effort')).toHaveTextContent('E = 0');expect(apply()).toBeEnabled();
    rerender(<QuickFishingTrips {...props} busy/>);expect(slider()).toBeDisabled();expect(screen.getByRole('button',{name:/Recalcul/})).toBeDisabled();
    rerender(<QuickFishingTrips {...props} practice={undefined}/>);expect(apply()).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('non enregistrée');
    const zero={...props.history,habitualPractice:{...props.practice,tripsPerWeek:0}};
    rerender(<QuickFishingTrips {...props} history={zero}/>);expect(slider()).toBeDisabled();expect(apply()).toBeDisabled();expect(screen.getByRole('button',{name:'Personnaliser'})).toBeEnabled();
    const invalid=structuredClone(props.history);invalid.configuration.id='';rerender(<QuickFishingTrips {...props} history={invalid}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Configuration');expect(apply()).toBeDisabled();
  });
  it('uses the shared engine bounds',()=>{
    const {props,rerender}=setup();const p={...props.practice,boats:100,tripScope:'perBoat' as const};rerender(<QuickFishingTrips {...props} practice={p}/>);
    expect(apply()).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('10000');
  });
});

it('stores a confirmed habit separately from scientific normalization, keeps it across decisions and V2/V1 restores',()=>{
  const request=fixture(),h=initializePracticeHistory(request.temporal!),p={...h.reference.practice,tripsPerWeek:5};h.habitualPractice=p;
  const first=applyFishingPractice(request,3.8,conditionsAt(request.temporal!,3.8),{...p,tripsPerWeek:8},h);
  const second=applyFishingPractice(first.request,10.3,conditionsAt(first.request.temporal!,10.3),p,first.history);
  expect(second.history.habitualPractice).toEqual(p);expect(second.history.reference).toEqual(h.reference);
  const text=exportPracticeHistory(second.request,second.history);expect(JSON.parse(text).version).toBe(2);
  expect(importPracticeHistory(text,second.request).habitualPractice).toEqual(p);expect(second.request).not.toHaveProperty('habitualPractice');
  const old=JSON.parse(exportPracticeHistory(request,initializePracticeHistory(request.temporal!)));old.version=1;delete old.history.configuration;
  expect(importPracticeHistory(JSON.stringify(old),request).habitualPractice).toBeUndefined();
});

it('confirms the initial habit only in the existing editor and never overwrites an established habit',()=>{
  const request=fixture(),h=initializePracticeHistory(request.temporal!),onApply=vi.fn();
  const props={experiment:request.temporal!,request,history:h,time:0,scientific:false,busy:false,onApply,onCancel:vi.fn()};
  const first=render(<ConditionsEditor {...props}/>);fireEvent.change(screen.getByLabelText('Sorties par semaine'),{target:{value:'5'}});fireEvent.submit(screen.getByRole('form'));
  expect(onApply.mock.calls[0]![2].habitualPractice.tripsPerWeek).toBe(5);expect(h.habitualPractice).toBeUndefined();first.unmount();
  h.habitualPractice={...h.reference.practice};render(<ConditionsEditor {...props}/>);fireEvent.change(screen.getByLabelText('Sorties par semaine'),{target:{value:'8'}});fireEvent.submit(screen.getByRole('form'));
  expect(onApply.mock.calls[1]![2].habitualPractice.tripsPerWeek).toBe(4);
});
