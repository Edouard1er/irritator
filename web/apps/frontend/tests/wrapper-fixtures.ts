import raw from '../../../examples/wrapper-affine-v3.json' with { type: 'json' };
import type { RunRequest, RunResultV2 } from '@contracts';

export const affine = (): RunRequest => structuredClone(raw) as unknown as RunRequest;
export const experiment = (r: RunRequest) => r.model.components.find(c => c.type === 'simulation_wrapper')!.experiment!;
export function pair(): RunRequest {
  const r = affine(), decision = structuredClone(r.model.components.find(c => c.experiment)!);
  r.model.definitions!.push({ id: 'Cell', name: 'Cellule expérimentale', inputs: [{ port: 0, name: 'run' }], outputs: [], components: [decision], connections: [{ from: { component: '$input', port: 0 }, to: { component: 'decision', port: 1 } }] });
  r.model.components = [{ id: 'run', type: 'constant', parameters: { value: 0, offset: 1 } }, { id: 'left', type: 'coupled', definition: 'Cell', parameters: {} }, { id: 'right', type: 'coupled', definition: 'Cell', parameters: {}, experimentOverrides: [{ target: 'decision', factors: [{ id: 'rate', type: 'fixed', values: [-2, 2] }] }] }];
  r.model.connections = ['left', 'right'].map(component => ({ from: { component: 'run', port: 0 }, to: { component, port: 0 } })); r.model.observations = []; return r;
}
// Unit-only fixture; browser/native oracles come from Fastify and the C++ runner.
export const resultFixture = (): RunResultV2 => ({
  schemaVersion: 2, status: 'completed', modelId: 'wrapper-affine', simulation: { start: 0, end: 3, finalTime: 3, runCalls: 6 },
  observations: ['terminal', 'minimum', 'rate'].map(component => ({ component, samplingInterval: .1, samples: [{ time: 0, value: 0 }] })),
  diagnostics: { engineVersion: '0.1.0', adapterVersion: '0.1.0', observationPolicy: 'engine-resampled-sealed-deduplicated' },
  wrappers: [{ component: 'decision', inputs: 3, scenarioCount: 3, outputs: [{ port: 0, id: 'terminal', kind: 'selection' }, { port: 1, id: 'minimum', kind: 'selection' }, { port: 2, id: 'rate', kind: 'factor' }] }],
  resultEvents: [{ component: 'decision', time: 1, port: 0, bag: 3, value: [3, 0, 0] }, { component: 'decision', time: 1, port: 1, bag: 3, value: [1, 0, 0] }, { component: 'decision', time: 1, port: 2, bag: 3, value: [1, 0, 0] }],
});
