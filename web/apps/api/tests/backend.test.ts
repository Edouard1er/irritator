import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { ApiError, catalog, validateRequest, parseResult, type RunRequest } from '../../../packages/contracts/index.js';
import type { Engine } from '../src/services/engine.js';
import { reference, mockResult } from './fixtures.js';

// These route tests use an explicitly mocked engine; real HTTP/native tests are separate.
const mockEngine = (): Engine => ({describe:async()=>catalog,run:async()=>mockResult(),close:async()=>{}});
test('mocked backend routes and successful response',async()=>{
  const app=buildApp(readConfig(),mockEngine());
  try {
    const h=await app.inject({method:'GET',url:'/api/v1/health'}); assert.equal(h.statusCode,200); assert.equal(h.json().runner.available,true);
    const c=await app.inject({method:'GET',url:'/api/v1/components'}); assert.deepEqual(c.json(),catalog);
    const r=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:reference()}); assert.equal(r.statusCode,200); assert.equal(r.json().observations[0].samples[2].value,1110); assert.match(r.json().runId,/^[0-9a-f-]{36}$/);
  } finally {await app.close();}
});
const invalid: [string,(m:RunRequest)=>unknown,string][] = [
  ['unknown type',m=>{m.model.components[0]!.type='unknown';return m;},'UNKNOWN_COMPONENT'],
  ['missing parameter',m=>{delete m.model.components[0]!.parameters.value;return m;},'INVALID_PARAMETER'],
  ['unknown parameter',m=>{m.model.components[0]!.parameters.bad=1;return m;},'INVALID_PARAMETER'],
  ['negative offset',m=>{m.model.components[0]!.parameters.offset=-1;return m;},'INVALID_PARAMETER'],
  ['port index',m=>{m.model.connections[0]!.from.port=1;return m;},'INVALID_CONNECTION'],
  ['port direction',m=>{m.model.connections[0]!.to.component='c2';return m;},'INVALID_CONNECTION'],
  ['unknown reference',m=>{m.model.connections[0]!.from.component='unknown';return m;},'INVALID_REFERENCE'],
  ['duplicate id',m=>{m.model.components[1]!.id='c1';return m;},'INVALID_MODEL'],
  ['time bounds',m=>{m.simulation.end=0;return m;},'INVALID_TIME'],
  ['duplicate observations',m=>{m.model.observations.push(m.model.observations[0]!);return m;},'OBSERVATION_ERROR'],
  ['unknown observation',m=>{m.model.observations[0]!.component='missing';return m;},'INVALID_REFERENCE'],
  ['numeric coercion',m=>({...m,simulation:{start:'0',end:3}}),'INVALID_MODEL'],
  ['extra property',m=>({...m,shell:'whoami'}),'INVALID_MODEL'],
  ['schema supplied by user',m=>({...m,$schema:{}}),'INVALID_MODEL'],
  ['future version',m=>({...m,schemaVersion:2}),'INVALID_MODEL'],
  ['model size',m=>{m.model.components=Array.from({length:129},()=>m.model.components[0]!);return m;},'INVALID_MODEL'],
  ['sampling size',m=>{m.model.observations[0]!.samplingInterval=1e-6;return m;},'LIMIT_EXCEEDED'],
  ['run cap',m=>({...m,limits:{maxRunCalls:100001}}),'INVALID_MODEL'],
  ['fractional port',m=>{m.model.connections[0]!.from.port=0.5;return m;},'INVALID_MODEL']
];
for(const [name,mutate,code] of invalid) test(`mocked backend rejects ${name} before launching`,async()=>{
  let launched=false; const engine=mockEngine(); engine.run=async()=>{launched=true;return mockResult();};
  const app=buildApp(readConfig(),engine);
  try {const r=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:mutate(reference()) as object});assert.equal(r.statusCode,400,r.body);assert.equal(r.json().error.code,code);assert.equal(launched,false);}finally{await app.close();}
});
test('body size and malformed JSON',async()=>{
  const app=buildApp({...readConfig(),bodyLimit:1024},mockEngine());
  try {
    const r=await app.inject({method:'POST',url:'/api/v1/simulations/run',headers:{'content-type':'application/json'},payload:' '.repeat(1025)});assert.equal(r.statusCode,413);assert.equal(r.json().error.code,'BODY_TOO_LARGE');
    const b=await app.inject({method:'POST',url:'/api/v1/simulations/run',headers:{'content-type':'application/json'},payload:'{'});assert.equal(b.statusCode,400);assert.equal(b.json().error.code,'INVALID_JSON');
  }finally{await app.close();}
});
test('engine failure propagates structured category/code',async()=>{
  const engine=mockEngine();engine.run=async()=>{throw new ApiError('EXECUTION_ERROR','simulation.run',422,{engineCategory:2,engineCode:8});};
  const app=buildApp(readConfig(),engine);
  try {const r=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:reference()});assert.equal(r.statusCode,422);assert.equal(r.json().error.engineCode,8);}finally{await app.close();}
});
test('unavailable health never advertises readiness',async()=>{
  const engine=mockEngine();engine.describe=async()=>{throw new ApiError('ENGINE_UNAVAILABLE','missing',503);};
  const app=buildApp(readConfig(),engine);
  try {const r=await app.inject({method:'GET',url:'/api/v1/health'});assert.equal(r.statusCode,503);assert.equal(r.json().status,'failed');assert.equal(r.json().runner.available,false);}finally{await app.close();}
});
test('strict finite numbers and server settings',()=>{
  const m=reference();m.model.components[0]!.parameters.value=NaN;assert.throws(()=>validateRequest(m));
  m.model.components[0]!.parameters.value=Infinity;assert.throws(()=>validateRequest(m));
  for(const env of [{HOST:'0.0.0.0'},{ENGINE_MAX_CONCURRENT:'9'},{ENGINE_MAX_POINTS:'20001'},{ENGINE_TIMEOUT_MS:'abc'}]) assert.throws(()=>readConfig(env));
  assert.equal(readConfig({ENGINE_MAX_RUN_CALLS:'50'}).engineLimits.maxRunCalls,50);
});
test('result validator rejects inconsistent or non-finite native output',()=>{
  const mutations: ((r:ReturnType<typeof mockResult>)=>void)[] = [r=>{r.modelId='other';},r=>{r.simulation.finalTime=2;},r=>{r.observations[0]!.samples[0]!.value=Infinity;},r=>{r.observations[0]!.samples[1]!.time=0;}];
  for(const mutate of mutations) {
    const r=mockResult();mutate(r);assert.throws(()=>parseResult(r,reference()));
  }
});
