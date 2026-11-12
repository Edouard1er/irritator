import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { catalog, runnerCapabilities, factorCardinality, wrapperOutputs, validateRequest, parseWrapperResult, type RunResultV2 } from '../../../packages/contracts/index.js';
import { wrapperAffine } from './wrapper-fixtures.js';

// Transport-only mock: no numerical series or scientific oracle is fabricated.
test('8O HTTP byte bound includes the runId added after native validation',async()=>{
  const request=wrapperAffine(),w=request.model.components.find(c=>c.experiment)!,e=w.experiment!;
  e.trajectoryObservations=[{target:e.selections[0]!.target,samplingInterval:.1}];
  request.model.components=[w];request.model.connections=[];request.model.observations=[];validateRequest(request);
  const result:RunResultV2={schemaVersion:2,status:'completed',modelId:request.model.id,simulation:{...request.simulation,finalTime:request.simulation.end,runCalls:1},observations:[],resultEvents:[],scenarioTrajectories:[],
    wrappers:[{component:w.id,inputs:e.factors.length+2,scenarioCount:e.factors.reduce((n,f)=>n*factorCardinality(f),1),outputs:wrapperOutputs(e)}],
    diagnostics:{engineVersion:'0.1.0',adapterVersion:'0.1.0',observationPolicy:'engine-resampled-sealed-deduplicated'}};
  const diagnostics=result.diagnostics as typeof result.diagnostics & {padding:string};diagnostics.padding='';
  const maximum=runnerCapabilities.wrapper.trajectoryObservations.maxResponseBytes;
  diagnostics.padding='x'.repeat(maximum-20-Buffer.byteLength(JSON.stringify(result),'utf8'));
  assert.equal(Buffer.byteLength(JSON.stringify(result),'utf8'),maximum-20);parseWrapperResult(result,request);
  const app=buildApp(readConfig(),{describe:async()=>catalog,run:async()=>result,close:async()=>{}});
  try {const response=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:request});assert.equal(response.statusCode,422);assert.equal(response.json().error.code,'LIMIT_EXCEEDED');assert.match(response.json().error.message,/including runId/);}
  finally {await app.close();}
});
