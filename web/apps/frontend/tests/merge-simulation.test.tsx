import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {applyTerritorialZone,conditionsAt,type RunRequest} from '@contracts';
import {SimulationWorkspace} from '@/components/simulation/simulation-workspace';
import {territoryDemo} from '@/lib/modeling/territory-demo';
import {runSimulation,type HttpResult} from '@/lib/api/client';
import source from '../../../examples/atelier-interventions-month-v3.json';

const {audioCreated,audioStarted}=vi.hoisted(()=>({audioCreated:vi.fn(),audioStarted:vi.fn()}));
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
vi.mock('@/components/panels/results-panel',()=>({ResultsPanel:()=>null}));
vi.mock('@/lib/api/client',async importOriginal=>({...await importOriginal<typeof import('@/lib/api/client')>(),runSimulation:vi.fn()}));
vi.mock('@/lib/simulation/alert-audio',()=>({AlertAudio:class {
  context={state:'running',resume:async()=>{}};
  constructor(){audioCreated();}
  start=audioStarted;stop=vi.fn();close=vi.fn();volume=vi.fn();
}}));

const fixture=()=>structuredClone(source) as unknown as RunRequest;
function result(request:RunRequest):HttpResult {
  return {schemaVersion:2,runId:'merge-regression-fictional-run',status:'completed',modelId:request.model.id,
    simulation:{start:0,end:3,finalTime:3,runCalls:3},
    observations:[
      {component:'lake/N',samplingInterval:1,samples:[{time:0,value:150},{time:1,value:120},{time:3,value:140}]},
      {component:'lake/C',samplingInterval:1,samples:[{time:0,value:0},{time:1,value:12},{time:3,value:20}]},
    ],resultEvents:[],wrappers:[],diagnostics:{engineVersion:'unit-test-only',adapterVersion:'unit-test-only',observationPolicy:'native'}};
}
beforeEach(()=>{
  localStorage.clear();vi.clearAllMocks();
  vi.stubGlobal('AudioContext',class {});
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('keeps territorial access and the observation cursor when full and quick fishing decisions recalculate effort',async()=>{
  const request=applyTerritorialZone(fixture(),structuredClone(territoryDemo),'demo-A');
  const initialResult=result(request),onIntervention=vi.fn();
  vi.mocked(runSimulation).mockResolvedValue(initialResult);
  const props={request,result:initialResult,status:'Terminé',stale:false,active:true,sessionId:'merge-session',onIntervention};
  const view=render(<SimulationWorkspace {...props}/>);
  const zone=screen.getByLabelText('Zone appliquée aux observations');
  expect(zone).toHaveTextContent('Zone fictive A');
  expect(zone).toHaveTextContent('15 t');
  expect(screen.getByLabelText('Effort du modèle appliqué')).toHaveTextContent('150');
  expect(screen.getByRole('slider',{name:'Fréquence des sorties de pêche'})).toBeEnabled();

  fireEvent.change(screen.getByLabelText('Position temporelle'),{target:{value:'1'}});
  expect(zone).toHaveTextContent('12 t');
  fireEvent.click(screen.getByRole('button',{name:'Modifier mes pratiques'}));
  const form=screen.getByRole('form',{name:'Conditions de l’intervention'});
  expect(within(form).getByLabelText('Accessibilité',{exact:true})).toBeDisabled();
  expect(within(form).getByLabelText('Accessibilité',{exact:true})).toHaveValue('10');
  expect(within(form).getByLabelText('Turbidité',{exact:true})).toBeEnabled();
  fireEvent.change(within(form).getByLabelText('Sorties par semaine'),{target:{value:'8'}});
  fireEvent.change(within(form).getByLabelText('Pluie',{exact:true}),{target:{value:'7'}});
  fireEvent.submit(form);
  await waitFor(()=>expect(onIntervention).toHaveBeenCalledOnce());
  const applied=onIntervention.mock.calls[0]![0] as RunRequest;
  expect(conditionsAt(applied.temporal!,1)).toMatchObject({E:300,a:.1,P:7});
  expect(applied.territory).toEqual(request.territory);
  expect(request.temporal!.interventions).toEqual([]);

  view.rerender(<SimulationWorkspace {...props} request={applied}/>);
  expect(screen.getByLabelText('Position temporelle')).toHaveValue('1');
  expect(screen.getByLabelText('Effort du modèle appliqué')).toHaveTextContent('300');
  expect(screen.getByLabelText('Zone appliquée aux observations')).toHaveTextContent('12 t');
  expect(screen.getByRole('slider',{name:'Fréquence des sorties de pêche'})).toHaveValue('8');
  fireEvent.change(screen.getByRole('slider',{name:'Fréquence des sorties de pêche'}),{target:{value:'2'}});
  const quick=screen.getByRole('region',{name:'Ajuster mes sorties de pêche'});
  fireEvent.click(within(quick).getByRole('button',{name:/^Appliquer/}));
  await waitFor(()=>expect(onIntervention).toHaveBeenCalledTimes(2));
  const quickApplied=onIntervention.mock.calls[1]![0] as RunRequest;
  expect(conditionsAt(quickApplied.temporal!,1)).toMatchObject({E:75,a:.1,P:7});
  expect(quickApplied.territory).toEqual(request.territory);
  expect(quickApplied.temporal!.interventions.filter(row=>row.time===1&&row.parameter==='E')).toHaveLength(1);
});

it('leaves access editable for a simulation without a confirmed territory',()=>{
  const request=fixture();
  render(<SimulationWorkspace request={request} result={result(request)} status="Terminé" stale={false} active onIntervention={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Modifier mes pratiques'}));
  expect(screen.getByLabelText('Accessibilité',{exact:true})).toBeEnabled();
});

it('keeps guided native readings synchronized and silent with a temporal fishing scenario',async()=>{
  const request=applyTerritorialZone(fixture(),structuredClone(territoryDemo),'demo-A');
  render(<SimulationWorkspace request={request} result={result(request)} status="Terminé" stale={false} active preferenceScope="level-one" guided={{scientific:false,reference:<p>Carte publique de test</p>}} onIntervention={vi.fn()}/>);
  expect(screen.getByLabelText('Présentation animée native')).toBeVisible();
  expect(screen.getByText('Carte publique de test')).toBeVisible();
  expect(screen.queryByRole('button',{name:'Modifier mes pratiques'})).not.toBeInTheDocument();
  expect(screen.queryByRole('slider',{name:'Fréquence des sorties de pêche'})).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Son des alertes')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Observation suivante'}));
  expect(screen.getByLabelText('Quantité totale observée')).toHaveAttribute('data-value','120');
  expect(document.querySelector('[data-native-cursor]')).toHaveAttribute('data-value','120');
  expect(screen.getByLabelText('Position temporelle')).toHaveValue('1');
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Reprendre'}));});
  expect(screen.getByRole('button',{name:'Pause'})).toBeVisible();
  expect(audioCreated).not.toHaveBeenCalled();expect(audioStarted).not.toHaveBeenCalled();
  expect(runSimulation).not.toHaveBeenCalled();
});
