import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import example from '../../../../examples/decision-feedback-schaefer-v3.json' with { type: 'json' };
const evidence=path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '8e') : '../../../build-web-test8e/browser');
const runner=path.resolve(process.env.IRRITATOR_RUNNER!);
const last=(r:any,id:string)=>r.observations.find((o:any)=>o.component===id).samples.at(-1).value;
test.beforeEach(async({page})=>{
  page.on('dialog',d=>d.accept()); await page.goto('/');
  await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(path.resolve('../../examples/decision-feedback-schaefer-v3.json'));
});
async function execute(page:Page,name:string) {
  const wait=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();
  const res=await wait,result=await res.json(),request=res.request().postDataJSON();
  await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,name+'-response.json'),JSON.stringify({request,result,status:res.status()},null,2));
  expect(res.ok(),JSON.stringify(result)).toBe(true);
  const {runId,...actual}=result;expect(runId).toBeTruthy();
  expect(actual).toEqual(JSON.parse(execFileSync(runner,[],{input:JSON.stringify(request),encoding:'utf8',windowsHide:true,timeout:30000})));
  await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,name+'.json'),JSON.stringify({request,result,httpEqualsNative:true},null,2));return result;
}
async function roundtrip(page:Page,name:string,r:any) {
  const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
  const file=path.join(evidence,name+'-export.json');await(await wait).saveAs(file);
  await page.getByRole('button',{name:'Nouveau',exact:true}).click();await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(file);
  const restored=await execute(page,name+'-restored');expect(restored.observations).toEqual(r.observations);expect(restored.resultEvents).toEqual(r.resultEvents);
}
async function rename(page:Page,id:string) {const f=page.getByLabel('Identifiant du composant',{exact:true});await f.fill(id);await f.press('Enter');}
async function add(page:Page,c:any) {
  await page.getByRole('button',{name:c.type==='coupled'?'Insérer '+c.definition:'Ajouter '+c.type,exact:true}).click();await rename(page,c.id);
  for(const [key,value] of Object.entries(c.parameters)) {
    const f=page.getByLabel(key,{exact:true});
    if(await f.evaluate(e=>e.tagName==='SELECT')) await f.selectOption(String(value));else {await f.fill(String(value));await f.blur();}
  }
}
async function wire(page:Page,e:any) {
  if(!await page.getByLabel('Port de sortie',{exact:true}).isVisible()) await page.getByRole('button',{name:'Relier des ports',exact:true}).click();
  await page.getByLabel('Port de sortie',{exact:true}).selectOption(`${e.from.component}|out:${e.from.port}`);
  await page.getByLabel('Port d’entrée',{exact:true}).selectOption(`${e.to.component}|in:${e.to.port}`);
  await page.getByRole('button',{name:'Créer la connexion',exact:true}).click();
}
test('8E importe deux campagnes, états différents, repli puis sélection principale et export scientifique',async({page})=>{
  const r=await execute(page,'two-cycles');expect(last(r,'plant/N')).toBeCloseTo(155.00819,1);expect(last(r,'plant/C')).toBeCloseTo(126.06030,1);expect(last(r,'applied')).toBe(150);
  const n=(c:number)=>r.resultEvents.filter((e:any)=>e.port===6&&e.value[2]===c);
  expect(n(1)).toHaveLength(3);expect(n(2)).toHaveLength(3);expect(n(1)[0].value[0]).toBeCloseTo(138.72355,1);expect(n(2)[0].value[0]).toBeCloseTo(148.03433,1);
  expect(last(r,'primarySelected')).toBe(1);expect(last(r,'secondarySelected')).toBe(1);await roundtrip(page,'two-cycles',r);
});
test('8E construit le Schaefer QSS observable et commandable dans une nouvelle définition React Flow',async({page})=>{
  test.setTimeout(360000);
  const d=example.model.definitions.find(d=>d.id==='SchaeferPlant')!;
  await page.getByLabel('Identifiant de définition',{exact:true}).fill('UiPlant');await page.getByRole('button',{name:'Créer le composant couplé',exact:true}).click();
  for(const [direction,label] of [['inputs','entrée'],['outputs','sortie']] as const) for(const p of d[direction]) {
    await page.getByRole('button',{name:'Ajouter une '+label,exact:true}).click();const f=page.getByLabel(`Nom ${direction} ${p.port}`,{exact:true});await f.fill(p.name);await f.blur();
  }
  for(const c of d.components) await add(page,c);for(const e of d.connections) await wire(page,e);
  await page.getByRole('button',{name:'Fermer les connexions',exact:true}).click();await page.getByRole('button',{name:'Ajuster la vue',exact:true}).click();await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'plant-from-react-flow.png'),fullPage:true});
  await page.getByRole('button',{name:'Modèle principal',exact:true}).click();await page.getByTestId('node-plant').locator('.node-header').click();await page.getByRole('button',{name:'Supprimer le composant',exact:true}).click();
  await add(page,{id:'plant',type:'coupled',definition:'UiPlant',parameters:{}});
  for(const e of example.model.connections.filter(e=>e.from.component==='plant'||e.to.component==='plant')) await wire(page,e);
  await page.getByText(/^Observations hiérarchiques \(/).click();
  for(const leaf of ['N','C','effort','modelHalieutique','observeN','observeC']) {await page.getByLabel('Chemin d’observation',{exact:true}).selectOption('plant/'+leaf);await page.getByRole('button',{name:'Observer ce chemin',exact:true}).click();const interval=page.getByLabel('Pas plant/'+leaf,{exact:true});await interval.fill('.1');await interval.blur();}
  const r=await execute(page,'ui-plant');expect(last(r,'plant/N')).toBeCloseTo(155.00819,1);expect(last(r,'applied')).toBe(150);await roundtrip(page,'ui-plant',r);
});
test('8E reconstruit la synchronisation et le décideur couplés, configure le wrapper et réimporte',async({page})=>{
  test.setTimeout(480000);
  for(const name of ['SynchronizePair','ConditionalDecision','EvaluateCandidates']) {
    const d=example.model.definitions.find(d=>d.id===name)!;
    await page.getByRole('button',{name:'Ouvrir définition '+name,exact:true}).click();
    for(const c of d.components) {await page.getByTestId('node-'+c.id).locator('.node-header').click();await page.getByRole('button',{name:'Supprimer le composant',exact:true}).click();}
    for(const c of d.components) await add(page,c);for(const e of d.connections) await wire(page,e);
    await page.getByRole('button',{name:'Fermer les connexions',exact:true}).click();await page.getByRole('button',{name:'Ajuster la vue',exact:true}).click();await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});
    await page.getByRole('button',{name:'Modèle principal',exact:true}).click();
  }
  await page.getByTestId('node-forecast').locator('.node-header').click();
  for(const id of ['initialN','initialC']) {await page.getByLabel('Entrée obligatoire '+id,{exact:true}).uncheck();await page.getByLabel('Entrée obligatoire '+id,{exact:true}).check();}
  await page.getByLabel('Fin prospective',{exact:true}).fill('20');await page.getByLabel('Fin prospective',{exact:true}).blur();
  await page.getByLabel('Transmettre tous les scénarios au modèle parent',{exact:true}).check();
  const r=await execute(page,'ui-synchronization-decision');expect(last(r,'applied')).toBe(150);expect(last(r,'primarySelected')).toBe(1);await roundtrip(page,'ui-synchronization-decision',r);
});
