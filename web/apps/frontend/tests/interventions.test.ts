import {describe,it,expect} from 'vitest';
import {compileTemporal,composeFleet,conditionsAt,defaultConditions,fleetEffort,intervene,nativeRequest,ratesAt,seasonAt,validateConditions,validateRequest,type RunRequest} from '@contracts';
import source from '../../../examples/atelier-interventions-month-v3.json';
import legacy from '../../../examples/atelier-schaefer-month-v3.json';
import {monthlyCatches} from '@/lib/simulation/monthly';
import {serializeModel,validateEditorDocument,initialViewport} from '@/lib/modeling/model';
import {interactiveRequest} from '@/lib/simulation/interactive';
import type {Trajectory} from '@/lib/simulation/trajectory';
const fixture=()=>structuredClone(source) as unknown as RunRequest;
describe('Temporal model and exact fleet composition',()=>{
  it.each([[0,1,'Printemps'],[2.999,3,'Printemps'],[3,4,'Été'],[6,7,'Automne'],[9,10,'Hiver'],[12,1,'Printemps'],[15,4,'Été'],[25,2,'Printemps']] as const)('calendar at %s', (time,month,name)=>{expect(seasonAt(time)).toMatchObject({month,name});});
  it('computes salinity growth and signed precipitation influence',()=>{
    const p={...defaultConditions,S:5,Sopt:3,ks:.2,P:8,betaP:-.5};
    expect(ratesAt(p,3).r).toBeCloseTo(.35*Math.exp(-.8),14);
    expect(ratesAt(p,3).q).toBeCloseTo(.001*Math.exp(-.4),14);
    expect(ratesAt({...p,betaP:0},3).q).toBe(.001);expect(ratesAt({...p,betaP:.5},3).q).toBeGreaterThan(.001);
  });
  it.each(['S','P','Sopt'] as const)('validates %s index in [0,10]',key=>{expect(()=>validateConditions({...defaultConditions,[key]:10.01})).toThrow();expect(()=>validateConditions({...defaultConditions,[key]:-.1})).toThrow();expect(()=>validateConditions({...defaultConditions,[key]:NaN})).toThrow();});
  it('selects 2 large, 1 medium and 1 small for balanced E=150',()=>{expect(composeFleet(150)).toEqual({counts:[2,1,1],utilization:[1,1,1]});expect(fleetEffort(composeFleet(150))).toBe(150);expect(composeFleet(150,'minimum').counts).toEqual([3,0,0]);});
  it.each([0,1,10,17,150.7,157,990,10000])('represents exact effort %s with utilization rates',e=>{for(const mode of ['balanced','minimum'] as const)expect(fleetEffort(composeFleet(e,mode))).toBeCloseTo(e,8);});
  it('configurable contribution targets change balanced composition',()=>{expect(composeFleet(150,'balanced',[0,1,0]).counts).toEqual([0,5,0]);expect(()=>composeFleet(150,'balanced',[.5,.5,.5])).toThrow();});
  it('round trips v3 temporal metadata and exports a native dated DEVS graph',()=>{
    const r=fixture(),before=JSON.stringify(r);validateRequest(r);validateEditorDocument(r);
    expect(serializeModel({request:r,positions:{},viewport:initialViewport})).toEqual(r);
    const compiled=nativeRequest(r);validateRequest(compiled);expect(compiled.temporal).toBeUndefined();
    expect(compiled.model.definitions![0]!.components.filter(c=>c.type==='constant').map(c=>c.parameters.offset)).toEqual(expect.arrayContaining([0,3,6,9,12,15,18,21]));
    expect(JSON.stringify(r)).toBe(before);expect(compileTemporal(legacy as unknown as RunRequest)).toEqual(legacy);
  });
  it('simultaneous values form one deterministic event snapshot; future choices are retained and rebased',()=>{
    let r=fixture();r=intervene(r,10,{...conditionsAt(r.temporal!,10),E:80,P:7},composeFleet(80),'balanced',[.6,.25,.15]);
    r=intervene(r,3,{...conditionsAt(r.temporal!,3),E:157},composeFleet(157),'balanced',[.6,.25,.15]);validateRequest(r);
    expect(conditionsAt(r.temporal!,2).E).toBe(150);expect(conditionsAt(r.temporal!,3).E).toBe(157);expect(conditionsAt(r.temporal!,10).E).toBe(80);
    expect(r.temporal!.interventions.filter(x=>x.parameter==='E').map(x=>[x.time,x.oldValue,x.newValue])).toEqual([[3,150,157],[10,157,80]]);
    r=intervene(r,10,{...conditionsAt(r.temporal!,10),P:4},composeFleet(80),'balanced',[.6,.25,.15]);validateRequest(r);expect(r.temporal!.interventions.filter(x=>x.time===10&&x.parameter==='P')).toHaveLength(1);
  });
  it('rejects duplicate decisions, incorrect previous values and horizon endpoint',()=>{
    const r=intervene(fixture(),10,{...defaultConditions,E:80},composeFleet(80),'balanced',[.6,.25,.15]);
    const bad=structuredClone(r);bad.temporal!.interventions[0]!.oldValue=99;expect(()=>validateRequest(bad)).toThrow(/Ancienne valeur/);
    r.temporal!.interventions.push({...r.temporal!.interventions[0]!});expect(()=>validateRequest(r)).toThrow(/seul changement/);
    expect(()=>validateRequest(intervene(fixture(),24,{...defaultConditions,E:80},composeFleet(80),'balanced',[.6,.25,.15]))).toThrow(/borne finale/);
  });
  it('requires exact monthly cumulative endpoints and never invents a partial month',()=>{
    expect(monthlyCatches([{time:0,value:0},{time:1,value:10},{time:2,value:23}],2.9)).toEqual([{month:1,value:10},{month:2,value:13}]);
    expect(monthlyCatches([{time:0,value:0},{time:1.01,value:10},{time:2,value:23}],2).map(x=>x.value)).toEqual([undefined,undefined]);
    expect(monthlyCatches([{time:0,value:10},{time:1,value:9}],1)[0]!.value).toBeUndefined();
    expect(monthlyCatches([{time:0,value:0},{time:.5,value:8},{time:.6,value:3},{time:1,value:10}],1)[0]!.value).toBeUndefined();
    expect(monthlyCatches([{time:0,value:-1},{time:1,value:10}],1)[0]!.value).toBeUndefined();
  });
  it('isolates intervention targets and treats simultaneous parameters as one snapshot',()=>{
    const r=intervene(fixture(),10,{...defaultConditions,P:6,S:7,E:157},composeFleet(157),'balanced',[.6,.25,.15]);
    const reordered=structuredClone(r);reordered.temporal!.interventions.reverse();validateRequest(reordered);expect(compileTemporal(reordered)).toEqual(compileTemporal(r));
    r.model.components.push({id:'other',type:'simulation_wrapper',parameters:{}});expect(()=>validateRequest(r)).toThrow();
  });
  it('isolates the actual selected scenario when activating an interactive experiment',()=>{
    const r=interactiveRequest(legacy as unknown as RunRequest,{id:'prospectives:1:2',units:legacy.model.definitions[0]!.units,parameters:{r:.35,q:.0008,a:1,E:150,K:300,'B0/N0':150},series:[{kind:'biomass_total',points:[{time:0,value:150},{time:20,value:160}]}]} as unknown as Trajectory);
    validateRequest(r);expect(r.temporal!.scenario).toBe('prospectives:1:2');expect(r.temporal!.parameters).toMatchObject({E:150,q0:.0008});expect(r.model.components).toHaveLength(1);expect(r.simulation.end).toBe(20);
  });
});
