import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { catalog, parseWrapperResult, validateRequest, wrapperOutputs, type RunRequest, type RunResultV2, type WrapperEvent } from '@contracts';
import { WrapperInspector } from '@/components/panels/wrapper-inspector';
import { IrritatorNodeView } from '@/components/nodes/irritator-node';
import { deserializeModel, serializeModel, defaultParameters } from '@/lib/modeling/model';
import { updateExperiment, wrapperSpec } from '@/lib/modeling/wrapper';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import { scopeView } from '@/lib/modeling/hierarchy';
import minimal from '../../../examples/decision-dynamic-plan-minimal-v3.json';
import schaefer from '../../../examples/tstar-schaefer-dynamic-plan-v3.json';

const request = () => structuredClone(minimal) as RunRequest;
const experiment = (r: RunRequest) => r.model.components.find(c => c.experiment)!.experiment!;

it('8H imports both generic native graphs, including the dynamic contract and event_tag defaults', () => {
  for (const graph of [minimal, schaefer]) {
    validateRequest(graph);
    expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(graph))))).toEqual(graph);
  }
  const tag = catalog.components.find(c => c.type === 'event_tag')!;
  expect(defaultParameters(tag).preserveCampaign).toBe(0);
  const old = request(); old.model.components.push({ id: 'legacyTag', type: 'event_tag', parameters: { identity: 0, campaign: 1 } });
  expect(() => validateRequest(old)).not.toThrow();
});

it('8H leaves space for the actual port rows of planning cards and preserves saved positions', () => {
  const r = request(), state = deserializeModel(r), d = r.model.definitions!.find(d => d.id === 'BuildPlan')!;
  const view = scopeView(state, 'BuildPlan');
  for (let i = 0; i + 2 < d.components.length; ++i) {
    const c = d.components[i]!, next = d.components[i + 2]!, spec = catalog.components.find(s => s.type === c.type)!;
    expect(view.positions[next.id]!.y - view.positions[c.id]!.y).toBeGreaterThanOrEqual(100 + 25 * Math.max(spec.inputs.length, spec.outputs.length));
  }
  state.scopes = { BuildPlan: { positions: { less: { x: 900, y: -100 } }, viewport: { x: 0, y: 0, zoom: 1 } } };
  expect(scopeView(state, 'BuildPlan').positions.less).toEqual({ x: 900, y: -100 });
});

it('8H renders a legacy event_tag without an optional campaign flag as valid', () => {
  const spec = catalog.components.find(s => s.type === 'event_tag')!;
  const props = { id: 'tag', data: { component: { id: 'tag', type: spec.type, parameters: { identity: 0, campaign: 1 } }, spec, observed: false }, selected: false } as unknown as Parameters<typeof IrritatorNodeView>[0];
  render(<ReactFlowProvider><IrritatorNodeView {...props} /></ReactFlowProvider>);
  expect(screen.getByTestId('node-tag')).not.toHaveClass('has-error');
});

it('8H appends plan interfaces and preserves connected plan/factor identities on reordering', () => {
  const r = request(), e = experiment(r);
  expect(wrapperSpec(e).inputs.map(p => p.name)).toEqual(['init', 'run', 'initial', 'control', 'plan']);
  expect(wrapperOutputs(e).map(p => p.kind)).toEqual(['selection', 'factor', 'factor', 'scenario-status', 'scenario-factor', 'scenario-factor', 'scenario-selection', 'campaign-end', 'plan-ready']);
  const next = updateExperiment(r, '$root', 'forecast', { ...e, factors: [...e.factors].reverse() });
  validateRequest(next);
  expect(next.model.connections.find(c => c.from.component === 'observer' && c.from.port === 2)!.to.port).toBe(2);
  expect(next.model.connections.find(c => c.from.component === 'observer' && c.from.port === 3)!.to.port).toBe(4);
  expect(next.model.connections.find(c => c.from.component === 'forecast' && c.from.port === 8)!.to.port).toBe(2);
  expect(() => updateExperiment(r, '$root', 'forecast', { ...e, dynamicPlan: false })).toThrow(/connecté/);
});

it('8H charges every native output collector even when all wrapper outputs are disconnected', () => {
  const r = request();
  r.model.definitions = r.model.definitions!.filter(d => d.id === 'LinearProspect');
  r.model.components = r.model.components.filter(c => c.type === 'simulation_wrapper');
  r.model.connections = []; r.model.observations = [];
  // Two prospective atoms/one edge, three children, and nine output collectors.
  // The wrapper and two native template copies also occupy their declared budget.
  r.limits = { maxTotalModels: 22, maxTotalConnections: 15 };
  expect(() => validateRequest(r)).not.toThrow();
  expect(() => validateRequest({ ...r, limits: { ...r.limits, maxTotalModels: 21 } })).toThrow(/Cumulative prospective/);
  expect(() => validateRequest({ ...r, limits: { ...r.limits, maxTotalConnections: 14 } })).toThrow(/Cumulative prospective/);
});

it.each([
  (e: ReturnType<typeof experiment>) => { e.run = 'bag'; },
  (e: ReturnType<typeof experiment>) => { e.scenarioResults = false; },
  (e: ReturnType<typeof experiment>) => { e.requiredInputs = []; },
  (e: ReturnType<typeof experiment>) => { e.requiredInputs = ['initial', 'control']; },
  (e: ReturnType<typeof experiment>) => { e.factors[1] = { ...e.factors[1]!, type: 'fixed-add', values: [-1, 0] }; },
])('8H rejects a dynamic configuration outside the supported direct transaction contract', change => {
  const r = request(); r.model.connections = r.model.connections.filter(c => c.from.component !== 'forecast'); change(experiment(r)); expect(() => validateRequest(r)).toThrow(/Dynamic plans|Required inputs/);
});

it('8H enables the native transaction in the inspector and documents its scalar transport', () => {
  const r = request(), e = experiment(r), edit = vi.fn(); e.dynamicPlan = false;
  const view = render(<WrapperInspector component={r.model.components.find(c => c.experiment)!} request={r} spec={wrapperSpec(e)} onExperiment={edit} onRename={() => undefined} onDelete={() => {}} onOpen={() => {}} />);
  fireEvent.click(screen.getByLabelText('Recevoir un plan dynamique par campagne'));
  expect(edit).toHaveBeenCalledWith(expect.objectContaining({ dynamicPlan: true, run: 'complete', scenarioResults: true, requiredInputs: ['initial'] }), undefined);
  e.dynamicPlan = true;
  view.rerender(<WrapperInspector component={r.model.components.find(c => c.experiment)!} request={r} spec={wrapperSpec(e)} onExperiment={edit} onRename={() => undefined} onDelete={() => {}} onOpen={() => {}} />);
  expect(screen.getByText(/Entrée plan x\[4\]/)).toBeVisible();
  expect(screen.getByText(/produit des domaines reçus/)).toBeVisible();
});

// Synthetic protocol fixtures only; Playwright compares actual HTTP and C++ output.
function resultFixture(): RunResultV2 {
  const r = request(), e = experiment(r), events: WrapperEvent[] = [];
  const emit = (port: number, value: [number, number, number], time: number) => events.push({ component: 'forecast', port, value, time, bag: events.length + 1 });
  for (const [campaign, count] of [[1, 3], [2, 2]]) {
    emit(8, [count!, campaign!, campaign!], campaign!);
    for (let id = 0; id < count!; ++id) {
      emit(3, [1, id, campaign!], campaign!);
      emit(4, [campaign === 1 ? -1 : 1, id, campaign!], campaign!);
      emit(5, [id - 1, id, campaign!], campaign!);
      emit(6, [id, id, campaign!], campaign!);
    }
    emit(7, [count!, count!, campaign!], campaign!);
  }
  return { schemaVersion: 2, status: 'completed', modelId: r.model.id, simulation: { ...r.simulation, finalTime: r.simulation.end, runCalls: 100 },
    observations: r.model.observations.map(o => ({ ...o, samples: [{ time: 0, value: 0 }] })), diagnostics: { engineVersion: catalog.engineVersion, adapterVersion: catalog.adapterVersion, observationPolicy: 'engine-resampled-sealed-deduplicated' },
    wrappers: [{ component: 'forecast', inputs: 5, scenarioCount: 3, criteriaScale: 'raw', outputs: wrapperOutputs(e) }], resultEvents: events };
}

it('8H keeps the declared capacity and accepts two complete campaigns of actual cardinalities 3 then 2', () => {
  const result = resultFixture(); expect(parseWrapperResult(result, request())).toBe(result);
  expect(result.wrappers[0]!.scenarioCount).toBe(3);
});

it.each([
  (r: RunResultV2) => { r.resultEvents.find(e => e.port === 7 && e.value[2] === 2)!.value[1] = 3; },
  (r: RunResultV2) => { r.resultEvents = r.resultEvents.filter(e => !(e.port === 6 && e.value[1] === 1 && e.value[2] === 2)); },
  (r: RunResultV2) => { r.resultEvents.find(e => e.port === 3 && e.value[2] === 2)!.value[1] = 2; },
  (r: RunResultV2) => { r.resultEvents.find(e => e.port === 3 && e.value[2] === 2)!.value[0] = 0; },
  (r: RunResultV2) => { r.resultEvents.find(e => e.port === 8)!.value[0] = 4; },
  (r: RunResultV2) => { r.resultEvents.find(e => e.port === 8)!.value[1] = 0; },
  (r: RunResultV2) => { r.resultEvents[1]!.port = 8; r.resultEvents[1]!.value = [3, 1, 1]; },
  (r: RunResultV2) => { r.resultEvents[2]!.port = r.resultEvents[1]!.port; },
])('8H rejects missing, duplicate, invalid, ambiguous or inconsistent actual result frames', corrupt => {
  const result = resultFixture(); corrupt(result); expect(() => parseWrapperResult(result, request())).toThrow(/Invalid wrapper result/);
});
