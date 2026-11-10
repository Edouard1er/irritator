import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { faultMinimal, safetySchaefer, faultSchaefer } from './decision-8j-fixture.mjs';
import { dynamicUncertainty } from './decision-8i-fixture.mjs';
import { dynamicMinimal } from './decision-8h-fixture.mjs';
import { source } from './decision-8c-fixture.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { schaeferOracle } from './decision-8e-oracle.mjs';
import { validateRequest, parseWrapperResult } from '../../dist/packages/contracts/index.js';
const runner=process.env.IRRITATOR_RUNNER; assert.ok(runner);
let app;
if(process.env.DECISION_8J_HTTP==='1') {
  const { buildApp }=await import('../../dist/apps/api/src/app.js');const { readConfig }=await import('../../dist/apps/api/src/config/index.js');
  app=buildApp(readConfig());await app.listen({host:'127.0.0.1',port:0});test.after(()=>app.close());
}
const dir=process.env.IRRITATOR_8J_EVIDENCE;
async function run(m,name,error=false,{native=true}={}) {
  validateRequest(m);const input=JSON.stringify(m),start=performance.now();
  const p=spawnSync(runner,[],{input,encoding:'utf8',windowsHide:true,timeout:30000});const processMs=performance.now()-start;
  const r=JSON.parse(p.stdout||'null');let path;
  const proof={request:m,result:r,exit:p.status,stderr:p.stderr,processMs,httpEqualsNative:null};
  if(dir){mkdirSync(dir,{recursive:true});path=resolve(dir,name+'.json');writeFileSync(path,JSON.stringify(proof,null,2));}
  assert.equal(p.status,error?2:0,p.stdout+p.stderr);
  if(error){assert.equal(r.error.code,'EXECUTION_ERROR');assert.equal(r.resultEvents,undefined);}else{parseWrapperResult(r,m);assert.equal(p.stderr,'');}
  if(app){const res=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:input});
    const {runId,requestId,...actual}=await res.json();if(path)writeFileSync(path,JSON.stringify({...proof,httpStatus:res.status,httpResult:actual},null,2));assert.equal(res.status,error?422:200,JSON.stringify(actual));assert.ok(error?requestId:runId);assert.deepEqual(actual,r);
    if(path)writeFileSync(path,JSON.stringify({...proof,httpEqualsNative:true,httpStatus:res.status},null,2));}
  if(native&&dir) {
    const file=resolve(dir,name+'-request.json');writeFileSync(file,input);
    const n=spawnSync(resolve(dirname(runner),'execution-safety-native.exe'),[file],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:32*1024*1024});
    writeFileSync(resolve(dir,name+'-native.log'),n.stdout+n.stderr);assert.equal(n.status,error?2:0,n.stdout.slice(-3000)+n.stderr);
    if(!error)assert.match(n.stdout,/NATIVE_EXECUTION_SAFETY_RESET_PASS/);
  }
  return r;
}
const wrapper=m=>m.model.components.find(c=>c.id==='forecast');
const events=(r,kind,c=1)=>{const ports=r.wrappers[0].outputs.filter(p=>p.kind===kind).map(p=>p.port);return r.resultEvents.filter(e=>ports.includes(e.port)&&e.value[2]===c);};
const values=(r,kind,c=1)=>events(r,kind,c).map(e=>e.value[0]);
const ends=r=>r.resultEvents.filter(e=>e.port===r.wrappers[0].outputs.find(p=>p.kind==='campaign-end').port).map(e=>e.value);
const last=(r,id)=>r.observations.find(o=>o.component===id).samples.at(-1).value;
const nativeActions=trace=>trace.split(/\r?\n/).flatMap(line=>{const m=line.match(/^EVENT 0 \d+ (\S+) plant\/effort:0 \[([^,]+),0,0\]$/);return m?[[Number(m[1]),Number(m[2])]]:[];});
function manual(){const m=dynamicMinimal();m.model.definitions=m.model.definitions.filter(d=>d.id==='LinearProspect');m.model.components=m.model.components.filter(c=>c.id==='forecast');m.model.connections=[];m.model.observations=[];m.simulation.end=8;wrapper(m).experiment.execution={failurePolicy:'isolate',maxChildRunCalls:10000,maxCampaignRunCalls:100000};return m;}
function transmit(m,c,domain,H,at=0){source(m,'forecast',2,7,0,c,at);domain.forEach((v,i)=>source(m,'forecast',3,v,i,c,at));for(const [field,value] of [[0,c],[1,1],[2,H],[6,domain.length],[3,0]])source(m,'forecast',4,value,field,c,at);}

test('8J QSS3 overflow isolates one child, preserves genuine zero, factors, horizon and reuse',async()=>{
  const m=faultMinimal();assert.deepEqual(m,JSON.parse(readFileSync(new URL('../../examples/decision-fault-tolerant-minimal-v3.json',import.meta.url))));
  const r=await run(m,'minimal');assert.deepEqual(ends(r),[[1,2,1],[1,2,2]]);
  for(const c of [1,2]){assert.deepEqual(values(r,'scenario-status',c),[1,0]);assert.deepEqual(values(r,'scenario-outcome',c),[1,2]);
    assert.deepEqual(values(r,'scenario-selection',c),[0]);assert.deepEqual(values(r,'scenario-horizon',c),[2,2]);}
  assert.equal(last(r,'choose'),.5);
  for(const policy of [undefined,{}]){const a=faultMinimal();wrapper(a).experiment.execution=policy;const f=await run(a,policy?'fail-fast-option':'fail-fast-default',true);assert.equal(f.error.engineCode,67);}
});
test('8J budget stops a high-event child, preserves sibling, then sufficient budget succeeds unchanged',async()=>{
  const m=faultMinimal({budget:true}),r=await run(m,'child-budget');
  assert.deepEqual(values(r,'scenario-outcome'),[1,3]);assert.equal(values(r,'scenario-run-calls')[1],10);assert.deepEqual(ends(r),[[1,2,1],[1,2,2]]);
  const high=structuredClone(m);wrapper(high).experiment.execution.maxChildRunCalls=10000;
  const h=await run(high,'child-budget-high');assert.deepEqual(values(h,'scenario-outcome'),[1,1]);assert.ok(values(h,'scenario-run-calls')[1]>10);
  assert.deepEqual(high.model.definitions,m.model.definitions);
  const fast=structuredClone(m);wrapper(fast).experiment.execution.failurePolicy='fail-fast';const f=await run(fast,'child-budget-fast',true);assert.equal(f.error.engineCode,71);
});
test('8J campaign budget cancels unstarted children and counts exactly the native calls',async()=>{
  const m=faultMinimal({budget:true});wrapper(m).experiment.execution.maxCampaignRunCalls=1;
  const r=await run(m,'campaign-budget');assert.deepEqual(values(r,'scenario-outcome'),[3,4]);assert.deepEqual(values(r,'scenario-run-calls'),[1,0]);
  assert.deepEqual(values(r,'campaign-run-calls'),[1]);assert.deepEqual(values(r,'scenario-selection'),[]);assert.deepEqual(ends(r),[[0,2,1],[0,2,2]]);
});
test('8J delayed static responses are bounded and capacity errors remain global',async()=>{
  const m=faultMinimal();m.model.components=m.model.components.filter(c=>!c.id.startsWith('run'));
  m.model.connections=m.model.connections.filter(e=>!e.from.component.startsWith('run'));
  m.model.components.push(atom('ticks','generator',{period:.0001,value:1000}));m.model.connections.push(edge('ticks',0,'forecast',1));
  m.simulation.end=2;const r=await run(m,'pending-capacity',true);assert.equal(r.error.engineCode,69);
});
test('8J unchanged logical time is bounded by calls without classifying legitimate microsteps as Zeno',async()=>{
  const m=faultMinimal();wrapper(m).experiment.execution.maxChildRunCalls=20;
  const d=m.model.definitions[0];d.components.push(atom('loop','event_operator'),atom('return','event_operator'));d.connections.push(edge('u',0,'loop',0),edge('loop',0,'return',0),edge('return',0,'loop',0));
  const r=await run(m,'zero-time-loop');assert.deepEqual(values(r,'scenario-outcome'),[3,3]);assert.deepEqual(values(r,'scenario-run-calls'),[20,20]);
});
test('8J collect-only has no historical selection, optimization uses only valid children for every method',async()=>{
  const m=faultMinimal();wrapper(m).experiment.execution.resultMode='collect';const r=await run(m,'collect-only');assert.equal(r.resultEvents.filter(e=>e.port<3).length,0);assert.deepEqual(ends(r),[[1,2,1],[1,2,2]]);
  for(const norm of ['min-max','z-score']){const w=faultMinimal();wrapper(w).experiment.objective={method:'weighted-sum',type:'maximize',weights:[1],types:['maximize'],norm};const a=await run(w,'weighted-'+norm);assert.deepEqual(ends(a),[[1,2,1],[1,2,2]]);}
  const e=faultMinimal();wrapper(e).experiment.objective={method:'epsilon-constrained',type:'maximize',primary:'terminal',epsilons:[0],operations:['greater-equal']};await run(e,'epsilon');
});
test('8J all invalid has no historical scientific output and no new selected action',async()=>{
  const m=faultMinimal();wrapper(m).experiment.factors[1].values=[2,3];const r=await run(m,'all-invalid');
  assert.deepEqual(ends(r),[[0,2,1],[0,2,2]]);assert.equal(r.resultEvents.filter(e=>e.port<3||e.port===6).length,0);
  assert.equal(last(r,'choose'),0); // unchanged initial observation, no command
});
test('8J successful static runs retain historical complete reuse, including a seeded random plan',async()=>{
  for(const random of [false,true]){
    const m=faultMinimal({budget:true});wrapper(m).experiment.execution.maxChildRunCalls=10000;
    if(random){wrapper(m).experiment.factors[1]={id:'control',target:'u',parameter:'value',type:'random',count:2,distribution:'uniform-real',reals:[-1,0],ints:[0,0]};wrapper(m).experiment.seed=['17','0','0','0','0','0'];}
    // Compare consecutive runs within one initialization. The legacy native
    // random stream advances on initialize; the fixed case additionally uses
    // the standalone deterministic reset proof.
    const r=await run(m,'successful-reuse-'+random,false,{native:!random}),old=structuredClone(m);delete wrapper(old).experiment.execution;
    const reference=await run(old,'historical-reuse-'+random,false,{native:false});
    assert.deepEqual(r.resultEvents.filter(e=>e.port<8).map(({bag,...e})=>e),reference.resultEvents.map(({bag,...e})=>e));
    assert.deepEqual(values(r,'scenario-run-calls',2),[0,0]);assert.deepEqual(values(r,'campaign-run-calls',2),[0]);
    assert.deepEqual(values(r,'scenario-outcome',2),[1,1]);
  }
});
test('8J two coupled wrapper occurrences own independent child budgets and scenario identities',async()=>{
  const a=faultMinimal(),scope={id:'Experiment',name:'Independent execution',inputs:[],outputs:[],components:a.model.components,connections:a.model.connections};
  const m={...a,model:{id:'two-safe-occurrences',definitions:[...a.model.definitions,scope],components:['a','b'].map(id=>({id,type:'coupled',definition:scope.id,parameters:{}})),connections:[],observations:[]}};
  const r=await run(m,'two-occurrences');for(const id of ['a/forecast','b/forecast']){
    assert.deepEqual(r.resultEvents.filter(e=>e.component===id&&e.port===7).map(e=>e.value),[[1,2,1],[1,2,2]]);
    assert.deepEqual(r.resultEvents.filter(e=>e.component===id&&e.port===11).map(e=>e.value),[[10,0,1],[10,0,2]]);
  }
});
test('8J entirely valid Schaefer preserves exact 8I criteria, decisions and Plant trajectories',async()=>{
  const m=safetySchaefer();assert.deepEqual(m,JSON.parse(readFileSync(new URL('../../examples/tstar-schaefer-execution-safety-v3.json',import.meta.url))));
  for(const id of ['SchaeferPlant','SchaeferProspect','SynchronizePair'])assert.deepEqual(m.model.definitions.find(d=>d.id===id),dynamicUncertainty().model.definitions.find(d=>d.id===id));
  const r=await run(m,'schaefer-valid'),old=await run(dynamicUncertainty(),'8i-reference',false,{native:false});
  assert.deepEqual(ends(r),[[6,6,1],[4,4,2]]);
  for(const id of ['plant/N','plant/C','plant/effort','applied'])assert.deepEqual(r.observations.find(o=>o.component===id),old.observations.find(o=>o.component===id));
  for(const c of [1,2])assert.deepEqual(events(r,'scenario-selection',c).map(e=>e.value),events(old,'scenario-selection',c).map(e=>e.value));
  if(dir)assert.deepEqual(nativeActions(readFileSync(resolve(dir,'schaefer-valid-native.log'),'utf8')),[[0,260],[1,150],[3,150]]);
});
test('8J Schaefer mixed and all-invalid numerical criteria retain raw finite C, gate B*, close strict groups',async()=>{
  for(const all of [false,true]){const m=faultSchaefer({all}),r=await run(m,'schaefer-fault-'+all);
    assert.ok(values(r,'scenario-outcome').includes(2));assert.equal(events(r,'scenario-selection').filter(e=>e.port===12).length,6);
    for(const e of events(r,'scenario-selection').filter(e=>e.port===12)){
      const factor=port=>r.resultEvents.find(x=>x.port===port&&x.value[1]===e.value[1]&&x.value[2]===1).value[0];
      assert.ok(Math.abs(e.value[0]-schaeferOracle(factor(7),factor(8),factor(9),20,factor(10)).C)<.3);
    }
    if(all){assert.deepEqual(ends(r).map(e=>e[0]),[0,0]);assert.equal(last(r,'applied'),260);assert.equal(last(r,'plant/effort'),260);assert.equal(last(r,'primarySelected'),0);}
    else assert.ok(ends(r)[0][0]>0&&ends(r)[0][0]<6);
    const at1=schaeferOracle(150,0,260,1),expected=all?schaeferOracle(150,0,260,5):schaeferOracle(at1.N,at1.C,80,4);
    assert.ok(Math.abs(last(r,'plant/N')-expected.N)<.05);assert.ok(Math.abs(last(r,'plant/C')-expected.C)<.1);
    if(dir){const trace=readFileSync(resolve(dir,'schaefer-fault-'+all+'-native.log'),'utf8');
      assert.deepEqual(nativeActions(trace),all?[[0,260]]:[[0,260],[1,80],[3,80]]);
      if(all){assert.equal(trace.split('\n').filter(l=>/plant\/effort:0 /.test(l)).length,2);assert.doesNotMatch(trace,/observer\/decide\/evaluate\/choose\/priority:0 /);}
      else {assert.match(trace,/observer\/decide\/groups\/minCH:3 \[0,1,1\]/);assert.match(trace,/observer\/decide\/groups\/minCH:7 \[2,1,1\]/);assert.doesNotMatch(trace,/observer\/decide\/groups\/minCH:0 \[[^,]+,1,1\]/);}
    }
  }
});
test('8J available-only aggregation explicitly marks a partly evaluated group',async()=>{
  const m=faultSchaefer();for(const d of m.model.definitions)for(const c of d.components)if(c.type==='group_aggregate')c.parameters.validation=1;
  const r=await run(m,'schaefer-partial');assert.ok(ends(r)[0][0]>0&&ends(r)[0][0]<6);
  if(dir){const trace=readFileSync(resolve(dir,'schaefer-partial-native.log'),'utf8');assert.match(trace,/observer\/decide\/groups\/minCH:3 \[2,1,1\]/);}
});
test('8J the external gate cannot replace a missing valid metric with its default zero',async()=>{
  const m=safetySchaefer();m.simulation.end=2;
  m.model.connections=m.model.connections.filter(e=>!(e.from.component==='forecast'&&e.from.port===12&&e.to.component==='gateCValue'));
  const r=await run(m,'missing-valid-metric');assert.deepEqual(ends(r),[[6,6,1]]);assert.equal(last(r,'applied'),260);
  if(dir){const trace=readFileSync(resolve(dir,'missing-valid-metric-native.log'),'utf8');assert.deepEqual(nativeActions(trace),[[0,260]]);assert.match(trace,/observer\/decide\/groups\/minCH:8 \[3,0,1\]/);assert.doesNotMatch(trace,/observer\/decide\/groups\/minCH:0 /);}
});
test('8J structural child errors remain globally fatal in isolation mode',async()=>{
  const m=faultMinimal();const d=m.model.definitions[0];d.components.push(atom('badEnd','event_operator'));d.connections.push(edge('u',0,'badEnd',3));
  const r=await run(m,'structural-child',true);assert.equal(r.error.engineCode,70);
});
test('8J a pre-existing unsafe initialization category remains a global process failure, never an isolated result',async()=>{
  const m=faultMinimal(),d=m.model.definitions[0];d.components.push(atom('badRead','state_observer'));d.connections.push(edge('u',0,'badRead',0));validateRequest(m);
  const p=spawnSync(runner,[],{input:JSON.stringify(m),encoding:'utf8',windowsHide:true,timeout:10000});
  assert.notEqual(p.status,0);assert.equal(p.stdout,'');
  const proof={request:m,exit:p.status,stdout:p.stdout,stderr:p.stderr};
  if(app){const res=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});proof.httpStatus=res.status;proof.httpResult=await res.json();assert.equal(res.status,502);assert.equal(proof.httpResult.error.code,'RUNNER_PROTOCOL_ERROR');}
  if(dir)writeFileSync(resolve(dir,'unsafe-initialization.json'),JSON.stringify(proof,null,2));
});
test('8J parser rejects forged outcomes, missing identity fields, invented interrupted criteria and wrong counts',async()=>{
  const m=faultMinimal({budget:true}),r=await run(m,'parser-reference');
  for(const mutate of [
    x=>{events(x,'scenario-outcome')[1].value[0]=1;},x=>{events(x,'scenario-run-calls')[1].value[0]=11;},
    x=>{events(x,'campaign-run-calls')[0].value[0]=0;},x=>{x.resultEvents.splice(x.resultEvents.indexOf(events(x,'scenario-horizon')[1]),1);},
    x=>{events(x,'scenario-factor')[0].value[0]=Infinity;},x=>{events(x,'campaign-end')[0].value[0]=2;}
  ]){const a=structuredClone(r);mutate(a);assert.throws(()=>parseWrapperResult(a,m));}
});
test('8J opt-in retains dynamicPlan, overlapping replies, init cancellation and seal/run confluence',async()=>{
  const m=dynamicMinimal({delay:4});m.simulation.end=8;wrapper(m).experiment.execution={failurePolicy:'isolate',maxChildRunCalls:1000,maxCampaignRunCalls:10000};
  const r=await run(m,'dynamic-overlap');assert.deepEqual(ends(r),[[3,3,1],[3,3,2]]);assert.deepEqual(events(r,'campaign-end').map(e=>e.time),[5]);assert.deepEqual(events(r,'campaign-end',2).map(e=>e.time),[7]);
  const cancel=faultMinimal();cancel.model.components.find(c=>c.id==='run1').parameters.value=3;
  source(cancel,'forecast',0,0,0,0,2);const c=await run(cancel,'init-cancel');assert.equal(events(c,'campaign-end',1).length,0);
});
test('8J failed children retain immutable out-of-order campaign snapshots and confluent seal/init/run',async()=>{
  const m=manual(),d=m.model.definitions[0];d.components.push(atom('fault','qss3_power',{n:2000}));d.connections.push(edge('u',0,'fault',0));wrapper(m).experiment.selections[0].target='fault';
  transmit(m,1,[.5,2],2);source(m,'forecast',0,0,0,1);source(m,'forecast',1,5,0,1);
  transmit(m,2,[.25,3],1,2);source(m,'forecast',1,0,0,2,2);
  const r=await run(m,'dynamic-faults-out-of-order');assert.deepEqual(ends(r),[[1,2,2],[1,2,1]]);
  for(const c of [1,2])assert.deepEqual(values(r,'scenario-outcome',c),[1,2]);
  assert.deepEqual(values(r,'scenario-horizon',1),[2,2]);assert.deepEqual(values(r,'scenario-horizon',2),[1,1]);
  assert.ok(events(r,'plan-ready',1)[0].bag<events(r,'scenario-status',1)[0].bag);
  const canceled=manual();transmit(canceled,1,[-1,0,1],2);source(canceled,'forecast',4,0,4,1,1);
  const c=await run(canceled,'dynamic-plan-canceled');assert.equal(events(c,'campaign-end').length,0);
  source(canceled,'forecast',1,0,0,1,2);await run(canceled,'dynamic-cancel-replay',true);
});
