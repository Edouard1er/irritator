import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve('build-web-test8g');
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const split=read(resolve(root,'contract-split-proof.json'));
assert.equal(split.baseAssertionsUnchanged,true);assert.equal(split.cliAggregatePreserved,true);
assert.equal(split.originalBaseSHA256,split.isolatedBaseSHA256);
assert.deepEqual(split.timeouts,{contract:60,hierarchy:120,qssCatalog:120});
const files=c=>readdirSync(resolve(root,c,'logs/http-8g')).filter(n=>n.endsWith('.json')).sort();
const names=files('Release');assert.equal(names.length,55);assert.deepEqual(names,files('Debug'));
for(const name of names) {
  const r=read(resolve(root,'Release/logs/http-8g',name)),d=read(resolve(root,'Debug/logs/http-8g',name));
  assert.deepEqual(r,d,`Release/Debug ${name}`);assert.equal(r.httpEqualsNative,true);
  if(r.exit===0)assert.equal(r.stderrBytes,0);
}
const expectedFailures=['native-wrapper-schaefer-pair','native-wrapper-schaefer-trajectories','runner-wrapper-7g'];
const configurations=['Release','Debug'].map(c=>{
  const exits=read(resolve(root,c,'logs/exit-codes.json'));
  for(const [step,code] of Object.entries(exits))assert.equal(code,step==='runner-tests'?8:0,`${c} ${step}`);
  const junit=readFileSync(resolve(root,c,'logs/runner.xml'),'utf8');
  const failures=[...junit.matchAll(/<testcase\b([^>]+)>([\s\S]*?)<\/testcase>/g)].filter(m=>m[2].includes('<failure')).map(m=>m[1].match(/name="([^"]+)"/)[1]).sort();
  if(failures.includes('runner-contract'))assert.match(readFileSync(resolve(root,c,'logs/contract-isolated.xml'),'utf8'),/failures="0"/);
  assert.deepEqual(failures.filter(n=>n!=='runner-contract'),expectedFailures);
  if(c==='Debug') {
    for(const dir of ['engine','runner']) {
      const ninja=readFileSync(resolve(root,c,dir,'build.ninja'),'utf8');
      assert.match(ninja,/IRRITATOR_ENABLE_DEBUG/);assert.doesNotMatch(ninja,/-DNDEBUG|\/DNDEBUG/);
    }
  }
  const browser=read(resolve(root,`playwright-${c.toLowerCase()}.json`));
  assert.equal(browser.stats.expected,69);for(const field of ['unexpected','skipped','flaky'])assert.equal(browser.stats[field],0);
  const finalBrowser=read(resolve(root,`playwright-${c.toLowerCase()}-final-8g.json`));
  assert.equal(finalBrowser.stats.expected,3);for(const field of ['unexpected','skipped','flaky'])assert.equal(finalBrowser.stats[field],0);
  return {configuration:c,exits,initialFailures:failures,remainingFailures:failures.filter(n=>n!=='runner-contract'),runner:hash(resolve(root,c,'runner/irritator-runner.exe')),engine:hash(resolve(root,c,'engine/lib/irritators-0.1.lib')),browser:browser.stats,finalBrowser:finalBrowser.stats};
});
const trace=readFileSync(resolve(root,'Release/logs/native-uncertainty.log'),'utf8');
assert.match(trace,/NATIVE_GROUPED_FEEDBACK_PASS/);assert.equal(trace,readFileSync(resolve(root,'Debug/logs/native-uncertainty.log'),'utf8'));
const events=[...trace.matchAll(/^EVENT (\d+) (\S+) (\S+):(\d+) \[([^\]]+)\]$/gm)].map(m=>({bag:+m[1],time:+m[2],path:m[3],port:+m[4],value:m[5].split(',').map(Number)}));
const children=[...trace.matchAll(/^CHILD_INIT (\d+) (\S+) (\d+) (\d+) (\S+) (\S+) (\S+) (\S+)$/gm)].map(m=>({bag:+m[1],time:+m[2],campaign:+m[3],scenario:+m[4],N:+m[5],C:+m[6],E:+m[7],q:+m[8]}));
assert.equal(children.length,12);
const groups=[...trace.matchAll(/^GROUP (\d+) (\d+) (\S+) (\S+) (\S+) (\S+) (\d+)$/gm)].map(m=>({campaign:+m[1],group:+m[2],E:+m[3],minCH:+m[4],maxCH:+m[5],minN:+m[6],validCount:+m[7]}));
assert.equal(groups.length,6);
const actions=events.filter(e=>e.path==='plant/effort');assert.deepEqual(actions.map(e=>[e.time,e.value]),[[0,[260,0,0]],[1,[150,0,0]],[3,[150,0,0]]]);
const summary={comparedCases:names.length,contractSplit:split,configurations,children,groups,actions};
writeFileSync(resolve(root,'cross-configuration.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
