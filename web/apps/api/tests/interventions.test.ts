import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config/index.js';
import {conditionUnits,composeFleet,nativeRequest,ratesAt,conditionsAt,validateRequest,type RunRequest,type ConditionKey} from '../../../packages/contracts/index.js';
const fixture=()=>JSON.parse(readFileSync(resolve('examples/atelier-interventions-month-v3.json'),'utf8')) as RunRequest;
test('dated DEVS sources: seasons, t=10 intervention, unchanged history and continuous QSS3 states',{timeout:60000},async()=>{
  const app=buildApp(readConfig());
  try {
    const request=fixture();validateRequest(request);
    const initial=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:request});assert.equal(initial.statusCode,200,initial.body);
    const edited=structuredClone(request),t=edited.temporal!;
    for(const [parameter,newValue] of Object.entries({P:8,S:6,a:.7,E:80,betaP:.4})) {const key=parameter as ConditionKey;t.interventions.push({time:10,parameter:key,oldValue:t.parameters[key],newValue,unit:conditionUnits[key],scenario:t.scenario,provenance:'test: intervention simultanée'});}
    t.fleetHistory.push({time:10,fleet:composeFleet(80)});
    const modified=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:edited});assert.equal(modified.statusCode,200,modified.body);
    const a=initial.json(),b=modified.json();
    const samples=(result:any,id:string)=>result.observations.find((o:any)=>o.component===`lake/${id}`).samples as {time:number;value:number}[];
    const at=(result:any,id:string,time:number)=>{const point=samples(result,id).find(p=>Math.abs(p.time-time)<1e-9);assert.ok(point,`${id} @ ${time}`);return point.value;};
    for(const id of ['N','C']) {
      for(const point of samples(a,id).filter(p=>p.time<=10)) assert.ok(Math.abs(point.value-at(b,id,point.time))<1e-7,`${id} prefix @ ${point.time}`);
      assert.ok(Math.abs(at(a,id,10)-at(b,id,10))<1e-7,`${id} continuous boundary`);
      assert.ok(Math.abs(at(a,id,10.1)-at(b,id,10.1))>.01,`${id} derivative changes`);
      assert.ok(at(b,id,10)>0,'states not reset');
    }
    const held=(result:any,id:string,time:number)=>samples(result,id).filter(p=>p.time<=time).at(-1)!.value;
    for(const time of [0.1,2.9,3.1,5.9,6.1,8.9,9.1,12.1,15.1,23.9])assert.ok(Math.abs(held(a,'r',time)-ratesAt(conditionsAt(t,-1),time).r)<1e-10,`season @ ${time}`);
    for(const time of [10.1,12.1,23.9])for(const id of ['r','q','a','E'] as const)assert.ok(Math.abs(held(b,id,time)-ratesAt(conditionsAt(t,time),time)[id])<1e-10,`${id} @ ${time}`);
    const graph=nativeRequest(edited);assert.equal(graph.temporal,undefined);assert.ok(graph.model.definitions![0]!.components.some(c=>c.type==='constant'&&c.parameters.offset===10));
    const dir=resolve('../reports/iteration3-evidence');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'engine-interventions.json'),JSON.stringify({request:edited,compiled:graph,baseline:a,modified:b},null,2));
  } finally {await app.close();}
});
test('reject invalid environmental indices, history and fleet before execution',async()=>{
  const app=buildApp(readConfig());try{for(const modify of [(r:RunRequest)=>r.temporal!.parameters.P=11,(r:RunRequest)=>r.temporal!.parameters.S=-1,(r:RunRequest)=>r.temporal!.fleet.initial.counts[0]=0]){const r=fixture();modify(r);const response=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:r});assert.equal(response.statusCode,400);assert.equal(response.json().error.code,'INVALID_TEMPORAL');}}finally{await app.close();}
});
