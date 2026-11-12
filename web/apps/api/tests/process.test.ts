import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig, type Config } from '../src/config/index.js';
import { ProcessEngine } from '../src/services/engine.js';
import { ApiError } from '../../../packages/contracts/index.js';
import { reference } from './fixtures.js';
import { wrapperAffine } from './wrapper-fixtures.js';

function fixture(mode: string, overrides: Partial<Config> = {}) {
  const children: ChildProcessWithoutNullStreams[]=[];
  const outputs: string[]=[];
  const engine=new ProcessEngine({...readConfig(),timeoutMs:2000,...overrides},(_exe,args)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./mock-runner.js',import.meta.url)),mode,...args],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const i=children.length;outputs.push('');child.stdout.on('data', (chunk: Buffer) => { outputs[i] += chunk.toString('utf8'); });
    children.push(child);return child;
  });
  return {engine,children,outputs};
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
for (const [mode, code] of [['catalog-mismatch', 'RUNNER_INCOMPATIBLE'], ['capabilities-mismatch', 'RUNNER_INCOMPATIBLE'], ['malformed-v3', 'RUNNER_PROTOCOL_ERROR'], ['legacy-v3', 'RUNNER_PROTOCOL_ERROR'], ['v3-error', 'INVALID_FACTOR']] as const) {
  test(`v3 process boundary: ${mode}`, async () => {
    const { engine, children } = fixture(mode, { timeoutMs: 5000 });
    try { await assert.rejects(engine.run(wrapperAffine()), errorCode(code)); assert.ok(children.every(c => c.exitCode !== null || c.signalCode !== null)); }
    finally { await engine.close(); }
  });
}
test('synchronous launch failure is an unavailable engine', async () => {
  const engine = new ProcessEngine(readConfig(), () => { throw new Error('fixture spawn failure'); });
  try { await assert.rejects(engine.run(reference()), errorCode('ENGINE_UNAVAILABLE')); } finally { await engine.close(); }
});
test('v3 forwards the complete document with all effective limits and leaves input intact', async () => {
  const config=readConfig();
  const { engine, outputs }=fixture('capture-v3', { timeoutMs:5000, engineLimits:{ ...config.engineLimits, maxRunCalls:100 }, maxDepth:4, maxInstances:256,
    wrapperLimits:{ maxWrappers:6, maxScenarios:16, maxTotalScenarios:50, maxTotalModels:4000, maxTotalConnections:16000, maxInternalPoints:100000, maxResultEvents:100, maxTrajectoryPoints:20000 } });
  const m=wrapperAffine();m.limits={ maxRunCalls:50, maxDepth:3, maxInstances:128, maxWrappers:4, maxScenarios:8, maxTotalScenarios:60, maxTotalModels:3000, maxTotalConnections:32000, maxInternalPoints:80000, maxResultEvents:40 };
  const before=structuredClone(m);
  try {
    await assert.rejects(engine.run(m),errorCode('RUNNER_PROTOCOL_ERROR'));
    const forwarded=JSON.parse(outputs.at(-1)!);
    assert.deepEqual(forwarded, { ...m, limits:{ ...config.engineLimits, maxRunCalls:50, maxDepth:3, maxInstances:128, maxWrappers:4, maxScenarios:8, maxTotalScenarios:50, maxTotalModels:3000, maxTotalConnections:16000, maxInternalPoints:80000, maxResultEvents:40, maxTrajectoryPoints:20000 } });
    assert.deepEqual(m,before);
  } finally { await engine.close(); }
});
