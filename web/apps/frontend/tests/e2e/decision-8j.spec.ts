import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const evidence=path.resolve(process.env.IRRITATOR_8J_BROWSER_EVIDENCE??'../../../build-web-test8j/browser');
const runner=path.resolve(process.env.IRRITATOR_RUNNER!);
async function select(page:Page,id:string){
  const ports=page.locator('details.external-ports[open] > summary');if(await ports.isVisible())await ports.click();
  await page.getByRole('button',{name:'Ajuster la vue',exact:true}).click();
  const node=page.getByTestId('rf__node-'+id);await node.focus();await node.press('Enter');
  await expect(page.getByLabel('Identifiant du composant',{exact:true})).toHaveValue(id);
}
async function execute(page:Page,name:string,error=false){
  const wait=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();const res=await wait,result=await res.json(),request=res.request().postDataJSON();
  const p=spawnSync(runner,[],{input:JSON.stringify(request),encoding:'utf8',windowsHide:true,timeout:30000});
  const {runId,requestId,...actual}=result;expect(res.status()).toBe(error?422:200);expect(p.status).toBe(error?2:0);expect(actual).toEqual(JSON.parse(p.stdout));
  await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,name+'.json'),JSON.stringify({request,result,httpEqualsNative:true},null,2));return actual;
}
async function load(page:Page,file:string){await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(path.resolve('../../examples/'+file));}
async function budget(page:Page,name:string,value:string){const f=page.getByLabel(name,{exact:true});if(await f.evaluate(e=>e.tagName==='SELECT'))await f.selectOption(value);else {await f.fill(value);await f.blur();}}
async function roundtrip(page:Page,name:string,original:any){
  const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();const file=path.join(evidence,name+'-export.json');await(await wait).saveAs(file);
  await page.getByRole('button',{name:'Nouveau',exact:true}).click();await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(file);
  const r=await execute(page,name+'-restored');expect(r.resultEvents).toEqual(original.resultEvents);expect(r.observations).toEqual(original.observations);
}
test.beforeEach(async({page})=>{page.on('dialog',d=>d.accept());await page.goto('/');await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();});
test('8J edits both policies and budgets, wires native outcomes, runs and roundtrips in React Flow',async({page})=>{
  test.setTimeout(120000);await load(page,'decision-fault-tolerant-minimal-v3.json');await select(page,'forecast');
  await expect(page.getByLabel('Gestion des échecs')).toHaveValue('isolate');await page.getByLabel('Gestion des échecs').selectOption('fail-fast');
  expect((await execute(page,'fail-fast',true)).error.engineCode).toBe(67);await select(page,'forecast');await page.getByLabel('Gestion des échecs').selectOption('isolate');
  await budget(page,'maxChildRunCalls','1');const stopped=await execute(page,'budget');expect(stopped.resultEvents.filter((e:any)=>e.port===7).map((e:any)=>e.value)).toEqual([[0,2,1],[0,2,2]]);
  await select(page,'forecast');await budget(page,'maxChildRunCalls','10000');await budget(page,'maxCampaignRunCalls','100000');
  await page.getByRole('button',{name:'Ajouter value_memory',exact:true}).click();const id=page.getByLabel('Identifiant du composant',{exact:true});await id.fill('statusMemory');await id.press('Enter');
  await page.getByLabel('Observer ce composant',{exact:true}).check();await budget(page,'emitOnWrite','1');
  await page.getByRole('button',{name:'Relier des ports',exact:true}).click();await page.getByLabel('Port de sortie',{exact:true}).selectOption('forecast|out:8');await page.getByLabel('Port d’entrée',{exact:true}).selectOption('statusMemory|in:0');await page.getByRole('button',{name:'Créer la connexion',exact:true}).click();
  await page.getByRole('button',{name:'Fermer les connexions',exact:true}).click();const r=await execute(page,'isolated');
  expect(r.resultEvents.filter((e:any)=>e.port===8).map((e:any)=>e.value[0])).toEqual([1,2,1,2]);expect(r.observations.find((o:any)=>o.component==='statusMemory').samples.at(-1).value).toBe(2);
  await select(page,'forecast');await page.setViewportSize({width:1600,height:1200});await page.getByLabel('maxCampaignRunCalls',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(evidence,'execution-inspector.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});await roundtrip(page,'isolated',r);
});
test('8J Schaefer collect-only preserves decisions; exhausted children produce no new action',async({page})=>{
  test.setTimeout(120000);await load(page,'tstar-schaefer-execution-safety-v3.json');await select(page,'forecast');await page.getByLabel('Restitution',{exact:true}).selectOption('collect');
  const r=await execute(page,'schaefer-collect');expect(r.resultEvents.filter((e:any)=>e.port<6)).toHaveLength(0);
  expect(r.observations.find((o:any)=>o.component==='applied').samples.at(-1).value).toBe(150);await roundtrip(page,'schaefer-collect',r);
  await select(page,'forecast');await budget(page,'maxChildRunCalls','1');const s=await execute(page,'schaefer-budget');expect(s.resultEvents.filter((e:any)=>e.port===13).every((e:any)=>e.value[0]===0)).toBe(true);
  expect(s.observations.find((o:any)=>o.component==='applied').samples.at(-1).value).toBe(260);
});
