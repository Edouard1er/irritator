import { expect, it } from 'vitest';
import { validateRequest, type RunRequest } from '@contracts';
import example from '../../../examples/wrapper-schaefer-v3.json';
import reference from '../../../model-test/modelhalieutiquetest.json';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { rootScope } from '@/lib/modeling/hierarchy';
import { prospectiveAtoms, scenarioCount, updateExperiment, wrapperSpec } from '@/lib/modeling/wrapper';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
const document = (): RunRequest => { const r=structuredClone(example); validateRequest(r); return r; };
const experiment = (r: RunRequest) => r.model.components.find(c => c.experiment)!.experiment!;
it('7G preserves the 15 reference atoms, 18 edges and exact InvK through scientific and workspace roundtrips', () => {
  const r=document(); validateRequest(r);
  expect(r.model.definitions![0]!.components).toEqual(reference.model.components);
  expect(r.model.definitions![0]!.connections).toEqual(reference.model.connections);
  expect(serializeModel(deserializeModel(r))).toEqual(r);
  expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(r))))).toEqual(r);
  expect(prospectiveAtoms(r,'Schaefer')).toHaveLength(15);
  expect(wrapperSpec(experiment(r)).inputs).toHaveLength(3); expect(wrapperSpec(experiment(r)).outputs).toHaveLength(3);
});
it('7G edits effort through the editor model while retaining the reference and connections', () => {
  const r=document(),e=experiment(r);
  const next=updateExperiment(r,rootScope,'decision',{...e,factors:[{id:'effort',type:'fixed',values:[200,260,320],target:'E',parameter:'value'}]});
  validateRequest(next); expect(scenarioCount(experiment(next))).toBe(3);
  expect(next.model.connections).toEqual(r.model.connections); expect(next.model.definitions).toEqual(r.model.definitions);
  expect(experiment(r).factors[0]).toMatchObject({type:'single',value:260});
});
it.each(['simple','weighted-sum','epsilon-constrained'] as const)('7G persists %s for independent Schaefer wrappers', method => {
  const r=document(),left=r.model.components.find(c=>c.experiment)!;
  left.experiment!.factors[0]={id:'effort',target:'E',parameter:'value',type:'fixed',values:[200,260]};
  const right=structuredClone(left); right.id='right'; right.experiment!.factors[0]={id:'effort',target:'E',parameter:'value',type:'fixed',values:[260,320]};
  r.model.components.push(right);
  for(const c of [left,right]) c.experiment!.objective=method==='simple'?{method,type:'maximize',primary:'N'}:method==='weighted-sum'?{method,type:'maximize',weights:[2,1],types:['maximize','minimize'],norm:'z-score'}:{method,type:'maximize',primary:'C',epsilons:[125,0],operations:['greater-equal','greater-equal']};
  validateRequest(r); const restored=serializeModel(loadWorkspace(saveWorkspace(deserializeModel(r))));
  expect(restored).toEqual(r);
  const changed=updateExperiment(restored,rootScope,'decision',{...experiment(restored),factors:[{id:'effort',target:'E',parameter:'value',type:'fixed',values:[200,230,260]}]});
  expect(changed.model.components.find(c=>c.id==='right')!.experiment!.factors[0]).toMatchObject({values:[260,320]});
  expect(changed.model.definitions).toEqual(r.model.definitions);
});
