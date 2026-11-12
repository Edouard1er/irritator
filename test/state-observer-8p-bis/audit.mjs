import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const out=path.join(root,'build-web-test8p-bis/audit');
const sha=x=>createHash('sha256').update(x).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).replaceAll('\r\n','\n');
const before=JSON.parse(fs.readFileSync(path.join(out,'before.json'),'utf8').replace(/^\uFEFF/,''));
const changes=before.filter(f=>sha(fs.readFileSync(path.resolve(root,f.path)))!==f.sha256.toLowerCase()).map(f=>f.path);
const allowed=new Set(['lib/CMakeLists.txt','lib/include/irritator/core.hpp','lib/include/irritator/event.hpp','lib/src/event.cpp','lib/src/timeline.cpp','web/engine/runner/event-native-tests.cpp','web/engine/runner/schaefer-feedback-native.cpp']);
const unexpected=changes.filter(p=>!allowed.has(p.replaceAll('\\','/')));
const hold=s=>{s=s.replaceAll('\r\n','\n');const a=s.indexOf('struct zero_order_hold {');return s.slice(a,s.indexOf('\n};',a)+3);};
const current=fs.readFileSync(path.join(root,'lib/include/irritator/core.hpp'),'utf8');
const normalize=s=>s.replaceAll('\r\n','\n');
const oldFile=p=>normalize(git('show',`HEAD:${p}`));
const nowFile=p=>normalize(fs.readFileSync(path.join(root,p),'utf8'));
const harness='web/engine/runner/event-native-tests.cpp';
const schaefer='web/engine/runner/schaefer-feedback-native.cpp';
const assertions=s=>s.split('\n').filter(l=>/\b(require|near)\(/.test(l)).join('\n');
const testBody=s=>s.slice(s.indexOf('#include "campaign-native-tests.hpp"'));
const oracleHashes={nativeTestBodies:{before:sha(testBody(oldFile(harness))),after:sha(testBody(nowFile(harness)))},schaeferAssertionLines:{before:sha(assertions(oldFile(schaefer))),after:sha(assertions(nowFile(schaefer)))}};
const holdFiles=git('grep','-l','zero_order_hold','HEAD','--','test','demos','web/engine/runner').trim().split('\n').filter(Boolean).map(p=>p.replace(/^HEAD:/,''));
const holdTestFiles=holdFiles.map(p=>({path:p,before:sha(oldFile(p)),after:sha(nowFile(p))}));
const result={head:git('rev-parse','HEAD').trim(),branch:git('branch','--show-current').trim(),inventoried:before.length,changes,unexpected,oracleHashes,holdTestFiles,
 zeroOrderHold:{before:sha(hold(git('show','HEAD:lib/include/irritator/core.hpp'))),after:sha(hold(current))},
 fixtureSha256:sha(fs.readFileSync(path.join(root,'web/model-test/modelhalieutiquetest-points.csv'))),
 originalDiagnostics:before.filter(f=>f.path.includes('state-observer-8p\\')||f.path.includes('state-observer-8p/')||f.path==='reports/state-observer-pdevs-conformity-8P.md').map(f=>({...f,unchanged:sha(fs.readFileSync(path.resolve(root,f.path)))===f.sha256.toLowerCase()})),
 trackedChanges:git('diff','--name-only').trim().split('\n').filter(Boolean)};
fs.writeFileSync(path.join(out,'integrity.json'),JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(path.join(out,'final.patch'),git('diff','--','lib','web/engine/runner/event-native-tests.cpp','web/engine/runner/schaefer-feedback-native.cpp'));
fs.writeFileSync(path.join(out,'status-final.txt'),git('status','--short'));
console.log(JSON.stringify(result,null,2));
if(unexpected.length || result.zeroOrderHold.before!==result.zeroOrderHold.after || result.branch!=='for-web-ui' || result.originalDiagnostics.some(f=>!f.unchanged) || holdTestFiles.some(f=>f.before!==f.after) || Object.values(oracleHashes).some(f=>f.before!==f.after)) process.exitCode=1;
