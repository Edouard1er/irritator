import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRequest, parseWrapperResult } from '../../dist/packages/contracts/index.js';
import { reference, schaefer, experiment, efforts, flat, pair, pulse, analytic } from './schaefer-fixture.mjs';

const runner = process.env.IRRITATOR_RUNNER ?? fileURLToPath(new URL(`../../../build-web-test7g/Release/runner/irritator-runner${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const near = (a,b,tol=1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a-b)<=tol, `${a} != ${b} (tol ${tol})`);
const evidence = []; let app;
before(async () => {
  if (process.env.WRAPPER_7G_HTTP === '1') {
    const { buildApp } = await import('../../dist/apps/api/src/app.js');
    app = buildApp(); await app.listen({ host:'127.0.0.1', port:0 });
  }
});
after(async () => {
  if (app) await app.close();
  if (process.env.IRRITATOR_7G_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_7G_EVIDENCE, {recursive:true});
    writeFileSync(resolve(process.env.IRRITATOR_7G_EVIDENCE,'results.json'), JSON.stringify(evidence,null,2));
  }
});
function invoke(m) {
  const p=spawnSync(runner,[],{input:JSON.stringify(m),encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:8*1024*1024});
  assert.ifError(p.error); return {code:p.status,result:JSON.parse(p.stdout)};
}
async function run(m) {
  validateRequest(m); const p=invoke(m); assert.equal(p.code,0,JSON.stringify(p.result));
  if(app) {
    const response=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});
    const result=await response.json(); assert.equal(response.status,200,JSON.stringify(result));
    const {runId,...native}=result; assert.ok(runId); assert.deepEqual(native,p.result);
  }
  evidence.push({request:m,result:p.result,httpEqualsNative:!!app});
  return m.schemaVersion===3 ? parseWrapperResult(p.result,m) : p.result;
}
const terminal = (r,name) => r.observations.find(o=>o.component===name).samples.at(-1).value;
function decision(r,effort,values,component='decision',time=1) {
  const events=r.resultEvents.filter(e=>e.component===component&&e.time===time);
  assert.equal(events.length,3);
  for(const [port,e] of events.entries()) {assert.equal(e.port,port);assert.ok(e.bag>0);near(e.value[0],port===2?effort:values[port]);assert.deepEqual(e.value.slice(1),[0,0]);}
}
const raw = new Map();
async function values(effort) {
  if(!raw.has(effort)) {const r=await run(flat(effort));raw.set(effort,[terminal(r,'N'),terminal(r,'C')]);}
  return raw.get(effort);
}
test('7G conversion preserves every reference atom, parameter and connection',()=>{
  const m=schaefer(),original=reference(),d=m.model.definitions[0];
  assert.equal(m.schemaVersion,3);assert.equal(d.id,'Schaefer');assert.equal(d.components.length,15);assert.equal(d.connections.length,18);
  assert.deepEqual(d.components,original.model.components);assert.deepEqual(d.connections,original.model.connections);
  assert.equal(d.components.find(c=>c.id==='InvK').parameters.value,.003333);
  assert.deepEqual(experiment(m).simulation,original.simulation);assert.deepEqual(m.simulation,{start:0,end:3});validateRequest(m);
});
test('7G single E260 matches direct QSS3, historical terminals and all 42 CSV points',async()=>{
  const f=await run(flat(260)),r=await run(schaefer());
  near(terminal(f,'N'),129.8069509703022);near(terminal(f,'C'),72.34097477635842);
  decision(r,260,[terminal(f,'N'),terminal(f,'C')]);
  assert.equal(r.wrappers[0].inputs,3);assert.equal(r.wrappers[0].outputs.length,3);assert.equal(r.wrappers[0].scenarioCount,1);
  assert.equal(r.wrappers[0].criteriaScale,'raw');assert.equal(r.simulation.finalTime,3);
  assert.deepEqual(r.observations.map(o=>o.component),['biomass','capture','effort']);
  for(const [i,o] of r.observations.entries()) near(o.samples.at(-1).value,[terminal(f,'N'),terminal(f,'C'),260][i]);
  const csv=readFileSync(new URL('../../model-test/modelhalieutiquetest-points.csv',import.meta.url),'utf8').trim().split(/\r?\n/).slice(1);
  assert.equal(csv.length,42);
  for(const line of csv) {const [name,t,v]=line.split(',');const o=f.observations.find(o=>o.component===name.replaceAll('"',''));const sample=o.samples.find(s=>Math.abs(s.time-Number(t))<1e-12);assert.ok(sample);near(sample.value,Number(v));}
});
for(const effort of [200,260,320]) test(`7G E=${effort}: independent flat, nested and analytic trajectory control`,async()=>{
  const f=await run(flat(effort)),r=await run(efforts(schaefer(),[effort]));
  const expected=[terminal(f,'N'),terminal(f,'C')];decision(r,effort,expected);
  for(const o of f.observations) {
    assert.equal(o.samples.length,21);near(o.samples[0].time,0);near(o.samples.at(-1).time,2);
    for(const sample of o.samples) near(sample.value,analytic(effort,sample.time)[o.component],.05);
  }
  assert.deepEqual((await run(efforts(schaefer(),[effort]))).resultEvents,r.resultEvents);
});
for(const primary of ['N','C']) test(`7G fixed [200,260,320]: simple maximize ${primary}`,async()=>{
  const m=efforts(schaefer(),[200,260,320]);experiment(m).objective.primary=primary;
  const r=await run(m),effort=primary==='N'?200:320;decision(r,effort,await values(effort));assert.equal(r.wrappers[0].scenarioCount,3);
});
for(const norm of ['min-max','z-score']) for(const types of [['maximize','maximize'],['minimize','maximize'],['maximize','minimize']]) test(`7G weighted ${norm} local ${types}`,async()=>{
  const rows=await Promise.all([200,260,320].map(values)),normalized=rows.map(()=>[]);
  for(let col=0;col<2;col++) {
    const column=rows.map(row=>row[col]),lo=Math.min(...column),hi=Math.max(...column),mean=column.reduce((a,b)=>a+b,0)/3;
    const std=Math.sqrt(column.reduce((s,v)=>s+(v-mean)**2,0)/3);
    rows.forEach((row,i)=>normalized[i][col]=norm==='min-max'?(types[col]==='maximize'?(row[col]-lo)/(hi-lo):(hi-row[col])/(hi-lo)):(types[col]==='maximize'?1:-1)*(row[col]-mean)/std);
  }
  const weights=[2,1],scores=normalized.map(row=>row[0]*weights[0]+row[1]*weights[1]),winner=scores.indexOf(Math.max(...scores));
  const m=efforts(schaefer(),[200,260,320]);experiment(m).objective={method:'weighted-sum',type:'maximize',weights,types,norm};
  const r=await run(m);decision(r,[200,260,320][winner],normalized[winner]);assert.equal(r.wrappers[0].criteriaScale,'normalized');
});
test('7G changing weights changes native selection',async()=>{
  for(const [weights,effort] of [[[10,1],200],[[1,10],320]]) {
    const m=efforts(schaefer(),[200,260,320]);experiment(m).objective={method:'weighted-sum',type:'maximize',weights,types:['maximize','maximize'],norm:'min-max'};
    near((await run(m)).resultEvents[2].value[0],effort);
  }
});
for(const threshold of [125,1000]) test(`7G epsilon max C with N>=${threshold}, C>=0`,async()=>{
  const m=efforts(schaefer(),[200,260,320]);experiment(m).objective={method:'epsilon-constrained',type:'maximize',primary:'C',epsilons:[threshold,0],operations:['greater-equal','greater-equal']};
  const r=await run(m);assert.equal(r.wrappers[0].scenarioCount,3);
  if(threshold===1000) assert.deepEqual(r.resultEvents,[]);else decision(r,260,await values(260));
});
for(const reset of [false,true]) test(`7G two Schaefer wrappers, private plans, reset=${reset}, roundtrip`,async()=>{
  const m=pair(reset),r=await run(m);assert.deepEqual(r.wrappers.map(w=>w.scenarioCount),[2,2]);
  decision(r,200,await values(200));decision(r,260,await values(260),'right');
  if(reset) decision(r,320,await values(320),'decision',2.2);
  assert.equal(r.resultEvents.length,reset?9:6);
  const restored=JSON.parse(JSON.stringify(m));assert.deepEqual(restored.model.components.filter(c=>c.experiment).map(c=>c.experiment.factors[0].values),[[200,260],[260,320]]);
  const s=await run(restored);assert.deepEqual(s.resultEvents,r.resultEvents);assert.deepEqual(s.observations,r.observations);assert.deepEqual(s.wrappers,r.wrappers);
});
test('7G repeated run and whole request restart reproduce the native decision',async()=>{
  const m=schaefer();pulse(m,'again',1.5,0,1);const r=await run(m);assert.equal(r.resultEvents.length,6);
  decision(r,260,await values(260));decision(r,260,await values(260),'decision',1.5);
  assert.deepEqual((await run(m)).resultEvents,r.resultEvents);
});
const invalid = [
  ['empty E',m=>experiment(m).factors[0]={id:'effort',target:'E',parameter:'value',type:'fixed',values:[]}],
  ['out of range E',m=>experiment(m).factors[0].value=1e13],
  ['nonnumeric E',m=>experiment(m).factors[0].value='260'],
  ['missing target',m=>experiment(m).factors[0].target='missing'],
  ['wrong parameter',m=>experiment(m).factors[0].parameter='offset'],
  ['unresolved N',m=>experiment(m).selections[0].target='missing'],
  ['invalid criterion',m=>experiment(m).selections[0].criteria='mean'],
  ['unresolved primary',m=>experiment(m).objective.primary='missing'],
  ['empty child horizon',m=>experiment(m).simulation.end=0],
  ['inverted parent horizon',m=>m.simulation.end=-1],
  ['scenario limit',m=>{efforts(m,[200,260,320]);m.limits={maxScenarios:2};}],
  ['recursive prospective',m=>m.model.definitions[0].components.push({id:'recursive',type:'simulation_wrapper',parameters:{},experiment:structuredClone(experiment(m))})]
];
for(const [name,mutate] of invalid) test(`7G rejects ${name} in contracts, runner and HTTP`,async()=>{
  const m=schaefer();mutate(m);assert.throws(()=>validateRequest(m));const p=invoke(m);assert.notEqual(p.code,0);assert.equal(p.result.status,'failed');
  if(app) {
    const response=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});
    assert.equal(response.status,400);assert.equal((await response.json()).status,'failed');
  }
});
test('7G parent horizon excludes a decision due at its end',async()=>{
  const m=schaefer();m.model.components[0].parameters.value=2;assert.deepEqual((await run(m)).resultEvents,[]);
});
test('7G v1/v2 Schaefer compatibility retains every QSS3 sample',async()=>{
  for(const effort of [200,260,320]) assert.deepEqual((await run(flat(effort,2))).observations,(await run(flat(effort,1))).observations);
});
test('7G result contract rejects altered scale, cardinality and nonnative layout',async()=>{
  const m=schaefer(),r=await run(m);
  for(const mutate of [r=>r.wrappers[0].scenarioCount=2,r=>r.wrappers[0].criteriaScale='normalized',r=>r.resultEvents[0].port=3]) {
    const bad=structuredClone(r);mutate(bad);assert.throws(()=>parseWrapperResult(bad,m));
  }
});
test('7G simultaneous independent HTTP requests',async()=>{
  if(!app) {const a=await run(schaefer()),b=await run(pair());assert.equal(a.resultEvents.length,3);assert.equal(b.resultEvents.length,6);return;}
  const requests=[schaefer(),pair()],results=await Promise.all(requests.map(async m=>{
    const response=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});
    const r=await response.json();assert.equal(response.status,200,JSON.stringify(r));const {runId,...native}=r;assert.deepEqual(native,invoke(m).result);return r;
  }));assert.notEqual(results[0].runId,results[1].runId);
});
