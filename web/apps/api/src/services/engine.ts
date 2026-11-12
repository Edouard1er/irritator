import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { ApiError, catalog, runnerCapabilities, parseResult, parseWrapperResult, validateRequest, type RunRequest, type RunResult, type RunResultV2 } from '../../../../packages/contracts/index.js';
import type { Config } from '../config/index.js';

// An interface boundary for future asynchronous jobs; no scientific logic here.
export interface Engine {
  describe(signal?: AbortSignal): Promise<typeof catalog>;
  capabilities?(signal?: AbortSignal): Promise<typeof runnerCapabilities>;
  run(request: RunRequest, signal?: AbortSignal): Promise<RunResult | RunResultV2>;
  close(): Promise<void>;
}
export type LaunchProcess = (executable: string, args: string[]) => ChildProcessWithoutNullStreams;
const launchRunner: LaunchProcess = (executable,args) => spawn(executable,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
export class ProcessEngine implements Engine {
  private readonly children = new Set<ChildProcessWithoutNullStreams>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly config: Config, private readonly launch: LaunchProcess = launchRunner) {}
  private async invoke(args: string[], input: string, signal?: AbortSignal): Promise<{ value: unknown; exitCode: number | null }> {
    if (this.closed) throw new ApiError('ENGINE_UNAVAILABLE','Engine service is closing',503);
    if (this.children.size >= this.config.maxConcurrent) throw new ApiError('ENGINE_BUSY','Maximum simultaneous simulations reached',503);
    if (signal?.aborted) throw new ApiError('CANCELLED','Execution cancelled',499);
    const pending = new Promise<{ value: unknown; exitCode: number | null }>((resolve,reject) => {
      // The executable path comes only from trusted server configuration.
      let child: ChildProcessWithoutNullStreams;
      try { child = this.launch(this.config.runnerPath,args); }
      catch { throw new ApiError('ENGINE_UNAVAILABLE','Cannot start configured runner',503); }
      this.children.add(child);
      let error: ApiError | undefined;
      const out: Buffer[] = [];
      const diagnostics: Buffer[] = [];
      let stdoutBytes=0, stderrBytes=0;
      const stop = (reason: ApiError) => {
        error ??= reason;
        child.kill('SIGKILL');
      };
      const abort = () => stop(new ApiError('CANCELLED','Execution cancelled',499));
      const timer=setTimeout(()=>stop(new ApiError('ENGINE_TIMEOUT','Runner deadline exceeded',504)),this.config.timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      child.on('error',()=>{error ??= new ApiError('ENGINE_UNAVAILABLE','Cannot start configured runner',503);});
      child.stdin.on('error',()=>{error ??= new ApiError('RUNNER_PROTOCOL_ERROR','Runner input stream failed',502);});
      child.stdout.on('data',(chunk: Buffer)=>{
        stdoutBytes+=chunk.length;
        if(stdoutBytes>this.config.maxStdoutBytes) stop(new ApiError('OUTPUT_LIMIT','Runner stdout limit exceeded',502));
        else if(!error) out.push(chunk);
      });
      // stderr is diagnostic data, never parsed as JSON or returned as a success.
      child.stderr.on('data',(chunk: Buffer)=>{
        stderrBytes+=chunk.length;
        if(stderrBytes>this.config.maxStderrBytes) stop(new ApiError('OUTPUT_LIMIT','Runner stderr limit exceeded',502));
        else diagnostics.push(chunk);
      });
      child.once('close',(code)=>{
        clearTimeout(timer); signal?.removeEventListener('abort',abort); this.children.delete(child);
        if(error) { error.cause=Buffer.concat(diagnostics).toString('utf8'); return reject(error); }
        let value: unknown;
        try { value=JSON.parse(Buffer.concat(out).toString('utf8')); }
        catch { return reject(new ApiError('RUNNER_PROTOCOL_ERROR','Runner returned invalid JSON',502)); }
        resolve({value,exitCode:code});
      });
      child.stdin.end(input);
    });
    this.pending.add(pending);
    try { return await pending; } finally { this.pending.delete(pending); }
  }
  async describe(signal?: AbortSignal): Promise<typeof catalog> {
    const { value, exitCode } = await this.invoke(['--describe'],'',signal);
    if(exitCode!==0 || !isDeepStrictEqual(value,catalog)) throw new ApiError('RUNNER_PROTOCOL_ERROR','Runner catalogue/version mismatch; rebuild runner and API together',502);
    return catalog;
  }
  async capabilities(signal?: AbortSignal): Promise<typeof runnerCapabilities> {
    try {
      // The historical atomic catalogue remains a separate, exact handshake.
      await this.describe(signal);
      const { value, exitCode } = await this.invoke(['--capabilities'],'',signal);
      if (exitCode !== 0 || !isDeepStrictEqual(value,runnerCapabilities)) {
        throw new ApiError('RUNNER_INCOMPATIBLE','Runner lacks the matching JSON v3/result v2 capabilities; rebuild the Test 8O runner with the API',502);
      }
      return runnerCapabilities;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RUNNER_PROTOCOL_ERROR') {
        throw new ApiError('RUNNER_INCOMPATIBLE','Runner catalogue or capability protocol does not match the API; rebuild runner and API together',502);
      }
      throw error;
    }
  }
  async run(request: RunRequest, signal?: AbortSignal): Promise<RunResult | RunResultV2> {
    validateRequest(request);
    const effective = structuredClone(request);
    effective.limits = { ...this.config.engineLimits };
    for(const key of Object.keys(this.config.engineLimits) as (keyof Config['engineLimits'])[]) {
      effective.limits[key] = Math.min(request.limits?.[key] ?? this.config.engineLimits[key],this.config.engineLimits[key]);
    }
    if (effective.schemaVersion >= 2) {
      effective.limits.maxDepth = Math.min(request.limits?.maxDepth ?? 8, this.config.maxDepth ?? 8);
      effective.limits.maxInstances = Math.min(request.limits?.maxInstances ?? 512, this.config.maxInstances ?? 512);
    }
    if (effective.schemaVersion === 3) {
      for (const key of Object.keys(this.config.wrapperLimits) as (keyof Config['wrapperLimits'])[]) {
        effective.limits[key] = Math.min(request.limits?.[key] ?? this.config.wrapperLimits[key],this.config.wrapperLimits[key]);
      }
    }
    validateRequest(effective);
    if (effective.schemaVersion === 3) await this.capabilities(signal);
    const { value, exitCode } = await this.invoke([],JSON.stringify(effective),signal);
    if(exitCode!==0) {
      const failure = value as { schemaVersion?: unknown; status?: unknown; error?: { code?: unknown; message?: unknown; engineCategory?: unknown; engineCode?: unknown; diagnostics?: import('../../../../packages/contracts/index.js').StructuralDiagnostic[] } } | null;
      if(!failure || failure.schemaVersion!==1 || failure.status!=='failed' || typeof failure.error?.code!=='string' || typeof failure.error.message!=='string') throw new ApiError('RUNNER_PROTOCOL_ERROR','Runner failed without a valid error envelope',502);
      const allowed = new Set(['INVALID_JSON','INVALID_MODEL','UNKNOWN_COMPONENT','INVALID_PARAMETER','INVALID_REFERENCE','INVALID_CONNECTION','INVALID_TIME','INITIALIZATION_ERROR','EXECUTION_ERROR','LIMIT_EXCEEDED','OBSERVATION_ERROR','INTERNAL_ERROR','SERIALIZATION_ERROR','DEFINITION_NOT_FOUND','INVALID_EXTERNAL_PORT','INVALID_SCOPE','RECURSIVE_DEFINITION','HIERARCHY_DEPTH','EXPANSION_LIMIT','NATIVE_CONSTRUCTION_ERROR','INVALID_EXPERIMENT','UNSUPPORTED_EXPERIMENT','INVALID_FACTOR','INVALID_SELECTION','STRUCTURAL_INCOMPATIBILITY']);
      const detail = failure.error;
      if(!allowed.has(detail.code as string) || (detail.message as string).length>1024) throw new ApiError('RUNNER_PROTOCOL_ERROR','Unknown runner error',502);
      const status = detail.code==='LIMIT_EXCEEDED' ? 422 : ['INTERNAL_ERROR','SERIALIZATION_ERROR'].includes(detail.code as string) ? 502 : 422;
      const engine = Number.isInteger(detail.engineCategory) && Number.isInteger(detail.engineCode) ? { engineCategory:Number(detail.engineCategory),engineCode:Number(detail.engineCode) } : undefined;
      throw new ApiError(detail.code as string,detail.message as string,status,engine,detail.diagnostics);
    }
    return effective.schemaVersion === 3 ? parseWrapperResult(value,effective) : parseResult(value,effective);
  }
  async close(): Promise<void> {
    this.closed=true;
    for(const child of this.children) child.kill('SIGKILL');
    await Promise.allSettled(this.pending);
  }
}
