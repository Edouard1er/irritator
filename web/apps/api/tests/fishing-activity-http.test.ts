import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config/index.js';
import { applyTerritorialZone, composeFleet, fishingActivityUnits, intervene, nativeRequest, type RunRequest, type RunResult, type TerritoryGeography } from '../../../packages/contracts/index.js';
import example from '../../../examples/atelier-interventions-month-v3.json' with { type: 'json' };

test('descriptive activities leave the actual native graph, E/q/a, interventions and observations identical', { timeout: 60000 }, async () => {
  const app = buildApp(readConfig());
  const geography: TerritoryGeography = { type: 'FeatureCollection', id: 'test-only', name: 'Test', source: 'Synthetic test', demonstration: true, features: [{ type: 'Feature', properties: { id: 'A', name: 'Test A', role: 'zone', accessibility: .1, provenance: 'Synthetic test' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }] };
  let control = applyTerritorialZone(structuredClone(example) as unknown as RunRequest, geography, 'A');
  control.simulation.end = 2;
  const conditions = { ...control.temporal!.parameters, E: control.temporal!.parameters.E + 10 };
  control = intervene(control, 1, conditions, composeFleet(conditions.E), 'balanced', [.6, .25, .15]);
  const declared = structuredClone(control);
  declared.fishingActivities = { version: 1, units: { ...fishingActivityUnits }, activities: [{ id: 'activity-1', zone: { geographyId: 'test-only', zoneId: 'A', name: 'Test A' }, scenario: control.temporal!.scenario, period: { start: 0, end: 12, unit: 'month' }, provenance: { basis: 'declared', note: 'Synthetic declaration' }, groups: [{ id: 'group-1', canoe: { category: 'small', count: 2 }, fishers: 4, tripsPerBoatPerMonth: 12, tripDurationHours: 6, gear: { category: 'line', effectiveFishingHours: 2 } }] }] };
  const run = async (request: RunRequest) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: request });
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as RunResult;
  };
  try {
    const expected = await run(control);
    for (const trips of [0, 12, 120]) {
      declared.fishingActivities.activities[0]!.groups[0]!.tripsPerBoatPerMonth = trips;
      assert.deepEqual(nativeRequest(declared), nativeRequest(control));
      assert.equal(nativeRequest(declared).fishingActivities, undefined);
      assert.deepEqual(declared.temporal, control.temporal);
      const actual = await run(declared);
      assert.deepEqual(actual.observations, expected.observations);
      assert.deepEqual(actual.simulation, expected.simulation);
      assert.deepEqual(actual.modelEvents, expected.modelEvents);
    }
    declared.fishingActivities.activities[0]!.groups[0]!.tripDurationHours = -1;
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', payload: declared });
    assert.equal(invalid.statusCode, 400);
    const malformed = await app.inject({ method: 'POST', url: '/api/v1/simulations/run', headers: { 'content-type': 'application/json' }, payload: '{broken' });
    assert.equal(malformed.statusCode, 400);
  } finally { await app.close(); }
});
