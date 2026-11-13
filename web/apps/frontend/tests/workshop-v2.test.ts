import { describe, it, expect } from 'vitest';
import { attachResultUnits, convertDuration, convertRate, nativeRequest, validateRequest, type RunRequest } from '@contracts';
import monthly from '../../../examples/atelier-schaefer-month-v3.json';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import { resultCsv, scenarioTrajectoryCsv } from '@/lib/serialization/csv';
import { normalizeRun } from '@/lib/simulation/trajectory';
import { fishCount, rollingCatch, scenarioLabel } from '@/lib/simulation/indicators';
import { workshopFixture } from './workshop-fixture';
const request=()=>structuredClone(monthly) as unknown as RunRequest;
describe('Structured physical units',()=>{
  it('loads, validates, exports and restores complete units without changing coefficients',()=>{
    const r=request();validateRequest(r);
    expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(r))))).toEqual(r);
    const stripped=nativeRequest(r);expect(stripped.model.units).toBeUndefined();expect(stripped.model.definitions![0]!.units).toBeUndefined();
    expect(stripped.model.definitions![0]!.components.find(c=>c.id==='r')!.parameters.value).toBe(.35);
    expect(r.model.definitions![0]!.units!.provenance.basis).toBe('workshop-convention');
  });
  it('retains atomic v1 unit metadata and rejects unsupported schema units',()=>{
    const r:RunRequest={schemaVersion:1,model:{id:'atom',units:{time:'year',provenance:{basis:'declared',note:'Test clock'}},components:[{id:'c',type:'constant',parameters:{value:2,offset:0},units:{output:'t',parameters:{value:'t',offset:'year'}}}],connections:[],observations:[{component:'c',samplingInterval:1}]},simulation:{start:0,end:2}};
    expect(serializeModel(deserializeModel(r))).toEqual(r);
    const invalid=JSON.parse(JSON.stringify(r));invalid.model.units.time='fortnight';expect(()=>validateRequest(invalid)).toThrow();
  });
  it('rejects incompatible rates, quantum, parameter references and source-free conversion',()=>{
    for(const mutate of [(r:RunRequest)=>{r.model.definitions![0]!.units!.growthRate='1/year';},(r:RunRequest)=>{r.model.definitions![0]!.components.find(c=>c.id==='q')!.units!.parameters!.value='1/(effort*year)';},(r:RunRequest)=>{r.model.definitions![0]!.components.find(c=>c.id==='N')!.units!.parameters!.dQ='kg';},(r:RunRequest)=>{r.model.definitions![0]!.components[0]!.units!.parameters!.noSuchParameter='t';},(r:RunRequest)=>{r.model.units!.provenance.basis='converted';}]){const r=request();mutate(r);expect(()=>validateRequest(r)).toThrow();}
  });
  it('distinguishes independent prospective clocks and rejects inconsistent same-clock coupling',()=>{
    const r=request();r.model.units!.time='year';delete r.model.components.find(c=>c.id==='run')!.units;expect(()=>validateRequest(r)).not.toThrow();
    r.model.components.push({id:'lake',type:'coupled',definition:'Schaefer',parameters:{}});expect(()=>validateRequest(r)).toThrow(/temps couplés différents/);
    r.model.components.pop();
    r.model.definitions!.push({id:'Intermediate',name:'Intermediate',inputs:[],outputs:[],components:[{id:'inner',type:'coupled',definition:'Schaefer',parameters:{}}],connections:[]});
    r.model.components.push({id:'outer',type:'coupled',definition:'Intermediate',parameters:{}});
    expect(()=>validateRequest(r)).toThrow(/temps couplés différents après héritage/);
  });
  it('converts declared duration/rate dimensions explicitly and preserves physical products',()=>{
    expect(convertDuration(2,'year','month')).toBe(24);expect(convertDuration(24,'month','year')).toBe(2);
    expect(convertRate(.36,'year','month')).toBeCloseTo(.03);expect(convertRate(.03,'month','year')).toBeCloseTo(.36);
    expect(convertRate(.36,'year','month')*convertDuration(2,'year','month')).toBeCloseTo(.36*2);
  });
  it('propagates local units into results, adapter and CSV while historical units stay unknown',()=>{
    const fixture=workshopFixture(),r=request();const result=attachResultUnits(fixture.result,r);
    if(result.schemaVersion!==2)throw new Error();
    expect(result.scenarioTrajectories![0]!.observations[0]).toMatchObject({unit:'t',timeUnit:'month'});
    const runs=normalizeRun(result,r);expect(runs[0]).toMatchObject({timeUnit:'mois',parameters:{E:80,K:300}});expect(runs[0]!.series[0]!.unit).toBe('t');
    expect(scenarioTrajectoryCsv(result.scenarioTrajectories!)).toContain(',timeUnit,unit');expect(scenarioTrajectoryCsv(result.scenarioTrajectories!)).toContain('"month","t"');
    expect(resultCsv({observations:result.scenarioTrajectories![0]!.observations})).toContain('"month","t"');
    expect(normalizeRun(fixture.result,fixture.request)[0]!.timeUnit).toBe('unité du modèle');
    const row=fixture.result.schemaVersion===2?fixture.result.scenarioTrajectories![0]:undefined;
    if(row){row.observations[0]!.unit='t';row.observations[0]!.timeUnit='month';}
    const historical=attachResultUnits(fixture.result,fixture.request);
    if(historical.schemaVersion===2)expect(historical.scenarioTrajectories![0]!.observations[0]!.unit).toBeUndefined();
  });
  it('normalizes explicitly declared kilograms to tonnes for biomass, cumul, N0 and K',()=>{
    const fixture=workshopFixture(),r=request(),d=r.model.definitions![0]!;d.units!.biomass='kg';d.units!.cumulativeCatch='kg';d.units!.catchRate='kg/month';
    for(const c of d.components){if(c.units?.output==='t')c.units.output='kg';for(const key of Object.keys(c.units?.parameters??{}))if(c.units!.parameters![key]==='t')c.units!.parameters![key]='kg';}
    d.components.find(c=>c.id==='InvK')!.units={output:'1/kg',parameters:{value:'1/kg',offset:'month'}};
    d.components.find(c=>c.id==='qaEN')!.units!.output='kg/month';
    validateRequest(r);const run=normalizeRun(fixture.result,r)[0]!;expect(run.series[0]!.points[0]!.value).toBe(.22);expect(run.parameters.K).toBeCloseTo(.3);expect(run.series[1]!.unit).toBe('t');
  });
});
describe('Relative scenario labels',()=>{
  it('uses parameters and campaign, never scenario number or source order',()=>{
    const f=workshopFixture(),runs=normalizeRun(f.result,f.request),base=runs[0]!;
    const compared=[{...base,scenarioId:2,parameters:{E:260,q:.0008}},{...base,scenarioId:0,parameters:{E:80,q:.001}},{...base,scenarioId:5,parameters:{E:150,q:.0008}}];
    expect(scenarioLabel(compared[0]!,compared,true)).toBe('Situation 3 — Pêche élevée · variante A');
    expect(scenarioLabel(compared[1]!,compared,true)).toContain('Pêche faible · variante B');expect(scenarioLabel(compared[2]!,compared,true)).toContain('intermédiaire');
    expect(scenarioLabel(compared[0]!,compared,false)).toBe('Situation 3 — E = 260 ; q = 0,0008');expect(compared[0]!.id).toBe(base.id);
  });
});
describe('Twelve-month cumulative window',()=>{
  const points=[0,8,12,19,20].map(time=>({time,value:time*time}));
  it('uses t-12, not the previous observation',()=>{expect(rollingCatch(points,20,'month').value).toBe(336);expect(rollingCatch(points,12,'month').value).toBe(144);});
  it('requires a complete window and both recorded bounds for irregular observations',()=>{expect(rollingCatch(points,8,'month').reason).toContain('non encore');expect(rollingCatch(points,19,'month').value).toBeUndefined();expect(rollingCatch(points,20).value).toBeUndefined();});
  it('handles declared years, shifted origins and machine rounding without interpolation',()=>{
    expect(rollingCatch([{time:2,value:10},{time:3,value:30}],3,'year').value).toBe(20);
    expect(rollingCatch([{time:5,value:10},{time:17,value:40}],17,'month').value).toBe(30);
    expect(rollingCatch([{time:8+1e-15,value:64},{time:20,value:400}],20,'month').value).toBe(336);
    expect(rollingCatch([{time:8.001,value:64},{time:20,value:400}],20,'month').value).toBeUndefined();
  });
  it('does not conceal gaps, negative or decreasing cumulatives',()=>{expect(rollingCatch([{time:0,value:0},{time:10,value:100},{time:12,value:80}],12,'month').value).toBeUndefined();expect(rollingCatch([{time:0,value:0},{time:5,value:NaN},{time:12,value:80}],12,'month').value).toBeUndefined();});
});
describe('Tonnes represented by fish symbols',()=>{
  it.each([20,50,100,150,250,700])('%s tonnes are represented without a hidden cap',value=>expect(fishCount(value,'t')).toBe(value));
  it('rounds only the symbol count and refuses an unknown physical scale',()=>{expect(fishCount(83.87,'t')).toBe(84);expect(fishCount(83.1,'t')).toBe(83);expect(fishCount(-1,'t')).toBeUndefined();expect(fishCount(100,'unité du modèle')).toBeUndefined();});
});
