import {test,expect,type Page} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {RunRequest} from '../../../../packages/contracts/index';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {monthlyCatches} from '../../lib/simulation/monthly';

const fixture=path.resolve('../../examples/atelier-interventions-month-v3.json'),evidence=path.resolve('../../../reports/effort-v2-evidence');
async function slider(page:Page,index:number){await page.getByLabel('Position temporelle',{exact:true}).fill(String(index));}
async function load(page:Page){
  page.on('dialog',d=>d.accept());await page.goto('/');await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(fixture);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();const response=await pending;expect(response.status(),await response.text()).toBe(200);return response.json();
}
test('video sequence: practice 150→300 at 3.8→100 at 10.3 equals direct native replay, export/import on desktop',async({page,request:api})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1600,height:1100});await page.emulateMedia({reducedMotion:'reduce'});await mkdir(evidence,{recursive:true});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const baseline=await load(page);
  const initial=JSON.parse(await readFile(fixture,'utf8')) as RunRequest;
  const observations=(r:any,id:string)=>r.observations.find((o:any)=>o.component==='lake/'+id).samples as {time:number;value:number}[];
  const indexAt=(r:any,t:number)=>observations(r,'N').findIndex(p=>Math.abs(p.time-t)<1e-9);
  await page.getByLabel('Seuil choisi pour l’atelier',{exact:true}).fill('140');
  await slider(page,indexAt(baseline,3.8));await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();
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
  await slider(page,indexAt(first.result,10.3));await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();
  await expect(page.getByLabel('Sorties par semaine')).toHaveValue('8');
  await page.getByLabel('Sorties par semaine',{exact:true}).fill(String(8/3));await expect(page.getByLabel('Effort calculé pour le modèle')).toContainText('100');
  const secondTime=observations(first.result,'N')[indexAt(first.result,10.3)]!.time;
  const second=await apply(10.3,secondTime);
  const contractModule=pathToFileURL(path.resolve('../../dist/packages/contracts/index.js')).href;
  const oracleScript='import {readFileSync} from "node:fs";import {intervene,composeFleet,conditionsAt,nativeRequest} from '+JSON.stringify(contractModule)+';const {initial,times}=JSON.parse(readFileSync(0,"utf8"));let direct=initial;for(const [time,E] of times)direct=intervene(direct,time,{...conditionsAt(direct.temporal,time),E},composeFleet(E),"balanced",[.6,.25,.15]);process.stdout.write(JSON.stringify({direct,native:nativeRequest(direct)}));';
  const {direct}=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',oracleScript],{input:JSON.stringify({initial,times:[[firstTime,300],[secondTime,100]]}),encoding:'utf8'}));
  const numericalRequest=structuredClone(second.request);
  for(const row of numericalRequest.temporal!.interventions)if(row.parameter==='E'){
    expect(row.provenance).toContain('effort calculé depuis les pratiques');expect(row.provenance).not.toContain('saisie explicite');
    row.provenance=direct.temporal.interventions.find((r:any)=>r.parameter==='E'&&r.time===row.time).provenance;
  }
  expect(numericalRequest).toEqual(direct);
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
  await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();await page.locator('.practice-details summary').click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter les pratiques appliquées'}).click();const practices=await download,practiceText=await readFile((await practices.path())!,'utf8');
  const sidecar=JSON.parse(practiceText);expect(sidecar.request).toEqual(second.request);expect(sidecar.history.records.map((r:any)=>r.time)).toEqual([firstTime,secondTime]);expect(sidecar.history.reference.modelEffort).toBe(150);
  await page.getByRole('button',{name:'Annuler',exact:true}).click();await page.locator('.intervention-history summary').click();
  const nativeDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter l’expérience avec historique'}).click();expect(JSON.parse(await readFile((await (await nativeDownload).path())!,'utf8'))).toEqual(second.request);
  // Import JSON alone: propose editable defaults, explicitly distinguished from restored practice.
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles({name:'experience.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(second.request))});
  const rerun=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();expect((await rerun).status()).toBe(200);
  await slider(page,indexAt(second.result,11.3));await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();
  await expect(page.getByLabel('Sorties par semaine')).toHaveValue('4');await expect(page.getByLabel('Effort calculé pour le modèle')).toContainText('150');await expect(page.getByRole('button',{name:/Appliquer à partir/})).toBeEnabled();await page.locator('.practice-details summary').click();
  await page.getByLabel('Importer les pratiques associées').setInputFiles({name:'pratiques.json',mimeType:'application/json',buffer:Buffer.from(practiceText)});
  await expect(page.getByLabel('Sorties par semaine')).toHaveValue('2.666667');await expect(page.getByLabel('Effort calculé pour le modèle')).toContainText('100');
  await page.locator('.practice-details summary').click();
  await page.getByLabel('Nombre de pirogues',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByLabel('Type de pirogue')).toBeFocused();
  await page.locator('.conditions-editor').screenshot({path:path.join(evidence,'03-restauration-bureau.png')});
  await page.getByRole('button',{name:'Annuler',exact:true}).click();
  await writeFile(path.join(evidence,'native-equivalence.json'),JSON.stringify({tolerance:0,prefixTolerance:1e-7,initial,first,second,direct,oracle,sidecar},null,2));expect(errors).toEqual([]);
});

test('desktop V2: three gears, motorization, mesh units, configuration cancel/save and native restoration',async({page})=>{
  test.setTimeout(90000);await page.setViewportSize({width:1700,height:1200});await mkdir(evidence,{recursive:true});
  const baseline=await load(page),n=baseline.observations.find((o:any)=>o.component==='lake/N').samples;
  await slider(page,n.findIndex((p:any)=>Math.abs(p.time-3.8)<1e-9));
  await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();
  const output=page.getByLabel('Effort calculé pour le modèle'),apply=page.getByRole('button',{name:/Appliquer à partir/});
  await page.getByLabel('Type de pirogue').selectOption('yes');await expect(output).toContainText('180');
  await page.getByLabel('Taille des mailles',{exact:true}).fill('35');await expect(output).toContainText('162');
  await page.getByLabel('Type de pirogue').selectOption('no');await expect(output).toContainText('135');
  await page.getByLabel('Unité des mailles').selectOption('cm');await page.getByLabel('Taille des mailles',{exact:true}).fill('4.6');await expect(output).toContainText('150');
  await page.getByLabel('Taille des mailles',{exact:true}).fill('46');await expect(apply).toBeDisabled();await expect(page.locator('.conditions-editor').getByRole('alert')).toContainText('hors du domaine');
  await page.getByLabel('Engin principal').selectOption('longline');await expect(apply).toBeDisabled();
  await page.getByLabel('Hameçons par ligne').fill('20');await page.getByLabel('Durée effective d’utilisation des lignes (h par sortie)').fill('4');await expect(output).toContainText('120');
  await page.getByLabel('Type de pirogue').selectOption('yes');await expect(output).toContainText('138');
  await page.getByLabel('Engin principal').selectOption('seine');await page.getByLabel('Nombre d’engins par sortie').fill('1');await page.getByLabel('Opérations par senne et par sortie').fill('2');await expect(output).toContainText('234');
  await page.getByLabel('Type de pirogue').selectOption('no');await expect(output).toContainText('180');
  await page.locator('.conditions-editor').screenshot({path:path.join(evidence,'04-senne-bureau.png')});
  await page.getByLabel('Engin principal').selectOption('longline');await page.getByLabel('Nombre d’engins par sortie').fill('2');await expect(output).toContainText('120');
  await page.locator('.practice-details summary').click();
  const c=JSON.parse(await readFile(path.resolve('lib/simulation/fishing-effort-config.v2.json'),'utf8'));c.id='scenario-custom';c.gearReferences.line.relativePower=1;
  const upload=()=>page.getByLabel('Charger une configuration de facteurs').setInputFiles({name:'facteurs.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(c))});
  await upload();await expect(output).toContainText('150');
  await page.getByRole('button',{name:'Annuler',exact:true}).click();await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();await expect(output).toContainText('150');
  await page.getByLabel('Engin principal').selectOption('longline');await page.getByLabel('Hameçons par ligne').fill('20');await page.getByLabel('Durée effective d’utilisation des lignes (h par sortie)').fill('4');await expect(output).toContainText('120');
  await page.locator('.practice-details summary').click();await upload();await expect(output).toContainText('150');
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');await apply.click();const response=await pending;expect(response.status(),await response.text()).toBe(200);const sent=response.request().postDataJSON();
  await page.getByRole('button',{name:'Pause',exact:true}).click();await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();
  await expect(page.getByLabel('Engin principal')).toHaveValue('longline');await expect(output).toContainText('150');await page.locator('.practice-details summary').click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter les pratiques appliquées'}).click();const text=await readFile((await (await download).path())!,'utf8'),sidecar=JSON.parse(text);
  expect(sidecar.version).toBe(2);expect(sidecar.history.records[0].configuration.id).toBe('scenario-custom');expect(sidecar.history.records[0].effortDerivation.gearFactor).toBe(1);
  await page.getByRole('button',{name:'Annuler',exact:true}).click();
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles({name:'experience.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sent))});
  const rerun=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();expect((await rerun).status()).toBe(200);
  await slider(page,n.findIndex((p:any)=>Math.abs(p.time-4)<1e-9));await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();await page.locator('.practice-details summary').click();
  await page.getByLabel('Importer les pratiques associées').setInputFiles({name:'pratiques.json',mimeType:'application/json',buffer:Buffer.from(text)});
  await expect(page.getByLabel('Engin principal')).toHaveValue('longline');await expect(output).toContainText('150');await expect(page.locator('.practice-details')).toContainText('scenario-custom');
  await page.locator('.conditions-editor').screenshot({path:path.join(evidence,'05-ligne-configuration-restauree.png')});
  await writeFile(path.join(evidence,'v2-configuration-roundtrip.json'),JSON.stringify({request:sent,sidecar},null,2));
});

test('each V2 gear submits only its calculated E through the existing native intervention adapter',async({page})=>{
  test.setTimeout(90000);const baseline=await load(page),n=baseline.observations.find((o:any)=>o.component==='lake/N').samples;
  const sent:any[]=[];
  for(const [time,gear,E] of [[3.8,'longline',120],[10.3,'seine',180],[11.3,'gillnet',162]] as const){
    await slider(page,n.findIndex((p:any)=>Math.abs(p.time-time)<1e-9));await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();
    await page.getByLabel('Engin principal').selectOption(gear);
    if(gear==='longline'){await page.getByLabel('Hameçons par ligne').fill('20');await page.getByLabel('Durée effective d’utilisation des lignes (h par sortie)').fill('4');}
    if(gear==='seine'){await page.getByLabel('Nombre d’engins par sortie').fill('1');await page.getByLabel('Opérations par senne et par sortie').fill('2');}
    if(gear==='gillnet'){await page.getByLabel('Nombre d’engins par sortie').fill('2');await page.getByLabel('Type de pirogue').selectOption('yes');await page.getByLabel('Taille des mailles',{exact:true}).fill('35');}
    await expect(page.getByLabel('Effort calculé pour le modèle')).toContainText(String(E));
    const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');await page.getByRole('button',{name:/Appliquer à partir/}).click();const response=await pending;expect(response.status(),await response.text()).toBe(200);
    const request=response.request().postDataJSON();expect(request.temporal.interventions.filter((r:any)=>r.parameter==='E').at(-1).newValue).toBe(E);expect(request.temporal.parameters.q0).toBe(.001);sent.push(request);
    await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.locator('canvas[data-effort]')).toHaveAttribute('data-effort',String(E));
  }
  await writeFile(path.join(evidence,'three-gears-native-requests.json'),JSON.stringify(sent,null,2));
});
