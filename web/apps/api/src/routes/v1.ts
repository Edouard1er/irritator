import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ApiError, catalog, runnerCapabilities, validateRequest, type RunRequest } from '../../../../packages/contracts/index.js';
import type { Engine } from '../services/engine.js';

export function routes(app: FastifyInstance, engine: Engine): void {
  app.get('/api/v1/health',async(request,reply)=> {
    // A successful launch and exact catalogue handshake, not an existence check.
    try {
      const capabilities = await engine.capabilities?.();
      const description = capabilities ? catalog : await engine.describe();
      return { status:'ok',backend:'fastify',nodeVersion:process.version,runner:{available:true,adapterVersion:description.adapterVersion,engineVersion:description.engineVersion,...(capabilities ? {capabilities} : {})},schemaVersion:1 };
    } catch(error) {
      if(!(error instanceof ApiError)) throw error;
      return reply.code(error.httpStatus).send({schemaVersion:1,status:'failed',backend:'fastify',nodeVersion:process.version,runner:{available:false},error:{code:error.code,message:error.message},requestId:request.id});
    }
  });
  app.get('/api/v1/components',async()=>engine.describe());
  app.post<{ Body: RunRequest }>('/api/v1/simulations/run',async(request,reply)=>{
    validateRequest(request.body);
    const controller=new AbortController();
    const abort=()=>controller.abort();
    const close=()=>{if(!reply.raw.writableEnded) controller.abort();};
    request.raw.once('aborted',abort); reply.raw.once('close',close);
    try {
      const result = await engine.run(request.body,controller.signal);
      const response = { ...result,runId:randomUUID() };
      if (result.schemaVersion === 2 && result.scenarioTrajectories && Buffer.byteLength(JSON.stringify(response), 'utf8') > runnerCapabilities.wrapper.trajectoryObservations.maxResponseBytes)
        throw new ApiError('LIMIT_EXCEEDED','HTTP trajectory response exceeds 4 MiB including runId',422);
      return response;
    } finally {
      request.raw.removeListener('aborted',abort); reply.raw.removeListener('close',close);
    }
  });
}
