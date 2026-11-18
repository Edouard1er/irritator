import {test,expect,type Page} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const evidence=path.resolve('../../../reports/quick-trips-evidence');
const fixture=path.resolve('../../examples/atelier-interventions-month-v3.json');
const card=(p:Page)=>p.getByRole('region',{name:'Ajuster mes sorties de pêche',exact:true});
const sidebar=(p:Page)=>p.getByRole('complementary',{name:'Ma façon de pêcher.'});
const frequency=(p:Page)=>card(p).getByRole('slider',{name:'Fréquence des sorties de pêche'});
const samples=(r:any)=>r.observations.find((o:any)=>o.component==='lake/N').samples as {time:number;value:number}[];
async function seek(p:Page,r:any,time:number){
  const i=samples(r).findIndex(s=>Math.abs(s.time-time)<1e-9);expect(i).toBeGreaterThanOrEqual(0);
  await p.getByLabel('Position temporelle',{exact:true}).fill(String(i));
  return samples(r)[i]!.time;
}
async function load(p:Page,source?:object){
  await p.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(source?{name:'experience.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))}:fixture);
  const pending=p.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await p.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();const response=await pending;
  expect(response.status(),await response.text()).toBe(200);return response.json();
}
async function apply(p:Page,quick=true){
  const pending=p.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await (quick?card(p):p.getByRole('form',{name:'Conditions de l’intervention'})).getByRole('button',{name:/^Appliquer à partir du mois/}).click();
  const response=await pending;expect(response.status(),await response.text()).toBe(200);
  await p.getByRole('button',{name:'Pause',exact:true}).click();
  return {request:response.request().postDataJSON(),result:await response.json()};
}
async function capture(p:Page,name:string){
  await p.locator('.simulation-container').evaluate(el=>el.scrollTop=0);
  await expect(p.locator('.biomass-card .js-plotly-plot')).toBeVisible();
  expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await p.locator('.simulation-container').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await p.screenshot({path:path.join(evidence,name),style:'nextjs-portal{display:none}'});
}
test.beforeEach(async({page})=>{
  page.on('dialog',d=>d.accept());await page.setViewportSize({width:1920,height:1080});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();await mkdir(evidence,{recursive:true});
});

test('desktop preview → native E300 at exact 3.8 → habit E150 at exact 10.3; same full editor, stable reference and restoration',async({page})=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let baseline=await load(page);await expect(card(page)).toContainText('Repère proposé : 4 sorties/semaine');
  // First explicit validation of the participant's habitual practice uses the existing editor.
  await card(page).getByRole('button',{name:'Personnaliser',exact:true}).click();
  await expect(page.getByLabel(/Je confirme la pratique/)).toBeChecked();
  const confirmed=await apply(page,false);baseline=confirmed.result;
  const at=await seek(page,baseline,3.8);await expect(card(page)).toContainText('Habituel : 4 sorties/semaine');
  await expect(card(page).getByRole('button',{name:/^Appliquer/})).toBeDisabled();
  const beforeSidebar=await sidebar(page).textContent(),beforeMetrics=await page.locator('.workshop-metrics').textContent();
  const graph=()=>page.locator('.biomass-card .js-plotly-plot').evaluate((el:any)=>JSON.stringify(el.data.map((t:any)=>({x:t.x,y:t.y}))));
  const beforeGraph=await graph(),requests:string[]=[];page.on('request',r=>{if(r.url().endsWith('/simulations/run'))requests.push(r.postData()??'');});
  for(const [trips,E] of [[2,'75'],[3,'112,5'],[4,'150'],[5,'187,5'],[6,'225'],[8,'300']]){
    await frequency(page).fill(String(trips));await expect(card(page).getByLabel('Aperçu de l’effort')).toContainText(`E = ${E}`);
  }
  expect(requests).toHaveLength(0);await expect(sidebar(page)).toHaveText(beforeSidebar!);await expect(page.locator('.workshop-metrics')).toHaveText(beforeMetrics!);expect(await graph()).toBe(beforeGraph);
  await capture(page,'01-apercu-1920x1080.png');await page.setViewportSize({width:1366,height:768});await capture(page,'02-apercu-1366x768.png');await page.setViewportSize({width:1920,height:1080});
  const quick=await apply(page);await seek(page,quick.result,3.8);
  expect(quick.request.temporal.interventions.find((r:any)=>r.parameter==='E'&&r.time===at)).toMatchObject({newValue:300});
  await expect(sidebar(page)).toContainText('8 / semaine');await expect(sidebar(page).getByLabel('Effort du modèle appliqué')).toContainText('E = 300');
  await expect(card(page)).toContainText('Habituel : 4 sorties/semaine');await expect(card(page).getByRole('button',{name:/^Appliquer/})).toBeDisabled();
  await capture(page,'03-applique-1920x1080.png');await page.setViewportSize({width:1366,height:768});await capture(page,'04-applique-1366x768.png');await page.setViewportSize({width:1920,height:1080});
  // Exactly one full editor instance, shared with the sidebar and environment strip.
  await card(page).getByRole('button',{name:'Personnaliser',exact:true}).click();
  await page.getByRole('form',{name:'Conditions de l’intervention'}).evaluate(el=>el.setAttribute('data-instance','same-editor'));
  await page.getByRole('button',{name:'Modifier mes pratiques',exact:true}).click();
  await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();
  await expect(page.locator('.conditions-editor')).toHaveCount(1);await expect(page.locator('.conditions-editor')).toHaveAttribute('data-instance','same-editor');
  const full=await apply(page,false);expect(full.request).toEqual(quick.request);expect(full.result.observations).toEqual(quick.result.observations);
  await seek(page,full.result,3.7);await expect(frequency(page)).toHaveValue('4');await expect(sidebar(page)).toContainText('4 / semaine');await expect(card(page)).toContainText('Habituel : 4 sorties/semaine');
  const later=await seek(page,full.result,10.3);await card(page).getByRole('button',{name:'Habitude',exact:true}).click();
  await expect(frequency(page)).toHaveValue('4');const habit=await apply(page);await seek(page,habit.result,10.3);
  expect(habit.request.temporal.interventions.find((r:any)=>r.parameter==='E'&&r.time===later).newValue).toBe(150);
  // Replacing an earlier decision preserves the absolute future decision.
  await seek(page,habit.result,3.8);await frequency(page).fill('6');const earlier=await apply(page);await seek(page,earlier.result,3.8);
  const events=earlier.request.temporal.interventions.filter((r:any)=>r.parameter==='E');expect(events.filter((r:any)=>r.time===at)).toHaveLength(1);
  expect(events.find((r:any)=>r.time===at).newValue).toBe(225);expect(events.find((r:any)=>r.time===later).newValue).toBe(150);
  await card(page).getByRole('button',{name:'Personnaliser',exact:true}).click();await page.locator('.practice-details summary').click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter les pratiques appliquées'}).click();const text=await readFile((await (await download).path())!,'utf8'),saved=JSON.parse(text);
  expect(saved.version).toBe(2);expect(saved.history.habitualPractice.tripsPerWeek).toBe(4);expect(saved.history.reference.modelEffort).toBe(150);
  expect(saved.history.records.find((r:any)=>r.time===at).practice.tripsPerWeek).toBe(6);expect(saved.request).not.toHaveProperty('habitualPractice');
  await page.getByRole('button',{name:'Annuler',exact:true}).click();await load(page,earlier.request);
  await expect.poll(()=>page.locator('.biomass-card .js-plotly-plot').evaluate((el:any)=>el.data.some((t:any)=>t.name==='Trajectoire initiale'))).toBe(true);
  await seek(page,earlier.result,4);await expect(frequency(page)).toBeDisabled();
  await card(page).getByRole('button',{name:'Personnaliser',exact:true}).click();await page.locator('.practice-details summary').click();
  await page.getByLabel('Importer les pratiques associées').setInputFiles({name:'pratiques.json',mimeType:'application/json',buffer:Buffer.from(text)});
  const restored=await apply(page,false);await seek(page,restored.result,4);await expect(frequency(page)).toHaveValue('6');await expect(card(page)).toContainText('Habituel : 4 sorties/semaine');
  await writeFile(path.join(evidence,'native-equivalence-and-history.json'),JSON.stringify({at,later,quick,full,habit,earlier,saved,tolerance:0},null,2));expect(errors).toEqual([]);
});

test('time change and API failure discard no applied state; rapid drafts never confirm the proposed habit',async({page})=>{
  const baseline=await load(page);await seek(page,baseline,3.8);await frequency(page).fill('8');
  await seek(page,baseline,3.7);await expect(frequency(page)).toHaveValue('4');await expect(card(page)).toContainText('aperçu a été abandonné');
  await seek(page,baseline,3.8);await frequency(page).fill('8');const before=await sidebar(page).textContent(),metrics=await page.locator('.workshop-metrics').textContent();
  await page.route('**/api/v1/simulations/run',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'ENGINE_UNAVAILABLE',message:'Test indisponibilité'}})}));
  await card(page).getByRole('button',{name:/^Appliquer/}).click();await expect(page.locator('.simulation-playback-main > .error-banner')).toContainText('ENGINE_UNAVAILABLE');
  await expect(sidebar(page)).toHaveText(before!);await expect(page.locator('.workshop-metrics')).toHaveText(metrics!);await expect(frequency(page)).toHaveValue('8');
  await expect(page.locator('[data-resume-time]')).toHaveCount(0);await page.unroute('**/api/v1/simulations/run');
  const success=await apply(page);await seek(page,success.result,3.8);await expect(card(page)).toContainText('Pratique habituelle à confirmer');
  await card(page).getByRole('button',{name:'Personnaliser',exact:true}).click();await page.getByRole('button',{name:'Annuler',exact:true}).click();
  await seek(page,success.result,10.3);await frequency(page).fill('0');const zero=await apply(page);expect(zero.request.temporal.interventions.find((r:any)=>r.parameter==='E'&&r.newValue===0)).toBeTruthy();
});

test('starting a slider adjustment pauses the animation first; Apply alone recalculates and resumes it',async({page})=>{
  const baseline=await load(page);await seek(page,baseline,3.8);
  await page.getByLabel('Vitesse de lecture').selectOption('0.5');
  await page.getByRole('button',{name:'Reprendre',exact:true}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await frequency(page).scrollIntoViewIfNeeded();
  const bounds=await frequency(page).boundingBox();expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2);await page.mouse.down();
  await expect(page.getByRole('button',{name:'Reprendre',exact:true})).toBeVisible();await page.mouse.up();
  const position=await page.getByLabel('Position temporelle',{exact:true}).inputValue();
  const at=samples(baseline)[Number(position)]!.time;
  const sidebarBefore=await sidebar(page).textContent(),calls:string[]=[];page.on('request',r=>{if(r.url().endsWith('/simulations/run'))calls.push(r.postData()??'');});
  await frequency(page).press('End');await expect(frequency(page)).toHaveValue('8');await expect(card(page)).toContainText('Animation en pause');
  // Observe longer than one playback tick: preparing cannot advance the simulated cursor.
  await page.waitForTimeout(400);await expect(page.getByLabel('Position temporelle',{exact:true})).toHaveValue(position);
  expect(calls).toHaveLength(0);await expect(sidebar(page)).toHaveText(sidebarBefore!);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await card(page).getByRole('button',{name:/^Appliquer/}).click();const response=await pending;expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().temporal.interventions.find((r:any)=>r.parameter==='E').time).toBe(at);
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await expect.poll(async()=>Number(await page.getByLabel('Position temporelle',{exact:true}).inputValue())).toBeGreaterThan(Number(position));
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  // Keyboard editing from a playing animation pauses it too.
  await page.getByRole('button',{name:'Reprendre',exact:true}).click();await frequency(page).press('ArrowLeft');
  await expect(page.getByRole('button',{name:'Reprendre',exact:true})).toBeVisible();
});

for(const gear of ['longline','seine'])test(`quick ${gear} preserves V2 factors and fields, yields bit-identical full-editor observations`,async({page})=>{
  const baseline=await load(page);await seek(page,baseline,3.8);await card(page).getByRole('button',{name:'Personnaliser',exact:true}).click();
  await page.getByLabel('Engin principal').selectOption(gear);await page.getByLabel('Type de pirogue').selectOption('yes');
  if(gear==='longline'){await page.getByLabel('Hameçons par ligne').fill('20');await page.getByLabel('Durée effective d’utilisation des lignes (h par sortie)').fill('4');}
  else {await page.getByLabel('Nombre d’engins par sortie').fill('1');await page.getByLabel('Opérations par senne et par sortie').fill('2');}
  const initial=await apply(page,false);await seek(page,initial.result,10.3);await frequency(page).fill('6');
  await expect(card(page).getByLabel('Aperçu de l’effort')).toContainText(gear==='longline'?'207':'351');
  const quick=await apply(page);await seek(page,quick.result,10.3);await card(page).getByRole('button',{name:'Personnaliser',exact:true}).click();
  await expect(page.getByLabel('Engin principal')).toHaveValue(gear);await expect(page.getByLabel('Sorties par semaine',{exact:true})).toHaveValue('6');
  const full=await apply(page,false);expect(full.request).toEqual(quick.request);expect(full.result.observations).toEqual(quick.result.observations);
});
