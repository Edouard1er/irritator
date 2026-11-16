import { applyTerritorialZone, fishingActivityUnits, type FishingGroup, type RunRequest } from '@contracts';
import { territoryDemo } from '@/lib/modeling/territory-demo';
import model from '../../../examples/atelier-interventions-month-v3.json';

export const referenceGroup = (): FishingGroup => ({ id: 'group-1', canoe: { category: 'small', count: 2 }, fishers: 4, tripsPerBoatPerMonth: 12, tripDurationHours: 6, gear: { category: 'net' } });
export function referenceActivity(): RunRequest {
  const request = applyTerritorialZone(structuredClone(model) as unknown as RunRequest, territoryDemo, 'demo-A');
  request.fishingActivities = { version: 1, units: { ...fishingActivityUnits }, activities: [{ id: 'activity-1', zone: { geographyId: territoryDemo.id, zoneId: 'demo-A', name: 'Zone fictive A' }, scenario: request.temporal!.scenario, period: { start: 0, end: 12, unit: 'month' }, provenance: { basis: 'declared', note: 'Exemple fictif déclaré pour le test.' }, groups: [referenceGroup()] }] };
  return request;
}
