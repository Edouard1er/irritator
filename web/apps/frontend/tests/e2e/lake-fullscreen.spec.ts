import {test,expect,type Page} from '@playwright/test';
import path from 'node:path';

const lake=(page:Page)=>page.locator('.lake-card');
const canvas=(page:Page)=>lake(page).locator('canvas[data-fish-count]');
const controls=(page:Page)=>lake(page).getByRole('group',{name:'Commandes du lac en plein écran'});
const cursor=(page:Page)=>page.getByLabel('Position temporelle',{exact:true});
type Samples={observations:{component:string;samples:{time:number;value:number}[]}[]};

async function load(page:Page){
  page.on('dialog',dialog=>dialog.accept());
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/');
  await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(path.resolve('../../examples/atelier-interventions-month-v3.json'));
  const pending=page.waitForResponse(response=>response.url().endsWith('/api/v1/simulations/run')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();
  const response=await pending;
  expect(response.status(),await response.text()).toBe(200);
  await expect(canvas(page)).toBeVisible();
  await page.getByLabel('Son des alertes',{exact:true}).uncheck();
  return response.json() as Promise<Samples>;
}

async function seek(page:Page,result:Samples,time:number){
  const samples=result.observations.find(observation=>observation.component==='lake/N')!.samples;
  const index=samples.findIndex(point=>Math.abs(point.time-time)<1e-9);
  expect(index).toBeGreaterThanOrEqual(0);
  await cursor(page).fill(String(index));
  return index;
}

async function enter(page:Page){
  await lake(page).getByRole('button',{name:'Plein écran',exact:true}).click();
  await expect.poll(()=>lake(page).evaluate(element=>document.fullscreenElement===element)).toBe(true);
  await expect(controls(page)).toBeVisible();
  await expect.poll(()=>lake(page).evaluate(element=>{
    const rect=element.getBoundingClientRect();
    return Math.abs(rect.x)<1&&Math.abs(rect.y)<1&&Math.abs(rect.width-innerWidth)<2&&Math.abs(rect.height-innerHeight)<2;
  })).toBe(true);
  await expect(canvas(page)).toHaveCount(1);
  await expect(lake(page).locator('.lake-season')).toBeInViewport();
  await expect(lake(page).locator('.lake-readings .lake-count')).toBeInViewport();
  await expect(lake(page).locator('.lake-readings>span').last()).toBeInViewport();
  await expect(controls(page).getByRole('button',{name:'Quitter le plein écran'})).toBeInViewport();
  // Native fullscreen paints only this subtree; controls and readings are its
  // descendants and dashboard navigation, charts and sidebar are outside it.
  expect(await lake(page).evaluate(element=>
    !element.querySelector('.app-header,.workspace-navigation,.fishing-practice-sidebar,.workshop-metrics,.timeline-player,.biomass-card,.capture-card'))).toBe(true);
}

async function exit(page:Page,escape=false){
  if(escape)await page.keyboard.press('Escape');
  else await controls(page).getByRole('button',{name:'Quitter le plein écran'}).click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
  await expect(controls(page)).toHaveCount(0);
  await expect(lake(page).getByRole('button',{name:'Plein écran',exact:true})).toBeVisible();
}

async function snapshot(page:Page){
  return {
    cursor:await cursor(page).inputValue(),
    attributes:await canvas(page).evaluate(element=>Object.fromEntries(['data-biomass','data-fish-count','data-season','data-rain','data-turbidity','data-boats','data-effort'].map(name=>[name,element.getAttribute(name)]))),
    readings:await lake(page).locator('.lake-readings').textContent(),
    season:await lake(page).locator('.lake-season').textContent(),
    practice:await page.locator('.fishing-practice-sidebar').textContent(),
  };
}

test('native lake fullscreen preserves paused state, canvas identity and fish positions through repeated exits',async({page},testInfo)=>{
  test.setTimeout(120000);
  const result=await load(page),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  let recalculations=0;
  page.on('request',request=>{if(request.url().endsWith('/api/v1/simulations/run')&&request.method()==='POST')recalculations++;});
  const original=await canvas(page).elementHandle();
  const initial=await snapshot(page);
  await enter(page);
  expect(await snapshot(page)).toEqual(initial);
  await expect(controls(page).getByRole('button',{name:'Reprendre',exact:true})).toBeVisible();
  await expect(controls(page).getByRole('button',{name:'Quitter le plein écran',exact:true})).toBeFocused();
  for(const key of ['Tab','Tab','Shift+Tab','Shift+Tab']){
    await page.keyboard.press(key);
    expect(await lake(page).evaluate(element=>element.contains(document.activeElement)),`focus after ${key}`).toBe(true);
  }
  await exit(page);
  const index=await seek(page,result,12.5);
  await expect(cursor(page)).toHaveValue(String(index));
  const paused=await snapshot(page);
  const initialImage=await canvas(page).evaluate((element:HTMLCanvasElement)=>element.toDataURL());
  for(const [iteration,escape] of [false,true,false].entries()){
    await enter(page);
    expect(await snapshot(page)).toEqual(paused);
    expect(await original!.evaluate(element=>element===document.querySelector('.lake-card canvas'))).toBe(true);
    if(iteration===0)await page.screenshot({path:testInfo.outputPath('lake-fullscreen-paused.png')});
    await exit(page,escape);
    expect(await snapshot(page)).toEqual(paused);
    await expect.poll(()=>canvas(page).evaluate((element:HTMLCanvasElement)=>element.toDataURL())).toBe(initialImage);
  }
  expect(recalculations).toBe(0);
  expect(errors).toEqual([]);
});

test('fullscreen shares running playback, pause and resume without restarting or recalculating',async({page},testInfo)=>{
  test.setTimeout(120000);
  const result=await load(page);
  const start=await seek(page,result,12.5);
  await page.getByLabel('Vitesse de lecture',{exact:true}).selectOption('0.25');
  let recalculations=0;
  page.on('request',request=>{if(request.url().endsWith('/api/v1/simulations/run')&&request.method()==='POST')recalculations++;});
  await page.getByRole('button',{name:'Reprendre',exact:true}).click();
  await enter(page);
  await expect(controls(page).getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await expect.poll(async()=>Number(await cursor(page).inputValue())).toBeGreaterThan(start);
  await controls(page).getByRole('button',{name:'Pause',exact:true}).click();
  await expect(controls(page).getByRole('button',{name:'Reprendre',exact:true})).toBeVisible();
  const paused=await snapshot(page),image=await canvas(page).evaluate((element:HTMLCanvasElement)=>element.toDataURL());
  // Observe beyond a timeline tick to distinguish a paused animation from a
  // still running one, including the visual fish movement between samples.
  await page.waitForTimeout(500);
  expect(await snapshot(page)).toEqual(paused);
  expect(await canvas(page).evaluate((element:HTMLCanvasElement)=>element.toDataURL())).toBe(image);
  await page.screenshot({path:testInfo.outputPath('lake-fullscreen-controls.png')});
  await controls(page).getByRole('button',{name:'Reprendre',exact:true}).click();
  await expect.poll(async()=>Number(await cursor(page).inputValue())).toBeGreaterThan(Number(paused.cursor));
  await expect.poll(()=>canvas(page).evaluate((element:HTMLCanvasElement,image)=>element.toDataURL()===image,image)).toBe(false);
  await exit(page);
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  expect(Number(await cursor(page).inputValue())).toBeGreaterThan(start);
  // Resuming at the final sample must not silently restart at month zero.
  await cursor(page).press('End');
  const last=await cursor(page).inputValue();
  await enter(page);
  await expect(controls(page).getByRole('button',{name:'Reprendre',exact:true})).toBeDisabled();
  await exit(page,true);
  await expect(cursor(page)).toHaveValue(last);
  expect(recalculations).toBe(0);
});

test('lake fullscreen handles denied requests and leaves the existing Grand écran mode intact',async({page})=>{
  const result=await load(page);
  await seek(page,result,12.5);
  const paused=await snapshot(page);
  await lake(page).evaluate(element=>{
    Object.defineProperty(element,'requestFullscreen',{configurable:true,value:()=>Promise.reject(new Error('Denied for test'))});
  });
  await lake(page).getByRole('button',{name:'Plein écran',exact:true}).click();
  await expect(lake(page).getByRole('alert')).toBeVisible();
  expect(await page.evaluate(()=>document.fullscreenElement)).toBe(null);
  expect(await snapshot(page)).toEqual(paused);
  await lake(page).evaluate(element=>{Reflect.deleteProperty(element,'requestFullscreen');});
  await enter(page);
  await exit(page);
  await page.getByRole('button',{name:'Grand écran',exact:true}).click();
  await expect(page.getByRole('button',{name:'Quitter le grand écran',exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('.simulation-workspace').evaluate(element=>document.fullscreenElement===element)).toBe(true);
  await enter(page);
  await controls(page).getByRole('button',{name:'Quitter le plein écran',exact:true}).click();
  await expect.poll(()=>page.locator('.simulation-workspace').evaluate(element=>document.fullscreenElement===element)).toBe(true);
  await expect(page.getByRole('button',{name:'Quitter le grand écran',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Quitter le grand écran',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
  expect(await snapshot(page)).toEqual(paused);
});

test('fullscreenerror retains usable exit controls and the same paused observation',async({page})=>{
  const result=await load(page);
  await seek(page,result,12.5);
  const paused=await snapshot(page);
  await enter(page);
  await lake(page).evaluate(element=>element.dispatchEvent(new Event('fullscreenerror',{bubbles:true})));
  await expect(lake(page).getByRole('alert')).toBeVisible();
  await expect(controls(page).getByRole('button',{name:'Quitter le plein écran',exact:true})).toBeVisible();
  expect(await snapshot(page)).toEqual(paused);
  await exit(page);
  expect(await snapshot(page)).toEqual(paused);
});
