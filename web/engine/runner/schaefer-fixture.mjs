// Test-only scientific fixtures. Production decisions remain in libirritator.
import { readFileSync } from 'node:fs';
export const reference = () => JSON.parse(readFileSync(new URL('../../model-test/modelhalieutiquetest.json', import.meta.url), 'utf8'));
export const schaefer = () => JSON.parse(readFileSync(new URL('../../examples/wrapper-schaefer-v3.json', import.meta.url), 'utf8'));
export const experiment = m => m.model.components.find(c => c.type === 'simulation_wrapper').experiment;
export function efforts(m, values) {
  experiment(m).factors[0] = { id: 'effort', target: 'E', parameter: 'value', type: 'fixed', values };
  return m;
}
export function flat(effort, version = 1) {
  const m = reference(); m.schemaVersion = version;
  m.model.components.find(c => c.id === 'E').parameters.value = effort;
  if (version === 2) m.model.definitions = [];
  return m;
}
export function pulse(m, id, time, value, port, target = 'decision') {
  m.model.components.push({ id, type: 'constant', parameters: { value, offset: time } });
  m.model.connections.push({ from: { component: id, port: 0 }, to: { component: target, port } });
}
export function pair(reset = false) {
  const m = efforts(schaefer(), [200, 260]);
  const right = structuredClone(m.model.components.find(c => c.id === 'decision'));
  right.id = 'right'; right.experiment.factors[0].values = [260, 320];
  m.model.components.push(right);
  m.model.connections.push({ from: { component: 'run', port: 0 }, to: { component: 'right', port: 1 } });
  if (reset) {
    pulse(m, 'changeLeft', 2, 320, 2);
    pulse(m, 'resetLeft', 2.1, 0, 0);
    pulse(m, 'rerunLeft', 2.2, 0, 1);
  }
  return m;
}
// Exact solution of N'=alpha*N-beta*N^2, C'=q*a*E*N.
// InvK deliberately retains the reference decimal, rather than 1/300.
export function analytic(effort, t) {
  const alpha = .35 - .001 * effort, beta = .35 * .003333;
  const integralExp = alpha === 0 ? t : Math.expm1(alpha * t) / alpha;
  const denominator = 1 + beta * 150 * integralExp;
  return { N: 150 * Math.exp(alpha * t) / denominator, C: .001 * effort * Math.log(denominator) / beta };
}
