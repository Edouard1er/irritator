import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { nativeRequest, type RunRequest } from '../../../packages/contracts/index.js';

const fixture=()=>JSON.parse(readFileSync(resolve('examples/atelier-schaefer-month-v3.json'),'utf8')) as RunRequest;
test('units HTTP → real native engine: unchanged values, explicit local metadata', {timeout:60000},async()=>{
  const app=buildApp(readConfig());
  try {
    const request=fixture(),before=JSON.stringify(request);
    const annotated=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:request});
    assert.equal(annotated.statusCode,200,annotated.body);
    const legacy=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:nativeRequest(request)});
    assert.equal(legacy.statusCode,200,legacy.body);
    const result=annotated.json(),raw=legacy.json();assert.equal(result.scenarioTrajectories.length,6);
    for(let i=0;i<6;i++)for(let j=0;j<2;j++) {
      const row=result.scenarioTrajectories[i].observations[j];assert.equal(row.unit,'t');assert.equal(row.timeUnit,'month');
      assert.deepEqual(row.samples,raw.scenarioTrajectories[i].observations[j].samples);
      assert.equal(raw.scenarioTrajectories[i].observations[j].unit,undefined);
    }
    assert.equal(result.units.time,'month');assert.equal(result.scenarioTrajectories[0].units.provenance.basis,'workshop-convention');assert.equal(JSON.stringify(request),before);
  } finally {await app.close();}
});
test('HTTP rejects rate or same-clock unit inconsistency before spawning',async()=>{
  const app=buildApp(readConfig());
  try {
    const request=fixture();request.model.definitions![0]!.units!.catchability='1/(effort*year)';
    const response=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:request});
    assert.equal(response.statusCode,400);assert.equal(response.json().error.code,'INVALID_UNITS');
    request.model.definitions![0]!.units!.catchability='1/(effort*month)';request.model.units!.time='year';delete request.model.components[0]!.units;
    request.model.components.push({id:'lake',type:'coupled',definition:'Schaefer',parameters:{}});
    const mismatch=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:request});assert.equal(mismatch.statusCode,400);assert.equal(mismatch.json().error.code,'INVALID_UNITS');
  } finally {await app.close();}
});
