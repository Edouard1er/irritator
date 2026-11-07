import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { feedbackOracle, schaeferOracle } from './decision-8e-oracle.mjs';
const root=resolve('build-web-test8e');
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const directory=c=>resolve(root,c,'logs/http-8e');
const names=readdirSync(directory('Release')).filter(n=>n.endsWith('.json')).sort();
assert.deepEqual(names,readdirSync(directory('Debug')).filter(n=>n.endsWith('.json')).sort());
for(const name of names) {
  const release=read(resolve(directory('Release'),name)),debug=read(resolve(directory('Debug'),name));
  assert.deepEqual(release,debug,`Cross configuration ${name}`);
  assert.equal(release.httpEqualsNative,true);
  if(release.exit===0) assert.equal(release.stderrBytes,0);
}
const r=read(resolve(directory('Release'),'two-cycles.json')).result;
const rows=(c,p)=>r.resultEvents.filter(e=>e.port===p&&e.value[2]===c).sort((a,b)=>a.value[1]-b.value[1]);
const campaigns=[1,2].map(c=>{
  const N=rows(c,6)[0].value[0],C=rows(c,7)[0].value[0],t=c===1?1:3;
  return {campaign:c,time:t,N,C,oracle:feedbackOracle(t),scenarios:rows(c,8).map((e,i)=>{
    const E=e.value[0],Nmin=rows(c,9)[i].value[0],CH=rows(c,10)[i].value[0];
    return {id:i,E,Nmin,CH,deltaC:CH-C,oracle:schaeferOracle(N,C,E,20)};
  })};
});
const maxErrors={N:0,C:0};
for(const id of ['N','C']) for(const s of r.observations.find(o=>o.component==='plant/'+id).samples) maxErrors[id]=Math.max(maxErrors[id],Math.abs(s.value-feedbackOracle(s.time)[id]));
const configurations=['Release','Debug'].map(c=>{
  const ninja=readFileSync(resolve(root,c,'engine/build.ninja'),'utf8');
  if(c==='Debug') {assert.match(ninja,/IRRITATOR_ENABLE_DEBUG/);assert.doesNotMatch(ninja,/-DNDEBUG|\/DNDEBUG/);}
  const exits=read(resolve(root,c,'logs/exit-codes.json'));
  for(const [step,code] of Object.entries(exits)) assert.equal(code,step==='runner-tests'?8:0,`${c} ${step}`);
  const junit=readFileSync(resolve(root,c,'logs/runner.xml'),'utf8');
  const initialFailed=[...junit.matchAll(/<testcase\b([^>]+)>([\s\S]*?)<\/testcase>/g)].filter(m=>m[2].includes('<failure')).map(m=>m[1].match(/name="([^"]+)"/)[1]).sort();
  if(initialFailed.includes('runner-contract')) {
    const retry=readFileSync(resolve(root,c,'logs/contract-isolated.xml'),'utf8');
    assert.match(retry,/tests="1"/);assert.match(retry,/failures="0"/);
  }
  const failed=initialFailed.filter(n=>n!=='runner-contract');
  assert.deepEqual(failed,['native-wrapper-schaefer-pair','native-wrapper-schaefer-trajectories','runner-wrapper-7g']);
  assert.match(readFileSync(resolve(root,c,'logs/native-events.log'),'utf8'),/NATIVE_SCHAEFER_FEEDBACK_PASS/);
  return {configuration:c,runner:hash(resolve(root,c,'runner/irritator-runner.exe')),engine:hash(resolve(root,c,'engine/lib/irritators-0.1.lib')),exits,initialFailed,failed};
});
assert.equal(readFileSync(resolve(root,'Release/logs/native-events.log'),'utf8'),readFileSync(resolve(root,'Debug/logs/native-events.log'),'utf8'),'Native bag trace differs');
const summary={comparedCases:names.length,configurations,campaigns,maxErrors,final:Object.fromEntries(['N','C'].map(id=>[id,r.observations.find(o=>o.component==='plant/'+id).samples.at(-1).value]))};
writeFileSync(resolve(root,'cross-configuration.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
