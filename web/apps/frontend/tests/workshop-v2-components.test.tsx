import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SimulationWorkspace } from '@/components/simulation/simulation-workspace';
import { BiomassLake } from '@/components/simulation/biomass-lake';
import { workshopFixture } from './workshop-fixture';
import monthly from '../../../examples/atelier-schaefer-month-v3.json';
import type { RunRequest } from '@contracts';
const { starts,stops,closes }=vi.hoisted(()=>({starts:vi.fn(),stops:vi.fn(),closes:vi.fn()}));
vi.mock('next/dynamic',()=>({default:()=>()=> <div/>}));
vi.mock('@/components/panels/results-panel',()=>({ResultsPanel:()=> <div/>}));
vi.mock('@/lib/simulation/alert-audio',()=>({AlertAudio:class {context={state:'running',resume:async()=>{}};start=starts;stop=stops;close=closes;volume=vi.fn();}}));
beforeEach(()=>{
  localStorage.clear();starts.mockClear();stops.mockClear();closes.mockClear();
  vi.stubGlobal('AudioContext',class {});
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  Object.defineProperty(window,'matchMedia',{writable:true,value:()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D);
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function start(){const f=workshopFixture();f.request=structuredClone(monthly) as unknown as RunRequest;return {...f,...render(<SimulationWorkspace {...f} status="Terminé" stale={false} active/>)};}
describe('Synchronized workshop dashboard',()=>{
  it('arms above the threshold, remains silent until critical, and persists an explicit mute',async()=>{
    const view=start();expect(screen.getByLabelText('Son des alertes')).toBeChecked();
    expect(screen.queryByRole('heading',{name:'Où en est la ressource ?'})).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Seuil choisi pour l’atelier',{exact:true}),{target:{value:'140'}});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Lancer la simulation'}));});expect(starts).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Seuil choisi pour l’atelier',{exact:true}),{target:{value:'220'}});expect(starts).toHaveBeenCalledWith('critical_crossed',.25);
    const before=stops.mock.calls.length;fireEvent.change(screen.getByLabelText('Seuil choisi pour l’atelier',{exact:true}),{target:{value:'100'}});expect(stops.mock.calls.length).toBeGreaterThan(before);expect(starts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Son des alertes'));expect(localStorage.getItem('irritator-alert-sound')).toBe('off');
    view.unmount();start();expect(screen.getByLabelText('Son des alertes')).not.toBeChecked();
    await act(async()=>{fireEvent.click(screen.getByLabelText('Son des alertes'));});expect(screen.getByLabelText('Son des alertes')).toBeChecked();expect(localStorage.getItem('irritator-alert-sound')).toBe('on');
  });
  it('keeps three indicators and fish count on the same selected observation',()=>{
    const {container}=start();expect(container.querySelector('canvas')).toHaveAttribute('data-fish-count','22');
    fireEvent.change(screen.getByLabelText('Position temporelle'),{target:{value:'3'}});
    expect(container.querySelector('canvas')).toHaveAttribute('data-fish-count','14');
    expect(container.querySelector('[data-biomass]')).toHaveAttribute('data-biomass','139');
    const metrics=container.querySelectorAll('.metric-card');expect(metrics[0]).toHaveTextContent('139 t');expect(metrics[1]).toHaveTextContent('30 t');expect(metrics[2]).toHaveTextContent('Non disponible');expect(metrics[2]).toHaveTextContent('12 mois complets');
    fireEvent.change(screen.getByLabelText('Position temporelle'),{target:{value:'0'}});expect(container.querySelector('canvas')).toHaveAttribute('data-fish-count','22');
  });
  it.each([50,100,150,158.6,200,300,600])('renders %s tonnes without a DOM node per fish',value=>{
    const ellipse=vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype,'getBoundingClientRect').mockReturnValue({width:600,height:300} as DOMRect);
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({setTransform(){},clearRect(){},save(){},translate(){},scale(){},beginPath(){},ellipse,fill(){},moveTo(){},lineTo(){},closePath(){},arc(){},restore(){}} as unknown as CanvasRenderingContext2D);
    const {container}=render(<BiomassLake value={value} unit="t" maximum={700} playing={false} reduced state="favorable"/>);
    expect(screen.getByRole('img')).toHaveAttribute('data-fish-count',String(Math.round(value/10)));expect(container.querySelectorAll('canvas')).toHaveLength(1);expect(container.querySelectorAll('svg')).toHaveLength(0);
    expect(ellipse).toHaveBeenCalledTimes(Math.round(value/10));
  });
  it('preserves scenario and time through fallback presentation and Escape',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);start();
    fireEvent.change(screen.getByLabelText('Position temporelle'),{target:{value:'3'}});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Grand écran'}));});
    expect(screen.getByRole('button',{name:'Quitter le grand écran'})).toBeVisible();expect(screen.getByLabelText('Position temporelle')).toHaveValue('3');
    fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('button',{name:'Grand écran'})).toBeVisible();expect(screen.getByLabelText('Position temporelle')).toHaveValue('3');expect(fetcher).not.toHaveBeenCalled();
  });
  it('defaults to enabled and stops continuous red on pause, mute, seek, scenario, exit and hidden tab',async()=>{
    vi.useFakeTimers();const view=start();
    fireEvent.change(screen.getByLabelText('Seuil choisi pour l’atelier',{exact:true}),{target:{value:'230'}});
    expect(screen.getByLabelText('Son des alertes')).toBeChecked();
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Lancer la simulation'}));});
    expect(starts).toHaveBeenCalledWith('critical_crossed',.25);const count=starts.mock.calls.length;
    act(()=>vi.advanceTimersByTime(5000));expect(starts).toHaveBeenCalledTimes(count); // Same critical state: one continuous voice.
    fireEvent.click(screen.getByRole('button',{name:'Pause'}));const stopped=stops.mock.calls.length;expect(stopped).toBeGreaterThan(0);
    act(()=>vi.advanceTimersByTime(10000));expect(starts).toHaveBeenCalledTimes(count);
    fireEvent.click(screen.getByRole('button',{name:'Reprendre'}));expect(starts).toHaveBeenCalledTimes(count+1);
    fireEvent.click(screen.getByRole('button',{name:'Arrêter l’alarme'}));expect(screen.getByLabelText('Son des alertes')).not.toBeChecked();expect(stops.mock.calls.length).toBeGreaterThan(stopped);
    await act(async()=>{fireEvent.click(screen.getByLabelText('Son des alertes'));});
    fireEvent.change(screen.getByLabelText('Position temporelle'),{target:{value:'2'}});expect(screen.getByRole('button',{name:'Reprendre'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Reprendre'}));
    Object.defineProperty(document,'hidden',{configurable:true,value:true});fireEvent(document,new Event('visibilitychange'));expect(screen.getByRole('button',{name:'Reprendre'})).toBeVisible();
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    fireEvent.change(screen.getByLabelText('Situation simulée'),{target:{value:'prospectives:1:1'}});expect(closes).toHaveBeenCalled();expect(screen.getByLabelText('Son des alertes')).toBeChecked();
    view.rerender(<SimulationWorkspace result={view.result} request={view.request} status="Terminé" stale={false} active={false}/>);expect(stops).toHaveBeenCalled();
  });
});
