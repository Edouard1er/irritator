import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRequest, parseWrapperResult } from '../../dist/packages/contracts/index.js';

const runner = process.env.IRRITATOR_RUNNER ?? fileURLToPath(new URL(`../../../build-web-test7f/${process.platform==='win32'?'Release/':''}runner/irritator-runner${process.platform==='win32'?'.exe':''}`,import.meta.url));
const affine = () => JSON.parse(readFileSync(new URL('../../examples/wrapper-affine-v3.json', import.meta.url), 'utf8'));
const experiment = m => m.model.components.find(c => c.experiment).experiment;
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
let app;
const evidence=[];
before(async()=>{
  if(process.env.WRAPPER_7F_HTTP==='1') {
    const {buildApp}=await import('../../dist/apps/api/src/app.js');
    app=buildApp(); await app.listen({host:'127.0.0.1',port:0});
  }
});
after(async()=>{
  if(app) await app.close();
  if(process.env.IRRITATOR_7F_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_7F_EVIDENCE,{recursive:true});
    writeFileSync(resolve(process.env.IRRITATOR_7F_EVIDENCE,'results.json'),JSON.stringify(evidence,null,2));
  }
});
function invoke(m) {
  const p=spawnSync(runner,[],{input:JSON.stringify(m),encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:4*1024*1024});
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
  return parseWrapperResult(p.result,m);
}
for(const norm of ['min-max','z-score']) for(const type of ['maximize','minimize']) test(`7F.1 weighted-sum ${norm} ${type}`,async()=>{
  const m=affine(); experiment(m).objective={method:'weighted-sum',type,weights:[2,1],types:['maximize','minimize'],norm};
  const r=await run(m), max=type==='maximize';
  near(r.resultEvents[0].value[0],norm==='min-max'?(max?1:0):(max?Math.sqrt(1.5):-Math.sqrt(1.5)));
  near(r.resultEvents[1].value[0],norm==='min-max'?(max?0:1):(max?-1/Math.sqrt(2):Math.sqrt(2)));
  near(r.resultEvents[2].value[0],max?1:-1);
});
test('7F.1 weights and native first tie order',async()=>{
  for(const weights of [[0,1],[0,0]]) { const m=affine(); experiment(m).objective={method:'weighted-sum',type:'maximize',weights,types:['maximize','minimize'],norm:'min-max'};
    near((await run(m)).resultEvents[2].value[0],-1); }
});
for(const [epsilons,operations,expected] of [
  [[1,1],['less-equal','greater-equal'],0], [[1,1],['equal','equal'],0], [[3,1],['not-equal','equal'],0],
  [[0,2],['greater-equal','greater-equal'],null], [[2,1],['equal','equal'],null]
]) test(`7F.1 epsilon ${operations} ${epsilons}`,async()=>{
  const m=affine(); experiment(m).objective={method:'epsilon-constrained',type:'maximize',primary:'terminal',epsilons,operations};
  const r=await run(m); if(expected===null) assert.deepEqual(r.resultEvents,[]); else near(r.resultEvents[2].value[0],expected);
});
test('7F.1 epsilon minimizing',async()=>{
  const m=affine(); experiment(m).objective={method:'epsilon-constrained',type:'minimize',primary:'terminal',epsilons:[-1,-1],operations:['greater-equal','greater-equal']};
  near((await run(m)).resultEvents[2].value[0],-1);
});
test('7F.1 invalid objective dimensions rejected by both validators',()=>{
  for(const objective of [
    {method:'weighted-sum',type:'maximize',weights:[1],types:['maximize'],norm:'min-max'},
    {method:'epsilon-constrained',type:'maximize',primary:'terminal',epsilons:[1],operations:['equal']}
  ]) { const m=affine(); experiment(m).objective=objective; assert.throws(()=>validateRequest(m),e=>e.code==='INVALID_EXPERIMENT'); assert.equal(invoke(m).result.error.code,'INVALID_EXPERIMENT'); }
});

for(const family of ['single','fixed','random']) for(const operation of ['','-add','-mult']) for(const external of [false,true]) test(`7F.2 ${family}${operation} external=${external}`,async()=>{
  const m=affine(),e=experiment(m),type=family+operation;
  const plan=family==='single'?{value:2}:family==='fixed'?{values:[1,2]}:{count:3,distribution:'uniform-int',reals:[0,1],ints:[2,2]};
  e.factors[0]={id:'rate',target:'u',parameter:'value',type,...plan};
  if(external) {m.model.components.push({id:'external',type:'constant',parameters:{value:3,offset:.5}});m.model.connections.push({from:{component:'external',port:0},to:{component:'decision',port:2}});}
  const expected=external?(operation==='-add'?5:operation==='-mult'?6:3):2,r=await run(m);
  near(r.resultEvents[2].value[0],expected);near(r.resultEvents[0].value[0],1+2*expected);
  assert.equal(r.wrappers[0].scenarioCount,family==='single'?1:family==='fixed'?2:3);
});
const distributions=[['uniform-int',14],['uniform-real',15],['bernoulli',0],['binomial',1],['negative-binomial',10],['geometric',8],['poisson',12],['exponential',4],['gamma',7],['weibull',16],['extreme-value',5],['normal',11],['lognormal',9],['chi-squared',3],['cauchy',2],['fisher-f',6],['student-t',13]];
let randomOracle;
function nativeRandomOracle() {
  if(!randomOracle) {
    const executable=resolve(runner,`../tests-wrapper/runner-wrapper-tests${process.platform==='win32'?'.exe':''}`);
    const p=spawnSync(executable,['distributions'],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:8*1024*1024});
    assert.ifError(p.error);assert.equal(p.status,0,p.stderr);
    randomOracle=new Map([...p.stdout.matchAll(/DISTRIBUTION (\d+) selected=([^\r\n]+)/g)].map(m=>[Number(m[1]),Number(m[2])]));
    assert.equal(randomOracle.size,17);
  }
  return randomOracle;
}
for(const [distribution,ordinal] of distributions) test(`7F.2 native distribution ${distribution}`,async()=>{
  const m=affine(),e=experiment(m);m.model.definitions[0].components.length=1;m.model.definitions[0].connections=[];
  for(const s of e.selections)s.target='u';
  e.seed=['18446744073709551615','9007199254740993','0','0','0','0'];
  e.factors[0]={id:'rate',target:'u',parameter:'value',type:'random',count:4,distribution,reals:[.5,1],ints:[2,4]};
  const r=await run(m);near(r.resultEvents[2].value[0],nativeRandomOracle().get(ordinal));
  assert.deepEqual((await run(JSON.parse(JSON.stringify(m)))).resultEvents,r.resultEvents);
});
const invalidDistributionParameters=[
 ['uniform-int',[0,1],[3,2]], ['uniform-real',[2,1],[0,0]], ['bernoulli',[1.1,1],[0,0]],['binomial',[.5,1],[-1,0]],
 ['negative-binomial',[0,1],[2,0]],['geometric',[1,1],[0,0]],['poisson',[0,1],[0,0]],['exponential',[-1,1],[0,0]],
 ['gamma',[1,0],[0,0]],['weibull',[0,1],[0,0]],['extreme-value',[0,0],[0,0]],['normal',[0,-1],[0,0]],
 ['lognormal',[0,0],[0,0]],['chi-squared',[0,1],[0,0]],['cauchy',[0,0],[0,0]],['fisher-f',[1,0],[0,0]],['student-t',[0,1],[0,0]]];
for(const [distribution,reals,ints] of invalidDistributionParameters) test(`7F.2 invalid domain ${distribution}`,async()=>{
  const m=affine();experiment(m).factors[0]={id:'rate',target:'u',parameter:'value',type:'random',count:4,distribution,reals,ints};
  assert.throws(()=>validateRequest(m),e=>e.code==='INVALID_FACTOR');assert.equal(invoke(m).result.error.code,'INVALID_FACTOR');
  if(app) { const r=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});assert.equal(r.status,400);assert.equal((await r.json()).error.code,'INVALID_FACTOR'); }
});
test('7F.2 exact uint64 seed validation and random Cartesian budgets',()=>{
  for(const seed of [['18446744073709551616','0','0','0','0','0'],['01','0','0','0','0','0'],['1\n','0','0','0','0','0'],[9007199254740993,0,0,0,0,0]]) {
    const m=affine();experiment(m).seed=seed;assert.throws(()=>validateRequest(m));assert.notEqual(invoke(m).code,0);
  }
  const m=affine(),e=experiment(m); e.factors[0]={id:'rate',target:'u',parameter:'value',type:'random',count:12,distribution:'uniform-real',reals:[0,1],ints:[0,0]};
  e.factors.push({id:'initial',target:'X',parameter:'X',type:'random-add',count:12,distribution:'uniform-real',reals:[0,1],ints:[0,0]});
  assert.throws(()=>validateRequest(m),e=>e.code==='LIMIT_EXCEEDED');assert.equal(invoke(m).result.error.code,'LIMIT_EXCEEDED');
});
test('7F.2 mixed Cartesian fixed/random plan and native parameter triplets',async()=>{
  const m=affine(),e=experiment(m);
  e.factors[0]={id:'rate',target:'u',parameter:'value',type:'random',count:3,distribution:'uniform-int',reals:[0,1],ints:[2,2]};
  e.factors.push({id:'initial',target:'X',parameter:'X',type:'fixed-mult',values:[1,2]});
  const r=await run(m);assert.equal(r.wrappers[0].scenarioCount,6);assert.deepEqual(r.resultEvents.map(e=>e.value),[[6,0,0],[2,0,0],[2,0,0],[2,.01,0]]);
});
test('7F.2 generated and transformed values outside native target bounds fail explicitly',async()=>{
  for(const random of [true,false]) {
    const m=affine(),e=experiment(m),d=m.model.definitions[0];d.components.length=1;d.connections=[];for(const s of e.selections)s.target='u';
    e.factors[0]=random?{id:'rate',target:'u',parameter:'value',type:'random',count:1,distribution:'lognormal',reals:[1000,.1],ints:[0,0]}:{id:'rate',target:'u',parameter:'value',type:'single-mult',value:1e12};
    if(!random)pulse(m,'external',.5,1e12,2);
    validateRequest(m);const p=invoke(m);assert.notEqual(p.code,0);assert.equal(p.result.error.code,'INVALID_FACTOR');
    if(app){const r=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});assert.equal(r.status,422);assert.equal((await r.json()).error.code,'INVALID_FACTOR');}
  }
});

const pulse=(m,id,at,value,port)=>{m.model.components.push({id,type:'constant',parameters:{value,offset:at}});m.model.connections.push({from:{component:id,port:0},to:{component:'decision',port}});};
function clocked(mode) {
  const m=affine(),e=experiment(m),d=m.model.definitions[0];e.run=mode;e.simulation={start:10,end:12};
  d.components.length=1;d.connections=[];for(const s of e.selections)s.target='u';
  for(const [i,offset] of [.5,1,1.5].entries())d.components.push({id:`clock${i}`,type:'constant',parameters:{value:0,offset}});
  m.model.components[0].parameters={value:mode==='until'?10.75:mode==='during'?.75:0,offset:5};m.simulation.end=30;
  return m;
}
for(const mode of ['complete','bag','time','until','during']) test(`7F.3 native mode ${mode} separate clocks`,async()=>{
  const m=clocked(mode),r=await run(m),arg=m.model.components[0].parameters.value;
  assert.equal(r.resultEvents.length,3);near(r.resultEvents[0].time,5+arg);near(r.resultEvents[0].value[0],1);
  assert.equal(r.simulation.finalTime,30);
});
test('7F.3 absolute until and relative during differ at child start=10',async()=>{
  const m=affine(),e=experiment(m);e.simulation={start:10,end:12};m.simulation.end=10;m.model.components[0].parameters={value:.75,offset:5};
  e.run='until';const u=await run(m);near(u.resultEvents[0].time,5.75);near(u.resultEvents[0].value[0],1);
  e.run='during';const d=await run(m);near(d.resultEvents[0].time,5.75);assert.ok(d.resultEvents[0].value[0]>=1.75);assert.notDeepEqual(u.resultEvents,d.resultEvents);
});
for(const mode of ['complete','bag','time','until','during']) for(const init of [false,true]) test(`7F.3 factor change ${mode}, init=${init}`,async()=>{
  const m=affine(),e=experiment(m);e.run=mode;e.factors[0]={id:'rate',target:'u',parameter:'value',type:'single',value:2};
  pulse(m,'factor',.5,5,2);if(init)pulse(m,'init',.75,0,0);
  near((await run(m)).resultEvents[2].value[0],mode==='complete'||init?5:2);
});
test('7F.3 simultaneous commands take the minimum run scalar and apply factor/init first',async()=>{
  const m=affine();m.model.components[0].parameters.value=3;pulse(m,'secondRun',1,1,1);pulse(m,'factor',1,5,2);pulse(m,'init',1,0,0);
  const r=await run(m);assert.equal(r.resultEvents.length,3);near(r.resultEvents[0].time,2);near(r.resultEvents[2].value[0],5);
});
test('7F.3 overlapping snapshots, equal due dates and cancelled responses',async()=>{
  const m=affine();m.simulation.end=4;m.model.components[0].parameters.value=2;pulse(m,'factor',1.5,2,2);pulse(m,'secondRun',2,0,1);
  const r=await run(m);assert.equal(r.resultEvents.length,6);near(r.resultEvents[0].time,2);near(r.resultEvents[2].value[0],2);near(r.resultEvents[3].time,3);near(r.resultEvents[5].value[0],1);
  const n=affine();n.simulation.end=4;n.model.components[0].parameters.value=2;pulse(n,'secondRun',2,1,1);
  const s=await run(n);assert.equal(s.resultEvents.length,6);near(s.resultEvents[0].time,3);near(s.resultEvents[3].time,3);assert.ok(s.resultEvents[0].bag<s.resultEvents[3].bag);
  pulse(n,'init',1.5,0,0);const c=await run(n);assert.equal(c.resultEvents.length,3);near(c.resultEvents[0].time,3);
});
test('7F.3 no command, and response beyond parent horizon, emit nothing',async()=>{
  const m=affine();m.model.connections=m.model.connections.filter(c=>c.to.component!=='decision');assert.deepEqual((await run(m)).resultEvents,[]);
  const n=affine();n.model.components[0].parameters.value=2;assert.deepEqual((await run(n)).resultEvents,[]);
});
test('7F.3 successive partial commands retain absolute until and accumulate during',async()=>{
  const results=[];
  for(const mode of ['until','during']) {
    const m=affine(),e=experiment(m);e.run=mode;e.simulation.end=4;m.simulation.end=5;
    e.factors[0]={id:'rate',target:'u',parameter:'value',type:'single',value:1};
    m.model.definitions[0].components[1].type='qss1_integrator';m.model.components[0].parameters.value=.75;
    pulse(m,'again',2,.75,1);const r=await run(m);assert.equal(r.resultEvents.length,6);
    near(r.resultEvents[0].time,1.75);near(r.resultEvents[3].time,2.75);
    const first=r.resultEvents[0].value[0],second=r.resultEvents[3].value[0];
    // Suspended children keep their resampler open: available native points
    // are at .7 and 1.4, rather than the requested .75 and 1.5 targets.
    near(first,1.7);near(second,mode==='until'?1.7:2.4);
    results.push([first,second]);
  }
  assert.ok(results[1][1]>results[0][1]);
});
