import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { nativeRequest, type RunRequest } from '../../../packages/contracts/index.js';
import { validateWorkshopSession, type WorkshopSessionV1 } from '../../../packages/contracts/workshop-session.js';
import example from '../../../examples/atelier-interventions-month-v3.json' with { type: 'json' };

test('D1/I/D2 research metadata never changes the real native graph or Irritator observations', { timeout: 60000 }, async () => {
  const request = structuredClone(example) as unknown as RunRequest; request.simulation.end = 2;
  const scientific = JSON.stringify(request), native = structuredClone(nativeRequest(request));
  const now = new Date().toISOString();
  const session: WorkshopSessionV1 = { kind: 'irritator.level2.workshop-session', version: 1, id: randomUUID(), title: 'Test fictif', locale: 'fr', protocolId: 'mbane-decision-before-after-v1', createdAt: now, updatedAt: now, records: [] };
  const app = buildApp(readConfig());
  const run = async () => { const response = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: request }); assert.equal(response.statusCode, 200, response.body); return response.json(); };
  try {
    const first = await run();
    const before = { status: 'answered' as const, choiceId: 'seek-information', confidence: 'medium' as const, sources: ['other-fisher' as const], recordedAt: now };
    session.records.push({ id: randomUUID(), participantCode: 'P-TEST', scenarioId: 'S1-captures', scenarioVersion: 1, activityIds: [], before,
      presentation: { kind: 'native-simulation', runId: first.runId, modelId: request.model.id, modelFingerprint: scientific, requestSchemaVersion: 3, presentedAt: now, assumptionsNote: 'Test du moteur réel, non calibré.' }, after: { ...before, choiceId: 'reduce-trips' } });
    validateWorkshopSession(session); validateWorkshopSession(JSON.parse(JSON.stringify(session)));
    assert.equal(JSON.stringify(request), scientific); assert.deepEqual(nativeRequest(request), native);
    const second = await run(); assert.notEqual(first.runId, second.runId);
    for (const key of ['observations', 'simulation', 'modelEvents', 'scenarios']) assert.deepEqual(second[key], first[key], key);
    const contaminated = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: { ...request, workshopSession: session } }); assert.equal(contaminated.statusCode, 400);
  } finally { await app.close(); }
});
