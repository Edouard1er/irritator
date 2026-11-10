import Fastify, { type FastifyError } from 'fastify';
import { ApiError } from '../../../packages/contracts/index.js';
import { readConfig, type Config } from './config/index.js';
import { ProcessEngine, type Engine } from './services/engine.js';
import { routes } from './routes/v1.js';

export function buildApp(config: Config = readConfig(), engine: Engine = new ProcessEngine(config)) {
  const app=Fastify({logger:false,bodyLimit:config.bodyLimit,requestTimeout:config.timeoutMs+5000,
    ajv:{customOptions:{coerceTypes:false,removeAdditional:false,useDefaults:false,strictNumbers:true}}});
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ApiError) return reply.code(error.httpStatus).send({schemaVersion:1,status:'failed',error:{code:error.code,message:error.message,...error.engine,...(error.diagnostics ? {diagnostics:error.diagnostics} : {})},requestId:request.id});
    const err = error as FastifyError;
    const code = err.validation ? 'INVALID_MODEL' : err.code==='FST_ERR_CTP_BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : err.statusCode===400 ? 'INVALID_JSON' : 'INTERNAL_ERROR';
    const status = err.validation ? 400 : err.statusCode ?? 500;
    if(status>=500) request.log.error({err:error},'API error');
    const message=status<500 ? err.message : 'Backend internal failure';
    return reply.code(status).send({schemaVersion:1,status:'failed',error:{code,message},requestId:request.id});
  });
  routes(app,engine);
  app.addHook('onClose',async()=>engine.close());
  return app;
}
