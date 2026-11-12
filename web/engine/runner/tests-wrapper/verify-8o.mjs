import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??'build-web-test8o');
const directory=process.argv[3]??'final-http';
const compared=[];
for(const file of readdirSync(resolve(root,'Release',directory)).filter(f=>f.endsWith('.json'))){
  const release=JSON.parse(readFileSync(resolve(root,'Release',directory,file),'utf8'));
  if(!release.request||!release.result)continue;
  const debug=JSON.parse(readFileSync(resolve(root,'Debug',directory,file),'utf8'));
  assert.deepEqual(debug.request,release.request,file+' request');assert.deepEqual(debug.result,release.result,file+' native result');
  if(release.httpResult)assert.deepEqual(release.httpResult,release.result,file+' release HTTP');
  if(debug.httpResult)assert.deepEqual(debug.httpResult,debug.result,file+' debug HTTP');
  compared.push(file);
}
assert.ok(compared.length>=20,'Expected complete real runner/HTTP evidence');
const nominal=JSON.parse(readFileSync(resolve(root,'Release',directory,'nominal-N-C.json'),'utf8')).result;
const proof={compared:compared.length,files:compared,exactNativeEquality:true,httpEqualsNative:true,records:nominal.scenarioTrajectories.length,series:nominal.scenarioTrajectories.reduce((n,r)=>n+r.observations.length,0),points:nominal.scenarioTrajectories.flatMap(r=>r.observations).reduce((n,o)=>n+o.samples.length,0),bytes:Buffer.byteLength(JSON.stringify(nominal),'utf8')};
writeFileSync(resolve(root,'cross-configuration.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));
