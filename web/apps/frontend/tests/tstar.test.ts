import { expect, it } from 'vitest';
import { validateRequest, type RunRequest } from '@contracts';
import example from '../../../examples/tstar-schaefer-three-coupled-v3.json';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import { prospectiveAtoms, wrapperSpec } from '@/lib/modeling/wrapper';
const document = (): RunRequest => { const r = structuredClone(example); validateRequest(r); return r; };

it('8F preserves the complete editable three-role graph and its reset wiring through both formats', () => {
  const m = document();
  expect(serializeModel(deserializeModel(m))).toEqual(m);
  expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(m))))).toEqual(m);
  expect(m.model.definitions!.find(d => d.id === 'ObserverDecision')!.inputs.map(p => p.name)).toEqual(['trigger', 'N', 'C', 'Nmin', 'CH', 'C0', 'E', 'end', 'reset']);
  expect(prospectiveAtoms(m, 'SchaeferProspect')).toHaveLength(15);
  const plan = m.model.components.find(c => c.experiment)!.experiment!;
  expect(plan.requiredInputs).toEqual(['initialN', 'initialC']);
  expect(wrapperSpec(plan).outputs).toHaveLength(12);
});
