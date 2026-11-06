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
it('exposes generic decision primitives with editable native defaults', () => {
  const onAdd = vi.fn(); render(<ComponentLibrary catalog={catalog} onAdd={onAdd} onRetry={() => {}} />);
  for (const type of ['generator', 'event_tag', 'value_memory', 'event_operator', 'candidate_filter', 'candidate_select']) {
    fireEvent.click(screen.getByRole('button', { name: `Ajouter ${type}` }));
    const spec = catalog.components.find(c => c.type === type)!;
    expect(onAdd).toHaveBeenLastCalledWith(spec);
    expect(Object.keys(defaultParameters(spec))).toEqual(spec.required);
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
  for (const example of [memory, reuse, prospective]) {
    const r = structuredClone(example); validateRequest(r);
    const state = deserializeModel(r);
    expect(serializeModel(state)).toEqual(r);
    const restored = loadWorkspace(saveWorkspace(state));
    expect(serializeModel(restored)).toEqual(r);
  }
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
