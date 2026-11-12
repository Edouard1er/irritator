import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const evidence=path.resolve(process.env.IRRITATOR_8O_BROWSER_EVIDENCE ?? '../../../build-web-test8o/browser');
const fixture=path.resolve('../../examples/test-8o-schaefer-six-trajectories-v3.json');
async function execute(page:Page,name:string){
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/simulations/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Exécuter la simulation',exact:true}).click();const response=await pending;
  const result=await response.json(),request=response.request().postDataJSON();await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,name+'.json'),JSON.stringify({request,result},null,2));
  expect(response.status(),JSON.stringify(result)).toBe(200);
  const p=spawnSync(process.env.IRRITATOR_RUNNER!,[],{input:JSON.stringify(request),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});expect(p.status,p.stderr).toBe(0);const {runId,requestId,...actual}=result;expect(actual).toEqual(JSON.parse(p.stdout));return result;
}
async function chart(page:Page,n:number){
  await expect(page.locator('.prospective-trajectories .js-plotly-plot')).toBeVisible();
  await expect.poll(()=>page.locator('.prospective-trajectories .js-plotly-plot').evaluate((el:any)=>el.data?.length)).toBe(n);
  const data=await page.locator('.prospective-trajectories .js-plotly-plot').evaluate((el:any)=>({data:el.data.map((s:any)=>({name:s.name,x:s.x,y:s.y,hovertemplate:s.hovertemplate})),axis:el.layout.xaxis.title.text}));
  expect(data.axis).toBe('Temps local enfant');for(const s of data.data){expect(s.x).toHaveLength(201);expect(s.x[0]).toBe(0);expect(s.x.at(-1)).toBeCloseTo(20,9);expect(s.hovertemplate).toContain('scenarioId=');}
  return data;
}
async function open(page:Page,file:Parameters<ReturnType<Page['getByLabel']>['setInputFiles']>[0]=fixture){page.on('dialog',d=>d.accept());await page.goto('/');await expect(page.getByRole('button',{name:/Moteur connecté/})).toBeVisible();await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(file);}
async function selectWrapper(page:Page){await page.getByRole('button',{name:'Ajuster la vue',exact:true}).click();const node=page.getByTestId('rf__node-prospectives');await node.focus();await node.press('Enter');await expect(page.getByLabel('Identifiant du composant',{exact:true})).toHaveValue('prospectives');}

test('8O imports one wrapper, selects N/C, draws 6/12/6 actual series and exports every point',async({page})=>{
  test.setTimeout(180000);await open(page);await selectWrapper(page);await expect(page.getByLabel('Observer prospectif N',{exact:true})).toBeChecked();await expect(page.getByLabel('Observer prospectif C',{exact:true})).not.toBeChecked();
  const n=await execute(page,'N');const nChart=await chart(page,6);expect(n.scenarioTrajectories).toHaveLength(6);
  expect(nChart.data.map((s:any)=>s.y)).toEqual(n.scenarioTrajectories.map((r:any)=>r.observations[0].samples.map((s:any)=>s.value)));
  await page.locator('.prospective-trajectories .trajectory-plot').screenshot({path:path.join(evidence,'N-six-curves.png')});
  await page.getByLabel('Observer prospectif C',{exact:true}).check();const nc=await execute(page,'N-C');await chart(page,12);
  await page.locator('.prospective-trajectories .trajectory-plot').screenshot({path:path.join(evidence,'N-C-twelve-curves.png')});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'CSV des trajectoires prospectives',exact:true}).click();const csv=path.join(evidence,'N-C.csv');await(await download).saveAs(csv);const lines=(await readFile(csv,'utf8')).trim().split(/\r?\n/);expect(lines).toHaveLength(2413);expect(lines[0]).toContain('wrapperId,campaignId,scenarioId');expect(lines[1]).toContain('""effort"":80');
  await page.getByLabel('Afficher variable C',{exact:true}).uncheck();await chart(page,6);await page.getByLabel('Afficher scénario 0',{exact:true}).uncheck();await chart(page,5);await page.getByLabel('Afficher scénario 0',{exact:true}).check();await chart(page,6);
  await page.getByLabel('Observer prospectif C',{exact:true}).uncheck();await execute(page,'N-restored');await chart(page,6);
  const save=page.waitForEvent('download');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();const exported=path.join(evidence,'model-export.json');await(await save).saveAs(exported);
  const doc=JSON.parse(await readFile(exported,'utf8'));expect(doc.model.components.find((c:any)=>c.experiment).experiment.trajectoryObservations).toEqual([{target:'N',samplingInterval:.1}]);
  await page.getByRole('button',{name:'Nouveau',exact:true}).click();await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles(exported);const restored=await execute(page,'reimport');await chart(page,6);expect(restored.scenarioTrajectories).toEqual(n.scenarioTrajectories);
});
test('8O filters campaigns, wrappers, partial and unavailable children without invented segments',async({page})=>{
  const doc=JSON.parse(await readFile(fixture,'utf8'));doc.model.components=doc.model.components.filter((c:any)=>['run','prospectives'].includes(c.id));doc.model.connections=doc.model.connections.filter((e:any)=>e.from.component==='run');doc.model.observations=[];
  const right=structuredClone(doc.model.components[1]);right.id='right';doc.model.components.push(right);doc.model.connections.push({from:{component:'run',port:0},to:{component:'right',port:1}});
  doc.model.components.push({id:'again',type:'constant',parameters:{offset:2,value:0}});doc.model.connections.push({from:{component:'again',port:0},to:{component:'prospectives',port:1}});
  await open(page,{name:'campaigns.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});const r=await execute(page,'campaigns');expect(r.scenarioTrajectories).toHaveLength(18);await chart(page,6);
  await page.getByLabel('Campagne des trajectoires').selectOption('2');await chart(page,6);await page.getByLabel('Wrapper des trajectoires').selectOption('right');await chart(page,6);await expect(page.getByLabel('Campagne des trajectoires').locator('option')).toHaveCount(1);
  // A real native interruption, not a mocked HTTP response.
  doc.model.components=doc.model.components.filter((c:any)=>['run','prospectives'].includes(c.id));doc.model.connections=doc.model.connections.filter((e:any)=>e.from.component==='run'&&e.to.component==='prospectives');doc.model.components[1].experiment.execution={failurePolicy:'isolate',maxCampaignRunCalls:1};
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles({name:'partial.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});const partial=await execute(page,'partial');expect(partial.scenarioTrajectories.some((s:any)=>s.status==='canceled')).toBe(true);
  await expect(page.locator('.prospective-trajectories').getByText(/indisponible/).first()).toBeVisible();await page.locator('.prospective-trajectories').screenshot({path:path.join(evidence,'partial-unavailable.png')});
  doc.model.components[1].experiment.execution={failurePolicy:'isolate',maxChildRunCalls:100};
  await page.getByLabel('Ouvrir un modèle JSON',{exact:true}).setInputFiles({name:'prefix.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});const prefix=await execute(page,'partial-prefix');
  expect(prefix.scenarioTrajectories.some((s:any)=>s.status==='budget-exceeded'&&s.observations[0].samples.length>1)).toBe(true);
  await expect(page.locator('.prospective-trajectories').getByText(/partielle/).first()).toBeVisible();await expect(page.locator('.prospective-trajectories .js-plotly-plot')).toBeVisible();
  await page.locator('.prospective-trajectories').screenshot({path:path.join(evidence,'partial-native-prefix.png')});
});
