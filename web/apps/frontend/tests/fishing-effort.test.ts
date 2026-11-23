import {describe,it,expect} from 'vitest';
import {compileTemporal,composeFleet,conditionsAt,defaultConditions,fleetEffort,intervene,validateRequest,type RunRequest} from '@contracts';
import source from '../../../examples/atelier-interventions-month-v3.json';
import {applyFishingPractice,exportPracticeHistory,importPracticeHistory,initialReferencePractice,initializePracticeHistory,defaultEffortConfiguration,importEffortConfiguration,nominalFishingEffort,normalizeFishingEffort,practiceAt,validatePractice,type FishingPractice} from '@/lib/simulation/fishing-effort';
const fixture=()=>structuredClone(source) as unknown as RunRequest;
const practice=(changes:Partial<FishingPractice>={})=>({...initialReferencePractice,...changes});
const reference=()=>initializePracticeHistory(fixture().temporal!).reference;
const effort=(p:FishingPractice)=>normalizeFishingEffort(p,reference(),defaultConditions,defaultEffortConfiguration);
describe('Declared practice: nominal activity and fixed model reference (EF-01–12)',()=>{
  it('computes 17.333333 trips, 104 hours and 6933.333333 m·h monthly; E=150',()=>{
    const computed=effort(practice());expect(computed.tripsPerMonth).toBeCloseTo(52/3,12);expect(computed.tripHoursPerMonth).toBe(104);
    expect(computed.nominalEffort).toBeCloseTo(6933.333333333333,10);expect(computed.nominalUnit).toBe('m·h/mois');expect(computed.modelEffort).toBe(150);
  });
  it('doubles to E=300 and keeps the actual scenario E_ref instead of hardcoding it',()=>{
    expect(effort(practice({tripsPerWeek:8})).modelEffort).toBe(300);
    expect(normalizeFishingEffort(practice({tripsPerWeek:8}),{...reference(),modelEffort:260},defaultConditions,defaultEffortConfiguration).modelEffort).toBe(520);
  });
  it('uses two thirds of the fixed nominal reference for E=100',()=>{
    expect(effort(practice({tripsPerWeek:8/3})).modelEffort).toBe(100);
    expect(()=>normalizeFishingEffort(practice(),{...reference(),practice:practice({gearCountPerTrip:3})},defaultConditions,defaultEffortConfiguration)).toThrow(/Référence initiale incompatible/);
  });
  it.each([['total',65/3,187.5],['perBoat',130/3,375]] as const)('counts 2 boats only once with scope %s', (tripScope,trips,model)=>{
    const computed=effort(practice({boats:2,tripsPerWeek:5,tripScope}));expect(computed.tripsPerMonth).toBeCloseTo(trips,12);expect(computed.modelEffort).toBeCloseTo(model,12);
  });
  it('allows 20 weekly group trips: 86.666667 trips, 520 hours, E=750',()=>{
    const c=effort(practice({tripsPerWeek:20}));expect(c.tripsPerMonth).toBeCloseTo(260/3,12);expect(c.tripHoursPerMonth).toBeCloseTo(520,12);expect(c.modelEffort).toBeCloseTo(750,12);
  });
  it('applies configured motorization once, mesh interpolation only in domain, and converts cm to mm',()=>{
    expect(effort(practice({motor:'yes'})).modelEffort).toBe(180);
    expect(effort(practice({meshValue:35})).modelEffort).toBe(135);
    expect(effort(practice({meshValue:60})).modelEffort).toBe(127.5);
    expect(effort(practice({meshValue:40.5})).meshFactor).toBeCloseTo(.95,12);
    expect(effort(practice({meshValue:4.6,meshUnit:'cm'}))).toEqual(effort(practice()));
    expect(()=>effort(practice({meshValue:46,meshUnit:'cm'}))).toThrow(/hors du domaine/);
    expect(effort(practice({motor:'yes',tripsPerWeek:8})).modelEffort).toBe(360);
    expect(effort(practice({motor:'yes',boats:3,tripScope:'perBoat'})).modelEffort).toBe(540);
    expect(effort(practice({motor:'yes',boats:3,tripScope:'total'})).modelEffort).toBe(180);
  });
  it('permits immersion longer than a trip and a fractional weekly trip count',()=>{expect(effort(practice({tripsPerWeek:.5,effectiveGearHours:12})).modelEffort).toBe(56.25);});
  it.each([0,-1,.5,NaN,Infinity])('rejects invalid boat count %s',boats=>{expect(()=>validatePractice(practice({boats}))).toThrow();});
  it.each([{tripsPerWeek:NaN},{tripsPerWeek:Infinity},{tripsPerWeek:-1},{tripHours:0},{tripHours:NaN},{effectiveGearHours:-1},{netLengthM:0},{netLengthM:undefined},{meshValue:undefined},{gearCountPerTrip:1.5}])('rejects missing/nonfinite/negative activity %j',changes=>{expect(()=>effort(practice(changes))).toThrow();});
  it('rejects invalid units, reference, zero reference and overflow',()=>{
    expect(()=>effort(practice({meshUnit:'m' as 'mm'}))).toThrow(/Unité/);
    expect(()=>normalizeFishingEffort(practice(),undefined!,defaultConditions,defaultEffortConfiguration)).toThrow(/Référence/);
    for(const ref of [{...reference(),modelUnit:'t'},{...reference(),modelEffort:NaN},{...reference(),modelEffort:0},{...reference(),practice:practice({tripsPerWeek:0})}])expect(()=>normalizeFishingEffort(practice(),ref,defaultConditions,defaultEffortConfiguration)).toThrow();
    expect(()=>effort(practice({tripsPerWeek:Number.MAX_VALUE}))).toThrow(/fini/);
  });
  it('accepts effort zero under the real contract, rejects >10000 without clamping',()=>{
    expect(effort(practice({tripsPerWeek:0})).modelEffort).toBe(0);expect(effort(practice({effectiveGearHours:0})).modelEffort).toBe(0);
    expect(()=>effort(practice({tripsPerWeek:1000}))).toThrow(/10000/);
  });
  it('standardizes line and seine using separate declared references and units',()=>{
    const line=practice({gearType:'longline',hooksPerLine:20,lineEffectiveHours:4}),seine=practice({gearType:'seine',gearCountPerTrip:1,haulsPerTrip:2});
    expect(nominalFishingEffort(line).nominalUnit).toBe('hameçon·h/mois');expect(nominalFishingEffort(line).nominalEffort).toBeCloseTo(2773.333333333333,10);
    expect(effort(line).modelEffort).toBe(120);expect(effort({...line,motor:'yes'}).modelEffort).toBe(138);
    expect(nominalFishingEffort(seine).nominalEffort).toBeCloseTo(34.666666666666664,12);
    expect(effort(seine).modelEffort).toBe(180);expect(effort({...seine,motor:'yes'}).modelEffort).toBe(234);
    expect(effort({...line,hooksPerLine:40}).modelEffort).toBe(240);expect(effort({...line,gearCountPerTrip:4}).modelEffort).toBe(240);
    expect(effort({...line,lineEffectiveHours:8}).modelEffort).toBe(240);
    expect(effort({...line,tripHours:20,effectiveGearHours:100}).modelEffort).toBe(120);
    expect(()=>effort({...line,lineEffectiveHours:undefined})).toThrow(/Durée effective/);
    expect(effort({...seine,haulsPerTrip:4}).modelEffort).toBe(360);expect(effort({...seine,gearCountPerTrip:2}).modelEffort).toBe(360);
    expect(effort({...seine,effectiveGearHours:NaN,meshValue:NaN}).modelEffort).toBe(180);
    expect(()=>effort(practice({gearType:'other',otherGearName:'Engin local'}))).toThrow(/règle validée/);
  });
  it('validates configuration, provenance, units, normalization and all required factors without fallback',()=>{
    expect(importEffortConfiguration(JSON.stringify(defaultEffortConfiguration))).toEqual(defaultEffortConfiguration);
    expect(()=>normalizeFishingEffort(practice(),reference(),defaultConditions,undefined!)).toThrow(/Configuration de facteurs absente/);
    const changes=[(c:any)=>delete c.gearReferences.line,(c:any)=>delete c.motorRelativePower.gillnet.yes,(c:any)=>c.gearReferences.line.relativePower=NaN,(c:any)=>c.motorRelativePower.seine.no=0,(c:any)=>c.gearReferences.gillnet.nominal=0,(c:any)=>c.gearReferences.line.unit='m·h/mois',(c:any)=>c.gillnetMeshRelativePower.points.reverse(),(c:any)=>c.gillnetMeshRelativePower.points[1].relativePower=.8,(c:any)=>c.gillnetMeshRelativePower.interpolation='extrapolate',(c:any)=>c.version=3,(c:any)=>c.id='',(c:any)=>c.baseline.tripsPerWeek=8];
    for(const change of changes){const c=structuredClone(defaultEffortConfiguration);change(c);expect(()=>importEffortConfiguration(JSON.stringify(c))).toThrow();expect(()=>normalizeFishingEffort(practice(),reference(),defaultConditions,c)).toThrow();}
    const c=structuredClone(defaultEffortConfiguration);c.id='custom';c.motorRelativePower.gillnet.yes=.8;
    expect(normalizeFishingEffort(practice({motor:'yes'}),reference(),defaultConditions,c).modelEffort).toBe(120);
  });

});
describe('Existing intervention contract, decimal times, native graph and compatible sidecar',()=>{
  it('produces the exact old events and compiled DEVS graph for 150→300→100',()=>{
    const request=fixture(),history=initializePracticeHistory(request.temporal!),original=structuredClone(request);
    const first=applyFishingPractice(request,3.8,conditionsAt(request.temporal!,3.8),practice({tripsPerWeek:8}),history);
    const second=applyFishingPractice(first.request,10.3,conditionsAt(first.request.temporal!,10.3),practice({tripsPerWeek:8/3}),first.history);
    let direct=request;
    for(const [time,E] of [[3.8,300],[10.3,100]])direct=intervene(direct,time!,{...conditionsAt(direct.temporal!,time!),E:E!},composeFleet(E!),'balanced',[.6,.25,.15]);
    expect(second.request.temporal!.interventions.every(r=>r.parameter!=='E'||(r.provenance.includes('calculé depuis les pratiques')&&!r.provenance.includes('saisie explicite')))).toBe(true);
    for(const row of direct.temporal!.interventions)if(row.parameter==='E')row.provenance=second.request.temporal!.interventions.find(r=>r.time===row.time&&r.parameter==='E')!.provenance;
    expect(second.request).toEqual(direct);expect(compileTemporal(second.request)).toEqual(compileTemporal(direct));expect(request).toEqual(original);
    expect(second.history.reference).toEqual(history.reference);expect(second.history.records.map(r=>r.effortDerivation.modelEffort)).toEqual([300,100]);
    expect(practiceAt(second.history,second.request.temporal!,10.3)).toEqual(practice({tripsPerWeek:8/3}));
    expect(second.request.temporal!.fleetHistory.map(r=>fleetEffort(r.fleet))).toEqual([300,100]);
  });
  it('roundtrips practice and provenance beside an unchanged schema-valid native JSON; rejects mismatches/tampering',()=>{
    const r=fixture(),applied=applyFishingPractice(r,3.8,conditionsAt(r.temporal!,3.8),practice({tripsPerWeek:8,boats:7,meshUnit:'cm',meshValue:4.6}),initializePracticeHistory(r.temporal!));
    const text=exportPracticeHistory(applied.request,applied.history);validateRequest(JSON.parse(JSON.stringify(applied.request)));
    expect(importPracticeHistory(text,applied.request)).toEqual(applied.history);
    expect(()=>importPracticeHistory(text,r)).toThrow(/exactement/);
    const invalid=JSON.parse(text);invalid.history.records[0].practice.tripsPerWeek=4;expect(()=>importPracticeHistory(JSON.stringify(invalid),applied.request)).toThrow(/incompatibles/);
    expect(Object.keys(applied.request.temporal!)).not.toContain('practice');
  });
  it('never invents a practice for a legacy direct effort; initializes from the scenario, keeps manual allocation if compatible',()=>{
    const r=fixture(),history=initializePracticeHistory(r.temporal!);
    const direct=intervene(r,3.8,{...conditionsAt(r.temporal!,3.8),E:300},composeFleet(300),'balanced',[.6,.25,.15]);
    expect(practiceAt(history,direct.temporal!,3.8)).toBeUndefined();
    r.temporal!.fleet.mode='manual';const same=applyFishingPractice(r,3.8,conditionsAt(r.temporal!,3.8),practice(),history);
    expect(same.request.temporal!.fleet.mode).toBe('manual');expect(same.request.temporal!.fleetHistory[0]!.fleet).toEqual(r.temporal!.fleet.initial);
  });
  it('replaces a practice at the same time while retaining future absolute decisions and initial reference',()=>{
    const r=fixture(),h=initializePracticeHistory(r.temporal!);
    const future=applyFishingPractice(r,10.3,conditionsAt(r.temporal!,10.3),practice({tripsPerWeek:8}),h);
    const past=applyFishingPractice(future.request,3.8,conditionsAt(future.request.temporal!,3.8),practice({tripsPerWeek:2}),future.history);
    const replace=applyFishingPractice(past.request,3.8,conditionsAt(past.request.temporal!,3.8),practice({tripsPerWeek:4}),past.history);
    expect(replace.history.records.map(r=>r.time)).toEqual([3.8,10.3]);expect(conditionsAt(replace.request.temporal!,11).E).toBe(300);
    expect(importPracticeHistory(exportPracticeHistory(replace.request,replace.history),replace.request)).toEqual(replace.history);
  });
});

describe('Versioned configuration snapshots and V1 migration',()=>{
  it('preserves old motor/mesh-descriptive results and exports migrated records without rewriting the native document',()=>{
    const r=fixture(),p=practice({tripsPerWeek:8,motor:'yes',meshValue:46,meshUnit:'cm'});
    const direct=intervene(r,3.8,{...conditionsAt(r.temporal!,3.8),E:300},composeFleet(300),'balanced',[.6,.25,.15]);
    const ref=reference(),nominal=nominalFishingEffort(p);
    const v1={format:'irritator-fishing-practices',version:1,request:direct,history:{reference:ref,records:[{time:3.8,practice:p,effortDerivation:{...nominal,referenceModelEffort:150,relativeEffort:2,modelEffort:300,referenceId:ref.id,modelUnit:'effort'}}]}};
    const original=JSON.stringify(direct),h=importPracticeHistory(JSON.stringify(v1),direct);
    expect(h.records[0]!.effortDerivation.modelEffort).toBe(300);expect(h.records[0]!.configuration.version).toBe(1);
    expect(h.configuration).toEqual(defaultEffortConfiguration);expect(practiceAt(h,direct.temporal!,4)).toEqual(p);
    expect(importPracticeHistory(exportPracticeHistory(direct,h),direct)).toEqual(h);expect(JSON.stringify(direct)).toBe(original);
    expect(()=>applyFishingPractice(direct,4,conditionsAt(direct.temporal!,4),p,h)).toThrow(/hors du domaine/);
    const next=applyFishingPractice(direct,4,conditionsAt(direct.temporal!,4),{...p,meshUnit:'mm'},h);
    expect(next.history.records.map(r=>r.effortDerivation.modelEffort)).toEqual([300,360]);
    expect(importPracticeHistory(exportPracticeHistory(next.request,next.history),next.request)).toEqual(next.history);
  });
  it('keeps the exact applied factors even if a later scenario config changes, rejects missing or altered snapshots',()=>{
    const r=fixture(),h=initializePracticeHistory(r.temporal!),p=practice({gearType:'longline',lineEffectiveHours:4,hooksPerLine:20});
    const first=applyFishingPractice(r,3.8,conditionsAt(r.temporal!,3.8),p,h),config=structuredClone(defaultEffortConfiguration);config.id='scenario-b';config.gearReferences.line.relativePower=1;
    const second=applyFishingPractice(first.request,10.3,conditionsAt(first.request.temporal!,10.3),p,{...first.history,configuration:config});
    expect(second.history.records.map(r=>r.effortDerivation.modelEffort)).toEqual([120,150]);
    const text=exportPracticeHistory(second.request,second.history);expect(importPracticeHistory(text,second.request)).toEqual(second.history);
    for(const mutate of [(d:any)=>delete d.history.records[0].configuration,(d:any)=>d.history.records[0].configuration.gearReferences.line.relativePower=1,(d:any)=>d.history.records[0].effortDerivation.motorFactor=100]){const d=JSON.parse(text);mutate(d);expect(()=>importPracticeHistory(JSON.stringify(d),second.request)).toThrow();}
  });
});
