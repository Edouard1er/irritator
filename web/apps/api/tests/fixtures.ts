import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunRequest, RunResult } from '../../../packages/contracts/index.js';

export const reference = (): RunRequest => JSON.parse(readFileSync(resolve('examples/sum3.json'),'utf8')) as RunRequest;
export const mockResult = (): RunResult => ({schemaVersion:1,status:'completed',modelId:'test-sum',simulation:{start:0,end:3,finalTime:3,runCalls:10},observations:[{component:'sum',samplingInterval:1,samples:[{time:0,value:10},{time:1,value:110},{time:2,value:1110}]}],diagnostics:{observationPolicy:'engine-resampled-sealed-deduplicated',engineVersion:'0.1.0',adapterVersion:'0.1.0'}});
export function affine(type: string, rate: number, start=0): RunRequest {
  return {schemaVersion:1,model:{id:`affine-${type}`,components:[{id:'rate',type:'constant',parameters:{value:rate,offset:0}},{id:'x',type,parameters:{X:5,dQ:0.25}}],connections:[{from:{component:'rate',port:0},to:{component:'x',port:0}}],observations:[{component:'x',samplingInterval:0.1}]},simulation:{start,end:start+3}};
}
