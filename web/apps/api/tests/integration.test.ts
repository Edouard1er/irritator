import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { ProcessEngine } from '../src/services/engine.js';
import { ApiError, catalog, validateRequest, type RunRequest, type RunResult } from '../../../packages/contracts/index.js';
import { reference, affine } from './fixtures.js';

test('real TCP HTTP -> Fastify -> C++ -> libirritator scientific campaign',{timeout:60000},async()=>{
  const app=buildApp(readConfig());
  await app.listen({host:'127.0.0.1',port:0});
  const url=app.listeningOrigin;
  const evidence: object[]=[];
  async function run(model: RunRequest): Promise<RunResult> {
    const response=await fetch(`${url}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(model)});
    const result=await response.json() as RunResult;
    assert.equal(response.status,200,JSON.stringify(result));
    assert.equal(result.status,'completed');assert.equal(result.modelId,model.model.id);assert.equal(result.simulation.finalTime,model.simulation.end);
    evidence.push({request:structuredClone(model),httpStatus:response.status,response:result});return result;
  }
  try {
    const h=await fetch(`${url}/api/v1/health`);assert.equal(h.status,200);assert.equal((await h.json() as {runner:{available:boolean}}).runner.available,true);
    const c=await fetch(`${url}/api/v1/components`);assert.equal(c.status,200);assert.deepEqual(await c.json(),catalog);
    const r=await run(reference());assert.deepEqual(r.observations[0]!.samples,[{time:0,value:10},{time:1,value:110},{time:2,value:1110}]);assert.equal(r.simulation.runCalls,10);
    const changed=reference();changed.model.id='changed';changed.model.components[0]!.parameters.value=-2;changed.model.components[1]!.parameters.value=7;changed.model.components[2]!.parameters.value=40;
    assert.deepEqual((await run(changed)).observations[0]!.samples.map(s=>s.value),[-2,5,45]);
    changed.model.id='two-inputs';changed.model.components.splice(2,1);changed.model.components[2]!.type='qss1_sum_2';changed.model.connections.pop();
    assert.deepEqual((await run(changed)).observations[0]!.samples.map(s=>s.value),[-2,5]);
    // A different multi-stage graph with two observations and fan-out.
    const chain=reference();chain.model.id='chain';chain.model.components.push({id:'next',type:'qss1_sum_2',parameters:{}});
    chain.model.connections.push({from:{component:'sum',port:0},to:{component:'next',port:0}},{from:{component:'c1',port:0},to:{component:'next',port:1}});
    chain.model.observations.push({component:'next',samplingInterval:1});
    assert.deepEqual((await run(chain)).observations[1]!.samples.map(s=>s.value),[20,120,1120]);
    for(const type of ['qss1_integrator','qss3_integrator']) for(const rate of [-2,0,2]) {
      const model=affine(type,rate,50), result=await run(model);
      const samples=result.observations[0]!.samples;
      for(const s of samples) assert.ok(Math.abs(s.value-(5+rate*(s.time-50)))<1e-9,JSON.stringify(s));
      if(rate!==0) {assert.equal(samples.at(-1)!.time,53);assert.ok(Math.abs(samples.at(-1)!.value-(5+3*rate))<1e-9);}
    }
    // The engine rejects a self-connection; generic graph validation permits cycles.
    const self=reference();self.model.connections.push({from:{component:'sum',port:0},to:{component:'sum',port:0}});
    const bad=await fetch(`${url}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(self)});
    assert.equal(bad.status,422);const error=await bad.json() as {error:{code:string;engineCode:number}};assert.equal(error.error.code,'INVALID_CONNECTION');assert.equal(typeof error.error.engineCode,'number');
    const budget=reference();budget.limits={maxRunCalls:1};
    const exceeded=await fetch(`${url}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(budget)});assert.equal(exceeded.status,422);assert.equal((await exceeded.json() as {error:{code:string}}).error.code,'LIMIT_EXCEEDED');
    const invalid=reference();invalid.model.components[0]!.type='unknown';
    const rejected=await fetch(`${url}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(invalid)});assert.equal(rejected.status,400);
    const logdir=resolve(process.env.IRRITATOR_HTTP_EVIDENCE ? resolve(process.env.IRRITATOR_HTTP_EVIDENCE,'integration') : '../build-web-test4/logs');mkdirSync(logdir,{recursive:true});writeFileSync(resolve(logdir,'http-results.json'),JSON.stringify(evidence,null,2));
  } finally {await app.close();}
});
test('real native deadline kills runner',{timeout:10000},async()=>{
  const engine=new ProcessEngine({...readConfig(),timeoutMs:10});
  try {await assert.rejects(engine.run(reference()),(e:unknown)=>e instanceof ApiError && e.code==='ENGINE_TIMEOUT');}finally{await engine.close();}
});
test('real runner unavailable and bounded stdout through API',async()=>{
  for(const config of [{...readConfig(),runnerPath:resolve('missing-runner.exe')},{...readConfig(),maxStdoutBytes:128}]) {
    const app=buildApp(config);
    try {const h=await app.inject({method:'GET',url:'/api/v1/health'});assert.ok([502,503].includes(h.statusCode));assert.equal(h.json().status,'failed');}finally{await app.close();}
  }
});
test('server caps lower client requests',async()=>{
  const config=readConfig();config.engineLimits.maxRunCalls=1;
  const app=buildApp(config);
  try {const r=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:{...reference(),limits:{maxRunCalls:100000}}});assert.equal(r.statusCode,422);assert.equal(r.json().error.code,'LIMIT_EXCEEDED');}finally{await app.close();}
});
test('HTTP disconnection releases native process slot',{timeout:15000},async()=>{
  const config={...readConfig(),maxConcurrent:1,timeoutMs:5000};
  let notifyStarted!: () => void;
  const started = new Promise<void>(resolve => { notifyStarted = resolve; });
  // Synchronize on the real simulation launch. A racing --describe request
  // otherwise takes the sole slot before the TCP POST arrives (notably Debug).
  const engine = new ProcessEngine(config, (executable, args) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    if (args.length === 0) notifyStarted();
    return child;
  });
  const app=buildApp(config,engine);await app.listen({host:'127.0.0.1',port:0});
  try {
    const model=reference();model.model.components.push({id:'feedback',type:'qss1_sum_2',parameters:{}});model.model.connections.push({from:{component:'sum',port:0},to:{component:'feedback',port:0}},{from:{component:'feedback',port:0},to:{component:'sum',port:0}});
    validateRequest(model);
    const abort=new AbortController();const request=fetch(`${app.listeningOrigin}/api/v1/simulations/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(model),signal:abort.signal}).catch(()=>undefined);
    await started;
    // Observe that the sole slot is occupied, then disconnect this client.
    let busy=false;
    for(let i=0;i<30;i++) {await delay(10);const h=await app.inject({method:'GET',url:'/api/v1/health'});if(h.statusCode===503 && h.json().error.code==='ENGINE_BUSY'){busy=true;break;}}
    assert.equal(busy,true);abort.abort();await request;
    let ready=false;
    for(let i=0;i<30;i++) {await delay(10);const h=await app.inject({method:'GET',url:'/api/v1/health'});if(h.statusCode===200){ready=true;break;}}
    assert.equal(ready,true);
  }finally{await app.close();}
});
