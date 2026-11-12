import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRequest, parseWrapperResult } from '../../dist/packages/contracts/index.js';
import { dynamicMinimal } from './decision-8h-fixture.mjs';
import { faultMinimal } from './decision-8j-fixture.mjs';
import { source } from './decision-8c-fixture.mjs';
import { adaptiveProspect } from './decision-8n-fixture.mjs';
const runner = process.env.IRRITATOR_RUNNER; assert.ok(runner, 'Set IRRITATOR_RUNNER');
const evidence = process.env.IRRITATOR_8O_EVIDENCE;
let rejected = 0;
let app;
if (process.env.TRAJECTORY_8O_HTTP === '1') {
  const { buildApp } = await import('../../dist/apps/api/src/app.js');
  const { readConfig } = await import('../../dist/apps/api/src/config/index.js');
  app = buildApp(readConfig()); await app.listen({ host: '127.0.0.1', port: 0 }); test.after(() => app.close());
}
const fixture = () => JSON.parse(readFileSync(new URL('../../examples/test-8o-schaefer-six-trajectories-v3.json', import.meta.url)));
const experiment = m => m.model.components.find(c => c.type === 'simulation_wrapper').experiment;
function invoke(m) {
  const p = spawnSync(runner, [], { input: JSON.stringify(m), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8*1024*1024 });
  assert.ok(p.stdout, p.error?.message); const r=JSON.parse(p.stdout);
  if(evidence && p.status!==0){mkdirSync(evidence,{recursive:true});writeFileSync(resolve(evidence,`rejected-${++rejected}-${r.error?.code}.json`),JSON.stringify({request:m,result:r},null,2));}
  return { p, r };
}
async function run(m, name) {
  validateRequest(m); const { p, r } = invoke(m); assert.equal(p.status, 0, p.stdout + p.stderr);
  if (m.schemaVersion === 3) parseWrapperResult(r, m);
  const proof = { request: m, result: r };
  if (app) {
    const response = await fetch(`${app.listeningOrigin}/api/v1/simulations/run`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(m) });
    const { runId, requestId, ...actual } = await response.json(); assert.equal(response.status, 200, JSON.stringify(actual)); assert.deepEqual(actual, r);
    proof.httpResult = actual; proof.httpStatus = response.status;
  }
  if (evidence) { mkdirSync(evidence, { recursive:true }); writeFileSync(resolve(evidence, name+'.json'), JSON.stringify(proof,null,2)); }
  return r;
}
async function rejectedHttp(m, native) {
  if(!app)return;
  const response=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});
  const {requestId,...actual}=await response.json();assert.equal(response.status,422);assert.ok(requestId);assert.deepEqual(actual,native);
}
const near = (a,b,t=1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a-b)<=t, `${a} != ${b}, tolerance ${t}`);
const both = m => { experiment(m).trajectoryObservations = ['N','C'].map(target => ({target,samplingInterval:.1})); return m; };
function flat(m, factors) {
  const d = structuredClone(m.model.definitions.find(d => d.id === experiment(m).definition));
  for (const f of experiment(m).factors) d.components.find(c => c.id === f.target).parameters[f.parameter] = factors[f.id];
  return { schemaVersion:1, model:{id:'independent-flat',components:d.components,connections:d.connections,observations:['N','C'].map(component=>({component,samplingInterval:.1}))},simulation:experiment(m).simulation };
}
function analytic(f,t) {
  const alpha=.35-f.capturabilite*f.effort,beta=.35/300,D=1+beta*150*(alpha===0?t:Math.expm1(alpha*t)/alpha);
  return {N:150*Math.exp(alpha*t)/D,C:f.capturabilite*f.effort*Math.log(D)/beta};
}
test('8O six/twelve native trajectories match every independent flat sample and analytic identity', async()=>{
  const m=both(fixture()), r=await run(m,'nominal-N-C'), summary=[];
  assert.equal(r.scenarioTrajectories.length,6);
  let csv='wrapperId,campaignId,scenarioId,effort,capturabilite,component,time,value\n';
  for(const row of r.scenarioTrajectories) {
    assert.equal(row.wrapperId,'prospectives');assert.equal(row.campaignId,1);assert.equal(row.status,'completed');assert.equal(row.horizonApplied,20);
    assert.deepEqual(row.factors,{effort:[80,150,260][row.scenarioId%3],capturabilite:[.0008,.001][Math.floor(row.scenarioId/3)]});
    const independent=await run(flat(m,row.factors),'flat-'+row.scenarioId);
    for(const series of row.observations) {
      assert.equal(series.samples.length,201);const actual=independent.observations.find(o=>o.component===series.component).samples;
      let max=0,squared=0,absolute=0,nativeFlatMax=0,nativeTimeMax=0;
      series.samples.forEach((p,i)=>{near(p.time,i*.1);near(p.time,actual[i].time);near(p.value,actual[i].value);nativeFlatMax=Math.max(nativeFlatMax,Math.abs(p.value-actual[i].value));nativeTimeMax=Math.max(nativeTimeMax,Math.abs(p.time-actual[i].time));const error=Math.abs(p.value-analytic(row.factors,p.time)[series.component]);max=Math.max(max,error);squared+=error*error;absolute+=error;csv+=`${row.wrapperId},${row.campaignId},${row.scenarioId},${row.factors.effort},${row.factors.capturabilite},${series.component},${p.time},${p.value}\n`;});
      assert.ok(max<.1,`${series.component} scenario ${row.scenarioId} analytic max ${max}`);
      summary.push({scenarioId:row.scenarioId,factors:row.factors,component:series.component,count:series.samples.length,nativeFlatMax,nativeTimeMax,max,mae:absolute/series.samples.length,rmse:Math.sqrt(squared/series.samples.length),final:series.samples.at(-1).value});
    }
  }
  if(evidence){writeFileSync(resolve(evidence,'numerical-summary.json'),JSON.stringify(summary,null,2));writeFileSync(resolve(evidence,'six-curves.csv'),csv);}
  const single=fixture(),n=await run(single,'nominal-N');assert.equal(n.scenarioTrajectories.flatMap(r=>r.observations).length,6);
  if(evidence)writeFileSync(resolve(evidence,'six-N-curves.csv'),'wrapperId,campaignId,scenarioId,factors,component,time,value\n'+n.scenarioTrajectories.flatMap(r=>r.observations.flatMap(o=>o.samples.map(s=>`${r.wrapperId},${r.campaignId},${r.scenarioId},"${JSON.stringify(r.factors).replaceAll('"','""')}",${o.component},${s.time},${s.value}`))).join('\n')+'\n');
  const old=structuredClone(single);delete experiment(old).trajectoryObservations;const historic=await run(old,'without-option');
  const {scenarioTrajectories,...rest}=n;assert.deepEqual(rest,historic);
  experiment(old).trajectoryObservations=[];assert.deepEqual(await run(old,'empty-option'),historic);
});
test('8O visualization is independent of individual decision ports, generic unselected target and roundtrip',async()=>{
  const m=fixture();m.model.components=m.model.components.filter(c=>['run','prospectives'].includes(c.id));m.model.connections=m.model.connections.filter(e=>e.from.component==='run');m.model.observations=[];
  experiment(m).scenarioResults=false;experiment(m).trajectoryObservations=[{target:'q',samplingInterval:.1}];
  const r=await run(m,'generic-no-scenario-results');assert.equal(r.scenarioTrajectories.length,6);assert.ok(r.wrappers[0].outputs.every(p=>!p.kind.startsWith('scenario')));
  for(const row of r.scenarioTrajectories)assert.ok(row.observations[0].samples.every(p=>p.value===row.factors.capturabilite));
  m.model.definitions.push({id:'Other',name:'Other',inputs:[],outputs:[],components:[{id:'value',type:'constant',parameters:{value:1,offset:0}}],connections:[]});
  m.model.definitions.reverse();assert.deepEqual(await run(JSON.parse(JSON.stringify(m)),'roundtrip'),r);
});
test('8O child origin is independent from parent publication time',async()=>{
  const m=fixture();experiment(m).simulation={start:10,end:12};const r=await run(m,'child-local-origin');
  for(const row of r.scenarioTrajectories){assert.equal(row.start,10);assert.equal(row.horizonApplied,2);assert.ok(row.observations[0].samples.every(s=>s.time>=10&&s.time<=12));}
  assert.ok(r.resultEvents.every(e=>e.time===1));
  experiment(m).simulation={start:-.1,end:.3};const fractional=await run(m,'child-fractional-origin');assert.ok(fractional.scenarioTrajectories.every(row=>row.start===-.1&&row.observations[0].samples.at(-1).time===.3));
});
test('8O addressed inputs identify trajectories without enabling scenarioResults',async()=>{
  const m=fixture();m.model.components=m.model.components.filter(c=>c.id==='prospectives');m.model.connections=[];m.model.observations=[];
  experiment(m).scenarioResults=false;experiment(m).requiredInputs=['effort'];
  source(m,'prospectives',2,100,0,7,0);source(m,'prospectives',1,0,0,7,1);
  const r=await run(m,'addressed-no-scenario-results');assert.equal(r.scenarioTrajectories.length,6);
  assert.ok(r.scenarioTrajectories.every(row=>row.campaignId===7 && row.factors.effort===100));
});
test('8O complete reuse, changed factors, init and two independent wrappers preserve snapshots',async()=>{
  const m=fixture();m.model.components=m.model.components.filter(c=>['run','prospectives'].includes(c.id));m.model.connections=m.model.connections.filter(e=>e.from.component==='run');m.model.observations=[];
  const right=structuredClone(m.model.components[1]);right.id='right';m.model.components.push(right);m.model.connections.push({from:{component:'run',port:0},to:{component:'right',port:1}});
  source(m,'prospectives',1,0,0,0,1.5);source(m,'prospectives',2,100,0,0,2);source(m,'prospectives',0,0,0,0,2.1);source(m,'prospectives',1,0,0,0,2.2);
  const r=await run(m,'two-wrappers-campaigns'),left=r.scenarioTrajectories.filter(s=>s.wrapperId==='prospectives');
  assert.equal(left.length,18);assert.equal(r.scenarioTrajectories.filter(s=>s.wrapperId==='right').length,6);
  for(let i=0;i<6;i++){assert.deepEqual(left[i].observations,left[i+6].observations);assert.equal(left[i+12].campaignId,3);assert.equal(left[i+12].factors.effort,100);}
  assert.deepEqual(left[0].observations,r.scenarioTrajectories.find(s=>s.wrapperId==='right').observations);
});
test('8O dynamic domains, different horizons and reused plans retain addressed identity',async()=>{
  const m=dynamicMinimal();experiment(m).trajectoryObservations=[{target:'X',samplingInterval:.1}];
  const r=await run(m,'dynamic-plans');assert.ok(r.scenarioTrajectories.length>3);
  for(const row of r.scenarioTrajectories){assert.ok(row.campaignId>=1);assert.ok(row.horizonRequested<=experiment(m).simulation.end);assert.equal(row.horizonApplied,row.horizonRequested);}
  assert.ok(new Set(r.scenarioTrajectories.map(s=>s.campaignId)).size>1);
});
test('8O repeated complete uses zero additional native child calls',async()=>{
  const m=fixture();experiment(m).execution={};source(m,'prospectives',1,0,0,0,2);const r=await run(m,'reuse-no-extra-calls');
  const port=r.wrappers[0].outputs.find(p=>p.kind==='scenario-run-calls').port;
  assert.ok(r.resultEvents.filter(e=>e.port===port&&e.value[2]===1).every(e=>e.value[0]>0));
  assert.deepEqual(r.resultEvents.filter(e=>e.port===port&&e.value[2]===2).map(e=>e.value[0]),[0,0,0,0,0,0]);
  assert.deepEqual(r.scenarioTrajectories.slice(0,6).map(r=>r.observations),r.scenarioTrajectories.slice(6).map(r=>r.observations));
});
test('8O budget-isolated and canceled children carry only collected finite samples and actual reached horizon',async()=>{
  const m=faultMinimal({budget:true});experiment(m).trajectoryObservations=[{target:'X',samplingInterval:.1}];experiment(m).execution.maxCampaignRunCalls=1;
  const r=await run(m,'budget-canceled');
  assert.deepEqual(r.scenarioTrajectories.slice(0,2).map(s=>s.status),['budget-exceeded','canceled']);
  for(const row of r.scenarioTrajectories){assert.ok(row.horizonApplied<row.horizonRequested);for(const o of row.observations)assert.ok(o.samples.every(p=>p.time<=row.start+row.horizonApplied));}
  assert.equal(r.scenarioTrajectories[1].observations[0].samples.length,0);
  const prefix=faultMinimal({budget:true});experiment(prefix).trajectoryObservations=[{target:'X',samplingInterval:.1}];experiment(prefix).execution.maxChildRunCalls=100;
  const p=await run(prefix,'budget-finite-prefix'),partial=p.scenarioTrajectories[1];
  assert.equal(partial.status,'budget-exceeded');assert.ok(partial.horizonApplied>0 && partial.horizonApplied<2);assert.ok(partial.observations[0].samples.length>1);
  const prospective=structuredClone(prefix.model.definitions[0]);prospective.components.find(c=>c.id==='u').parameters.value=-1;
  const f=await run({schemaVersion:1,model:{id:'flat-budget-prefix',components:prospective.components,connections:prospective.connections,observations:[{component:'X',samplingInterval:.1}]},simulation:{start:0,end:2}},'flat-budget-prefix');
  const samples=partial.observations[0].samples;assert.deepEqual(samples,f.observations[0].samples.filter(s=>s.time<=samples.at(-1).time));
  const port=p.wrappers[0].outputs.find(o=>o.kind==='scenario-run-calls').port;assert.equal(p.resultEvents.find(v=>v.port===port&&v.value[1]===1&&v.value[2]===1).value[0],100);
});
for(const [name,mutate] of [
  ['duplicate',m=>experiment(m).trajectoryObservations.push({target:'N',samplingInterval:.1})],
  ['unknown',m=>experiment(m).trajectoryObservations[0].target='missing'],
  ['nonobservable',m=>{const leaf=structuredClone(m.model.definitions[0]);leaf.id='Leaf';leaf.name='Leaf';m.model.definitions.push(leaf);m.model.definitions[0].components.push({id:'nested',type:'coupled',parameters:{},definition:'Leaf'});experiment(m).trajectoryObservations[0].target='nested';}],
  ['wrong-step',m=>experiment(m).trajectoryObservations[0].samplingInterval=.2],
  ['zero-step',m=>experiment(m).trajectoryObservations[0].samplingInterval=0],
  ['negative-step',m=>experiment(m).trajectoryObservations[0].samplingInterval=-.1],
  ['nonfinite-step',m=>experiment(m).trajectoryObservations[0].samplingInterval=Infinity],
  ['too-many-targets',m=>experiment(m).trajectoryObservations=Array.from({length:33},()=>({target:'N',samplingInterval:.1}))],
  ['mode',m=>experiment(m).run='bag'],
  ['point-budget',m=>m.limits={maxTrajectoryPoints:1206}],
  ['internal-budget',m=>m.limits={maxInternalPoints:100}],
])test('8O rejects '+name+' before execution',async()=>{
  const m=fixture();mutate(m);assert.throws(()=>validateRequest(m));const {p,r}=invoke(m);assert.equal(p.status,2);assert.equal(r.status,'failed');
  if(name==='nonobservable')assert.equal(r.error.code,'OBSERVATION_ERROR');
  if(app){const response=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});assert.ok(response.status>=400);}
});
test('8O runtime serialization budget rejects repeated captures explicitly',async()=>{
  const m=fixture();m.limits={maxTrajectoryPoints:1300};source(m,'prospectives',1,0,0,0,2);validateRequest(m);const {p,r}=invoke(m);assert.equal(p.status,2);assert.equal(r.error.code,'LIMIT_EXCEEDED');assert.match(r.error.message,/trajectory/i);
  await rejectedHttp(m,r);
});
test('8O record budget also bounds many short campaigns with few samples',async()=>{
  const m=fixture();m.model.components=m.model.components.filter(c=>['run','prospectives'].includes(c.id));m.model.connections=m.model.connections.filter(e=>e.from.component==='run');m.model.observations=[];
  // generator's native successive delays grow by ta; allow enough parent
  // time for >342 requests without changing child or serialization budgets.
  m.model.components[0]={id:'run',type:'generator',parameters:{period:.005,value:0}};m.simulation.end=1000;experiment(m).simulation.end=.1;experiment(m).scenarioResults=false;
  validateRequest(m);const {p,r}=invoke(m);assert.equal(p.status,2);assert.equal(r.error.code,'LIMIT_EXCEEDED');assert.match(r.error.message,/record/i);
  await rejectedHttp(m,r);
});
test('8O native byte budget rejects large identified responses without truncation',async()=>{
  const m=fixture(),w=structuredClone(m.model.components.find(c=>c.experiment));w.experiment.simulation.end=.1;
  const long='long_prospective_occurrence_123';const definitions=[...m.model.definitions];
  for(let level=0;level<7;level++)definitions.push({id:'Layer'+level,name:'Layer'+level,inputs:[{name:'run',port:0}],outputs:[],components:level===0?[w]:[{id:long,type:'coupled',parameters:{},definition:'Layer'+(level-1)}],connections:[{from:{component:'$input',port:0},to:{component:level===0?w.id:long,port:level===0?1:0}}]});
  m.model.definitions=definitions;m.model.components=[{id:'run',type:'generator',parameters:{period:.01,value:0}},{id:long,type:'coupled',parameters:{},definition:'Layer6'}];m.model.connections=[{from:{component:'run',port:0},to:{component:long,port:0}}];m.model.observations=[];m.simulation.end=452;
  validateRequest(m);const {p,r}=invoke(m);assert.equal(p.status,2);assert.equal(r.error.code,'LIMIT_EXCEEDED');assert.match(r.error.message,/4 MiB/);
  await rejectedHttp(m,r);
});
test('8O parser rejects malformed histories, identities, factors, status and missing rows',async()=>{
  const m=both(fixture()),r=await run(m,'parser-reference');
  for(const mutate of [
    r=>delete r.scenarioTrajectories, r=>r.scenarioTrajectories.pop(), r=>r.scenarioTrajectories.push(r.scenarioTrajectories[0]),
    r=>r.scenarioTrajectories[0].campaignId=0, r=>r.scenarioTrajectories[0].scenarioId=7, r=>r.scenarioTrajectories[0].wrapperId='unknown',
    r=>r.scenarioTrajectories[0].observations[0].samples[1].time=0, r=>r.scenarioTrajectories[0].observations[0].samples[0].value=Infinity,
    r=>r.scenarioTrajectories[0].observations[1].component='N', r=>r.scenarioTrajectories[0].horizonApplied=19,
    r=>r.scenarioTrajectories[0].factors.effort=150, r=>r.scenarioTrajectories[0].status='partial',
  ]){const invalid=structuredClone(r);mutate(invalid);assert.throws(()=>parseWrapperResult(invalid,m));}
  const huge=structuredClone(r);huge.scenarioTrajectories[0].observations[0].samples=Array.from({length:20001},(_,i)=>({time:i/10000,value:0}));assert.throws(()=>parseWrapperResult(huge,m));
  const bytes=structuredClone(r);bytes.diagnostics.extra='x'.repeat(4194304);assert.throws(()=>parseWrapperResult(bytes,m));
});
test('8O selected prospective in adaptive 8N graphs uses actual active wrappers only',async()=>{
  const m=adaptiveProspect();for(const d of m.model.definitions)for(const c of d.components)if(c.experiment)c.experiment.trajectoryObservations=[{target:c.experiment.selections[0].target,samplingInterval:.1}];
  const r=await run(m,'adaptive-8n');assert.ok(r.scenarioTrajectories.length);assert.ok(r.scenarioTrajectories.every(row=>row.observations.length===1));
});
test('8O numerical isolation preserves its decision status; nonfinite additional observations fail natively',async()=>{
  const m=faultMinimal();experiment(m).trajectoryObservations=[{target:'criterion',samplingInterval:.1}];
  const r=await run(m,'numerical-isolated');assert.deepEqual(r.scenarioTrajectories.map(s=>s.status),['completed','numerical-invalid','completed','numerical-invalid']);
  assert.ok(r.scenarioTrajectories.every(s=>s.observations[0].samples.every(p=>Number.isFinite(p.value))));
  // criterion is now an additional observable, while X alone drives validity.
  experiment(m).selections[0].target='X';const {p,r:failed}=invoke(m);
  assert.equal(p.status,2);assert.equal(failed.error.code,'EXECUTION_ERROR');assert.ok(Number.isSafeInteger(failed.error.engineCode));assert.equal(failed.scenarioTrajectories,undefined);
  if(app){const response=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});const body=await response.json();assert.equal(response.status,422);assert.equal(body.error.code,'EXECUTION_ERROR');assert.equal(body.error.engineCode,failed.error.engineCode);}
});
