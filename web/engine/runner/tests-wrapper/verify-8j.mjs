import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [release,debug,out]=process.argv.slice(2).map(p=>resolve(p));
if(!release||!debug||!out)throw Error('Expected Release evidence, Debug evidence, output path');
const files=readdirSync(release).filter(f=>f.endsWith('.json')&&!f.endsWith('-request.json'));
const rows=[];
for(const file of files){
  const a=JSON.parse(readFileSync(resolve(release,file))),b=JSON.parse(readFileSync(resolve(debug,file)));
  assert.deepEqual(a.request,b.request,file+' request');
  if(file==='unsafe-initialization.json') {assert.notEqual(a.exit,0);assert.notEqual(b.exit,0);assert.equal(a.httpStatus,502);assert.equal(b.httpStatus,502);rows.push({file,globalFailure:true});continue;}
  assert.deepEqual(a.result,b.result,file+' result');assert.equal(a.exit,b.exit,file+' exit');assert.equal(a.httpEqualsNative,true,file+' Release HTTP');assert.equal(b.httpEqualsNative,true,file+' Debug HTTP');
  const log=file.replace('.json','-native.log');
  if(readdirSync(release).includes(log)){
    const events=p=>readFileSync(resolve(p,log),'utf8').split(/\r?\n/).filter(l=>l.startsWith('EVENT ')||l.startsWith('RESOURCE ')).map(l=>l.replace(/ wrapper_ms=.*/,''));
    assert.deepEqual(events(release),events(debug),file+' native events/resources');
  }
  rows.push({file,exit:a.exit,httpStatus:a.httpStatus,identical:true});
}
writeFileSync(out,JSON.stringify({pairs:rows.length,rows},null,2)+'\n');console.log('8J EVIDENCE_IDENTICAL',rows.length);
