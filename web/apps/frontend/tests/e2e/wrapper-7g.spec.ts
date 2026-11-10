import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { RunRequest, RunResultV2 } from '@contracts';
const evidence=path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '7g') : '../../../build-web-test7g/logs/browser');
const runner=path.resolve(process.env.IRRITATOR_RUNNER??'../../../build-web-test7g/Release/runner/irritator-runner.exe');
const file=path.resolve('../../examples/wrapper-schaefer-v3.json');
async function document():Promise<RunRequest> {return JSON.parse(await readFile(file,'utf8'));}
async function start(page:Page,m?:RunRequest) {
  page.on('dialog',d=>d.accept()); await page.goto('/');
  await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(m?{name:'schaefer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(m))}:file);
}
function direct(m:RunRequest) {return JSON.parse(execFileSync(runner,[],{input:JSON.stringify(m),encoding:'utf8',windowsHide:true,timeout:10000}));}
async function execute(page:Page,name:string) {
  const waiting=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();
  const response=await waiting,result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);
  const request=response.request().postDataJSON() as RunRequest;const {runId,...native}=result;
  expect(runId).toBeTruthy();expect(native).toEqual(direct(request));
  await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,name+'.json'),JSON.stringify({request,result,directEqualsHttp:true},null,2));
  return {request,result:result as RunResultV2};
}
async function roundtrip(page:Page,name:string,expected:RunResultV2) {
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
  const exported=path.join(evidence,name+'-export.json');await (await downloading).saveAs(exported);
  await page.getByRole('button',{name:'Nouveau',exact:true}).click();await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(exported);
  const restored=(await execute(page,name+'-restored')).result;
  expect(restored.resultEvents).toEqual(expected.resultEvents);expect(restored.wrappers).toEqual(expected.wrappers);expect(restored.observations).toEqual(expected.observations);
  return JSON.parse(await readFile(exported,'utf8'));
}
async function fixed(page:Page) {
  await page.getByTestId('node-decision').click();await page.getByLabel('Type du facteur',{exact:true}).selectOption('fixed');
  await page.getByLabel('Valeurs fixes',{exact:true}).fill('200,260,320');
}
test('7G importe Schaefer, vérifie les 15 atomes/18 connexions, modifie E et reproduit les observations parent',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
  await page.getByTestId('node-decision').click();
  await expect(page.getByLabel('Cible du facteur',{exact:true})).toHaveValue('E');
  for(const name of ['N','C']) {await expect(page.getByTestId('selection-'+name).getByLabel('Cible observable')).toHaveValue(name);await expect(page.getByTestId('selection-'+name).getByLabel('Critère',{exact:true})).toHaveValue('max-last');}
  await page.getByLabel('Inspecteur expérimental').getByRole('button',{name:'Ouvrir le prospectif',exact:true}).click();
  const d=(await document()).model.definitions![0]!;
  for(const c of d.components) await expect(page.getByTestId('node-'+c.id)).toBeAttached();
  for(const e of d.connections) await expect(page.getByLabel(`${e.from.component} sortie ${e.from.port} vers ${e.to.component} entrée ${e.to.port}`,{exact:true})).toBeAttached();
  await page.getByRole('button',{name:'Ajuster la vue',exact:true}).click();await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'schaefer-definition.png'),fullPage:true});
  await page.getByRole('button',{name:'Modèle principal',exact:true}).click();
  const single=(await execute(page,'single-reference')).result;
  expect(single.resultEvents.map(e=>e.value[0])).toEqual([129.8069509703022,72.34097477635842,260]);
  expect(single.observations.map(o=>o.samples.at(-1)!.value)).toEqual([129.8069509703022,72.34097477635842,260]);
  await fixed(page);await page.getByLabel('Sélection primaire',{exact:true}).selectOption('C');
  const changed=await execute(page,'simple-max-C');expect(changed.result.resultEvents[2]!.value[0]).toBe(320);
  expect(changed.result.wrappers[0]!.scenarioCount).toBe(3);await expect(page.getByTestId('wrapper-summary-decision')).toContainText('critères bruts');
  await roundtrip(page,'simple-max-C',changed.result);expect(errors).toEqual([]);
});
for(const norm of ['min-max','z-score']) test(`7G configure weighted-sum ${norm} dans l’inspecteur`,async({page})=>{
  await start(page);await fixed(page);await page.getByLabel('Méthode',{exact:true}).selectOption('weighted-sum');
  await page.getByLabel('Poids N',{exact:true}).fill('2');await page.getByLabel('Poids C',{exact:true}).fill('1');
  await page.getByLabel('Sens du critère N',{exact:true}).selectOption('minimize');
  await page.getByLabel('Normalisation',{exact:true}).selectOption(norm);
  const {result}=await execute(page,'weighted-'+norm);expect(result.resultEvents[2]!.value[0]).toBe(320);
  if(norm==='min-max') expect(result.resultEvents.map(e=>e.value[0])).toEqual([1,1,320]);
  else expect(Math.abs(result.resultEvents[0]!.value[0])).toBeLessThan(2);
  await expect(page.getByTestId('wrapper-summary-decision')).toContainText('critères normalisés');
  await page.screenshot({path:path.join(evidence,'weighted-'+norm+'.png'),fullPage:true});await roundtrip(page,'weighted-'+norm,result);
});
test('7G configure epsilon N>=125/C>=0 puis vérifie l’absence de décision admissible',async({page})=>{
  await start(page);await fixed(page);await page.getByLabel('Méthode',{exact:true}).selectOption('epsilon-constrained');
  await page.getByLabel('Sélection primaire',{exact:true}).selectOption('C');await page.getByLabel('Epsilon N',{exact:true}).fill('125');
  const {result}=await execute(page,'epsilon-feasible');expect(result.resultEvents[2]!.value[0]).toBe(260);
  await expect(page.getByTestId('wrapper-summary-decision')).toContainText('critères bruts');
  await page.getByTestId('node-decision').click();await page.getByLabel('Epsilon N',{exact:true}).fill('1000');
  const empty=await execute(page,'epsilon-empty');expect(empty.result.resultEvents).toEqual([]);
  await expect(page.getByLabel('Événements natifs du wrapper').getByRole('status')).toContainText('sans candidat admissible');await expect(page.getByTestId('wrapper-events')).toHaveCount(0);
});
test('7G deux wrappers Schaefer : plans édités séparément et conservés au réimport',async({page})=>{
  const m=await document(),left=m.model.components.find(c=>c.id==='decision')!;
  left.experiment!.factors[0]={id:'effort',target:'E',parameter:'value',type:'fixed',values:[200,260]};
  const right=structuredClone(left);right.id='right';right.experiment!.factors[0]={id:'effort',target:'E',parameter:'value',type:'fixed',values:[260,320]};m.model.components.push(right);
  m.model.connections.push({from:{component:'run',port:0},to:{component:'right',port:1}});
  await start(page,m);await page.getByTestId('node-right').click();await page.getByLabel('Valeurs fixes',{exact:true}).fill('260, 300, 320');
  const {result}=await execute(page,'pair');expect(result.wrappers.map(w=>w.scenarioCount)).toEqual([2,3]);
  expect(result.resultEvents.filter(e=>e.port===2).map(e=>e.value[0])).toEqual([200,260]);
  const exported=await roundtrip(page,'pair',result);
  expect(exported.model.components.filter((c:{experiment?:unknown})=>c.experiment).map((c:{experiment:{factors:{values:number[]}[]}})=>c.experiment.factors[0]!.values)).toEqual([[200,260],[260,300,320]]);
});
test('7G construit le plan et connecte run dans React Flow à partir du seul prospectif',async({page})=>{
  test.setTimeout(120000);
  const m=await document();m.schemaVersion=2;m.model.components=m.model.components.slice(0,1);m.model.connections=[];m.model.observations=[];
  await start(page,m);await page.getByRole('button',{name:'Ajouter simulation_wrapper',exact:true}).click();
  const id=page.getByLabel('Identifiant du composant',{exact:true});await id.fill('decision');await id.press('Enter');
  await page.getByLabel('Définition prospective',{exact:true}).selectOption('Schaefer');
  await page.getByRole('button',{name:'Ajouter un facteur',exact:true}).click();
  await page.getByLabel('Cible du facteur',{exact:true}).selectOption('E');await page.getByLabel('Type du facteur',{exact:true}).selectOption('fixed');await page.getByLabel('Valeurs fixes',{exact:true}).fill('200,260,320');
  for(const name of ['N','C']) {
    await page.getByRole('button',{name:'Ajouter une sélection',exact:true}).click();
    const card=page.getByTestId('selection-selection1'),field=card.getByLabel('Id de la sélection',{exact:true});await field.fill(name);await field.press('Enter');
    await page.getByTestId('selection-'+name).getByLabel('Cible observable',{exact:true}).selectOption(name);
  }
  await page.getByLabel('Sélection primaire',{exact:true}).selectOption('C');
  await page.getByRole('button',{name:'Relier des ports',exact:true}).click();
  await page.getByLabel('Port de sortie',{exact:true}).selectOption('run|out:0');await page.getByLabel('Port d’entrée',{exact:true}).selectOption('decision|in:1');
  await page.getByRole('button',{name:'Créer la connexion',exact:true}).click();
  const {request,result}=await execute(page,'built-in-ui');expect(request.schemaVersion).toBe(3);expect(result.resultEvents[2]!.value[0]).toBe(320);
  expect(request.model.components.find(c=>c.experiment)!.experiment!.selections.map(s=>s.target)).toEqual(['N','C']);
  expect(request.model.definitions![0]!.components).toEqual(m.model.definitions![0]!.components);
  await roundtrip(page,'built-in-ui',result);
});
