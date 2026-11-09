import { expect, it } from 'vitest';
import { validateRequest, wrapperOutputs, type RunRequest } from '@contracts';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import main from '../../../examples/tstar-schaefer-dynamic-uncertainty-v3.json';
import single from '../../../examples/tstar-schaefer-dynamic-uncertainty-single-v3.json';
import context from '../../../examples/tstar-schaefer-dynamic-uncertainty-context-v3.json';

it.each([main, single, context])('8I preserves nested native planning, aggregation and selection through both document formats', graph => {
  validateRequest(graph);
  const scientific = serializeModel(deserializeModel(graph));
  expect(scientific).toEqual(graph);
  expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(graph))))).toEqual(graph);
  const w = (graph as RunRequest).model.components.find(c => c.id === 'forecast')!.experiment!;
  expect(w.dynamicPlan).toBe(true); expect(w.requiredInputs).toEqual(['initialN', 'initialC']);
  expect(w.factors.filter(f => f.type === 'fixed').map(f => f.id)).toEqual(['effort', 'qHypothesis']);
  expect(wrapperOutputs(w).at(-1)).toMatchObject({ port: 14, kind: 'plan-ready' });
});

it('8I domain values, thresholds, horizon, reductions and both selector strategies remain editable data', () => {
  const graph = structuredClone(main) as RunRequest;
  const set = (definition: string, id: string, field: string, value: number) => {
    graph.model.definitions!.find(d => d.id === definition)!.components.find(c => c.id === id)!.parameters[field] = value;
  };
  set('BuildPlan', 'less', 'right', 145); set('BuildPlan', 'lowValue0', 'left', 90);
  set('BuildPlan', 'highContext0Value0', 'left', .0009); set('BuildPlan', 'highHorizon', 'left', 5);
  set('AggregateActions', 'minCH', 'operation', 1); set('EvaluateGroups', 'admissible', 'right', 135);
  set('ConditionalDecision', 'primary', 'direction', 1); set('ConditionalDecision', 'secondary', 'direction', 1);
  validateRequest(graph); expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(graph))))).toEqual(graph);
});
