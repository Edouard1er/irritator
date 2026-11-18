import {composeFleet,conditionsAt,fleetAt,fleetEffort,intervene,validateConditions,validateRequest,type Conditions,type RunRequest,type TemporalExperiment} from '@contracts';

export type FishingPractice = {
  boats:number; motor:'yes'|'no'; tripScope:'total'|'perBoat'; tripsPerWeek:number; tripHours:number;
  gearType:'gillnet'|'longline'|'seine'|'other'; gearCountPerTrip:number; effectiveGearHours:number;
  netLengthM?:number; meshValue?:number; meshUnit?:'mm'|'cm'; hooksPerLine?:number; haulsPerTrip?:number; otherGearName?:string;
};
export type EffortReference = {id:string; version:1; source:'workshop-reference'; modelEffort:number; modelUnit:string; practice:FishingPractice};
export type NominalEffort = {tripsPerMonth:number; tripHoursPerMonth:number; nominalEffort:number; nominalUnit:string};
export type ComputedFishingEffort = NominalEffort & {referenceModelEffort:number; relativeEffort:number; modelEffort:number; referenceId:string; modelUnit:string};
export type PracticeRecord = {time:number; practice:FishingPractice; effortDerivation:ComputedFishingEffort};
export type PracticeHistory = {reference:EffortReference; records:PracticeRecord[]};

/** Explicit workshop convention, not a measured practice or a scientific calibration. */
export const initialReferencePractice:Readonly<FishingPractice> = {
  boats:1,motor:'no',tripScope:'total',tripsPerWeek:4,tripHours:6,gearType:'gillnet',gearCountPerTrip:2,
  effectiveGearHours:4,netLengthM:50,meshValue:46,meshUnit:'mm',hooksPerLine:1,haulsPerTrip:1,otherGearName:'',
};
const finite = (n:unknown,label:string,minimum:number,strict=false,integer=false) => {
  if(typeof n!=='number'||!Number.isFinite(n)||(strict?n<=minimum:n<minimum)||(integer&&!Number.isSafeInteger(n)))
    throw new Error(`${label} : saisir ${integer?'un entier':'un nombre'} fini ${strict?'supérieur à':'au moins égal à'} ${minimum}.`);
};
export function validatePractice(p:FishingPractice):void {
  if(!p||!['yes','no'].includes(p.motor)||!['total','perBoat'].includes(p.tripScope)||!['gillnet','longline','seine','other'].includes(p.gearType))throw new Error('Type de pirogue, périmètre ou engin invalide.');
  finite(p.boats,'Nombre de pirogues',0,true,true);finite(p.tripsPerWeek,'Sorties par semaine',0);
  finite(p.tripHours,'Durée de sortie',0,true);finite(p.effectiveGearHours,'Temps d’utilisation de l’engin',0);
  finite(p.gearCountPerTrip,'Nombre d’engins',0,true,true);
  if(p.gearType==='gillnet') {
    finite(p.netLengthM,'Longueur de filet',0,true);finite(p.meshValue,'Taille des mailles',0,true);
    if(!['mm','cm'].includes(p.meshUnit??''))throw new Error('Unité des mailles : choisir mm ou cm.');
  }
  if(p.gearType==='longline')finite(p.hooksPerLine,'Hameçons par ligne',0,true,true);
  if(p.gearType==='seine')finite(p.haulsPerTrip,'Opérations par sortie',0,true,true);
  if(p.gearType==='other'&&(!p.otherGearName?.trim()||p.otherGearName.length>80))throw new Error('Préciser le nom local de l’engin (80 caractères maximum).');
}
export function nominalFishingEffort(p:FishingPractice):NominalEffort {
  validatePractice(p);
  const tripsPerMonth=p.tripsPerWeek*(p.tripScope==='perBoat'?p.boats:1)*(52/12);
  const tripHoursPerMonth=tripsPerMonth*p.tripHours;
  if(p.gearType==='other')throw new Error('Effort nominal non défini pour cet engin. Une règle validée est nécessaire.');
  const nominalEffort=tripsPerMonth*p.gearCountPerTrip*(p.gearType==='gillnet'?p.netLengthM!*p.effectiveGearHours:p.gearType==='longline'?p.hooksPerLine!*p.effectiveGearHours:p.haulsPerTrip!);
  if(![tripsPerMonth,tripHoursPerMonth,nominalEffort].every(Number.isFinite))throw new Error('Activité trop grande : le calcul doit rester fini.');
  return {tripsPerMonth,tripHoursPerMonth,nominalEffort,nominalUnit:p.gearType==='gillnet'?'m·h/mois':p.gearType==='longline'?'hameçon·h/mois':'traits/mois'};
}
/** E_ref always comes from the initial scenario, never from the preceding intervention. */
export function initializePracticeHistory(t:TemporalExperiment):PracticeHistory {
  return {reference:{id:`${t.target}:${t.scenario}:initial`,version:1,source:'workshop-reference',modelEffort:t.parameters.E,modelUnit:'effort',practice:{...initialReferencePractice}},records:[]};
}
export function normalizeFishingEffort(p:FishingPractice,reference:EffortReference,conditions:Conditions):ComputedFishingEffort {
  if(!reference||reference.version!==1||reference.source!=='workshop-reference'||!reference.id?.trim())throw new Error('Référence d’effort absente ou invalide.');
  if(reference.modelUnit!=='effort')throw new Error('Unité de référence incompatible avec l’effort du modèle.');
  finite(reference.modelEffort,'Effort de référence',0,true);
  const nominal=nominalFishingEffort(p),base=nominalFishingEffort(reference.practice);
  if(p.gearType!==reference.practice.gearType)throw new Error('Conversion entre engins non définie : une référence du même engin est nécessaire.');
  if(base.nominalEffort<=0)throw new Error('La référence doit avoir un effort nominal strictement positif.');
  const relativeEffort=nominal.nominalEffort/base.nominalEffort,modelEffort=reference.modelEffort*relativeEffort;
  // Reuse the actual temporal engine contract, including its bounds and acceptance of zero.
  validateConditions({...conditions,E:reference.modelEffort});validateConditions({...conditions,E:modelEffort});
  return {...nominal,referenceModelEffort:reference.modelEffort,relativeEffort,modelEffort,referenceId:reference.id,modelUnit:reference.modelUnit};
}
export function practiceAt(history:PracticeHistory,t:TemporalExperiment,time:number):FishingPractice|undefined {
  const record=history.records.filter(r=>r.time<=time).at(-1);
  const practice=record?.practice??history.reference.practice;
  const expected=record?.effortDerivation.modelEffort??history.reference.modelEffort;
  // An imported/direct effort decision cannot be turned into a purported real practice.
  if(conditionsAt(t,time).E!==expected)return undefined;
  return structuredClone(practice);
}
export function applyFishingPractice(request:RunRequest,time:number,p:Conditions,practice:FishingPractice,history:PracticeHistory) {
  const t=request.temporal;if(!t)throw new Error('Expérience temporelle requise.');
  const effortDerivation=normalizeFishingEffort(practice,history.reference,p),effort=effortDerivation.modelEffort;
  const mode=t.fleet.mode==='minimum'?'minimum':'balanced',currentFleet=fleetAt(t,time);
  // Keep a compatible existing allocation; otherwise retain the automatic technical allocation.
  const fleet=fleetEffort(currentFleet)===effort?currentFleet:composeFleet(effort,mode,t.fleet.shares);
  const next=intervene(request,time,{...p,E:effort},fleet,t.fleet.mode==='manual'&&fleet===currentFleet?'manual':mode,t.fleet.shares);
  validateRequest(next);
  const record:PracticeRecord={time,practice:structuredClone(practice),effortDerivation};
  return {request:next,history:{reference:structuredClone(history.reference),records:[...history.records.filter(r=>r.time!==time),record].sort((a,b)=>a.time-b.time)}};
}
/** Separate versioned envelope: never add unknown properties to native v3 JSON. */
export function exportPracticeHistory(request:RunRequest,history:PracticeHistory):string {
  return JSON.stringify({format:'irritator-fishing-practices',version:1,request,history},null,2);
}
export function importPracticeHistory(text:string,request:RunRequest):PracticeHistory {
  const data=JSON.parse(text);
  if(data?.format!=='irritator-fishing-practices'||data.version!==1||JSON.stringify(data.request)!==JSON.stringify(request))throw new Error('Ce fichier de pratiques doit accompagner exactement l’expérience JSON courante.');
  const history=data.history as PracticeHistory,t=request.temporal;
  if(!t||!history?.reference||!Array.isArray(history.records)||history.reference.modelEffort!==t.parameters.E||history.reference.id!==initializePracticeHistory(t).reference.id)throw new Error('Référence incompatible avec le scénario initial.');
  normalizeFishingEffort(history.reference.practice,history.reference,t.parameters);
  let previous=-Infinity;
  for(const row of history.records) {
    if(!Number.isFinite(row.time)||row.time<0||row.time>=request.simulation.end||row.time<=previous)throw new Error('Historique des pratiques : date invalide.');
    const computed=normalizeFishingEffort(row.practice,history.reference,conditionsAt(t,row.time));
    if(computed.modelEffort!==conditionsAt(t,row.time).E||JSON.stringify(computed)!==JSON.stringify(row.effortDerivation))throw new Error('Pratique et effort exporté incompatibles.');
    previous=row.time;
  }
  return structuredClone(history);
}
export function meshWarning(p:FishingPractice):string|undefined {
  if(p.gearType!=='gillnet'||!Number.isFinite(p.meshValue))return;
  const mm=p.meshValue!*(p.meshUnit==='cm'?10:1);
  return mm<5||mm>200?'Vérifier la taille et l’unité des mailles. Cette indication ne modifie pas l’effort.':undefined;
}
