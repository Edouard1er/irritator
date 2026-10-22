import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunRequest } from '../../../packages/contracts/index.js';

export const example = (name: string): RunRequest => JSON.parse(readFileSync(resolve(`examples/${name}.json`), 'utf8'));
export const wrapperAffine = () => example('wrapper-affine-v3');
export const experiment = (m: RunRequest) => m.model.components.find(c => c.type === 'simulation_wrapper')!.experiment!;
export const edge = (a: string, ap: number, b: string, bp: number) => ({ from: { component: a, port: ap }, to: { component: b, port: bp } });
const constant = (id: string, value: number, offset: number) => ({ id, type: 'constant', parameters: { value, offset } });
export function wrapperCoupled(): RunRequest {
  const m = wrapperAffine(), system = m.model.definitions![0]!;
  system.id = 'System'; system.outputs = [{ port: 0, name: 'state' }]; system.connections.push(edge('X', 0, '$output', 0));
  m.model.definitions!.push({ id: 'Prospectif', name: 'Coupled prospective', inputs: [], outputs: [], components: [{ id: 'system', type: 'coupled', definition: 'System', parameters: {} }, { id: 'monitor', type: 'qss1_sum_2', parameters: {} }], connections: [edge('system', 0, 'monitor', 0)] });
  experiment(m).factors[0]!.target = 'system/u';
  for (const s of experiment(m).selections) s.target = 'system/X';
  return m;
}
export function wrapperPair(reset = false): RunRequest {
  const m = wrapperCoupled(), wrapper = m.model.components.find(c => c.type === 'simulation_wrapper')!;
  m.model.definitions!.push({ id: 'Cell', name: 'Shared wrapper', inputs: [0, 1, 2].map(port => ({ port, name: `in${port}` })), outputs: [0, 1, 2].map(port => ({ port, name: `out${port}` })), components: [wrapper], connections: [...[0, 1, 2].map(p => edge('$input', p, 'decision', p)), ...[0, 1, 2].map(p => edge('decision', p, '$output', p))] });
  m.model.components = [constant('leftRun', 1, 1), constant('rightRun', .5, 1.5), { id: 'left', type: 'coupled', definition: 'Cell', parameters: {} }, { id: 'right', type: 'coupled', definition: 'Cell', parameters: {}, experimentOverrides: [{ target: 'decision', factors: [{ id: 'rate', type: 'fixed', values: [-2, 2] }] }] }];
  m.model.connections = [edge('leftRun', 0, 'left', 1), edge('rightRun', 0, 'right', 1)]; m.model.observations = []; m.simulation.end = 4;
  if (reset) for (const [id, value, offset, port] of [['factor', -2, 2.25, 2], ['init', 0, 2.5, 0], ['again', 0, 2.75, 1]] as const) {
    m.model.components.push(constant(id, value, offset)); m.model.connections.push(edge(id, 0, 'left', port));
  }
  return m;
}
// A legal DEVS zero-time loop inside the prospective graph. Parent maxRunCalls
// cannot stop it: these tests require the process deadline/disconnection guard.
export function wrapperBusy(): RunRequest {
  const m = wrapperAffine(), d = m.model.definitions![0]!;
  d.components.push({ id: 'spin1', type: 'qss1_sum_2', parameters: {} }, { id: 'spin2', type: 'qss1_sum_2', parameters: {} });
  d.connections.push(edge('u', 0, 'spin1', 0), edge('spin1', 0, 'spin2', 0), edge('spin2', 0, 'spin1', 0));
  m.limits = { maxRunCalls: 10 };
  return m;
}
