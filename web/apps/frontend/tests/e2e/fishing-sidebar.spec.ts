import {test,expect,type Page} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';

const evidence=path.resolve('../../../reports/sidebar-pecheur-evidence');
const fixture=path.resolve('../../examples/atelier-interventions-month-v3.json');
const sidebar=(page:Page)=>page.getByRole('complementary',{name:'Ma façon de pêcher.'});
const effort=(page:Page)=>sidebar(page).getByLabel('Effort du modèle appliqué');
async function expectEffortInsideSidebar(page:Page){
  await expect.poll(()=>effort(page).evaluate(el=>{
    const output=el.getBoundingClientRect(),panel=el.closest('.fishing-practice-sidebar')!.getBoundingClientRect();
    const viewport=el.closest('.simulation-container')!.getBoundingClientRect();
    return output.top>=panel.top&&output.bottom<=Math.min(panel.bottom,viewport.bottom);
  })).toBe(true);
}
const samples=(result:any)=>result.observations.find((o:any)=>o.component==='lake/N').samples as {time:number;value:number}[];
async function seek(page:Page,result:any,time:number){
  const index=samples(result).findIndex(p=>Math.abs(p.time-time)<1e-9);expect(index).toBeGreaterThanOrEqual(0);
  await page.getByLabel('Position temporelle',{exact:true}).fill(String(index));
}
async function load(page:Page,source?:object){
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(source?{name:'experience.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))}:fixture);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();const response=await pending;
  expect(response.status(),await response.text()).toBe(200);const result=await response.json();
  if((source as {temporal?:{interventions:unknown[]}}|undefined)?.temporal?.interventions.length){
    // Loading an existing history also requests its native comparison trajectory.
    await expect.poll(()=>page.locator('.biomass-card .js-plotly-plot').evaluate((el:any)=>el.data.some((t:any)=>t.name==='Trajectoire initiale'))).toBe(true);
  }
  return result;
}
async function apply(page:Page){
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:/^Appliquer à partir du mois/}).click();const response=await pending;
  expect(response.status(),await response.text()).toBe(200);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  return {result:await response.json(),request:response.request().postDataJSON()};
}
test.beforeEach(async({page})=>{
  page.on('dialog',d=>d.accept());await page.setViewportSize({width:1920,height:1080});
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
});

test('desktop sidebar shares one editor, follows applied practices and uses the full viewport width',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const initial=await load(page);
  await expect(sidebar(page)).toContainText('4 / semaine');await expect(effort(page)).toHaveText('Effort du modèle : E = 150 effort');
  const edit=page.getByRole('button',{name:'Modifier mes pratiques',exact:true});
  await edit.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#simulation-conditions-editor')).toBeFocused();
  await expect(page.getByRole('heading',{name:'Modifier les conditions au mois 0',exact:true})).toBeVisible();
  await page.getByRole('form',{name:'Conditions de l’intervention'}).evaluate(el=>el.setAttribute('data-instance','shared'));
  await page.getByLabel('Sorties par semaine',{exact:true}).fill('8');
  await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();await edit.click();
  await expect(page.locator('.conditions-editor')).toHaveCount(1);await expect(page.locator('.conditions-editor')).toHaveAttribute('data-instance','shared');
  await expect(page.getByLabel('Sorties par semaine',{exact:true})).toHaveValue('8');await expect(effort(page)).toContainText('150');
  await page.getByRole('button',{name:'Annuler',exact:true}).click();await expect(edit).toBeFocused();
  await expect(sidebar(page)).toContainText('4 / semaine');
  // The initial sidebar reads the very same default practice as the existing editor.
  await seek(page,initial,0);
  const boat=sidebar(page).getByRole('region',{name:'Mon embarcation'});
  await expect(boat).toContainText('Non motorisée');await expect(boat).toContainText('4 / semaine');await expect(boat).toContainText('6 h');await expect(boat).toContainText('Toutes les pirogues');
  const gear=sidebar(page).getByRole('region',{name:'Mes engins de pêche'});
  for(const text of ['2 filets','50 m / filet','46 mm','4 h / sortie'])await expect(gear).toContainText(text);
  await mkdir(evidence,{recursive:true});
  for(const [width,height] of [[1366,768],[1920,1080],[2560,1440]]){
    await page.setViewportSize({width:width!,height:height!});
    await page.locator('.simulation-container').evaluate(el=>el.scrollTop=0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.locator('.simulation-container').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await page.locator('.simulation-workspace').evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(width);
    expect(await sidebar(page).evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(280);
    await expect.poll(()=>sidebar(page).evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-el.closest('.simulation-container')!.getBoundingClientRect().bottom))).toBeLessThan(2);
    expect(await sidebar(page).evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
    await expectEffortInsideSidebar(page);
    expect(await sidebar(page).evaluate(el=>getComputedStyle(el).overflowY)).toBe('visible');
    await effort(page).scrollIntoViewIfNeeded();await expect(effort(page)).toBeVisible();
    await sidebar(page).evaluate(el=>el.scrollTop=0);await page.locator('.simulation-container').evaluate(el=>el.scrollTop=0);
    if(width!==2560)await page.screenshot({path:path.join(evidence,`simulation-${width}x${height}.png`),style:'nextjs-portal{display:none}'});
  }
  await page.setViewportSize({width:1366,height:768});
  await page.getByRole('button',{name:'Grand écran',exact:true}).click();
  await expect.poll(()=>sidebar(page).evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-innerHeight))).toBeLessThan(2);
  expect(await sidebar(page).evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  await expect.poll(()=>page.locator('.biomass-card .workshop-plot').evaluate(el=>Math.abs(el.querySelector('svg.main-svg')!.getBoundingClientRect().width-el.clientWidth))).toBeLessThan(2);
  expect(await page.locator('.simulation-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:path.join(evidence,'simulation-plein-ecran.png'),style:'nextjs-portal{display:none}'});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1920,height:1080});await seek(page,initial,3.8);await edit.click();
  await expect(page.getByRole('heading',{name:'Modifier les conditions au mois 3.8',exact:true})).toBeVisible();
  await page.getByLabel('Sorties par semaine',{exact:true}).fill('8');await expect(effort(page)).toContainText('150');
  const changed=await apply(page);await seek(page,changed.result,3.8);
  expect(changed.request.temporal.interventions.find((r:any)=>r.parameter==='E').newValue).toBe(300);
  await expect(boat).toContainText('8 / semaine');await expect(effort(page)).toContainText('E = 300');
  await page.setViewportSize({width:1366,height:768});await page.locator('.simulation-container').evaluate(el=>el.scrollTop=0);
  await expect.poll(()=>sidebar(page).evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-el.closest('.simulation-container')!.getBoundingClientRect().bottom))).toBeLessThan(2);
  expect(await sidebar(page).evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  await expectEffortInsideSidebar(page);
  await page.setViewportSize({width:1920,height:1080});
  await expect(page.locator('.biomass-card .js-plotly-plot')).toBeVisible();
  await expect.poll(()=>page.locator('.biomass-card .js-plotly-plot').evaluate((el:any)=>el.data.some((t:any)=>t.name==='Trajectoire initiale'))).toBe(true);
  await page.locator('.simulation-container').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(evidence,'simulation-apres-intervention.png'),style:'nextjs-portal{display:none}'});
  await seek(page,changed.result,3.7);await expect(boat).toContainText('4 / semaine');await expect(effort(page)).toContainText('E = 150');
  await page.getByRole('button',{name:'Reprendre',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();await expect(page.locator('.conditions-editor')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('only successful interventions change gear cards; validation and API failures preserve the applied panel',async({page})=>{
  const baseline=await load(page);await seek(page,baseline,3.8);await page.getByRole('button',{name:'Modifier mes pratiques',exact:true}).click();
  await page.getByLabel('Engin principal').selectOption('longline');await page.getByLabel('Hameçons par ligne').fill('20');
  await page.getByLabel('Durée effective d’utilisation des lignes (h par sortie)').fill('4');
  const line=await apply(page);await seek(page,line.result,3.8);
  const gear=sidebar(page).getByRole('region',{name:'Mes engins de pêche'});
  await expect(gear).toContainText('Lignes');await expect(gear).toContainText('Hameçons / ligne20');await expect(gear).toContainText('Durée effective4 h / sortie');
  await expect(gear).not.toContainText('Maillage');await expect(effort(page)).toContainText('E = 120');
  await seek(page,line.result,0);await expect(sidebar(page)).toContainText('4 / semaine');await expect(effort(page)).toContainText('E = 150');
  await seek(page,line.result,10.3);await page.getByRole('button',{name:'Modifier mes pratiques',exact:true}).click();
  await page.getByLabel('Engin principal').selectOption('seine');await page.getByLabel('Nombre d’engins par sortie').fill('1');await page.getByLabel('Opérations par senne et par sortie').fill('2');
  const seine=await apply(page);await seek(page,seine.result,10.3);
  await expect(gear).toContainText('Sennes');await expect(gear).toContainText('Opérations / senne / sortie2');await expect(gear).not.toContainText('Hameçons');await expect(gear).not.toContainText('Durée effective');await expect(effort(page)).toContainText('E = 180');
  const metrics=(await page.locator('.workshop-metrics').textContent())!,before=(await sidebar(page).textContent())!;
  await page.getByRole('button',{name:'Modifier mes pratiques',exact:true}).click();await page.getByLabel('Nombre de pirogues',{exact:true}).fill('0');
  await expect(page.getByRole('button',{name:/^Appliquer à partir/})).toBeDisabled();await expect(sidebar(page)).toHaveText(before);
  await page.getByLabel('Nombre de pirogues',{exact:true}).fill('1');await page.getByLabel('Sorties par semaine',{exact:true}).fill('8');
  await page.route('**/api/v1/simulations/run',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'ENGINE_UNAVAILABLE',message:'Test indisponibilité'}})}));
  await page.getByRole('button',{name:/^Appliquer à partir/}).click();await expect(page.locator('.simulation-playback-main > .error-banner')).toContainText('ENGINE_UNAVAILABLE');
  await expect(sidebar(page)).toHaveText(before);await expect(page.locator('.workshop-metrics')).toHaveText(metrics);
  await page.getByRole('button',{name:'Annuler',exact:true}).click();await expect(sidebar(page)).toHaveText(before);
});

for(const version of [1,2])test(`a V${version} sidecar restores applied practices while a native JSON alone remains explicitly unavailable`,async({page})=>{
  const baseline=await load(page);
  await seek(page,baseline,3.8);await page.getByRole('button',{name:'Modifier mes pratiques',exact:true}).click();
  await page.getByLabel('Sorties par semaine',{exact:true}).fill('8');const changed=await apply(page);
  await page.getByRole('button',{name:'Modifier mes pratiques',exact:true}).click();await page.locator('.practice-details summary').click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exporter les pratiques appliquées'}).click();const sidecar=JSON.parse(await readFile((await (await download).path())!,'utf8'));
  if(version===1){
    sidecar.version=1;delete sidecar.history.configuration;
    sidecar.history.records=sidecar.history.records.map((row:any)=>{
      const {referenceNominal,nominalRatio,gearFactor,motorFactor,meshFactor,configurationId,configurationVersion,meshMm,...legacy}=row.effortDerivation;
      return {time:row.time,practice:row.practice,effortDerivation:legacy};
    });
  }
  const text=JSON.stringify(sidecar);
  await page.getByRole('button',{name:'Annuler',exact:true}).click();const imported=await load(page,changed.request);
  await expect(sidebar(page)).toContainText('4 / semaine');await expect(effort(page)).toContainText('E = 150');
  await seek(page,imported,4);await expect(sidebar(page)).toContainText('Pratique à renseigner');await expect(effort(page)).toContainText('E = 300');
  await page.getByRole('button',{name:'Modifier mes pratiques',exact:true}).click();await page.locator('.practice-details summary').click();
  const upload=()=>page.getByLabel('Importer les pratiques associées').setInputFiles({name:'pratiques.json',mimeType:'application/json',buffer:Buffer.from(text)});
  await upload();await expect(sidebar(page)).toContainText('Pratique à renseigner');
  await page.getByRole('button',{name:'Annuler',exact:true}).click();await expect(sidebar(page)).toContainText('Pratique à renseigner');
  await page.getByRole('button',{name:'Modifier mes pratiques',exact:true}).click();await page.locator('.practice-details summary').click();await upload();
  const restored=await apply(page);await seek(page,restored.result,4);await expect(sidebar(page)).toContainText('8 / semaine');await expect(effort(page)).toContainText('E = 300');
  await seek(page,restored.result,0);await expect(sidebar(page)).toContainText('4 / semaine');await expect(effort(page)).toContainText('E = 150');
});
