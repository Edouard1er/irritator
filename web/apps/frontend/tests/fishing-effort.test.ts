import {describe,it,expect} from 'vitest';
import {compileTemporal,composeFleet,conditionsAt,defaultConditions,fleetEffort,intervene,validateRequest,type RunRequest} from '@contracts';
import source from '../../../examples/atelier-interventions-month-v3.json';
import {applyFishingPractice,exportPracticeHistory,importPracticeHistory,initialReferencePractice,initializePracticeHistory,meshWarning,nominalFishingEffort,normalizeFishingEffort,practiceAt,validatePractice,type FishingPractice} from '@/lib/simulation/fishing-effort';
const fixture=()=>structuredClone(source) as unknown as RunRequest;
const practice=(changes:Partial<FishingPractice>={})=>({...initialReferencePractice,...changes});
const reference=()=>initializePracticeHistory(fixture().temporal!).reference;
const effort=(p:FishingPractice)=>normalizeFishingEffort(p,reference(),defaultConditions);
describe('Declared practice: nominal activity and fixed model reference (EF-01–12)',()=>{
  it('computes 17.333333 trips, 104 hours and 6933.333333 m·h monthly; E=150',()=>{
    const computed=effort(practice());expect(computed.tripsPerMonth).toBeCloseTo(52/3,12);expect(computed.tripHoursPerMonth).toBe(104);
    expect(computed.nominalEffort).toBeCloseTo(6933.333333333333,10);expect(computed.nominalUnit).toBe('m·h/mois');expect(computed.modelEffort).toBe(150);
  });
  it('doubles to E=300 and keeps the actual scenario E_ref instead of hardcoding it',()=>{
    expect(effort(practice({tripsPerWeek:8})).modelEffort).toBe(300);
    expect(normalizeFishingEffort(practice({tripsPerWeek:8}),{...reference(),modelEffort:260},defaultConditions).modelEffort).toBe(520);
  });
  it('uses 3 reference nets versus 2 selected nets for E=100',()=>{
    expect(normalizeFishingEffort(practice(),{...reference(),practice:practice({gearCountPerTrip:3})},defaultConditions).modelEffort).toBe(100);
  });
  it.each([['total',65/3,187.5],['perBoat',130/3,375]] as const)('counts 2 boats only once with scope %s', (tripScope,trips,model)=>{
    const computed=effort(practice({boats:2,tripsPerWeek:5,tripScope}));expect(computed.tripsPerMonth).toBeCloseTo(trips,12);expect(computed.modelEffort).toBeCloseTo(model,12);
  });
  it('allows 20 weekly group trips: 86.666667 trips, 520 hours, E=750',()=>{
    const c=effort(practice({tripsPerWeek:20}));expect(c.tripsPerMonth).toBeCloseTo(260/3,12);expect(c.tripHoursPerMonth).toBeCloseTo(520,12);expect(c.modelEffort).toBeCloseTo(750,12);
  });
  it('retains mesh units and motorization descriptively, warns without applying a coefficient',()=>{
    for(const meshUnit of ['mm','cm'] as const)expect(effort(practice({meshUnit,motor:'yes'})).modelEffort).toBe(150);
    expect(meshWarning(practice({meshUnit:'mm'}))).toBeUndefined();expect(meshWarning(practice({meshUnit:'cm'}))).toContain('Vérifier');
  });
  it('permits immersion longer than a trip and a fractional weekly trip count',()=>{expect(effort(practice({tripsPerWeek:.5,effectiveGearHours:12})).modelEffort).toBe(56.25);});
  it.each([0,-1,.5,NaN,Infinity])('rejects invalid boat count %s',boats=>{expect(()=>validatePractice(practice({boats}))).toThrow();});
  it.each([{tripsPerWeek:NaN},{tripsPerWeek:Infinity},{tripsPerWeek:-1},{tripHours:0},{tripHours:NaN},{effectiveGearHours:-1},{netLengthM:0},{netLengthM:undefined},{meshValue:undefined},{gearCountPerTrip:1.5}])('rejects missing/nonfinite/negative activity %j',changes=>{expect(()=>effort(practice(changes))).toThrow();});
  it('rejects invalid units, reference, zero reference and overflow',()=>{
    expect(()=>effort(practice({meshUnit:'m' as 'mm'}))).toThrow(/Unité/);
    expect(()=>normalizeFishingEffort(practice(),undefined!,defaultConditions)).toThrow(/Référence/);
    for(const ref of [{...reference(),modelUnit:'t'},{...reference(),modelEffort:NaN},{...reference(),modelEffort:0},{...reference(),practice:practice({tripsPerWeek:0})}])expect(()=>normalizeFishingEffort(practice(),ref,defaultConditions)).toThrow();
    expect(()=>effort(practice({tripsPerWeek:Number.MAX_VALUE}))).toThrow(/fini/);
  });
  it('accepts effort zero under the real contract, rejects >10000 without clamping',()=>{
    expect(effort(practice({tripsPerWeek:0})).modelEffort).toBe(0);expect(effort(practice({effectiveGearHours:0})).modelEffort).toBe(0);
    expect(()=>effort(practice({tripsPerWeek:1000}))).toThrow(/10000/);
  });
  it('keeps line and seine nominal units separate and refuses heterogeneous conversion',()=>{
    const line=practice({gearType:'longline',hooksPerLine:10}),seine=practice({gearType:'seine',haulsPerTrip:3});
    expect(nominalFishingEffort(line).nominalUnit).toBe('hameçon·h/mois');expect(nominalFishingEffort(line).nominalEffort).toBeCloseTo(52/3*2*10*4,10);
    expect(nominalFishingEffort(seine)).toMatchObject({nominalUnit:'traits/mois',nominalEffort:104});
    for(const p of [line,seine])expect(()=>effort(p)).toThrow(/Conversion entre engins/);
    expect(()=>effort(practice({gearType:'other',otherGearName:'Engin local'}))).toThrow(/règle validée/);
  });
});
describe('Existing intervention contract, decimal times, native graph and compatible sidecar',()=>{
  it('produces the exact old events and compiled DEVS graph for 150→300→100',()=>{
    const request=fixture(),history=initializePracticeHistory(request.temporal!),original=structuredClone(request);
    const first=applyFishingPractice(request,3.8,conditionsAt(request.temporal!,3.8),practice({tripsPerWeek:8}),history);
    const second=applyFishingPractice(first.request,10.3,conditionsAt(first.request.temporal!,10.3),practice({tripsPerWeek:8/3}),first.history);
    let direct=request;
    for(const [time,E] of [[3.8,300],[10.3,100]])direct=intervene(direct,time!,{...conditionsAt(direct.temporal!,time!),E:E!},composeFleet(E!),'balanced',[.6,.25,.15]);
    expect(second.request).toEqual(direct);expect(compileTemporal(second.request)).toEqual(compileTemporal(direct));expect(request).toEqual(original);
    expect(second.history.reference).toEqual(history.reference);expect(second.history.records.map(r=>r.effortDerivation.modelEffort)).toEqual([300,100]);
    expect(practiceAt(second.history,second.request.temporal!,10.3)).toEqual(practice({tripsPerWeek:8/3}));
    expect(second.request.temporal!.fleetHistory.map(r=>fleetEffort(r.fleet))).toEqual([300,100]);
  });
  it('roundtrips practice and provenance beside an unchanged schema-valid native JSON; rejects mismatches/tampering',()=>{
    const r=fixture(),applied=applyFishingPractice(r,3.8,conditionsAt(r.temporal!,3.8),practice({tripsPerWeek:8,boats:7,meshUnit:'cm'}),initializePracticeHistory(r.temporal!));
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
