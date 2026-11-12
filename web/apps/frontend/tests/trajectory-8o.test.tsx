import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { validateRequest, type RunRequest, type ScenarioTrajectory, type WrapperExperiment } from '@contracts';
import raw from '../../../examples/test-8o-schaefer-six-trajectories-v3.json';
import { WrapperInspector } from '@/components/panels/wrapper-inspector';
import { WrapperTrajectories } from '@/components/panels/wrapper-trajectories';
import { renameExperimentPaths, updateExperiment, wrapperSpec, assertCanRemove } from '@/lib/modeling/wrapper';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import { scenarioTrajectoryCsv } from '@/lib/serialization/csv';
vi.mock('next/dynamic', () => ({ default: () => ({ observations, childClock }: { observations: unknown[]; childClock: boolean }) => <div data-testid="native-series" data-clock={String(childClock)}>{JSON.stringify(observations)}</div> }));
const fixture = () => structuredClone(raw) as unknown as RunRequest;
function Harness() {
  const [r,setR]=useState(fixture());const c=r.model.components.find(c=>c.experiment)!;
  return <WrapperInspector component={c} request={r} spec={wrapperSpec(c.experiment)} onRename={vi.fn()} onDelete={vi.fn()} onOpen={vi.fn()} onExperiment={(e:WrapperExperiment)=>{setR(updateExperiment(r,'$root',c.id,e));return undefined;}} />;
}
describe('8O prospective observations',()=>{
  it('selects N/C and arbitrary observable q independently from decision fields',()=>{
    render(<Harness />);const n=screen.getByLabelText('Observer prospectif N'),c=screen.getByLabelText('Observer prospectif C');
    expect(n).toBeChecked();expect(c).not.toBeChecked();fireEvent.click(c);expect(c).toBeChecked();fireEvent.click(n);expect(n).not.toBeChecked();fireEvent.click(screen.getByLabelText('Observer prospectif q'));expect(screen.getByLabelText('Observer prospectif q')).toBeChecked();
  });
  it('preserves trajectories through workspace/JSON, definition reorder and component rename',()=>{
    const r=fixture(),w=r.model.components.find(c=>c.experiment)!;w.experiment!.trajectoryObservations!.push({target:'q',samplingInterval:.1});
    const restored=serializeModel(loadWorkspace(saveWorkspace(deserializeModel(r))));expect(restored).toEqual(r);
    restored.model.definitions!.push({id:'Other',name:'Other',inputs:[],outputs:[],components:[{id:'value',type:'constant',parameters:{value:1,offset:0}}],connections:[]});
    restored.model.definitions!.reverse();validateRequest(restored);
    const edited=structuredClone(r);const d=edited.model.definitions![0]!;
    d.components.find(c=>c.id==='q')!.id='catchability';
    for(const edge of d.connections)for(const end of [edge.from,edge.to])if(end.component==='q')end.component='catchability';
    const next=renameExperimentPaths(r,edited,'Schaefer','q','catchability');
    expect(next.model.components.find(c=>c.experiment)!.experiment!.trajectoryObservations!.at(-1)!.target).toBe('catchability');validateRequest(next);
    expect(()=>assertCanRemove(r,'Schaefer',new Set(['q']))).toThrow();
  });
  it('rejects unsupported step, duplicate, missing target and prospective budget',()=>{
    for(const change of [(r:RunRequest)=>r.model.components.find(c=>c.experiment)!.experiment!.trajectoryObservations![0]!.samplingInterval=.2,(r:RunRequest)=>r.model.components.find(c=>c.experiment)!.experiment!.trajectoryObservations!.push({target:'N',samplingInterval:.1}),(r:RunRequest)=>r.model.components.find(c=>c.experiment)!.experiment!.trajectoryObservations![0]!.target='unknown',(r:RunRequest)=>r.limits={maxTrajectoryPoints:100}]){const r=fixture();change(r);expect(()=>validateRequest(r)).toThrow();}
  });
});
// Presentation-only unit fixture. Scientific trajectories are checked with the
// native runner/HTTP and Playwright, never with these illustrative UI values.
const rows = (): ScenarioTrajectory[] => [1,2].flatMap(campaignId=>Array.from({length:6},(_,scenarioId)=>({wrapperId:'prospectives',campaignId,scenarioId,status:'completed' as const,factors:{effort:[80,150,260][scenarioId%3]!,q:scenarioId<3?.0008:.001},start:0,horizonRequested:20,horizonApplied:20,observations:['N','C'].map(component=>({component,samplingInterval:.1,samples:[{time:0,value:150},{time:20,value:100+scenarioId}]}))})));
describe('8O comparison and long CSV',()=>{
  it('shows twelve series, filters variables/scenarios/campaign and retains local times',()=>{
    render(<WrapperTrajectories rows={rows()} />);expect(screen.getByText(/12 séries · 24 points/)).toBeVisible();expect(screen.getByTestId('native-series')).toHaveAttribute('data-clock','true');
    fireEvent.click(screen.getByLabelText('Afficher variable C'));expect(screen.getByText(/6 séries · 12 points/)).toBeVisible();
    fireEvent.click(screen.getByLabelText('Afficher scénario 0'));expect(screen.getByText(/5 séries · 10 points/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Campagne des trajectoires'),{target:{value:'2'}});expect(screen.getByText(/6 séries · 12 points/)).toBeVisible();
  });
  it('qualifies missing/partial series and handles no campaign',()=>{
    const r=rows().slice(0,1);r[0]!.status='budget-exceeded';r[0]!.horizonApplied=1;r[0]!.observations=[];
    const view=render(<WrapperTrajectories rows={r} />);expect(screen.getByText(/indisponible/)).toBeVisible();view.unmount();render(<WrapperTrajectories rows={[]} />);expect(screen.getByText('Aucune campagne enfant exécutée.')).toBeVisible();
  });
  it('exports every original point with arbitrary factor identities and status',()=>{
    const r=rows();r[0]!.factors['arbitrary-factor']=42;const csv=scenarioTrajectoryCsv(r);expect(csv.split('\r\n')).toHaveLength(50);expect(csv).toContain('""arbitrary-factor"":42');expect(csv).toContain('"prospectives",1,0,"completed"');expect(csv).toContain(',"N",20,100');
  });
});
