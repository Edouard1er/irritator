import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { catalog, validateRequest } from '@contracts';
import { Inspector } from '@/components/panels/inspector';
import { defaultParameters, deserializeModel, serializeModel } from '@/lib/modeling/model';
import { saveWorkspace, loadWorkspace } from '@/lib/serialization/workspace';
import grouped from '../../../examples/decision-grouped-schaefer-v3.json';
import uncertainty from '../../../examples/tstar-schaefer-uncertainty-v3.json';

it('8G exposes all reductions and explicit validation in the ordinary inspector', () => {
  const spec = catalog.components.find(c => c.type === 'group_aggregate')!, onParameter = vi.fn();
  render(<Inspector component={{ id: 'group', type: spec.type, parameters: defaultParameters(spec) }} spec={spec} onParameter={onParameter} onRename={() => undefined} onObserve={() => {}} onDelete={() => {}} onDeleteEdge={() => {}} />);
  expect(screen.getByLabelText('operation').querySelectorAll('option')).toHaveLength(7);
  for (const [label, value] of [['operation', 6], ['validation', 1], ['endCount', 0]] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
    expect(onParameter).toHaveBeenLastCalledWith(label, value);
  }
  expect(spec.inputs.map(p => p.name)).toEqual(['key', 'action', 'value', 'valid', 'weight', 'end', 'seal', 'reset']);
  expect(screen.getByText(/Une moyenne descriptive/)).toBeInTheDocument();
});
it('8G roundtrips coupled groups and controlled-action wiring through scientific JSON and workspace', () => {
  for (const example of [grouped, uncertainty]) {
    const m = structuredClone(example); validateRequest(m);
    const state = deserializeModel(m);
    expect(serializeModel(state)).toEqual(m);
    expect(serializeModel(loadWorkspace(saveWorkspace(state)))).toEqual(m);
  }
});
