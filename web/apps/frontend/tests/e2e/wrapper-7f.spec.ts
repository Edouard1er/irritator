import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { affine } from '../wrapper-fixtures';
import type { RunRequest, RunResultV2 } from '@contracts';

const evidence=path.resolve(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT ? path.join(process.env.IRRITATOR_BROWSER_REGRESSION_ROOT, '7f') : '../../../build-web-test7f/logs/browser');
const runner=path.resolve(process.env.IRRITATOR_RUNNER??'../../../build-web-test7f/Release/runner/irritator-runner.exe');
async function open(page:Page,document:RunRequest=affine()) {
  page.on('dialog',dialog=>dialog.accept());await page.goto('/');
  await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles({name:'wrapper-7f.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
  await page.getByTestId('node-decision').click();
}
async function execute(page:Page,name:string) {
  const waiting=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();
  const response=await waiting,result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);
  const request=response.request().postDataJSON();
  const direct=JSON.parse(execFileSync(runner,[],{input:JSON.stringify(request),encoding:'utf8',windowsHide:true}));
  const {runId,...native}=result;expect(runId).toBeTruthy();expect(native).toEqual(direct);
  await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,name+'.json'),JSON.stringify({request,result,directEqualsHttp:true},null,2));
  return {request:request as RunRequest,result:result as RunResultV2};
}
async function roundtrip(page:Page,name:string,expected:RunResultV2) {
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
  const file=path.join(evidence,name+'-export.json');await (await download).saveAs(file);
  const document=JSON.parse(await readFile(file,'utf8'));
  await page.getByRole('button',{name:'Nouveau',exact:true}).click();await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(file);
  expect((await execute(page,name+'-restored')).result.resultEvents).toEqual(expected.resultEvents);return document;
}
test('7F simple, single-add, complete : édition et décision native',async({page})=>{
  await open(page);await page.getByLabel('Type du facteur',{exact:true}).selectOption('single-add');await page.getByLabel('Valeur unique',{exact:true}).fill('2');
  const {result}=await execute(page,'simple-single');expect(result.resultEvents.map(e=>e.value[0])).toEqual([5,1,2]);
  await expect(page.getByTestId('wrapper-summary-decision')).toContainText('critères bruts');
});
for(const norm of ['min-max','z-score']) test(`7F weighted-sum fixed ${norm} : poids, directions et export`,async({page})=>{
  await open(page);await page.getByLabel('Méthode',{exact:true}).selectOption('weighted-sum');
  await page.getByLabel('Poids terminal',{exact:true}).fill('2');await page.getByLabel('Sens du critère minimum',{exact:true}).selectOption('minimize');await page.getByLabel('Normalisation',{exact:true}).selectOption(norm);
  const {result,request}=await execute(page,'weighted-'+norm);
  expect(request.model.components[1]!.experiment!.objective.method).toBe('weighted-sum');expect(result.resultEvents[2]!.value[0]).toBe(1);
  expect(result.resultEvents[0]!.value[0]).toBeCloseTo(norm==='min-max'?1:Math.sqrt(1.5),12);
  await expect(page.getByTestId('wrapper-summary-decision')).toContainText('critères normalisés');
  await page.screenshot({path:path.join(evidence,'weighted-'+norm+'.png'),fullPage:true});
  if(norm==='z-score') {
    await page.getByTestId('node-decision').click();await page.getByRole('button',{name:'Monter sélection minimum',exact:true}).click();
    await expect(page.getByLabel('Poids terminal',{exact:true})).toHaveValue('2');
    const changed=await execute(page,'weighted-reordered');expect(changed.result.resultEvents.map(e=>e.value[0])).toEqual([result.resultEvents[1]!.value[0],result.resultEvents[0]!.value[0],1]);
    await roundtrip(page,'weighted-workspace',changed.result);
  }
});
test('7F epsilon-constrained : contrainte primaire, absence de candidat',async({page})=>{
  await open(page);await page.getByLabel('Méthode',{exact:true}).selectOption('epsilon-constrained');
  await page.getByLabel('Opération terminal',{exact:true}).selectOption('less-equal');await page.getByLabel('Epsilon terminal',{exact:true}).fill('1');await page.getByLabel('Epsilon minimum',{exact:true}).fill('1');
  const {result}=await execute(page,'epsilon-feasible');expect(result.resultEvents.map(e=>e.value[0])).toEqual([1,1,0]);
  await page.getByTestId('node-decision').click();await page.getByLabel('Epsilon minimum',{exact:true}).fill('2');
  const empty=await execute(page,'epsilon-empty');expect(empty.result.resultEvents).toEqual([]);
  await expect(page.getByLabel('Événements natifs du wrapper').getByRole('status')).toContainText('sans candidat admissible');await expect(page.getByTestId('wrapper-events')).toHaveCount(0);
});
test('7F random-mult : distribution, paramètres et graine u64 sans perte',async({page})=>{
  await open(page);await page.getByLabel('Type du facteur',{exact:true}).selectOption('random-mult');await page.getByLabel('Distribution',{exact:true}).selectOption('uniform-int');
  await page.getByLabel('ints[0] · borne inférieure',{exact:true}).fill('2');await page.getByLabel('ints[1] · borne supérieure',{exact:true}).fill('2');await page.getByLabel('Nombre de tirages',{exact:true}).fill('4');
  await page.getByLabel('Configurer la graine native',{exact:true}).check();const seed=page.getByLabel('seed[0]',{exact:true});await seed.fill('18446744073709551615');await seed.press('Enter');
  const {result,request}=await execute(page,'random-seeded');expect(result.resultEvents.map(e=>e.value[0])).toEqual([5,1,2]);expect(request.model.components[1]!.experiment!.seed![0]).toBe('18446744073709551615');expect(result.wrappers[0]!.scenarioCount).toBe(4);
  await page.screenshot({path:path.join(evidence,'random-seeded.png'),fullPage:true});
  const exported=await roundtrip(page,'random-seeded',result);expect(exported.model.components[1].experiment.seed[0]).toBe('18446744073709551615');
});
for(const mode of ['complete','bag','time','until','during']) test(`7F mode ${mode} : horloges distinctes et vrai Fastify`,async({page})=>{
  const document=affine(),e=document.model.components[1]!.experiment!,d=document.model.definitions![0]!;
  e.simulation={start:10,end:12};d.components.length=1;d.connections=[];for(const s of e.selections)s.target='u';
  for(const [i,offset] of [.5,1,1.5].entries())d.components.push({id:'clock'+i,type:'constant',parameters:{value:0,offset}});
  document.simulation.end=30;document.model.components[0]!.parameters.offset=5;
  await open(page,document);await page.getByLabel('Mode d’exécution',{exact:true}).selectOption(mode);
  await page.getByTestId('node-run').click();const arg=mode==='until'?10.75:mode==='during'?.75:0;await page.getByLabel('value',{exact:true}).fill(String(arg));
  const {result,request}=await execute(page,'mode-'+mode);expect(request.model.components[1]!.experiment!.run).toBe(mode);expect(result.resultEvents).toHaveLength(3);
  expect(result.resultEvents[0]!.time).toBe(5+arg);expect(result.resultEvents[0]!.value[0]).toBe(1);expect(result.simulation.finalTime).toBe(30);
  await expect(page.getByTestId('wrapper-events').locator('tbody tr')).toHaveCount(3);
});
