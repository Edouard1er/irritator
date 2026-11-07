import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const evidence=path.resolve('../../../build-web-test8b/browser');
const runner=path.resolve(process.env.IRRITATOR_RUNNER!);
const last=(r:any,id:string)=>r.observations.find((o:any)=>o.component===id).samples.at(-1).value;
test.beforeEach(async({page})=>{page.on('dialog',d=>d.accept());});
async function open(page:Page,file?:string) {
  await page.goto('/'); await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
  if(file) await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(path.resolve('../../examples/'+file));
}
async function rename(page:Page,id:string) {const f=page.getByLabel('Identifiant du composant',{exact:true});await f.fill(id);await f.press('Enter');}
async function add(page:Page,type:string,id:string,params:Record<string,number>={},observed=false) {
  await page.getByRole('button',{name:'Ajouter '+type,exact:true}).click(); await rename(page,id);
  for(const [key,v]of Object.entries(params)) {const f=page.getByLabel(key,{exact:true});if(await f.evaluate(e=>e.tagName==='SELECT')) await f.selectOption(String(v));else await f.fill(String(v));}
  if(observed){await page.getByLabel('Observer ce composant',{exact:true}).check();await page.getByLabel('Pas d’observation',{exact:true}).fill('0.1');}
}
async function wire(page:Page,from:string,fp:number,to:string,tp:number) {
  if(!await page.getByLabel('Port de sortie',{exact:true}).isVisible())await page.getByRole('button',{name:'Relier des ports',exact:true}).click();
  await page.getByLabel('Port de sortie',{exact:true}).selectOption(`${from}|out:${fp}`);
  await page.getByLabel('Port d’entrée',{exact:true}).selectOption(`${to}|in:${tp}`);
  await page.getByRole('button',{name:'Créer la connexion',exact:true}).click();
}
async function execute(page:Page,name:string) {
  const wait=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();
  const res=await wait,result=await res.json(),request=res.request().postDataJSON(); expect(res.ok(),JSON.stringify(result)).toBe(true);
  const {runId,...actual}=result;expect(runId).toBeTruthy();
  expect(actual).toEqual(JSON.parse(execFileSync(runner,[],{input:JSON.stringify(request),encoding:'utf8',windowsHide:true,timeout:30000})));
  await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,name+'.json'),JSON.stringify({request,result,directEqualsHttp:true},null,2));
  return {request,result};
}
async function roundtrip(page:Page,name:string,result:any) {
  const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
  const file=path.join(evidence,name+'-export.json');await(await wait).saveAs(file);
  await page.getByRole('button',{name:'Nouveau',exact:true}).click();await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(file);
  const restored=(await execute(page,name+'-restored')).result;
  expect(restored.observations).toEqual(result.observations);expect(restored.resultEvents).toEqual(result.resultEvents);
  return JSON.parse(await readFile(file,'utf8'));
}
test('8B construit tout le décideur depuis le seul prospectif Schaefer et configure les seuils',async({page})=>{
  test.setTimeout(240000);await open(page);
  const original=JSON.parse(await readFile(path.resolve('../../model-test/schaefer-six-scenarios.source.json'),'utf8'));
  const source={schemaVersion:2,model:{id:'manual-schaefer',definitions:original.model.definitions,components:[original.model.components[0]],connections:[],observations:[]},simulation:original.simulation};
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles({name:'prospectif-seul.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
  await add(page,'simulation_wrapper','decision');await page.getByLabel('Définition prospective',{exact:true}).selectOption('Schaefer');
  await page.getByLabel('Fin prospective',{exact:true}).fill('20');
  for(const [id,target,values] of [['effort','E','80,150,260'],['capturabilite','q','0.0008,0.001']]) {
    await page.getByRole('button',{name:'Ajouter un facteur',exact:true}).click();
    const card=page.getByTestId('factor-factor1'),field=card.getByLabel('Id du facteur',{exact:true});await field.fill(id!);await field.press('Enter');
    const renamed=page.getByTestId('factor-'+id);await renamed.getByLabel('Cible du facteur',{exact:true}).selectOption(target!);
    await renamed.getByLabel('Type du facteur',{exact:true}).selectOption('fixed');await renamed.getByLabel('Valeurs fixes',{exact:true}).fill(values!);
  }
  for(const [id,target,criteria]of [['Nmin','N','min'],['CH','C','max-last']]) {
    await page.getByRole('button',{name:'Ajouter une sélection',exact:true}).click();
    const f=page.getByTestId('selection-selection1').getByLabel('Id de la sélection',{exact:true});await f.fill(id!);await f.press('Enter');
    const c=page.getByTestId('selection-'+id);await c.getByLabel('Cible observable',{exact:true}).selectOption(target!);await c.getByLabel('Critère',{exact:true}).selectOption(criteria!);
  }
  await page.getByLabel('Sélection primaire',{exact:true}).selectOption('CH');
  await page.getByLabel('Transmettre tous les scénarios au modèle parent',{exact:true}).check();
  await expect(page.getByLabel('Inspecteur expérimental')).toContainText('10 sorties');
  await page.getByLabel('Identifiant de définition',{exact:true}).fill('DecisionFiltrage');
  await page.getByRole('button',{name:'Créer le composant couplé',exact:true}).click();
  for(const [kind,names] of [['entrée',['Nmin','CH','E','end']],['sortie',['action','identity','score','selected']]] as const) for(const name of names){await page.getByLabel('Nom du port externe',{exact:true}).fill(name);await page.getByRole('button',{name:'Ajouter une '+kind,exact:true}).click();}
  await add(page,'event_operator','admissible',{operation:10,right:140,required:1});
  await add(page,'candidate_filter','filter',{required:7});await add(page,'candidate_select','select',{emitFallback:0});
  for(const [a,ap,b,bp]of [['$input',0,'admissible',0],['$input',3,'admissible',3],['$input',1,'filter',0],['$input',2,'filter',1],['admissible',0,'filter',2],['admissible',2,'filter',3],['filter',0,'select',0],['filter',1,'select',1],['filter',2,'select',2],...Array.from({length:4},(_,p)=>['select',p,'$output',p])] as [string,number,string,number][])await wire(page,a,ap,b,bp);
  await page.getByRole('button',{name:'Ajuster la vue',exact:true}).click();await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'manual-definition.png'),fullPage:true});
  await page.getByRole('button',{name:'Modèle principal',exact:true}).click();await page.getByRole('button',{name:'Insérer DecisionFiltrage',exact:true}).click();await rename(page,'external');
  await add(page,'qss1_sum_2','action',{},true);await add(page,'value_memory','actionReceipt',{initial:-999,emitOnWrite:1},true);
  for(const id of ['identity','score'])await add(page,'qss1_sum_2',id,{},true);
  await add(page,'value_memory','selected',{emitOnWrite:1},true);
  for(const id of ['internalE','internalQ'])await add(page,'qss1_sum_2',id,{},true);
  for(const [a,ap,b,bp]of [['run',0,'decision',1],['decision',7,'external',0],['decision',8,'external',1],['decision',5,'external',2],['decision',9,'external',3],['external',0,'action',0],['external',0,'actionReceipt',0],['external',1,'identity',0],['external',2,'score',0],['external',3,'selected',0],['decision',2,'internalE',0],['decision',3,'internalQ',0]] as [string,number,string,number][])await wire(page,a,ap,b,bp);
  const {request,result}=await execute(page,'manual-140');expect(last(result,'action')).toBe(150);expect(last(result,'identity')).toBe(4);expect(last(result,'internalE')).toBe(260);expect(last(result,'internalQ')).toBe(.0008);
  expect(request.model.definitions[0]).toEqual(original.model.definitions[0]);expect(result.wrappers[0].scenarioCount).toBe(6);
  const exported=await roundtrip(page,'manual-140',result);expect(exported.model.definitions.find((d:any)=>d.id==='DecisionFiltrage').components).toHaveLength(3);
  for(const [threshold,expected,identity]of [[120,260,2],[160,0,-1]]){
    await page.getByRole('button',{name:'Ouvrir définition DecisionFiltrage',exact:true}).click();await page.getByTestId('node-admissible').click();await page.getByLabel('right',{exact:true}).fill(String(threshold));
    await page.getByRole('button',{name:'Modèle principal',exact:true}).click();const r=(await execute(page,'manual-'+threshold)).result;expect(last(r,'action')).toBe(expected);expect(last(r,'identity')).toBe(identity);if(threshold===160)expect(last(r,'actionReceipt')).toBe(-999);
  }
  await page.screenshot({path:path.join(evidence,'manual-parent.png'),fullPage:true});
});
test('8B importe l’exemple et remappe les ports dynamiques après réordonnancement',async({page})=>{
  await open(page,'decision-schaefer-external-v3.json');
  const r=(await execute(page,'example')).result;expect(last(r,'action')).toBe(150);expect(last(r,'identity')).toBe(4);
  await page.getByTestId('node-decision').click();await page.getByRole('button',{name:'Monter facteur capturabilite',exact:true}).click();
  await page.getByRole('button',{name:'Monter sélection CH',exact:true}).click();
  const changed=(await execute(page,'reordered')).result;expect(last(changed,'action')).toBe(150);expect(last(changed,'identity')).toBe(3);
  expect(last(changed,'internalE')).toBe(260);await roundtrip(page,'reordered',changed);
});
