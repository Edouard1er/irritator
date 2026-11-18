import {composeFleet,conditionsAt,fleetAt,fleetEffort,intervene,validateConditions,validateRequest,type Conditions,type RunRequest,type TemporalExperiment} from '@contracts';
import example from './fishing-effort-config.v2.json';

export type FishingPractice = {
  boats:number; motor:'yes'|'no'; tripScope:'total'|'perBoat'; tripsPerWeek:number; tripHours:number;
  gearType:'gillnet'|'longline'|'seine'|'other'; gearCountPerTrip:number; effectiveGearHours:number;
  lineEffectiveHours?:number; netLengthM?:number; meshValue?:number; meshUnit?:'mm'|'cm'; hooksPerLine?:number; haulsPerTrip?:number; otherGearName?:string;
};
type Gear = 'gillnet'|'line'|'seine';
export type EffortConfiguration = {
  schema:'irritator-effective-fishing-effort'; version:2; id:string; source:string; status:string;
  modelEffortReference:'temporal.parameters.E'; baseline:typeof example.baseline;
  gearReferences:Record<Gear,{nominal:number;unit:string;relativePower:number}>;
  motorRelativePower:Record<Gear,{no:number;yes:number}>;
  gillnetMeshRelativePower:{meshUnit:'mm';referenceMeshMm:number;interpolation:'linear_between_declared_points_only';points:{meshMm:number;relativePower:number}[]};
  warning:string;
};
export type EffortReference = {id:string; version:1; source:'workshop-reference'; modelEffort:number; modelUnit:string; practice:FishingPractice};
export type NominalEffort = {tripsPerMonth:number; tripHoursPerMonth:number; nominalEffort:number; nominalUnit:string};
export type ComputedFishingEffort = NominalEffort & {
  referenceModelEffort:number; relativeEffort:number; modelEffort:number; referenceId:string; modelUnit:string;
  referenceNominal:number; nominalRatio:number; gearFactor:number; motorFactor:number; meshFactor:number; meshMm?:number;
  configurationId:string; configurationVersion:number;
};
type LegacyConfiguration = {id:'legacy-practices-v1';version:1;source:'Annexe V1 : motorisation et mailles descriptives'};
type AppliedConfiguration = EffortConfiguration|LegacyConfiguration;
export type PracticeRecord = {time:number; practice:FishingPractice; effortDerivation:ComputedFishingEffort; configuration:AppliedConfiguration};
export type PracticeHistory = {reference:EffortReference; configuration:EffortConfiguration; records:PracticeRecord[]; habitualPractice?:FishingPractice};
/** Explicit workshop convention, not a measured practice or a scientific calibration. */
export const initialReferencePractice:Readonly<FishingPractice> = {
  boats:1,motor:'no',tripScope:'total',tripsPerWeek:4,tripHours:6,gearType:'gillnet',gearCountPerTrip:2,
  effectiveGearHours:4,netLengthM:50,meshValue:46,meshUnit:'mm',hooksPerLine:1,haulsPerTrip:1,otherGearName:'',
};
export const defaultEffortConfiguration = example as EffortConfiguration;
const legacyConfiguration:LegacyConfiguration={id:'legacy-practices-v1',version:1,source:'Annexe V1 : motorisation et mailles descriptives'};
const units:Record<Gear,string>={gillnet:'m·h/mois',line:'hameçon·h/mois',seine:'traits/mois'};
const gearKey=(p:FishingPractice):Gear=>p.gearType==='longline'?'line':p.gearType as Gear;
const finite = (n:unknown,label:string,minimum:number,strict=false,integer=false) => {
  if(typeof n!=='number'||!Number.isFinite(n)||(strict?n<=minimum:n<minimum)||(integer&&!Number.isSafeInteger(n)))
    throw new Error(`${label} : saisir ${integer?'un entier':'un nombre'} fini ${strict?'supérieur à':'au moins égal à'} ${minimum}.`);
};
export function validatePractice(p:FishingPractice):void {
  if(!p||!['yes','no'].includes(p.motor)||!['total','perBoat'].includes(p.tripScope)||!['gillnet','longline','seine','other'].includes(p.gearType))throw new Error('Type de pirogue, périmètre ou engin invalide.');
  finite(p.boats,'Nombre de pirogues',0,true,true);finite(p.tripsPerWeek,'Sorties par semaine',0);
  finite(p.tripHours,'Durée de sortie',0,true);finite(p.gearCountPerTrip,'Nombre d’engins',0,true,true);
  if(p.gearType==='gillnet') {
    finite(p.effectiveGearHours,'Durée d’immersion',0);finite(p.netLengthM,'Longueur de filet',0,true);finite(p.meshValue,'Taille des mailles',0,true);
    if(!['mm','cm'].includes(p.meshUnit??''))throw new Error('Unité des mailles : choisir mm ou cm.');
  }
  if(p.gearType==='longline'){finite(p.hooksPerLine,'Hameçons par ligne',0,true,true);finite(p.lineEffectiveHours,'Durée effective d’utilisation des lignes',0);}
  if(p.gearType==='seine')finite(p.haulsPerTrip,'Opérations par senne et par sortie',0,true,true);
  if(p.gearType==='other'&&(!p.otherGearName?.trim()||p.otherGearName.length>80))throw new Error('Préciser le nom local de l’engin (80 caractères maximum).');
}
export function nominalFishingEffort(p:FishingPractice):NominalEffort {
  validatePractice(p);
  const tripsPerMonth=p.tripsPerWeek*(p.tripScope==='perBoat'?p.boats:1)*(52/12),tripHoursPerMonth=tripsPerMonth*p.tripHours;
  if(p.gearType==='other')throw new Error('Effort nominal non défini pour cet engin. Une règle validée est nécessaire.');
  const nominalEffort=tripsPerMonth*p.gearCountPerTrip*(p.gearType==='gillnet'?p.netLengthM!*p.effectiveGearHours:p.gearType==='longline'?p.hooksPerLine!*p.lineEffectiveHours!:p.haulsPerTrip!);
  if(![tripsPerMonth,tripHoursPerMonth,nominalEffort].every(Number.isFinite))throw new Error('Activité trop grande : le calcul doit rester fini.');
  return {tripsPerMonth,tripHoursPerMonth,nominalEffort,nominalUnit:units[gearKey(p)]};
}
function meshFactor(mm:number,c:EffortConfiguration):number {
  const points=c.gillnetMeshRelativePower.points;
  if(mm<points[0]!.meshMm||mm>points.at(-1)!.meshMm)throw new Error(`Maille hors du domaine configuré : ${points[0]!.meshMm}–${points.at(-1)!.meshMm} mm. Vérifier la taille et l’unité des mailles.`);
  const exact=points.find(p=>p.meshMm===mm);if(exact)return exact.relativePower;
  const i=points.findIndex(p=>p.meshMm>mm),lo=points[i-1]!,hi=points[i]!;
  return lo.relativePower+(hi.relativePower-lo.relativePower)*(mm-lo.meshMm)/(hi.meshMm-lo.meshMm);
}
export function validateEffortConfiguration(c:EffortConfiguration):void {
  if(!c||c.schema!=='irritator-effective-fishing-effort'||c.version!==2||typeof c.id!=='string'||!c.id.trim()||c.id.length>120||typeof c.source!=='string'||!c.source.trim()||typeof c.status!=='string'||!c.status.trim()||typeof c.warning!=='string'||!c.warning.trim()||c.modelEffortReference!=='temporal.parameters.E')throw new Error('Configuration de facteurs : identifiant, version ou provenance invalide.');
  for(const g of ['gillnet','line','seine'] as const){
    const r=c.gearReferences?.[g],m=c.motorRelativePower?.[g];
    finite(r?.nominal,`Référence nominale ${g}`,0,true);finite(r?.relativePower,`Facteur engin ${g}`,0,true);
    if(r?.unit!==units[g])throw new Error(`Unité de référence ${g} incompatible.`);
    finite(m?.no,`Facteur motorisation ${g} non motorisée`,0,true);finite(m?.yes,`Facteur motorisation ${g} motorisée`,0,true);
  }
  const table=c.gillnetMeshRelativePower;
  if(table?.meshUnit!=='mm'||table.interpolation!=='linear_between_declared_points_only'||!Array.isArray(table.points)||table.points.length<2)throw new Error('Table de mailles absente ou interpolation invalide.');
  let previous=0;
  for(const p of table.points){finite(p.meshMm,'Maille configurée',previous,true);finite(p.relativePower,'Facteur de maille',0,true);previous=p.meshMm;}
  const b=c.baseline;
  if(!b||b.gear!=='gillnet'||b.motor!=='no'||b.meshMm!==46||b.tripScope!=='total')throw new Error('Pratique de référence configurée incompatible avec le filet initial.');
  const baseline={...initialReferencePractice,boats:b.boats,tripsPerWeek:b.tripsPerWeek,gearCountPerTrip:b.gearCount,netLengthM:b.netLengthM,effectiveGearHours:b.effectiveGearHours,meshValue:b.meshMm};
  const nominal=nominalFishingEffort(baseline).nominalEffort;
  if(c.gearReferences.gillnet.relativePower!==1||c.motorRelativePower.gillnet.no!==1||table.referenceMeshMm!==46||meshFactor(46,c)!==1||nominal!==c.gearReferences.gillnet.nominal)throw new Error('Normalisation de référence incohérente (filet, motorisation, maille ou activité).');
}
export function importEffortConfiguration(text:string):EffortConfiguration {
  const c=JSON.parse(text);validateEffortConfiguration(c);return structuredClone(c);
}
export function initializePracticeHistory(t:TemporalExperiment):PracticeHistory {
  return {reference:{id:`${t.target}:${t.scenario}:initial`,version:1,source:'workshop-reference',modelEffort:t.parameters.E,modelUnit:'effort',practice:{...initialReferencePractice}},configuration:structuredClone(defaultEffortConfiguration),records:[]};
}
/** E_ref stays fixed at the initial native value. Each gear has its own nominal denominator. */
export function normalizeFishingEffort(p:FishingPractice,reference:EffortReference,conditions:Conditions,configuration:AppliedConfiguration):ComputedFishingEffort {
  if(!reference||reference.version!==1||reference.source!=='workshop-reference'||!reference.id?.trim())throw new Error('Référence d’effort absente ou invalide.');
  if(reference.modelUnit!=='effort')throw new Error('Unité de référence incompatible avec l’effort du modèle.');
  finite(reference.modelEffort,'Effort de référence',0,true);
  const nominal=nominalFishingEffort(p),base=nominalFishingEffort(reference.practice);
  if(base.nominalEffort<=0)throw new Error('La référence doit avoir un effort nominal strictement positif.');
  let referenceNominal:number,gearFactor:number,motorFactor:number,mesh=1;
  let meshMm:number|undefined;
  if(!configuration)throw new Error('Configuration de facteurs absente.');
  if(configuration.version===1){
    if(JSON.stringify(configuration)!==JSON.stringify(legacyConfiguration)||p.gearType!==reference.practice.gearType)throw new Error('Configuration historique V1 incompatible.');
    referenceNominal=base.nominalEffort;gearFactor=1;motorFactor=1;
  }else{
    validateEffortConfiguration(configuration);
    const g=gearKey(p),ref=configuration.gearReferences[g];
    if(reference.practice.gearType!=='gillnet'||base.nominalEffort!==configuration.gearReferences.gillnet.nominal||reference.practice.motor!=='no'||reference.practice.meshValue!*(reference.practice.meshUnit==='cm'?10:1)!==46)throw new Error('Référence initiale incompatible avec la configuration ; fournir une configuration normalisée correspondante.');
    referenceNominal=ref.nominal;gearFactor=ref.relativePower;motorFactor=configuration.motorRelativePower[g][p.motor];
    if(g==='gillnet'){meshMm=p.meshValue!*(p.meshUnit==='cm'?10:1);mesh=meshFactor(meshMm,configuration);}
  }
  const nominalRatio=nominal.nominalEffort/referenceNominal,relativeEffort=nominalRatio*gearFactor*motorFactor*mesh,modelEffort=reference.modelEffort*relativeEffort;
  // Reuse the native bounds, including zero; never clamp or round the transmitted E.
  validateConditions({...conditions,E:reference.modelEffort});validateConditions({...conditions,E:modelEffort});
  return {...nominal,referenceModelEffort:reference.modelEffort,relativeEffort,modelEffort,referenceId:reference.id,modelUnit:reference.modelUnit,referenceNominal,nominalRatio,gearFactor,motorFactor,meshFactor:mesh,...(meshMm===undefined?{}:{meshMm}),configurationId:configuration.id,configurationVersion:configuration.version};
}
export function practiceAt(history:PracticeHistory,t:TemporalExperiment,time:number):FishingPractice|undefined {
  const record=history.records.filter(r=>r.time<=time).at(-1),practice=record?.practice??history.reference.practice,expected=record?.effortDerivation.modelEffort??history.reference.modelEffort;
  if(conditionsAt(t,time).E!==expected)return undefined;
  return structuredClone(practice);
}
export function applyFishingPractice(request:RunRequest,time:number,p:Conditions,practice:FishingPractice,history:PracticeHistory) {
  const t=request.temporal;if(!t)throw new Error('Expérience temporelle requise.');
  const effortDerivation=normalizeFishingEffort(practice,history.reference,p,history.configuration),effort=effortDerivation.modelEffort;
  const mode=t.fleet.mode==='minimum'?'minimum':'balanced',currentFleet=fleetAt(t,time);
  // The technical allocation does not multiply declared boats or trips a second time.
  const fleet=fleetEffort(currentFleet)===effort?currentFleet:composeFleet(effort,mode,t.fleet.shares);
  const next=intervene(request,time,{...p,E:effort},fleet,t.fleet.mode==='manual'&&fleet===currentFleet?'manual':mode,t.fleet.shares);
  for(const row of next.temporal!.interventions)if(row.time===time&&row.parameter==='E')row.provenance=`atelier: effort calculé depuis les pratiques de pêche ; ${history.configuration.id} v${history.configuration.version}`;
  validateRequest(next);
  const record:PracticeRecord={time,practice:structuredClone(practice),effortDerivation,configuration:structuredClone(history.configuration)};
  return {request:next,history:{...structuredClone(history),records:[...history.records.filter(r=>r.time!==time),record].sort((a,b)=>a.time-b.time)}};
}
/** Separate versioned envelope: never add unknown properties to native v3 JSON. */
export function exportPracticeHistory(request:RunRequest,history:PracticeHistory):string {
  return JSON.stringify({format:'irritator-fishing-practices',version:2,request,history},null,2);
}
export function importPracticeHistory(text:string,request:RunRequest):PracticeHistory {
  const data=JSON.parse(text);
  if(data?.format!=='irritator-fishing-practices'||![1,2].includes(data.version)||JSON.stringify(data.request)!==JSON.stringify(request))throw new Error('Ce fichier de pratiques doit accompagner exactement l’expérience JSON courante.');
  const history=data.history as PracticeHistory,t=request.temporal;
  if(!t||!history?.reference||!Array.isArray(history.records)||history.reference.modelEffort!==t.parameters.E||history.reference.id!==initializePracticeHistory(t).reference.id)throw new Error('Référence incompatible avec le scénario initial.');
  if(data.version===1)history.configuration=structuredClone(defaultEffortConfiguration);
  validateEffortConfiguration(history.configuration);
  // Optional interface metadata in the existing V1/V2 envelope, never in native JSON.
  if(history.habitualPractice!==undefined)validatePractice(history.habitualPractice);
  // A legacy reference remains valid for its old records; V2 conversion checks its own normalization on Apply.
  normalizeFishingEffort(history.reference.practice,history.reference,t.parameters,legacyConfiguration);
  let previous=-Infinity;
  for(const row of history.records){
    if(!Number.isFinite(row.time)||row.time<0||row.time>=request.simulation.end||row.time<=previous)throw new Error('Historique des pratiques : date invalide.');
    if(data.version===1){
      if(row.practice.gearType==='longline')row.practice.lineEffectiveHours=row.practice.effectiveGearHours;
      const computed=normalizeFishingEffort(row.practice,history.reference,conditionsAt(t,row.time),legacyConfiguration);
      const {referenceNominal,nominalRatio,gearFactor,motorFactor,meshFactor,configurationId,configurationVersion,meshMm,...v1}=computed;
      if(JSON.stringify(v1)!==JSON.stringify(row.effortDerivation))throw new Error('Pratique et effort exporté incompatibles.');
      row.configuration=structuredClone(legacyConfiguration);row.effortDerivation=computed;
    }
    if(!row.configuration)throw new Error('Configuration appliquée absente de l’annexe.');
    const computed=normalizeFishingEffort(row.practice,history.reference,conditionsAt(t,row.time),row.configuration);
    if(computed.modelEffort!==conditionsAt(t,row.time).E||JSON.stringify(computed)!==JSON.stringify(row.effortDerivation))throw new Error('Pratique et effort exporté incompatibles.');
    previous=row.time;
  }
  return structuredClone(history);
}
