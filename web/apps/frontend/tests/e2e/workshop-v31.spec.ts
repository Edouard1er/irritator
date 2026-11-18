import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const evidence=path.resolve('../../../reports/iteration31-evidence');
async function input(page:Page,label:string,value:number){await page.getByLabel(label,{exact:true}).evaluate((el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function load(page:Page){page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());await page.goto('/');await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(path.resolve('../../examples/atelier-interventions-month-v3.json'));const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();const response=await pending;expect(response.status(),await response.text()).toBe(200);return response.json();}
test('enlarged lake, seasons, rain, monthly curve, critical state, fullscreen and keyboard use real native values',async({page})=>{
  await page.setViewportSize({width:1920,height:1080});await page.emulateMedia({reducedMotion:'reduce'});
  const errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!['127.0.0.1','localhost'].includes(new URL(r.url()).hostname))external.push(r.url());});
  const result=await load(page),n=result.observations.find((o:any)=>o.component==='lake/N').samples;await mkdir(evidence,{recursive:true});
  await expect(page.getByLabel('Son des alertes')).toBeChecked();await expect(page.getByRole('heading',{name:'Où en est la ressource ?'})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Poissons pêchés chaque mois'})).toBeVisible();
  const canvas=page.locator('canvas[data-fish-count]');await expect(canvas).toHaveAttribute('data-fish-count','15');
  await expect(page.locator('.biomass-card .js-plotly-plot')).toBeVisible();
  const layout=await page.locator('.workshop-visuals').evaluate(el=>{const rect=(selector:string)=>{const r=el.querySelector(selector)!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};return {lake:rect('.lake-card'),canvas:rect('canvas'),biomass:rect('.biomass-card'),monthly:rect('.capture-card')};});
  expect(layout.canvas.height).toBeGreaterThan(380);expect(Math.abs(layout.lake.y-layout.biomass.y)).toBeLessThan(2);expect(Math.abs(layout.lake.bottom-layout.monthly.bottom)).toBeLessThan(2);expect(layout.lake.x).toBeGreaterThan(layout.biomass.x);
  await page.screenshot({path:path.join(evidence,'01-lac-agrandi.png'),fullPage:true});
  for(const [time,season] of [[3,'Été'],[6,'Automne'],[9,'Hiver'],[12,'Printemps']] as const){await input(page,'Position temporelle',n.findIndex((p:any)=>Math.abs(p.time-time)<1e-9));await expect(canvas).toHaveAttribute('data-season',season);await expect(page.locator('.lake-season')).toHaveText(season);if(time===3)await page.screenshot({path:path.join(evidence,'02-ete.png'),fullPage:true});if(time===9)await page.locator('.lake-card').screenshot({path:path.join(evidence,'07-hiver.png')});}
  await input(page,'Position temporelle',70);await page.getByRole('button',{name:'Modifier les conditions',exact:true}).click();await expect(page.locator('.conditions-editor')).not.toContainText('validation climatique');await input(page,'Pluie',8);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');await page.getByRole('button',{name:'Appliquer à partir du mois 7',exact:true}).click();const response=await pending,modified=await response.json();expect(response.status()).toBe(200);await page.getByRole('button',{name:'Pause',exact:true}).click();await input(page,'Position temporelle',100);await expect(canvas).toHaveAttribute('data-rain','8');await expect(canvas).toHaveAttribute('data-season','Hiver');
  await page.locator('.simulation-container').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(evidence,'03-pluie.png'),fullPage:true});
  const cumul=modified.observations.find((o:any)=>o.component==='lake/C').samples,at=(t:number)=>cumul.find((p:any)=>Math.abs(p.time-t)<1e-9).value;
  for(let month=1;month<=10;month++){expect(Number(await page.locator(`[data-month="${month}"]`).getAttribute('data-catch'))).toBe(at(month)-at(month-1));}
  await expect(page.locator('[data-monthly-point]')).toHaveCount(10);expect(await page.locator('[data-monthly-line]').getAttribute('d')).not.toMatch(/[CQ]/);await expect(page.locator('.monthly-catch-chart rect')).toHaveCount(0);
  await page.locator('[data-month="5"] circle').focus();await expect(page.getByRole('tooltip')).toContainText('Mois 5');await page.locator('.capture-card').screenshot({path:path.join(evidence,'05-captures-mensuelles.png')});await page.keyboard.press('Enter');await expect(page.getByLabel('Temps courant')).toContainText('t = 5 / 24');await expect(page.locator('[data-monthly-point]')).toHaveCount(5);
  await input(page,'Position temporelle',100);await page.getByLabel('Seuil choisi pour l’atelier',{exact:true}).fill('200');await expect(page.getByRole('heading',{name:'DANGER : SEUIL FRANCHI'})).toBeVisible();
  const exact=modified.observations.find((o:any)=>o.component==='lake/N').samples[100].value;await expect(canvas).toHaveAttribute('data-biomass',String(exact));await expect(canvas).toHaveAttribute('data-fish-count',String(Math.round(exact/10)));await expect(page.locator('.metric-card').first()).toContainText(new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(exact));
  await page.locator('.simulation-container').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(evidence,'04-biomasse-critique.png'),fullPage:true});
  const visible=await page.locator('.simulation-workspace').innerText();expect(visible).not.toMatch(/symbole|pictogramme|illustrati|hypothèse pédagogique|sans validation écologique/i);
  await page.getByRole('button',{name:'Grand écran',exact:true}).click();await expect(page.getByRole('button',{name:'Quitter le grand écran'})).toBeVisible();expect(await canvas.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(layout.canvas.height);await expect(page.getByLabel('Son des alertes')).toBeInViewport();await page.screenshot({path:path.join(evidence,'06-grand-ecran.png'),fullPage:true});await page.keyboard.press('Escape');await expect(page.getByLabel('Position temporelle')).toHaveValue('100');
  const frozen=await canvas.evaluate((el:HTMLCanvasElement)=>el.toDataURL());await page.waitForTimeout(200);expect(await canvas.evaluate((el:HTMLCanvasElement)=>el.toDataURL())).toBe(frozen);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect.poll(()=>page.locator('.simulation-container').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.locator('.simulation-container').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(evidence,'08-mobile.png'),fullPage:true});await page.locator('.lake-card').screenshot({path:path.join(evidence,'09-mobile-lac.png')});await page.locator('.capture-card').screenshot({path:path.join(evidence,'10-mobile-captures.png')});
  await writeFile(path.join(evidence,'native-and-layout.json'),JSON.stringify({layout,request:response.request().postDataJSON(),result,modified},null,2));expect(errors).toEqual([]);expect(external).toEqual([]);
});

test('default sound arms above threshold, crosses automatically, stops immediately and stays single after intervention',async({page})=>{
  await page.addInitScript(()=>{
    const Native=window.AudioContext;let active=0,max=0,contexts=0,connected=0;
    (window as any).audioCounts=()=>({active,max,contexts,connected});
    window.AudioContext=class extends Native {constructor(){super();contexts++;}
      createOscillator(){const node=super.createOscillator(),start=node.start.bind(node),stop=node.stop.bind(node),disconnect=node.disconnect.bind(node);let live=false,linked=false;const connect=node.connect.bind(node);node.connect=((...args:any[])=>{if(!linked){linked=true;connected++;}return (connect as any)(...args);}) as typeof node.connect;
        node.start=(when?:number)=>{start(when);if(!live){live=true;active++;max=Math.max(max,active);}};node.stop=(when?:number)=>{stop(when);if(live){live=false;active--;}};node.disconnect=(()=>{disconnect();if(linked){linked=false;connected--;}}) as typeof node.disconnect;return node;}
    };
  });
  const result=await load(page),n=result.observations.find((o:any)=>o.component==='lake/N').samples;
  const count=()=>page.evaluate(()=>(window as any).audioCounts()),active=async()=>(await count()).active;
  await expect(page.getByLabel('Son des alertes')).toBeChecked();expect((await count()).contexts).toBe(0);
  const index=n.findIndex((p:any,i:number)=>i>=40&&i+7<n.length&&n.slice(i,i+7).every((p:any,j:number)=>j===0||p.value<n[i+j-1].value));expect(index).toBeGreaterThan(0);
  await input(page,'Position temporelle',index);const threshold=(n[index+5].value+n[index+6].value)/2;await page.getByLabel('Seuil choisi pour l’atelier',{exact:true}).fill(String(threshold));
  await page.getByLabel('Son des alertes').uncheck();await page.getByLabel('Son des alertes').check();expect((await count()).contexts).toBe(1);expect(await active()).toBe(0);
  await page.getByLabel('Vitesse de lecture').selectOption('0.5');await page.getByRole('button',{name:'Reprendre',exact:true}).click();expect(await active()).toBe(0);await expect.poll(active).toBe(2);await expect(page.getByRole('heading',{name:'DANGER : SEUIL FRANCHI'})).toBeVisible();expect((await count()).max).toBe(2);
  await page.getByLabel('Seuil choisi pour l’atelier',{exact:true}).fill('1');await expect.poll(active).toBe(0);expect((await count()).connected).toBe(0);
  await page.getByLabel('Seuil choisi pour l’atelier',{exact:true}).fill('500');await expect.poll(active).toBe(2);await page.getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(active).toBe(0);
  await input(page,'Position temporelle',100);await page.getByLabel('Seuil choisi pour l’atelier',{exact:true}).fill(String(n[100].value));await page.getByRole('button',{name:'Reprendre',exact:true}).click();await expect.poll(active).toBe(2);
  await page.getByRole('button',{name:'Modifier les conditions',exact:true}).click();await expect.poll(active).toBe(0);await page.getByLabel('Sorties par semaine',{exact:true}).fill('8');
  await page.getByRole('button',{name:/Appliquer à partir du mois/}).click();await expect(page.locator('[data-resume-time]')).toBeVisible();await expect.poll(active).toBe(2);expect((await count()).max).toBe(2);expect((await count()).contexts).toBe(1);
  await page.getByLabel('Son des alertes').uncheck();await expect.poll(active).toBe(0);expect((await count()).connected).toBe(0);await page.getByLabel('Son des alertes').check();await expect.poll(active).toBe(2);
  await page.getByRole('button',{name:'Modélisation',exact:true}).click();await expect.poll(active).toBe(0);await page.getByRole('button',{name:'Simulation',exact:true}).click();await page.getByLabel('Son des alertes').uncheck();
  await writeFile(path.join(evidence,'web-audio.json'),JSON.stringify(await count(),null,2));await load(page);await expect(page.getByLabel('Son des alertes')).not.toBeChecked();
});
