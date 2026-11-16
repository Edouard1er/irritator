import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { applyTerritorialZone, nativeRequest, temporalScope, type RunRequest, type RunResult, type TerritoryGeography } from '../../../packages/contracts/index.js';
import example from '../../../examples/atelier-interventions-month-v3.json' with { type: 'json' };

test('territorial configuration -> existing temporal compiler -> real Irritator, single biomass and access applied once', { timeout: 60000 }, async () => {
  const app = buildApp(readConfig());
  try {
    for (const a of [0, .1, 1]) {
      const model = structuredClone(example) as unknown as RunRequest; model.simulation.end = 2;
      const geography: TerritoryGeography = { type: 'FeatureCollection', id: 'test-only', name: 'Fictitious test zone', source: 'Synthetic unit-test geometry', demonstration: true, features: [{ type: 'Feature', properties: { id: 'A', name: 'Fictitious A', role: 'zone', accessibility: a, provenance: 'Synthetic test value' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }] };
      const territorial = applyTerritorialZone(model, geography, 'A');
      const control = structuredClone(model); control.temporal!.parameters.a = a; temporalScope(control)!.components.find(c => c.id === 'a')!.parameters.value = a;
      assert.deepEqual(nativeRequest(territorial), nativeRequest(control)); assert.equal(nativeRequest(territorial).territory, undefined);
      const run = async (request: RunRequest) => {
        const response = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: request });
        assert.equal(response.statusCode, 200, response.body); const result = response.json() as RunResult;
        assert.equal(result.status, 'completed'); return result;
      };
      const result = await run(territorial), expected = await run(control);
      assert.deepEqual(result.observations, expected.observations);
      const n = result.observations.find(o => o.component === 'lake/N')!, c = result.observations.find(o => o.component === 'lake/C')!;
      assert.equal(n.samples[0]!.value, temporalScope(model)!.components.find(component => component.id === 'N')!.parameters.X);
      assert.equal(result.observations.filter(o => o.component.endsWith('/N')).length, 1);
      if (a === 0) assert.ok(c.samples.every(point => point.value === 0));
      else assert.ok(c.samples.at(-1)!.value > 0);
      const invalid = structuredClone(territorial); invalid.territory!.accessibility = .123;
      const rejected = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: invalid }); assert.equal(rejected.statusCode, 400);
    }
  } finally { await app.close(); }
});
