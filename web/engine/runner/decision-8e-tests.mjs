import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { schaeferFeedback } from './decision-8e-fixture.mjs';
import { schaeferOracle, feedbackOracle } from './decision-8e-oracle.mjs';
import { atom, edge } from './decision-fixtures.mjs';
import { source } from './decision-8c-fixture.mjs';
import { validateRequest, parseWrapperResult, parseResult } from '../../dist/packages/contracts/index.js';
const runner=process.env.IRRITATOR_RUNNER;
assert.ok(runner,'Set IRRITATOR_RUNNER');
let app;
if(process.env.DECISION_8E_HTTP==='1') {
  const { buildApp }=await import('../../dist/apps/api/src/app.js');
  const { readConfig }=await import('../../dist/apps/api/src/config/index.js');
  app=buildApp(readConfig()); await app.listen({host:'127.0.0.1',port:0}); test.after(()=>app.close());
}
async function run(m,name,expected=0) {
  validateRequest(m);
  const p=spawnSync(runner,[],{input:JSON.stringify(m),encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(p.status,expected,p.stdout+p.stderr);
  const r=JSON.parse(p.stdout);
  if(!expected) { if(m.schemaVersion===3) parseWrapperResult(r,m); else parseResult(r,m); assert.equal(p.stderr,''); assert.ok(r.simulation.runCalls<10000); }
  else { assert.match(p.stderr,/^[A-Z_]+:/); assert.ok(Buffer.byteLength(p.stderr)<1024); }
  if(app) {
    const res=await fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});
    const {runId,requestId,...actual}=await res.json();
    assert.equal(res.status,expected?422:200); assert.ok(expected?requestId:runId); assert.deepEqual(actual,r);
  }
  if(process.env.IRRITATOR_8E_EVIDENCE) {
    mkdirSync(process.env.IRRITATOR_8E_EVIDENCE,{recursive:true});
    writeFileSync(resolve(process.env.IRRITATOR_8E_EVIDENCE,name+'.json'),JSON.stringify({request:m,result:r,exit:p.status,stderrBytes:Buffer.byteLength(p.stderr),httpEqualsNative:!!app},null,2));
  }
  return r;
}
const near=(a,b,tol=.05)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=tol,`${a} != ${b} (tol=${tol})`);
const wrapper=m=>m.model.components.find(c=>c.id==='forecast');
const definition=(m,id)=>m.model.definitions.find(d=>d.id===id);
const rows=(r,c,p)=>r.resultEvents.filter(e=>e.value[2]===c&&e.port===p).sort((a,b)=>a.value[1]-b.value[1]);
const last=(r,id)=>r.observations.find(o=>o.component===id).samples.at(-1).value;
const cut=(m,predicate)=>m.model.connections=m.model.connections.filter(e=>!predicate(e));
function campaign(r,c,time,N,C) {
  for(const p of [6,7,8,9,10]) assert.equal(rows(r,c,p).length,3);
  for(let i=0;i<3;++i) {
    const E=[80,150,260][i], terminal=schaeferOracle(N,C,E,20);
    near(rows(r,c,6)[i].value[0],N,1e-10); near(rows(r,c,7)[i].value[0],C,1e-10);
    near(rows(r,c,8)[i].value[0],E,0); near(rows(r,c,9)[i].value[0],Math.min(N,terminal.N));
    near(rows(r,c,10)[i].value[0],terminal.C,.25); assert.equal(rows(r,c,10)[i].time,time);
    const delta=rows(r,c,10)[i].value[0]-C;
    // Parent histories retain only the last zero-time value. Every actual
    // identified delta emission is checked in native-schaefer-feedback.
    near(delta,terminal.C-C,.25);
  }
  assert.deepEqual(rows(r,c,11).map(e=>e.value),[[3,3,c]]);
}
test('8E: delivered graph equals fixture and scientific v3 roundtrip',async()=>{
  const m=schaeferFeedback(), saved=JSON.parse(readFileSync(new URL('../../examples/decision-feedback-schaefer-v3.json',import.meta.url),'utf8'));
  assert.deepEqual(saved,m); assert.deepEqual(await run(m,'delivered'),await run(JSON.parse(JSON.stringify(saved)),'roundtrip'));
});
test('8E: two observed N/C pairs initialize distinct campaigns and close the dynamic loop',async()=>{
  const r=await run(schaeferFeedback(),'two-cycles');
  campaign(r,1,1,rows(r,1,6)[0].value[0],rows(r,1,7)[0].value[0]);
  campaign(r,2,3,rows(r,2,6)[0].value[0],rows(r,2,7)[0].value[0]);
  for(const [c,t] of [[1,1],[2,3]]) { const o=feedbackOracle(t); near(rows(r,c,6)[0].value[0],o.N);near(rows(r,c,7)[0].value[0],o.C); }
  assert.notEqual(rows(r,1,6)[0].value[0],rows(r,2,6)[0].value[0]); assert.notEqual(rows(r,1,7)[0].value[0],rows(r,2,7)[0].value[0]);
  assert.equal(last(r,'applied'),150); assert.equal(last(r,'identity'),1); assert.equal(last(r,'primarySelected'),1); assert.equal(last(r,'internalE'),260);
  for(const id of ['N','C']) for(const s of r.observations.find(o=>o.component==='plant/'+id).samples) near(s.value,feedbackOracle(s.time)[id]);
});
test('8E: no observation, or one missing state, cannot start a campaign',async()=>{
  for(const field of [null,0,1]) {
    const m=schaeferFeedback(field===null?{times:[]}:{});
    if(field!==null) cut(m,e=>e.from.component==='plant'&&e.from.port===field);
    const r=await run(m,'missing-'+field); assert.equal(r.resultEvents.length,0); assert.equal(last(r,'applied'),260);
    near(last(r,'plant/N'),schaeferOracle(150,0,260,5).N);
  }
});
test('8E: a missing first C followed by a full second cycle preserves campaign 2',async()=>{
  const m=schaeferFeedback(); const plant=definition(m,'SchaeferPlant');
  // Disconnect C's common read, then read C only from the second cycle.
  plant.connections=plant.connections.filter(e=>!(e.to.component==='observeC'&&e.to.port===1));
  plant.inputs.push({port:2,name:'readC'}); plant.connections.push(edge('$input',2,'observeC',1));
  m.model.connections.push(edge('cycle2',0,'plant',2));
  const r=await run(m,'missing-first-C'); assert.equal(rows(r,1,6).length,0);
  const oracle=schaeferOracle(150,0,260,3); near(rows(r,2,6)[0].value[0],oracle.N); near(rows(r,2,7)[0].value[0],oracle.C);
});
test('8E: bypassing the barrier with incomplete required factors is a native error',async()=>{
  for(const p of [0,1]) {
    const m=schaeferFeedback({times:[1]}); cut(m,e=>e.to.component==='forecast');
    source(m,'forecast',2,123,0,7,.5); source(m,'forecast',p,0,0,7,1);
    await run(m,'incomplete-'+p,2);
  }
});
test('8E: N and C from different cycles never join, even with an explicit run',async()=>{
  const m=schaeferFeedback({times:[]});
  source(m,'forecast',2,123,0,4,.5); source(m,'forecast',3,45,0,5,.5); source(m,'forecast',1,0,0,4,1);
  await run(m,'mismatched-cycles',2);
});
test('8E: a second missing observation cannot reuse the first cycle C',async()=>{
  const m=schaeferFeedback(), plant=definition(m,'SchaeferPlant');
  plant.connections=plant.connections.filter(e=>!(e.to.component==='observeC'&&e.to.port===1));
  plant.inputs.push({port:2,name:'readC'});plant.connections.push(edge('$input',2,'observeC',1));m.model.connections.push(edge('cycle1',0,'plant',2));
  const r=await run(m,'missing-second-C');assert.equal(rows(r,1,6).length,3);assert.equal(rows(r,2,6).length,0);
  near(last(r,'plant/N'),feedbackOracle(5).N);
});
test('8E: an observation delayed by several zero-time bags still joins its own cycle',async()=>{
  const m=schaeferFeedback();cut(m,e=>e.from.component==='plant'&&e.from.port===1);
  for(let i=0;i<5;++i) {m.model.components.push(atom('delayC'+i,'event_operator'));m.model.connections.push(edge(i?'delayC'+(i-1):'plant',i?0:1,'delayC'+i,0));}
  m.model.connections.push(edge('delayC4',0,'synchronize',1));
  const r=await run(m,'asynchronous-bags');near(last(r,'plant/N'),feedbackOracle(5).N);assert.equal(rows(r,1,6).length,3);assert.equal(rows(r,2,6).length,3);
});
test('8E: interleaved factor frames retain N/C association and allow gaps in campaign numbers',async()=>{
  const m=schaeferFeedback({times:[]});
  for(const [port,value,c,time] of [[2,120,7,.1],[3,80,9,.2],[2,160,9,.3],[3,40,7,.4],[1,0,7,1],[1,0,9,2]]) source(m,'forecast',port,value,0,c,time);
  const r=await run(m,'interleaved-factors');campaign(r,7,1,120,40);campaign(r,9,2,160,80);
});
test('8E: factor/init/run in the same native bag apply both fields',async()=>{
  const m=schaeferFeedback({times:[]});
  // Identical-length event_tag branches put all four messages in one bag.
  for(const [port,value] of [[2,120],[3,40],[0,0],[1,0]]) source(m,'forecast',port,value,0,9,1);
  const r=await run(m,'same-bag'); campaign(r,9,1,120,40);
});
test('8E: changing both initial fields changes every child, retaining fixed effort and dQ',async()=>{
  const r=await run(schaeferFeedback({initialN:170,initialC:250}),'different-initials');
  const first=schaeferOracle(170,250,260,1); campaign(r,1,1,rows(r,1,6)[0].value[0],rows(r,1,7)[0].value[0]);
  near(rows(r,1,6)[0].value[0],first.N);near(rows(r,1,7)[0].value[0],first.C);
});
test('8E: explicit init followed by run does not draw random factors twice',async()=>{
  const m=schaeferFeedback({times:[]}), e=wrapper(m).experiment;
  e.factors[2]={id:'effort',target:'E',parameter:'value',type:'random',count:3,distribution:'uniform-real',reals:[80,260],ints:[0,0]};
  e.seed=['1393618426636810568','0','0','0','0','0'];
  for(const [p,v] of [[2,120],[3,40],[1,0]]) source(m,'forecast',p,v,0,1,1);
  const auto=await run(m,'random-auto-init');source(m,'forecast',0,0,0,1,1);
  const explicit=await run(m,'random-explicit-init');
  assert.deepEqual(auto.resultEvents.map(e=>[e.port,e.value]),explicit.resultEvents.map(e=>[e.port,e.value]));
});
test('8E: DeltaC matches a separate C0=0 prospective campaign',async()=>{
  const m=schaeferFeedback({times:[1]}), actual=await run(m,'cumulative-prospect');
  const zero=structuredClone(m), sync=definition(zero,'SynchronizePair');
  sync.components.push(atom('zeroC','event_operator',{operation:3,right:0}));
  sync.connections=sync.connections.filter(e=>!(e.from.component==='pairC'&&e.to.component==='$output'));
  sync.connections.push(edge('pairC',0,'zeroC',0),edge('zeroC',0,'$output',1),edge('pairC',2,'zeroC',3));
  // The extra bag is safe because initValue is two causal stages after ready.
  const r=await run(zero,'zero-prospect');
  for(let i=0;i<3;++i) { near(rows(r,1,7)[i].value[0],0,0); near(rows(actual,1,10)[i].value[0]-rows(actual,1,7)[i].value[0],rows(r,1,10)[i].value[0],.03); }
  assert.equal(last(r,'applied'),last(actual,'applied'));
});
test('8E: long-horizon quantization error matches a flat model and converges under refinement',async()=>{
  const baseline=schaeferFeedback({times:[1]}), native=await run(baseline,'convergence-wrapper');
  const N=rows(native,1,6)[0].value[0],C=rows(native,1,7)[0].value[0];let previous;
  for(const dQ of [.01,.001,.0001]) {
    const d=structuredClone(definition(baseline,'SchaeferProspect'));
    for(const c of d.components) {if(c.id==='N')c.parameters={X:N,dQ};if(c.id==='C')c.parameters={X:C,dQ};if(c.id==='E')c.parameters.value=80;}
    const m={schemaVersion:1,model:{id:'flat-convergence',components:d.components,connections:d.connections,observations:['N','C'].map(component=>({component,samplingInterval:.1}))},simulation:{start:0,end:20}};
    const r=await run(m,'flat-quantum-'+dQ),errors={};
    for(const id of ['N','C']) errors[id]=Math.max(...r.observations.find(o=>o.component===id).samples.map(s=>Math.abs(s.value-schaeferOracle(N,C,80,s.time)[id])));
    if(dQ===.01) {near(last(r,'C'),rows(native,1,10)[0].value[0],1e-10);assert.ok(errors.N<.5&&errors.C<.25);}
    else {assert.ok(errors.N<dQ*5&&errors.C<dQ*2);assert.ok(errors.N<previous.N*.2&&errors.C<previous.C*.2);}
    previous=errors;
  }
});
test('8E: force primary or secondary by graph threshold, always selecting a real candidate',async()=>{
  for(const [threshold,name] of [[0,'primary'],[1000,'secondary']]) {
    const r=await run(schaeferFeedback({times:[1],threshold}),name);
    assert.equal(last(r,'primarySelected'),threshold===0?1:0); assert.equal(last(r,'secondarySelected'),1);
    assert.ok([80,150,260].includes(last(r,'applied'))); assert.ok([0,1,2].includes(last(r,'identity')));
  }
});
test('8E: the returned action changes the parent trajectory and derivative',async()=>{
  const m=schaeferFeedback({times:[1]}); const controlled=await run(m,'control');
  cut(m,e=>e.from.component==='decide'&&e.to.component==='plant'); const open=await run(m,'open-loop');
  assert.ok(last(controlled,'plant/N')>last(open,'plant/N')+30);
  near(last(open,'plant/N'),schaeferOracle(150,0,260,5).N);
  assert.notEqual(last(controlled,'plant/modelHalieutique'),last(open,'plant/modelHalieutique'));
});
test('8E: delayed overlapping responses keep both captured N/C pairs without explicit init',async()=>{
  const m=schaeferFeedback({times:[1,1.2],delay:1}); cut(m,e=>e.to.component==='forecast'&&e.to.port===0);
  const r=await run(m,'overlap');
  for(const [c,t] of [[1,1],[2,1.2]]) { const o=schaeferOracle(150,0,260,t); near(rows(r,c,6)[0].value[0],o.N);near(rows(r,c,7)[0].value[0],o.C);assert.equal(rows(r,c,6)[0].time,t+1); }
});
test('8E: explicit init cancels a pending response; late init also requires a complete new frame',async()=>{
  const m=schaeferFeedback({times:[1,1.2],delay:1});const r=await run(m,'overlap-init'); assert.equal(rows(r,1,6).length,0);assert.equal(rows(r,2,6).length,3);
  const late=schaeferFeedback({times:[1],delay:1});
  source(late,'forecast',2,100,0,3,1.4);source(late,'forecast',3,20,0,3,1.4);source(late,'forecast',0,0,0,3,1.5);
  const cancelled=await run(late,'late-init'); assert.equal(cancelled.resultEvents.length,0);assert.equal(last(cancelled,'applied'),260);
});
test('8E: stale replay, conflicting duplicates and two run commands in a bag fail explicitly',async()=>{
  for(const mode of ['replay','duplicate','two-runs']) {
    const m=schaeferFeedback({times:mode==='replay'?[1]:[]});
    if(mode==='replay') source(m,'forecast',2,123,0,1,2);
    else {
      source(m,'forecast',2,123,0,7,1);source(m,'forecast',3,40,0,7,1);
      if(mode==='duplicate') source(m,'forecast',2,124,0,7,1);
      else { source(m,'forecast',1,0,0,7,1);source(m,'forecast',1,0,0,8,1); }
    }
    await run(m,mode,2);
  }
});
test('8E: coupled plant definition reused with independent commands and observer bindings',async()=>{
  const m=schaeferFeedback();m.model.components.push({id:'other',type:'coupled',parameters:{},definition:'SchaeferPlant'},atom('otherEffort','constant',{value:80}));
  m.model.connections.push(edge('otherEffort',0,'other',1),edge('cycle1',0,'other',0));
  m.model.observations.push({component:'other/N',samplingInterval:.1},{component:'other/observeN',samplingInterval:.1});
  const r=await run(m,'reuse');near(last(r,'other/N'),schaeferOracle(150,0,80,5).N);near(last(r,'other/observeN'),schaeferOracle(150,0,80,1).N);
});
test('8E: instantaneous feedback retains the native run-call budget',async()=>{
  const m=schaeferFeedback({times:[1]});m.model.components.push(atom('loop','value_memory',{emitOnWrite:1}),atom('loopTag','event_tag'));m.model.connections.push(edge('initialCommand',0,'loop',0),edge('loop',0,'loopTag',0),edge('loopTag',0,'loop',0));m.limits={maxRunCalls:500};
  await run(m,'bounded-loop',2);
});
test('8E: six hypotheses preserve q as context and apply only E to the parent',async()=>{
  const m=schaeferFeedback({times:[1]});wrapper(m).experiment.factors.push({id:'qHypothesis',target:'q',parameter:'value',type:'fixed',values:[.0008,.001]});
  // F=4,S=2: raw initialN/C/E/q=7/8/9/10, selections=11/12, end=13.
  const mapping=new Map([[9,11],[10,12],[7,8],[8,9],[11,13],[4,4]]);
  for(const e of m.model.connections) if(e.from.component==='forecast') e.from.port=mapping.get(e.from.port)??e.from.port;
  const r=await run(m,'six-hypotheses');assert.equal(rows(r,1,10).length,6);assert.deepEqual(rows(r,1,10).map(e=>e.value[0]),[.0008,.0008,.0008,.001,.001,.001]);
  assert.equal(last(r,'applied'),150);assert.equal(last(r,'identity'),4);
  assert.equal(rows(r,1,10).find(e=>e.value[1]===last(r,'identity')).value[0],.001);
  assert.equal(definition(m,'SchaeferPlant').components.find(c=>c.id==='q').parameters.value,.001);
});
test('8E: required input references and complete mode are validated',()=>{
  for(const change of [e=>e.requiredInputs=['unknown'],e=>e.requiredInputs=['initialN','initialN'],e=>e.run='bag']) {
    const m=schaeferFeedback();change(wrapper(m).experiment);assert.throws(()=>validateRequest(m));
  }
});
