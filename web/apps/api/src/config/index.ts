import { resolve } from 'node:path';
import { caps, wrapperCaps } from '../../../../packages/contracts/index.js';

export interface Config {
  runnerPath: string; host: string; port: number; bodyLimit: number;
  timeoutMs: number; maxConcurrent: number; maxStdoutBytes: number; maxStderrBytes: number;
  engineLimits: typeof caps;
  wrapperLimits: typeof wrapperCaps;
  maxDepth?: number; maxInstances?: number;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  function integer(name: string, fallback: number, min: number, max: number): number {
    const raw = env[name];
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(n) || n < min || n > max || raw?.trim() === '') throw new Error(`Invalid ${name} (${min}..${max})`);
    return n;
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1','::1','localhost'].includes(host)) throw new Error('This version binds only to loopback');
  return {
    runnerPath: resolve(env.IRRITATOR_RUNNER ?? `../build-web-test8o/${process.platform === 'win32' ? 'Release/' : ''}runner/irritator-runner${process.platform === 'win32' ? '.exe' : ''}`),
    host, port: integer('PORT',3001,0,65535), bodyLimit: integer('API_BODY_LIMIT',1048576,1024,1048576),
    timeoutMs: integer('ENGINE_TIMEOUT_MS',10000,10,60000), maxConcurrent: integer('ENGINE_MAX_CONCURRENT',2,1,8),
    maxStdoutBytes: integer('ENGINE_MAX_STDOUT_BYTES',4*1024*1024,128,4*1024*1024),
    maxStderrBytes: integer('ENGINE_MAX_STDERR_BYTES',65536,128,65536),
    engineLimits: {
      maxComponents: integer('ENGINE_MAX_COMPONENTS',caps.maxComponents,1,caps.maxComponents),
      maxConnections: integer('ENGINE_MAX_CONNECTIONS',caps.maxConnections,0,caps.maxConnections),
      maxRunCalls: integer('ENGINE_MAX_RUN_CALLS',caps.maxRunCalls,1,caps.maxRunCalls),
      maxPoints: integer('ENGINE_MAX_POINTS',caps.maxPoints,1,caps.maxPoints)
    },
    maxDepth: integer('ENGINE_MAX_DEPTH',8,1,8),
    maxInstances: integer('ENGINE_MAX_INSTANCES',512,1,512),
    wrapperLimits: Object.fromEntries(Object.entries(wrapperCaps).map(([key, cap]) => [
      key, integer(`ENGINE_${key.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}`, cap, 1, cap)
    ])) as typeof wrapperCaps
  };
}
