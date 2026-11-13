import { validateRequest, type RunRequest } from '@contracts';
import type { HttpResult } from '@/lib/api/client';
import example from '../../../examples/test-8o-schaefer-six-trajectories-v3.json';
export function workshopFixture(): { result: HttpResult; request: RunRequest } {
  const request = structuredClone(example); validateRequest(request);
  const result: HttpResult = { schemaVersion: 2, runId: 'real-run-test', status: 'completed', modelId: request.model.id,
    simulation: { start: 0, end: 3, finalTime: 3, runCalls: 10 }, observations: [], resultEvents: [], wrappers: [],
    diagnostics: { engineVersion: 'test-engine', adapterVersion: 'test-adapter', observationPolicy: 'native' },
    scenarioTrajectories: [0, 1].map(scenarioId => ({ wrapperId: 'prospectives', campaignId: 1, scenarioId, status: 'completed', factors: { effort: scenarioId ? 200 : 80 }, start: 0, horizonRequested: 20, horizonApplied: 20,
      observations: [{ component: 'N', samplingInterval: 1, samples: [220, 210, 166, 139, 130].map((value, time) => ({ time, value: value + scenarioId * 100 })) }, { component: 'C', samplingInterval: 1, samples: [0, 10, 20, 30, 40].map((value, time) => ({ time, value })) }] })),
  };
  return { result, request };
}
