import test from 'node:test';
import './hierarchy-tests.mjs';
import './qss-catalog-tests.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runner = process.env.IRRITATOR_RUNNER ?? fileURLToPath(new URL(`../../../build-web-test4/runner/irritator-runner${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
export const reference = () => JSON.parse(readFileSync(new URL('../../examples/sum3.json',import.meta.url),'utf8'));
const invoke = input => {
  const p = spawnSync(runner, [], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding:'utf8', timeout:10000, maxBuffer:4*1024*1024, shell:false });
  assert.ifError(p.error);
  return { code:p.status, stderr:p.stderr, result:JSON.parse(p.stdout) };
};
const success = model => { const p=invoke(model); assert.equal(p.code,0,p.stderr); assert.equal(p.result.status,'completed'); return p.result; };
const reject = (model,code) => { const p=invoke(model); assert.notEqual(p.code,0); assert.equal(p.result.status,'failed'); assert.equal(p.result.error.code,code); assert.equal(p.result.observations,undefined); };
test('C++: native catalogue handshake',()=>{
  const p=spawnSync(runner,['--describe'],{encoding:'utf8',timeout:10000});
  assert.equal(p.status,0,p.stderr);
  assert.deepEqual(JSON.parse(p.stdout),JSON.parse(readFileSync(new URL('../../packages/contracts/catalog.json',import.meta.url),'utf8')));
});
test('C++: reference oracle',()=>{
  const r=success(reference());
  assert.deepEqual(r.observations[0].samples,[{time:0,value:10},{time:1,value:110},{time:2,value:1110}]);
  assert.equal(r.simulation.finalTime,3); assert.equal(r.simulation.runCalls,10);
});
test('C++: changed values and dynamic sum2 topology',()=>{
  const m=reference(); m.model.components[0].parameters.value=-2; m.model.components[1].parameters.value=7; m.model.components[2].parameters.value=40;
  assert.deepEqual(success(m).observations[0].samples.map(s=>s.value),[-2,5,45]);
  m.model.components.splice(2,1); m.model.components[2].type='qss1_sum_2'; m.model.connections.pop();
  assert.deepEqual(success(m).observations[0].samples.map(s=>s.value),[-2,5]);
});
for(const type of ['qss1_integrator','qss3_integrator']) for(const rate of [-2,0,2]) {
  test(`C++: ${type}, rate=${rate}, translated time and sealed affine history`,()=>{
    const m={schemaVersion:1,model:{id:'affine',components:[{id:'r',type:'constant',parameters:{value:rate,offset:0}},{id:'x',type,parameters:{X:5,dQ:0.25}}],connections:[{from:{component:'r',port:0},to:{component:'x',port:0}}],observations:[{component:'x',samplingInterval:0.1}]},simulation:{start:50,end:53}};
    const r=success(m), samples=r.observations[0].samples;
    for(const s of samples) assert.ok(Math.abs(s.value-(5+rate*(s.time-50)))<1e-9,JSON.stringify(s));
    if(rate!==0) { assert.equal(samples.at(-1).time,53); assert.ok(Math.abs(samples.at(-1).value-(5+rate*3))<1e-9); }
  });
}
const invalid = [
  ['malformed JSON',()=>'{','INVALID_JSON'],
  ['duplicate JSON member',()=>'{"schemaVersion":1,"schemaVersion":1}','INVALID_JSON'],
  ['NUL and trailing document',()=>JSON.stringify(reference())+'\0{}','INVALID_JSON'],
  ['unsupported schema',m=>{m.schemaVersion=2;return m;},'INVALID_MODEL'],
  ['unknown component',m=>{m.model.components[0].type='evil';return m;},'UNKNOWN_COMPONENT'],
  ['missing parameter',m=>{delete m.model.components[0].parameters.value;return m;},'INVALID_PARAMETER'],
  ['unknown parameter',m=>{m.model.components[0].parameters.command=1;return m;},'INVALID_PARAMETER'],
  ['negative offset',m=>{m.model.components[0].parameters.offset=-1;return m;},'INVALID_PARAMETER'],
  ['duplicate id',m=>{m.model.components[1].id='c1';return m;},'INVALID_MODEL'],
  ['unknown reference',m=>{m.model.connections[0].from.component='missing';return m;},'INVALID_REFERENCE'],
  ['port direction',m=>{m.model.connections[0].to.component='c2';return m;},'INVALID_CONNECTION'],
  ['port index',m=>{m.model.connections[0].from.port=1;return m;},'INVALID_CONNECTION'],
  ['duplicate connection',m=>{m.model.connections.push(m.model.connections[0]);return m;},'INVALID_CONNECTION'],
  ['time bounds',m=>{m.simulation.end=0;return m;},'INVALID_TIME'],
  ['duplicate observation',m=>{m.model.observations.push(m.model.observations[0]);return m;},'OBSERVATION_ERROR'],
  ['unknown observation',m=>{m.model.observations[0].component='missing';return m;},'INVALID_REFERENCE'],
  ['sampling budget',m=>{m.model.observations[0].samplingInterval=1e-6;return m;},'LIMIT_EXCEEDED'],
  ['model budget',m=>{m.limits={maxComponents:1};return m;},'LIMIT_EXCEEDED'],
  ['scheduler budget',m=>{m.limits={maxRunCalls:1};return m;},'LIMIT_EXCEEDED'],
  ['finite numbers',()=>JSON.stringify(reference()).replace('"value":10','"value":1e999'),'INVALID_JSON'],
  ['body budget',()=> ' '.repeat(1048577),'LIMIT_EXCEEDED'],
  ['dQ zero',m=>{m.model.components[0]={id:'c1',type:'qss1_integrator',parameters:{X:0,dQ:0}};return m;},'INVALID_PARAMETER']
];
for(const [name,mutate,code] of invalid) test(`C++ rejects ${name}`,()=>reject(mutate(reference()),code));
test('C++: accepted two-node feedback cycle terminates with structured scheduler limit',()=>{
  const m=reference(); m.model.components.push({id:'feedback',type:'qss1_sum_2',parameters:{}});
  m.model.connections.push({from:{component:'sum',port:0},to:{component:'feedback',port:0}},{from:{component:'feedback',port:0},to:{component:'sum',port:0}}); m.limits={maxRunCalls:20};
  reject(m,'LIMIT_EXCEEDED');
});
test('C++: events at end excluded',()=>{
  const m=reference(); m.model.components[2].parameters.offset=3;
  assert.deepEqual(success(m).observations[0].samples.map(s=>s.value),[10,110]);
});
