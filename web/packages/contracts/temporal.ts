import type { CoupledDefinition, RunRequest } from './index.js';
import reference from '../../examples/wrapper-schaefer-v3.json' with { type: 'json' };

export const conditionKeys = ['r0','q0','S','Sopt','ks','P','betaP','a','E','spring','summer','autumn','winter'] as const;
export type ConditionKey = typeof conditionKeys[number];
export type Conditions = Record<ConditionKey, number>;
export type Fleet = { counts: [number,number,number]; utilization: [number,number,number] };
export interface Intervention { time: number; parameter: ConditionKey; oldValue: number; newValue: number; unit: string; scenario: string; provenance: string }
export interface TemporalExperiment {
  target: string; scenario: string; parameters: Conditions;
  fleet: { mode: 'balanced'|'minimum'|'manual'; shares: [number,number,number]; initial: Fleet };
  fleetHistory: {time:number; fleet:Fleet}[];
  interventions: Intervention[];
  provenance: string;
}
export const conditionUnits: Record<ConditionKey,string> = {r0:'1/month',q0:'1/(effort*month)',S:'index',Sopt:'index',ks:'1/index²',P:'index',betaP:'ratio',a:'ratio',E:'effort',spring:'ratio',summer:'ratio',autumn:'ratio',winter:'ratio'};
export const defaultConditions: Conditions = {r0:.35,q0:.001,S:3,Sopt:3,ks:.05,P:0,betaP:.3,a:1,E:150,spring:1.15,summer:1,autumn:.85,winter:.7};
export const seasonNames = ['Printemps','Été','Automne','Hiver'] as const;
/** Only remove IEEE-754 grid accumulation at integer calendar boundaries. */
export function calendarTime(time:number) {const n=Math.round(time);return Math.abs(time-n)<=32*Number.EPSILON*Math.max(1,Math.abs(time))?n:time;}
export function seasonAt(time:number) { const month=1+((Math.floor(time)%12)+12)%12;return {month,index:Math.floor((month-1)/3),name:seasonNames[Math.floor((month-1)/3)]!}; }
export function conditionsAt(experiment:TemporalExperiment,time:number):Conditions {
  const p={...experiment.parameters};for(const row of experiment.interventions){if(row.time>time)break;p[row.parameter]=row.newValue;}return p;
}
export function ratesAt(p:Conditions,time:number) { const factor=p[(['spring','summer','autumn','winter'] as const)[seasonAt(time).index]!];return {r:p.r0*factor*Math.exp(-p.ks*(p.S-p.Sopt)**2),q:p.q0*Math.exp(p.betaP*p.P/10),a:p.a,E:p.E}; }
export function intervene(request:RunRequest,time:number,next:Conditions,fleet:Fleet,mode:TemporalExperiment['fleet']['mode'],shares:[number,number,number]):RunRequest {
  const copy=structuredClone(request),t=copy.temporal!;validateConditions(next);validateFleet(fleet);
  if(Math.abs(fleetEffort(fleet)-next.E)>1e-7)throw new Error('La flotte doit fournir l’effort exact');
  const current=conditionsAt(t,time),changed=conditionKeys.filter(k=>next[k]!==current[k]);
  t.interventions=t.interventions.filter(r=>!(r.time===time&&changed.includes(r.parameter)));
  for(const parameter of changed)t.interventions.push({time,parameter,oldValue:current[parameter],newValue:next[parameter],unit:conditionUnits[parameter],scenario:t.scenario,provenance:'atelier: saisie explicite, interface Simulation'});
  t.interventions.sort((a,b)=>a.time-b.time||conditionKeys.indexOf(a.parameter)-conditionKeys.indexOf(b.parameter));
  const state={...t.parameters};for(const row of t.interventions){row.oldValue=state[row.parameter];state[row.parameter]=row.newValue;}
  t.fleetHistory=t.fleetHistory.filter(r=>r.time!==time);t.fleetHistory.push({time,fleet});t.fleetHistory.sort((a,b)=>a.time-b.time);
  // Future effort decisions keep their absolute value; fleet records track those decisions.
  for(const row of t.fleetHistory)if(Math.abs(fleetEffort(row.fleet)-conditionsAt(t,row.time).E)>1e-7)row.fleet=composeFleet(conditionsAt(t,row.time).E,'balanced',shares);
  t.fleet.mode=mode;t.fleet.shares=shares;return copy;
}
export function fleetAt(t:TemporalExperiment,time:number):Fleet {return t.fleetHistory.filter(r=>r.time<=time).at(-1)?.fleet??t.fleet.initial;}
export const fleetEffort = (f:Fleet) => f.counts.reduce((e,n,i)=>e+n*[50,30,20][i]!*f.utilization[i]!,0);
export function validateConditions(p:Conditions) {
  for(const key of conditionKeys) { const n=p[key];if(!Number.isFinite(n))throw new Error(`${key} doit être fini`);
    const [lo,hi]=key==='betaP'?[-10,10]:['S','Sopt','P'].includes(key)?[0,10]:key==='a'?[0,1]:key==='E'?[0,10000]:key==='q0'?[0,1]:[0,10];
    if(n<lo!||n>hi!)throw new Error(`${key} hors de [${lo}, ${hi}]`);
  }
}
export function validateFleet(f:Fleet) {if(f.counts.length!==3||f.utilization.length!==3||f.counts.some(n=>!Number.isInteger(n)||n<0||n>500)||f.utilization.some(u=>!Number.isFinite(u)||u<0||u>1))throw new Error('Composition de flotte invalide');}
/** Exact effort first; full utilization preferred when possible. Shares measure contributions, not boat counts. */
export function composeFleet(e:number,mode:'balanced'|'minimum'='balanced',shares:readonly number[]=[.6,.25,.15]):Fleet {
  if(!Number.isFinite(e)||e<0||e>10000||shares.length!==3||shares.some(s=>!Number.isFinite(s)||s<0)||Math.abs(shares.reduce((a,b)=>a+b,0)-1)>1e-9)throw new Error('Effort ou proportions invalides');
  if(!e)return {counts:[0,0,0],utilization:[0,0,0]};
  if(mode==='minimum'){const n=Math.ceil(e/50);return {counts:[n,0,0],utilization:[e/(50*n),0,0]};}
  let best:Fleet|undefined,bestScore=Infinity,bestCount=Infinity;
  const full=Math.abs(e/10-Math.round(e/10))<1e-10 && e>=20;
  for(let partial=0;partial<3;partial++) {
    const others=[0,1,2].filter(i=>i!==partial),cap=[50,30,20];
    for(let x=0;x<=Math.floor(e/cap[others[0]!]!);x++)for(let y=0;y<=Math.floor((e-x*cap[others[0]!]!)/cap[others[1]!]!);y++) {
      const remaining=Math.max(0,e-x*cap[others[0]!]!-y*cap[others[1]!]!),n=Math.max(0,Math.ceil(remaining/cap[partial]!-1e-12));
      if(full&&Math.abs(remaining-n*cap[partial]!)>1e-8)continue;
      const counts:[number,number,number]=[0,0,0],utilization:[number,number,number]=[1,1,1];counts[others[0]!]=x;counts[others[1]!]=y;counts[partial]=n;utilization[partial]=n?remaining/(n*cap[partial]!):0;
      const score=counts.reduce((s,c,i)=>s+(c*cap[i]!*utilization[i]!/e-shares[i]!)**2,0),total=x+y+n;
      if(score<bestScore-1e-12||(Math.abs(score-bestScore)<1e-12&&total<bestCount)){best={counts,utilization};bestScore=score;bestCount=total;}
    }
  }
  // 10 effort has no full-capacity solution. Rates still represent it exactly.
  return best??{counts:[1,0,0],utilization:[e/50,0,0]};
}
const edgeKey=(e:CoupledDefinition['connections'][number])=>`${e.from.component}:${e.from.port}>${e.to.component}:${e.to.port}`;
export function isWorkshopSchaefer(scope?:Pick<CoupledDefinition,'components'|'connections'>):boolean {
  const canonical=reference.model.definitions[0]!;
  return !!scope&&scope.components.length===canonical.components.length&&scope.connections.length===canonical.connections.length&&canonical.components.every(c=>scope.components.some(a=>a.id===c.id&&a.type===c.type&&Object.entries(c.parameters).filter(([k])=>k.startsWith('coeff-')).every(([k,v])=>a.parameters[k]===v)))&&canonical.connections.every(e=>scope.connections.some(a=>edgeKey(a)===edgeKey(e)));
}
export function temporalScope(request:RunRequest) {const target=request.model.components.find(c=>c.id===request.temporal?.target);return request.model.definitions?.find(d=>d.id===target?.definition);}
export function validateTemporal(request:RunRequest) {
  const t=request.temporal;if(!t)return;
  if(request.schemaVersion!==3||request.simulation.start!==0||request.simulation.end>120)throw new Error('Expérience temporelle v3 : origine 0 et horizon ≤120 mois requis');
  const scope=temporalScope(request),target=request.model.components.find(c=>c.id===t.target);
  if(request.model.components.length!==1||request.model.connections.length!==0)throw new Error('Une expérience temporelle exige une occurrence racine isolée');
  if(target?.type!=='coupled'||!isWorkshopSchaefer(scope)||scope?.units?.time!=='month'||scope?.units?.biomass!=='t')throw new Error('Cible temporelle : occurrence couplée Schaefer en tonnes/mois requise');
  if(request.model.components.filter(c=>c.definition===scope!.id).length!==1)throw new Error('La définition temporelle doit appartenir à une seule occurrence');
  validateConditions(t.parameters);validateFleet(t.fleet.initial);
  if(Math.abs(fleetEffort(t.fleet.initial)-t.parameters.E)>1e-7)throw new Error('Effort initial et flotte incompatibles');
  if(t.fleet.shares.length!==3||t.fleet.shares.some(n=>n<0||!Number.isFinite(n))||Math.abs(t.fleet.shares.reduce((a,b)=>a+b,0)-1)>1e-9)throw new Error('Proportions de contribution : somme 1 requise');
  for(const [id,key] of [['r','r0'],['q','q0'],['a','a'],['E','E']] as const)if(scope!.components.find(c=>c.id===id)?.parameters.value!==t.parameters[key])throw new Error(`Valeur initiale ${id} différente des paramètres temporels`);
  let previous=-Infinity;const state={...t.parameters};const seen=new Set<string>();
  for(const row of t.interventions) {
    if(!conditionKeys.includes(row.parameter)||!Number.isFinite(row.time)||row.time<0||row.time>=request.simulation.end||row.time<previous||row.scenario!==t.scenario||row.unit!==conditionUnits[row.parameter]||!row.provenance.trim())throw new Error('Intervention : date, ordre, unité, cible ou provenance invalide (borne finale exclue)');
    if(seen.has(`${row.time}:${row.parameter}`))throw new Error('Un seul changement par paramètre et instant');seen.add(`${row.time}:${row.parameter}`);
    if(row.oldValue!==state[row.parameter]||!Number.isFinite(row.newValue))throw new Error('Ancienne valeur incohérente dans l’historique');
    state[row.parameter]=row.newValue;validateConditions(state);previous=row.time;
  }
  previous=-Infinity;for(const row of t.fleetHistory){validateFleet(row.fleet);if(!Number.isFinite(row.time)||row.time<0||row.time<=previous||row.time>=request.simulation.end||Math.abs(fleetEffort(row.fleet)-conditionsAt(t,row.time).E)>1e-7)throw new Error('Historique de flotte incohérent');previous=row.time;}
  // Validate expansion budgets before spawning the runner, never silently truncate events.
  const compiled=compileTemporal(request),d=temporalScope({...compiled,temporal:t})!;
  if(d.components.length>128||d.connections.length>512)throw new Error('Budget du graphe temporel dépassé : réduire horizon ou interventions');
}
/** Compile piecewise constant signals into dated DEVS emissions. No N/C integration here. */
export function compileTemporal(request:RunRequest):RunRequest {
  const copy=structuredClone(request),t=copy.temporal;if(!t)return copy;
  const scope=temporalScope(copy)!;delete copy.temporal;
  const dates=new Set<number>([0]);for(let date=3;date<copy.simulation.end;date+=3)dates.add(date);for(const row of t.interventions)dates.add(row.time);
  const times=[...dates].sort((a,b)=>a-b);
  for(const signal of ['r','q','a','E'] as const) {
    const original=scope.components.find(c=>c.id===signal)!;
    const events=times.map(time=>({time,value:ratesAt(conditionsAt(t,time),time)[signal]}));
    const changes=events.filter((e,i)=>i===0||e.value!==events[i-1]!.value);
    scope.components=scope.components.filter(c=>c!==original);
    let source='';let prior=0;
    changes.forEach((e,i)=>{
      const constantId=changes.length===1?signal:`_t${signal}v${i}`,next=i===changes.length-1?signal:`_t${signal}s${i}`;
      scope.components.push({id:constantId,type:'constant',parameters:{value:e.value-prior,offset:e.time}});prior=e.value;
      if(i===0)source=constantId;
      else {scope.components.push({id:next,type:'qss3_wsum_2',parameters:{'coeff-0':1,'coeff-1':1}});scope.connections.push({from:{component:source,port:0},to:{component:next,port:0}},{from:{component:constantId,port:0},to:{component:next,port:1}});source=next;}
    });
    // A single emission retains the public signal name; chains end with it too.
  }
  return copy;
}
