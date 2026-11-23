import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const fixture=path.resolve('../../examples/atelier-interventions-month-v3.json');
const evidence=path.resolve('../../../reports/biomass-progressive');
type Point={time:number;value:number};
type Result={observations:{component:string;samples:Point[]}[]};
type Snapshot={time:number;range:number[];traces:{name:string;x:(number|null)[];y:(number|null)[];dash?:string;color:string}[];calculated:{x:number;y:number}[]};
const samples=(result:Result)=>result.observations.find(o=>o.component==='lake/N')!.samples;
const chart=(page:Page)=>page.locator('.biomass-card .js-plotly-plot');

async function load(page:Page){
  page.on('dialog',d=>d.accept());
  await page.goto('/');
  await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(fixture);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();
  const response=await pending;
  expect(response.status(),await response.text()).toBe(200);
  await expect(chart(page)).toBeVisible();
  await page.getByLabel('Son des alertes').uncheck();
  return response.json() as Promise<Result>;
}

async function seek(page:Page,result:Result,time:number){
  const index=samples(result).findIndex(p=>Math.abs(p.time-time)<1e-9);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.getByLabel('Position temporelle',{exact:true}).fill(String(index));
  return samples(result)[index]!.time;
}

async function snapshot(page:Page):Promise<Snapshot>{
  return chart(page).evaluate((el:any)=>({
    time:el.layout?.shapes?.find((s:any)=>s.line?.color==='#324a5c')?.x0,
    range:el.layout?.xaxis?.range,
    traces:(el.data??[]).map((t:any)=>({name:t.name,x:t.x,y:t.y,dash:t.line?.dash,color:t.line?.color})),
    calculated:(el.calcdata??[]).flatMap((trace:any[])=>trace.filter(d=>Number.isFinite(d.x)&&Number.isFinite(d.y)).map(d=>({x:d.x,y:d.y}))),
  }));
}

async function expectElapsed(page:Page,result:Result,time:number,baseline?:Result){
  const expected=samples(result).filter(p=>p.time<=time);
  await expect.poll(async()=>{
    const state=await snapshot(page);
    const current=state.traces.filter(t=>t.name!=='Trajectoire initiale');
    const times=[...new Set(current.flatMap(t=>t.x.filter((x):x is number=>typeof x==='number')))];
    return {time:state.time,times:times.sort((a:number,b:number)=>a-b)};
  }).toEqual({time,times:expected.map(p=>p.time)});
  const state=await snapshot(page);
  expect(state.range).toEqual([0,24]);
  expect(state.traces.some(t=>t.name==='Suite enregistrée (non lue)')).toBe(false);
  for(const trace of state.traces)for(const x of trace.x)if(typeof x==='number')expect(x).toBeLessThanOrEqual(time);
  for(const point of state.calculated)expect(point.x).toBeLessThanOrEqual(time);
  const initial=state.traces.find(t=>t.name==='Trajectoire initiale');
  if(baseline){
    const points=samples(baseline).filter(p=>p.time<=time);
    expect(initial).toMatchObject({x:points.map(p=>p.time),y:points.map(p=>p.value),dash:'dash',color:'#657eaa'});
  }else expect(initial).toBeUndefined();
  return state;
}

test('real observations are revealed at 0, 3, 8 and 24 months, while playing, paused and after rewinding',async({page})=>{
  await page.setViewportSize({width:1600,height:1100});
  await page.emulateMedia({reducedMotion:'reduce'});
  await mkdir(evidence,{recursive:true});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const result=await load(page);
  const states=[];
  states.push(await expectElapsed(page,result,0));
  await page.locator('.workshop-visuals').screenshot({path:path.join(evidence,'01-before-animation-t0.png')});
  for(const time of [3,8,24,8,3,0])states.push(await expectElapsed(page,result,await seek(page,result,time)));

  // Start from three months, then record a live frame rather than a seeked preview.
  await seek(page,result,3);
  await page.getByLabel('Vitesse de lecture').selectOption('0.25');
  await page.getByRole('button',{name:'Reprendre',exact:true}).click();
  await expect.poll(()=>page.getByLabel('Position temporelle',{exact:true}).inputValue().then(Number)).toBeGreaterThan(30);
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  const live=await snapshot(page);
  expect(live.time).toBeGreaterThan(3);
  expect(live.time).toBeLessThan(8);
  for(const trace of live.traces)for(const x of trace.x)if(typeof x==='number')expect(x).toBeLessThanOrEqual(live.time);
  await page.locator('.workshop-visuals').screenshot({path:path.join(evidence,'02-during-animation.png')});
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const position=Number(await page.getByLabel('Position temporelle',{exact:true}).inputValue());
  const pausedTime=samples(result)[position]!.time;
  const paused=await expectElapsed(page,result,pausedTime);
  // Longer than the selected playback step: a pause must not reveal another point.
  await page.waitForTimeout(450);
  expect(await snapshot(page)).toEqual(paused);
  await expectElapsed(page,result,await seek(page,result,0));
  await writeFile(path.join(evidence,'progressive-playback.json'),JSON.stringify({states,live,paused},null,2));
  expect(errors).toEqual([]);
});

test('initial comparison uses the same time boundary and future points cannot be hovered after rewinding',async({page})=>{
  await page.setViewportSize({width:1600,height:1100});
  await mkdir(evidence,{recursive:true});
  const initial=await load(page);
  await seek(page,initial,8);
  await page.locator('.environment-strip').getByRole('button',{name:'Personnaliser',exact:true}).click();
  await page.getByLabel('Sorties par semaine',{exact:true}).fill('8');
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Appliquer à partir du mois 8',exact:true}).click();
  const response=await pending;
  expect(response.status(),await response.text()).toBe(200);
  const modified=await response.json() as Result;
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const states=[];
  for(const time of [0,3,8,24,8,3,0])states.push(await expectElapsed(page,modified,await seek(page,modified,time),initial));
  await expectElapsed(page,modified,await seek(page,modified,8),initial);
  // Hover a real future baseline position in the plot. Neither trace may expose it.
  const future=samples(initial).find(p=>Math.abs(p.time-20)<1e-9)!;
  const at=await chart(page).evaluate((el:any,point)=>{
    const box=el.getBoundingClientRect(),layout=el._fullLayout;
    return {x:box.x+layout.xaxis._offset+layout.xaxis.l2p(point.time),y:box.y+layout.yaxis._offset+layout.yaxis.l2p(point.value)};
  },future);
  await page.mouse.move(at.x,at.y);
  await expect(chart(page).locator('.hovertext')).toHaveCount(0);
  // A genuine elapsed point remains inspectable, including its exact native value.
  const past=samples(initial).find(p=>Math.abs(p.time-3)<1e-9)!;
  await chart(page).evaluate((el:any,point)=>(window as any).Plotly.Fx.hover(el,[{curveNumber:0,pointNumber:el.data[0].x.indexOf(point.time)}]),past);
  await expect(chart(page).locator('.hovertext')).toContainText('Initiale');
  await page.getByLabel('Position temporelle',{exact:true}).fill('0');
  await expectElapsed(page,modified,0,initial);
  await expect(chart(page).locator('.hovertext')).toHaveCount(0);
  await page.locator('.workshop-visuals').screenshot({path:path.join(evidence,'03-comparison-rewound-t0.png')});
  await expectElapsed(page,modified,await seek(page,modified,8),initial);
  await page.locator('.workshop-visuals').screenshot({path:path.join(evidence,'04-comparison-t8.png')});
  await writeFile(path.join(evidence,'progressive-comparison.json'),JSON.stringify({states},null,2));
});
