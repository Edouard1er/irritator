import { describe, expect, it } from 'vitest';
import { activityIndicators, applyTerritorialZone, nativeRequest, validateRequest, type FishingGroup } from '@contracts';
import { deserializeModel, scientificFingerprint, serializeModel } from '@/lib/modeling/model';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import { territoryDemo } from '@/lib/modeling/territory-demo';
import { referenceActivity, referenceGroup } from './fishing-fixture';

describe('Descriptive fishing activities, separate from scientific effort', () => {
  it('computes 24 canoe trips and 144 canoe hours without multiplying by four fishers', () => {
    expect(activityIndicators([referenceGroup()])).toEqual({ canoeTripsPerMonth: 24, canoeTripHoursPerMonth: 144 });
    expect(activityIndicators([{ ...referenceGroup(), fishers: 40 }])).toEqual(activityIndicators([referenceGroup()]));
  });
  it('adds groups, handles rest and does not use effective fishing or soak time', () => {
    const g = referenceGroup();
    expect(activityIndicators([g, { ...g, id: 'g2', canoe: { ...g.canoe, count: 1 }, tripsPerBoatPerMonth: 2, tripDurationHours: 3 }])).toEqual({ canoeTripsPerMonth: 26, canoeTripHoursPerMonth: 150 });
    expect(activityIndicators([{ ...g, tripsPerBoatPerMonth: 0 }])).toEqual({ canoeTripsPerMonth: 0, canoeTripHoursPerMonth: 0 });
    expect(activityIndicators([])).toEqual({ canoeTripsPerMonth: 0, canoeTripHoursPerMonth: 0 });
    expect(activityIndicators([{ ...g, gear: { category: 'net', effectiveFishingHours: 2, soakHours: 30 } }])).toEqual(activityIndicators([g]));
  });
  it('roundtrips complete activity through local saving and JSON import/export', () => {
    const request = referenceActivity(); const gear = request.fishingActivities!.activities[0]!.groups[0]!.gear;
    Object.assign(gear, { count: 3, netLengthM: 120, meshSizeMm: 35.5, effectiveFishingHours: 2, soakHours: 48, notes: 'Test fictif, sans seuil réglementaire.' });
    validateRequest(request);
    expect(serializeModel(deserializeModel(JSON.parse(JSON.stringify(request))))).toEqual(request);
    expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(request))))).toEqual(request);
  });
  it('accepts absent optional fields, non-net gear, multiday trips and no trips', () => {
    for (const change of [
      (g: FishingGroup) => { g.gear = { category: 'line' }; g.tripDurationHours = 60; },
      (g: FishingGroup) => { g.canoe.count = 0; g.fishers = 0; g.tripsPerBoatPerMonth = 0; g.tripDurationHours = 0; },
      (g: FishingGroup) => { g.gear = { category: 'other', description: 'Technique déclarée' }; g.canoe = { category: 'other', description: 'Pirogue déclarée', count: 2 }; },
    ]) { const r = referenceActivity(); change(r.fishingActivities!.activities[0]!.groups[0]!); expect(() => validateRequest(r)).not.toThrow(); }
  });
  it.each([
    ['negative boats', (g: FishingGroup) => { g.canoe.count = -1; }],
    ['fractional boats', (g: FishingGroup) => { g.canoe.count = 1.5; }],
    ['fractional fishers', (g: FishingGroup) => { g.fishers = .5; }],
    ['fractional trips', (g: FishingGroup) => { g.tripsPerBoatPerMonth = 2.5; }],
    ['unsafe integer', (g: FishingGroup) => { g.fishers = Number.MAX_SAFE_INTEGER + 1; }],
    ['negative duration', (g: FishingGroup) => { g.tripDurationHours = -1; }],
    ['NaN duration', (g: FishingGroup) => { g.tripDurationHours = NaN; }],
    ['infinite duration', (g: FishingGroup) => { g.tripDurationHours = Infinity; }],
    ['missing boats', (g: FishingGroup) => { g.canoe.count = 0; }],
    ['missing fishers', (g: FishingGroup) => { g.fishers = 0; }],
    ['zero duration with trips', (g: FishingGroup) => { g.tripDurationHours = 0; }],
    ['empty other gear', (g: FishingGroup) => { g.gear.category = 'other'; }],
    ['empty other canoe', (g: FishingGroup) => { g.canoe.category = 'other'; }],
    ['unknown gear', (g: FishingGroup) => { Object.assign(g.gear, { category: 'invalid' }); }],
    ['negative optional', (g: FishingGroup) => { g.gear.netLengthM = -1; }],
    ['fractional gear count', (g: FishingGroup) => { g.gear.count = .5; }],
    ['invalid optional duration', (g: FishingGroup) => { g.gear.soakHours = Infinity; }],
    ['effective exceeds trip', (g: FishingGroup) => { g.gear.effectiveFishingHours = 7; }],
    ['non-net mesh', (g: FishingGroup) => { g.gear = { category: 'line', meshSizeMm: 40 }; }],
    ['overflow', (g: FishingGroup) => { g.tripDurationHours = Number.MAX_VALUE; }],
    ['unsafe trip total', (g: FishingGroup) => { g.canoe.count = Number.MAX_SAFE_INTEGER; }],
  ] as const)('rejects %s both on import and on execution', (_, mutate) => {
    const r = referenceActivity(); mutate(r.fishingActivities!.activities[0]!.groups[0]!);
    expect(() => validateRequest(r)).toThrow(); expect(() => deserializeModel(r)).toThrow();
  });
  it.each(['duplicate-group', 'duplicate-activity', 'unit', 'version', 'empty-period', 'negative-period', 'overlap', 'unknown-zone', 'additional-field', 'null-extension', 'bad-json'] as const)('rejects malformed %s', kind => {
    const r = referenceActivity(), extension = r.fishingActivities!, a = extension.activities[0]!;
    if (kind === 'duplicate-group') a.groups.push(structuredClone(a.groups[0]!));
    if (kind === 'duplicate-activity') extension.activities.push(structuredClone(a));
    if (kind === 'unit') Object.assign(extension.units, { tripDurationHours: 'day' });
    if (kind === 'version') Object.assign(extension, { version: 2 });
    if (kind === 'empty-period') a.period.end = a.period.start;
    if (kind === 'negative-period') a.period.start = -1;
    if (kind === 'overlap') extension.activities.push({ ...structuredClone(a), id: 'other', groups: [] });
    if (kind === 'unknown-zone') a.zone.zoneId = 'absent';
    if (kind === 'additional-field') Object.assign(a.groups[0]!, { effort: 144 });
    if (kind === 'null-extension') Object.assign(r, { fishingActivities: null });
    if (kind === 'bad-json') { expect(() => deserializeModel(JSON.parse('{broken'))).toThrow(); return; }
    expect(() => validateRequest(r)).toThrow(); expect(() => deserializeModel(r)).toThrow();
  });
  it('retains distinct periods, scenarios and zone snapshots without changing scientific parameters', () => {
    const r = referenceActivity(), a = r.fishingActivities!.activities[0]!;
    r.fishingActivities!.activities.push({ ...structuredClone(a), id: 'rest', period: { start: 12, end: 24, unit: 'month' }, groups: [] });
    r.fishingActivities!.activities.push({ ...structuredClone(a), id: 'scenario-2', scenario: 'autre-scénario', groups: [] });
    const changed = applyTerritorialZone(r, territoryDemo, 'demo-B'); validateRequest(changed);
    expect(changed.fishingActivities).toEqual(r.fishingActivities);
    const control = structuredClone(r); delete control.fishingActivities;
    expect(nativeRequest(r)).toEqual(nativeRequest(control)); expect(nativeRequest(r)).not.toHaveProperty('fishingActivities');
    expect(scientificFingerprint(r)).toBe(scientificFingerprint(control));
    expect(r.temporal).toEqual(control.temporal); expect(r.model).toEqual(control.model);
  });
});
