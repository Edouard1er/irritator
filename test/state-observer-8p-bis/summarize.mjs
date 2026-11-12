import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const result=[];
let bad=false;
for(const configuration of ['Release','Debug']) for(const [suite,expected] of [['proof',13],['engine',10],['historical',40],['runner',71]]) {
 const file=path.join(root,'build-web-test8p-bis',configuration,`${suite}.xml`);
 if(!fs.existsSync(file)) {result.push({configuration,suite,missing:true});bad=true;continue;}
 const xml=fs.readFileSync(file,'utf8');
 const header=xml.match(/<testsuite\s[^>]*>/)?.[0]??'';
 const attr=n=>Number(header.match(new RegExp(`\\b${n}="([^"]+)"`))?.[1]??0);
 const cases=[...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)];
 const failed=cases.filter(m=>/<failure\b|<error\b/.test(m[2]??'')).map(m=>m[1].match(/\bname="([^"]+)"/)?.[1]);
 const entry={configuration,suite,tests:attr('tests'),failures:attr('failures'),skipped:attr('skipped'),disabled:attr('disabled'),passed:attr('tests')-attr('failures')-attr('skipped')-attr('disabled'),failedNames:failed,file,time:attr('time')};
 result.push(entry);
 if(entry.tests!==expected || entry.failures || entry.skipped || entry.disabled || failed.length) bad=true;
}
const sha=p=>createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const sourceFiles=['lib/CMakeLists.txt','lib/include/irritator/core.hpp','lib/include/irritator/event.hpp','lib/include/irritator/qss-probe.hpp','lib/src/event.cpp','lib/src/timeline.cpp','lib/src/observer-couplings.hpp','lib/src/state-observer-protocol.hpp','web/engine/runner/event-native-tests.cpp','web/engine/runner/schaefer-feedback-native.cpp'];
const summary={allRequiredPass:!bad,results:result,sourceHashes:sourceFiles.map(p=>({path:p,sha256:sha(p)}))};
fs.writeFileSync(path.join(root,'build-web-test8p-bis/audit/validation-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(bad) process.exitCode=1;
