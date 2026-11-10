import { expect, it } from 'vitest';
import { validateRequest, type RunRequest } from '@contracts';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { saveWorkspace, loadWorkspace } from '@/lib/serialization/workspace';
import minimal from '../../../examples/decision-forecast-validation-minimal-v3.json';
import diagnostic from '../../../examples/decision-forecast-comparison-v3.json';
import schaefer from '../../../examples/tstar-schaefer-forecast-validation-v3.json';

it('8M preserves identified event observations and every native evaluation parameter through workspace roundtrip', () => {
  for (const graph of [minimal, diagnostic, schaefer]) {
    const request = structuredClone(graph) as unknown as RunRequest; validateRequest(request);
    const restored = loadWorkspace(saveWorkspace(deserializeModel(request)));
    expect(serializeModel(restored)).toEqual(request);
  }
});
it('8M rejects an event observation of an unknown port or a continuous QSS state', () => {
  const request = structuredClone(minimal) as unknown as RunRequest;
  request.model.observations[0]!.eventPorts = [0];
  expect(() => validateRequest(request)).toThrow(/event observation/);
  const second = structuredClone(minimal) as unknown as RunRequest;
  second.model.observations.find(o => o.component === 'M2Xpair')!.eventPorts = [20];
  expect(() => validateRequest(second)).toThrow(/event observation/);
});
