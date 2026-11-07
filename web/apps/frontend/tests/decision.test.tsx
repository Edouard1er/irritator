import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { catalog, validateRequest, wrapperOutputs, type RunRequest } from '@contracts';
import { ComponentLibrary } from '@/components/panels/component-library';
import { Inspector } from '@/components/panels/inspector';
import { deserializeModel, serializeModel, defaultParameters } from '@/lib/modeling/model';
import { updateExperiment, wrapperSpec } from '@/lib/modeling/wrapper';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import memory from '../../../examples/decision-memory.json';
import reuse from '../../../examples/decision-reuse.json';
import prospective from '../../../examples/decision-prospective.json';
import schaeferExternal from '../../../examples/decision-schaefer-external-v3.json';
import aggregation8c from '../../../examples/decision-8c-aggregation-v3.json';
import normalization8c from '../../../examples/decision-8c-normalization-v3.json';
import fallback8c from '../../../examples/decision-8c-fallback-v3.json';
import schaefer8c from '../../../examples/decision-8c-schaefer-v3.json';
import feedback8d from '../../../examples/decision-feedback-minimal-v3.json';
it('exposes generic decision primitives with editable native defaults', () => {
  const onAdd = vi.fn(); render(<ComponentLibrary catalog={catalog} onAdd={onAdd} onRetry={() => {}} />);
  for (const type of ['generator', 'event_tag', 'value_memory', 'event_operator', 'candidate_filter', 'candidate_select', 'campaign_aggregate', 'campaign_broadcast', 'selection_priority', 'state_observer', 'zero_order_hold']) {
    fireEvent.click(screen.getByRole('button', { name: `Ajouter ${type}` }));
    const spec = catalog.components.find(c => c.type === type)!;
    expect(onAdd).toHaveBeenLastCalledWith(spec);
    expect(Object.keys(defaultParameters(spec))).toEqual(Object.keys(spec.parameters));
  }
});
it('configures comparison operations and fallback in the standard inspector', () => {
  const spec = catalog.components.find(c => c.type === 'event_operator')!, onParameter = vi.fn();
  render(<Inspector component={{ id: 'comparison', type: spec.type, parameters: defaultParameters(spec) }} spec={spec} onParameter={onParameter} onRename={() => undefined} onObserve={() => {}} onDelete={() => {}} onDeleteEdge={() => {}} />);
  fireEvent.change(screen.getByLabelText('operation'), { target: { value: '7' } });
  expect(onParameter).toHaveBeenCalledWith('operation', 7);
  expect(screen.getByText(/Joint les valeurs par identité/)).toBeInTheDocument();
});
it('roundtrips scientific JSON and graphical workspace with generic hierarchical decisions', () => {
  for (const example of [memory, reuse, prospective, schaeferExternal, aggregation8c, normalization8c, fallback8c, schaefer8c, feedback8d]) {
    const r = structuredClone(example); validateRequest(r);
    const state = deserializeModel(r);
    expect(serializeModel(state)).toEqual(r);
    const restored = loadWorkspace(saveWorkspace(state));
    expect(serializeModel(restored)).toEqual(r);
  }
});
it('edits campaign reductions and branch priorities through standard metadata', () => {
  for (const [type, key, value] of [['campaign_aggregate', 'operation', 3], ['selection_priority', 'primaryPriority', 2], ['candidate_select', 'requireSecondary', 1]] as const) {
    const spec = catalog.components.find(c => c.type === type)!, onParameter = vi.fn();
    const view = render(<Inspector component={{ id: type, type, parameters: defaultParameters(spec) }} spec={spec} onParameter={onParameter} onRename={() => undefined} onObserve={() => {}} onDelete={() => {}} onDeleteEdge={() => {}} />);
    const input = screen.getByLabelText(key);
    fireEvent.change(input, { target: { value: String(value) } }); fireEvent.blur(input);
    expect(onParameter).toHaveBeenCalledWith(key, value); view.unmount();
  }
});
it('offers an optional backward-compatible empty-campaign action mode in the inspector', () => {
  const spec=catalog.components.find(c=>c.type==='candidate_select')!, onParameter=vi.fn();
  const parameters=defaultParameters(spec); delete parameters.emitFallback;
  render(<Inspector component={{id:'select',type:spec.type,parameters}} spec={spec} onParameter={onParameter} onRename={()=>undefined} onObserve={()=>{}} onDelete={()=>{}} onDeleteEdge={()=>{}} />);
  expect(screen.getByLabelText('emitFallback')).toHaveValue('1');
  fireEvent.change(screen.getByLabelText('emitFallback'),{target:{value:'0'}});
  expect(onParameter).toHaveBeenCalledWith('emitFallback',0);
});
it('adds scenario ports and preserves connected identities on factor/criterion edits', () => {
  const r = structuredClone(prospective); validateRequest(r); const e = r.model.components[1]!.experiment!;
  expect(wrapperSpec(e).outputs).toHaveLength(8);
  expect(wrapperOutputs(e).at(-1)?.kind).toBe('campaign-end');
  const next = { ...e, selections: [...e.selections].reverse() };
  const changed = updateExperiment(r, '$root', 'decision', next);
  expect(changed.model.connections.find(c => c.to.component === 'score' && c.to.port === 0)?.from.port).toBe(6);
  expect(() => updateExperiment(r, '$root', 'decision', { ...e, scenarioResults: false })).toThrow(/connecté/);
});
