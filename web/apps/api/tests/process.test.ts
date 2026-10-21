import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig, type Config } from '../src/config/index.js';
import { ProcessEngine } from '../src/services/engine.js';
import { ApiError } from '../../../packages/contracts/index.js';
import { reference } from './fixtures.js';

function fixture(mode: string, overrides: Partial<Config> = {}) {
  const children: ChildProcessWithoutNullStreams[]=[];
  const engine=new ProcessEngine({...readConfig(),timeoutMs:2000,...overrides},()=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./mock-runner.js',import.meta.url)),mode],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    children.push(child);return child;
  });
  return {engine,children};
}
const errorCode=(code:string)=>(error:unknown)=>error instanceof ApiError && error.code===code;
test('real process launch failure',async()=>{
  const e=new ProcessEngine({...readConfig(),runnerPath:fileURLToPath(new URL('./missing.exe',import.meta.url))});
  try{await assert.rejects(e.run(reference()),errorCode('ENGINE_UNAVAILABLE'));}finally{await e.close();}
});
for(const [mode,code] of [['invalid','RUNNER_PROTOCOL_ERROR'],['success-on-failure','RUNNER_PROTOCOL_ERROR'],['failure-on-success','RUNNER_PROTOCOL_ERROR'],['failure','EXECUTION_ERROR'],['stdout','OUTPUT_LIMIT'],['stderr','OUTPUT_LIMIT']] as const) {
  test(`fixture process: ${mode}`,async()=>{
    const {engine}=fixture(mode,{maxStdoutBytes:1024,maxStderrBytes:1024});
    try{await assert.rejects(engine.run(reference()),errorCode(code));}finally{await engine.close();}
  });
}
test('timeout kills and reaps fixture process',async()=>{
  const {engine,children}=fixture('hang',{timeoutMs:100});
  try {await assert.rejects(engine.run(reference()),errorCode('ENGINE_TIMEOUT'));assert.ok(children[0]!.exitCode!==null || children[0]!.signalCode!==null);}finally{await engine.close();}
});
test('cancellation, concurrency and slot reuse after process close',async()=>{
  const {engine,children}=fixture('hang',{maxConcurrent:1});const abort=new AbortController();
  const pending=assert.rejects(engine.run(reference(),abort.signal),errorCode('CANCELLED'));
  await assert.rejects(engine.run(reference()),errorCode('ENGINE_BUSY'));
  abort.abort(); await pending;
  assert.ok(children[0]!.exitCode!==null || children[0]!.signalCode!==null);
  const next=new AbortController();const again=assert.rejects(engine.run(reference(),next.signal),errorCode('CANCELLED'));next.abort();await again;
  await engine.close();await assert.rejects(engine.describe(),errorCode('ENGINE_UNAVAILABLE'));
});
test('server shutdown reaps children',async()=>{
  const {engine,children}=fixture('hang');
  const running=engine.run(reference()).catch(()=>{});await engine.close();await running;
  assert.ok(children[0]!.exitCode!==null || children[0]!.signalCode!==null);
});
