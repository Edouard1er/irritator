import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { validateRequest, wrapperOutputs, type RunRequest } from '@contracts';
import { WrapperInspector } from '@/components/panels/wrapper-inspector';
import { wrapperSpec, updateExperiment } from '@/lib/modeling/wrapper';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import minimal from '../../../examples/decision-fault-tolerant-minimal-v3.json';
import schaefer from '../../../examples/tstar-schaefer-execution-safety-v3.json';
describe('8J native execution contract in the ordinary editor',()=>{
  it('preserves both graphs and appended port identities through editing and JSON roundtrip',()=>{
    for(const input of [minimal,schaefer]){
      const m=structuredClone(input) as unknown as RunRequest;validateRequest(m);
      const c=m.model.components.find(c=>c.id==='forecast')!,e=c.experiment!;
      const ports=wrapperOutputs(e);expect(ports.slice(-5).map(p=>p.kind)).toEqual(['scenario-outcome','scenario-run-calls','scenario-horizon','campaign-run-calls','campaign-end-total']);
      const next=updateExperiment(m,'$root','forecast',{...e,execution:{failurePolicy:'fail-fast',resultMode:'collect',maxChildRunCalls:10,maxCampaignRunCalls:20}});
      validateRequest(JSON.parse(JSON.stringify(next)));expect(next.model.connections).toEqual(m.model.connections);
      expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(next))))).toEqual(next);
    }
  });
  it('edits failure policy, result mode and independent child budgets in the inspector',()=>{
    const request=structuredClone(minimal) as unknown as RunRequest,c=request.model.components.find(c=>c.id==='forecast')!,edit=vi.fn();
    render(<WrapperInspector component={c} request={request} spec={wrapperSpec(c.experiment)} onExperiment={edit} onRename={()=>undefined} onDelete={()=>{}} onOpen={()=>{}} />);
    fireEvent.change(screen.getByLabelText('Gestion des échecs'),{target:{value:'fail-fast'}});
    expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({execution:expect.objectContaining({failurePolicy:'fail-fast'})}),undefined);
    fireEvent.change(screen.getByLabelText('Restitution'),{target:{value:'collect'}});
    expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({execution:expect.objectContaining({resultMode:'collect'})}),undefined);
    fireEvent.change(screen.getByLabelText('maxChildRunCalls'),{target:{value:'12'}});
    expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({execution:expect.objectContaining({maxChildRunCalls:12})}),undefined);
    fireEvent.change(screen.getByLabelText('maxCampaignRunCalls'),{target:{value:'30'}});
    expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({execution:expect.objectContaining({maxCampaignRunCalls:30})}),undefined);
  });
  it('rejects execution control in partial run modes and negative budgets',()=>{
    for(const change of [(e:any)=>e.run='bag',(e:any)=>e.scenarioResults=false,(e:any)=>e.execution.maxChildRunCalls=-1]){
      const m=structuredClone(minimal) as unknown as RunRequest;change(m.model.components.find(c=>c.id==='forecast')!.experiment);expect(()=>validateRequest(m)).toThrow();
    }
  });
});

