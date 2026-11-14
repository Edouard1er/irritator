import {composeFleet,defaultConditions,isWorkshopSchaefer,validateRequest,wrapperOccurrences,type RunRequest} from '@contracts';
import type {Trajectory} from './trajectory';
/** Materialize a selected static scenario as a new, isolated experiment at the origin. */
export function interactiveRequest(request:RunRequest,run:Trajectory):RunRequest {
  if(run.units?.time!=='month'||run.units.biomass!=='t')throw new Error('Unités tonnes/mois requises');
  const wrapper=wrapperOccurrences(request).find(o=>run.id.startsWith(`${o.component}:`));
  const root=request.model.components.find(c=>`root:${c.id}`===run.id);
  const definition=request.model.definitions?.find(d=>d.id===(wrapper?.experiment.definition??root?.definition));
  if(!isWorkshopSchaefer(definition))throw new Error('Graphe Schaefer reconnu requis');
  const d=structuredClone(definition!),p={...defaultConditions};
  for(const [id,key] of [['r','r0'],['q','q0'],['a','a'],['E','E']] as const){const value=run.parameters[id];if(value===undefined)throw new Error(`Paramètre ${id} non disponible`);d.components.find(c=>c.id===id)!.parameters.value=value;p[key]=value;}
  if(run.parameters['B0/N0']!==undefined)d.components.find(c=>c.id==='N')!.parameters.X=run.parameters['B0/N0'];
  if(run.parameters.C!==undefined)d.components.find(c=>c.id==='C')!.parameters.X=run.parameters.C;
  if(run.parameters.K!==undefined)d.components.find(c=>c.id==='InvK')!.parameters.value=1/run.parameters.K;
  const next:RunRequest={schemaVersion:3,model:{id:`${request.model.id.slice(0,42)}-interactif`,units:structuredClone(d.units!),definitions:[d],components:[{id:'lake',type:'coupled',definition:d.id,parameters:{}}],connections:[],observations:['N','C','r','q','a','E'].map(id=>({component:`lake/${id}`,samplingInterval:.1}))},simulation:{start:0,end:run.series.find(s=>s.kind==='biomass_total')?.points.at(-1)?.time??24},temporal:{target:'lake',scenario:run.id,parameters:p,fleet:{mode:'balanced',shares:[.6,.25,.15],initial:composeFleet(p.E)},fleetHistory:[],interventions:[],provenance:`Nouvelle expérience pédagogique issue de ${request.model.id} / ${run.id}. Calendrier et réponses environnementales non calibrés pour le lac de Guiers. Nouveau calcul depuis l’origine ; aucun ancien résultat réétiqueté.`}};
  validateRequest(next);return next;
}
