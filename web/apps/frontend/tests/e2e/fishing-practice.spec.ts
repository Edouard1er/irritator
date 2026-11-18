import {test,expect,type Page} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {RunRequest} from '../../../../packages/contracts/index';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {monthlyCatches} from '../../lib/simulation/monthly';

const fixture=path.resolve('../../examples/atelier-interventions-month-v3.json'),evidence=path.resolve('../../../reports/effort-evidence');
async function slider(page:Page,index:number){await page.getByLabel('Position temporelle',{exact:true}).fill(String(index));}
async function load(page:Page){
  page.on('dialog',d=>d.accept());await page.goto('/');await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(fixture);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();const response=await pending;expect(response.status(),await response.text()).toBe(200);return response.json();
}
test('video sequence: practice 150→300 at 3.8→100 at 10.3 equals direct native replay, export/import and mobile',async({page,request:api})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1600,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await mkdir(evidence,{recursive:true});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const baseline=await load(page);
  const initial=JSON.parse(await readFile(fixture,'utf8')) as RunRequest;
  const observations=(r:any,id:string)=>r.observations.find((o:any)=>o.component==='lake/'+id).samples as {time:number;value:number}[];
  const indexAt=(r:any,t:number)=>observations(r,'N').findIndex(p=>Math.abs(p.time-t)<1e-9);
  await page.getByLabel('Seuil choisi pour l’atelier',{exact:true}).fill('140');
  await slider(page,indexAt(baseline,3.8));await page.getByRole('button',{name:'Modifier les conditions',exact:true}).click();
  await expect(page.getByLabel('Effort calculé pour le modèle')).toContainText('150');
  await page.getByLabel('Sorties par semaine',{exact:true}).fill('8');
  await expect(page.getByLabel('Effort calculé pour le modèle')).toContainText('300');
  await expect(page.getByRole('button',{name:'Appliquer à partir du mois 3.8',exact:true})).toBeEnabled();
  await page.locator('.conditions-editor').screenshot({path:path.join(evidence,'01-formulaire-bureau.png')});
  const apply=async(time:number,exactTime:number)=>{
    const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Appliquer à partir du mois '+time,exact:true}).click();
    const response=await pending,result=await response.json();expect(response.status(),JSON.stringify(result)).toBe(200);
    await expect(page.locator('[data-resume-time]')).toHaveAttribute('data-resume-time',String(exactTime));await page.getByRole('button',{name:'Pause',exact:true}).click();
    return {result,request:response.request().postDataJSON() as RunRequest};
  };
  const firstTime=observations(baseline,'N')[indexAt(baseline,3.8)]!.time;
  const first=await apply(3.8,firstTime);expect(first.request.temporal!.interventions).toMatchObject([{time:firstTime,parameter:'E',oldValue:150,newValue:300}]);
  await slider(page,indexAt(first.result,10.3));await page.getByRole('button',{name:'Modifier les conditions',exact:true}).click();
  await expect(page.getByLabel('Sorties par semaine')).toHaveValue('8');
  await page.getByLabel('Sorties par semaine',{exact:true}).fill(String(8/3));await expect(page.getByLabel('Effort calculé pour le modèle')).toContainText('100');
  const secondTime=observations(first.result,'N')[indexAt(first.result,10.3)]!.time;
  const second=await apply(10.3,secondTime);
  const contractModule=pathToFileURL(path.resolve('../../dist/packages/contracts/index.js')).href;
  const oracleScript='import {readFileSync} from "node:fs";import {intervene,composeFleet,conditionsAt,nativeRequest} from '+JSON.stringify(contractModule)+';const {initial,times}=JSON.parse(readFileSync(0,"utf8"));let direct=initial;for(const [time,E] of times)direct=intervene(direct,time,{...conditionsAt(direct.temporal,time),E},composeFleet(E),"balanced",[.6,.25,.15]);process.stdout.write(JSON.stringify({direct,native:nativeRequest(direct)}));';
  const {direct}=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',oracleScript],{input:JSON.stringify({initial,times:[[firstTime,300],[secondTime,100]]}),encoding:'utf8'}));
  expect(second.request).toEqual(direct);
  const oracleResponse=await api.post('/api/v1/simulations/run',{data:direct});expect(oracleResponse.status(),await oracleResponse.text()).toBe(200);const oracle=await oracleResponse.json();
  // Identical deterministic native graphs must produce bit-identical samples (no display tolerance).
  expect(second.result.observations).toEqual(oracle.observations);
  for(const id of ['N','C'])for(const point of observations(baseline,id).filter(p=>p.time<=3.8))expect(Math.abs(observations(second.result,id).find(p=>p.time===point.time)!.value-point.value)).toBeLessThan(1e-7);
  const points=observations(second.result,'N');expect(points.some(p=>p.value<=140)).toBe(true);
  expect(monthlyCatches(observations(second.result,'C'),24)).toEqual(monthlyCatches(observations(oracle,'C'),24));
  await slider(page,indexAt(second.result,11.3));await expect(page.getByRole('heading',{name:'DANGER : SEUIL FRANCHI'})).toBeVisible();
  await expect(page.locator('.biomass-card .js-plotly-plot')).toBeVisible();
  await expect.poll(()=>page.locator('.biomass-card .js-plotly-plot').evaluate((el:any)=>el.data.some((t:any)=>t.name==='Trajectoire initiale'))).toBe(true);
  expect(await page.locator('.biomass-card .js-plotly-plot').evaluate((el:any)=>el.layout.shapes.filter((s:any)=>s.line.color==='#8c4089').map((s:any)=>s.x0))).toEqual([firstTime,secondTime]);
  expect(await page.locator('.biomass-card .js-plotly-plot').evaluate((el:any)=>el.data.find((t:any)=>t.name==='Trajectoire initiale').y)).toEqual(observations(baseline,'N').map(p=>p.value));
  await page.locator('.simulation-container').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(evidence,'02-resultats-sequence.png'),fullPage:true});
  await page.getByRole('button',{name:'Modifier les conditions',exact:true}).click();await page.locator('.practice-details summary').click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter les pratiques appliquées'}).click();const practices=await download,practiceText=await readFile((await practices.path())!,'utf8');
  const sidecar=JSON.parse(practiceText);expect(sidecar.request).toEqual(second.request);expect(sidecar.history.records.map((r:any)=>r.time)).toEqual([firstTime,secondTime]);expect(sidecar.history.reference.modelEffort).toBe(150);
  await page.getByRole('button',{name:'Annuler',exact:true}).click();await page.locator('.intervention-history summary').click();
  const nativeDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter l’expérience avec historique'}).click();expect(JSON.parse(await readFile((await (await nativeDownload).path())!,'utf8'))).toEqual(second.request);
  // Import the ordinary JSON alone: practice must be explicitly missing, never reverse-engineered from E.
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles({name:'experience.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(second.request))});
  const rerun=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();expect((await rerun).status()).toBe(200);
  await slider(page,indexAt(second.result,11.3));await page.getByRole('button',{name:'Modifier les conditions',exact:true}).click();
  await expect(page.getByLabel('Sorties par semaine')).toBeEmpty();await expect(page.getByRole('button',{name:/Appliquer à partir/})).toBeDisabled();await page.locator('.practice-details summary').click();
  await page.getByLabel('Importer les pratiques associées').setInputFiles({name:'pratiques.json',mimeType:'application/json',buffer:Buffer.from(practiceText)});
  await expect(page.getByLabel('Sorties par semaine')).toHaveValue(String(8/3));await expect(page.getByLabel('Effort calculé pour le modèle')).toContainText('100');
  await page.locator('.practice-details summary').click();await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('.conditions-editor').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.getByLabel('Nombre de pirogues',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByLabel('Type de pirogue')).toBeFocused();
  await page.screenshot({path:path.join(evidence,'03-formulaire-mobile-pirogues.png')});
  await page.getByRole('button',{name:/Appliquer à partir/}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:/Appliquer à partir/})).toBeInViewport();
  await expect(page.getByLabel('Effort calculé pour le modèle')).toBeInViewport();
  await page.screenshot({path:path.join(evidence,'04-formulaire-mobile-effort.png')});
  await page.getByRole('button',{name:'Annuler',exact:true}).click();
  await writeFile(path.join(evidence,'native-equivalence.json'),JSON.stringify({tolerance:0,prefixTolerance:1e-7,initial,first,second,direct,oracle,sidecar},null,2));expect(errors).toEqual([]);
});
