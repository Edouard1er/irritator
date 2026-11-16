import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { nativeRequest, type RunRequest } from '../../../packages/contracts/index.js';
import { validateGeoAtlas, type GeoAtlasV1 } from '../../../packages/contracts/geo-atlas.js';
import example from '../../../examples/atelier-interventions-month-v3.json' with { type: 'json' };
test('100 cartographic declarations stay outside native input, observations and closed API', {timeout:60000},async()=>{
  const r=structuredClone(example) as unknown as RunRequest;r.simulation.end=2;
  const before=structuredClone(nativeRequest(r)),requestText=JSON.stringify(r),now=new Date().toISOString();
  const atlas:GeoAtlasV1={kind:'irritator.level2.geo-atlas',version:1,id:'test-atlas',revision:1,createdAt:now,updatedAt:now,crs:'EPSG:4326',sources:[{id:'test-workshop',title:'Exercice de test fictif',organization:'Test',classification:'workshop-declaration'}],features:[]};
  const app=buildApp(readConfig());
  const run=async()=>{const res=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:r});assert.equal(res.statusCode,200,res.body);return res.json();};
  try {
    const first=await run();
    for(let i=0;i<100;i++)atlas.features.push({type:'Feature',id:`test-${i}`,geometry:null,properties:{name:'Lieu fictif de test',kind:'fishing-point',sourceId:'test-workshop',evidence:'declared-unverified',precision:'unknown',share:'workshop-only',recordedAt:now}});
    validateGeoAtlas(atlas);assert.equal(JSON.stringify(r),requestText);assert.deepEqual(nativeRequest(r),before);
    const second=await run();for(const key of ['observations','simulation','modelEvents','scenarios'])assert.deepEqual(second[key],first[key],key);
    if(process.env.IRRITATOR_GEO_EVIDENCE){const dir=resolve(process.env.IRRITATOR_GEO_EVIDENCE);await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'purete-native-avant-apres-carte.json'),JSON.stringify({declarations:atlas.features.length,nativeBefore:before,nativeAfter:nativeRequest(r),firstRun:first,secondRun:second},null,2));}
    const res=await app.inject({method:'POST',url:'/api/v1/simulations/run',payload:{...r,geoAtlas:atlas}});assert.equal(res.statusCode,400);
  }finally{await app.close();}
});
