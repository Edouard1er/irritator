import { describe, expect, it } from 'vitest';
import { accessibleBiomass, applyTerritorialZone, geographicZone, initialTerritorialBiomass, nativeRequest, temporalScope, validateGeography, validateRequest, type RunRequest } from '@contracts';
import { territoryDemo } from '@/lib/modeling/territory-demo';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { loadWorkspace, saveWorkspace } from '@/lib/serialization/workspace';
import model from '../../../examples/atelier-interventions-month-v3.json';
import legacy1 from '../../../examples/sum3.json';
import legacy3 from '../../../examples/atelier-schaefer-month-v3.json';

const request = () => structuredClone(model) as unknown as RunRequest;
const geography = () => structuredClone(territoryDemo);
describe('Territorial data and the single global biological state', () => {
  it('accepts local Polygon, MultiPolygon and empty collections without inventing zones', () => {
    validateGeography(geography()); const empty = geography(); empty.features = []; validateGeography(empty);
    const multi = geography(); const f = multi.features[0]!;
    if (f.geometry.type === 'Polygon') f.geometry = { type: 'MultiPolygon', coordinates: [f.geometry.coordinates] };
    validateGeography(multi);
  });
  it.each([null, {}, { type: 'FeatureCollection', features: [] }])('rejects incomplete GeoJSON %j', data => expect(() => validateGeography(data)).toThrow());
  it.each(['missing-id', 'duplicate-id', 'open-ring', 'nonfinite-point', 'outside-earth', 'unknown-geometry', 'empty-polygon', 'unknown-field'] as const)('rejects %s', kind => {
    const data = geography(), f = data.features[1]!;
    if (kind === 'missing-id') f.properties.id = '';
    if (kind === 'duplicate-id') f.properties.id = data.features[0]!.properties.id;
    if (kind === 'unknown-field') Object.assign(f.properties, { arbitrary: 1 });
    if (f.geometry.type === 'Polygon') {
      if (kind === 'open-ring') f.geometry.coordinates[0]!.pop();
      if (kind === 'nonfinite-point') f.geometry.coordinates[0]![1]![0] = Infinity;
      if (kind === 'outside-earth') f.geometry.coordinates[0]![1]![0] = 181;
      if (kind === 'empty-polygon') f.geometry.coordinates = [];
    }
    if (kind === 'unknown-geometry') Object.assign(f.geometry, { type: 'Point' });
    expect(() => validateGeography(data)).toThrow();
  });
  it.each([undefined, -.1, 1.1, NaN, Infinity, -Infinity])('refuses unusable access %s without mutating the model', value => {
    const data = geography(), original = request(), before = structuredClone(original);
    data.features[1]!.properties.accessibility = value;
    expect(() => applyTerritorialZone(original, data, 'demo-A')).toThrow(); expect(original).toEqual(before);
  });
  it('allows an unconfigured zone to be displayed but requires provenance and access before applying', () => {
    const data = geography(); delete data.features[1]!.properties.accessibility; validateGeography(data);
    expect(() => applyTerritorialZone(request(), data, 'demo-A')).toThrow();
    data.features[1]!.properties.accessibility = .1; delete data.features[1]!.properties.provenance;
    expect(() => applyTerritorialZone(request(), data, 'demo-A')).toThrow(/Provenance/);
    expect(() => geographicZone(data, 'absent')).toThrow(/inexistante/);
  });
  it.each([[.1, 10], [0, 0], [1, 100]])('N=100 and a=%s gives %s tonnes without changing N', (a, expected) => {
    const n = 100; expect(accessibleBiomass(n, a)).toBe(expected); expect(n).toBe(100);
  });
  it('does not invent biomass when the model or observations are unavailable', () => {
    expect(accessibleBiomass(undefined, .1)).toBeUndefined(); expect(accessibleBiomass(NaN, .1)).toBeUndefined();
    expect(initialTerritorialBiomass(legacy1 as RunRequest)).toBeUndefined();
    const r = request(); expect(initialTerritorialBiomass(r)).toBe(temporalScope(r)!.components.find(c => c.id === 'N')!.parameters.X);
  });
  it('applies a once through the existing graph and temporal compiler; adds no biological state', () => {
    const original = request(), next = applyTerritorialZone(original, geography(), 'demo-A'); validateRequest(next);
    expect(original.temporal!.parameters.a).toBe(1); expect(next.temporal!.parameters.a).toBe(.1);
    const expected = request(); expected.temporal!.parameters.a = .1; temporalScope(expected)!.components.find(c => c.id === 'a')!.parameters.value = .1;
    expect(nativeRequest(next)).toEqual(nativeRequest(expected));
    expect(nativeRequest(next)).not.toHaveProperty('territory'); expect(nativeRequest(next)).not.toHaveProperty('temporal');
    expect(temporalScope(next)!.components).toHaveLength(temporalScope(original)!.components.length);
    expect(temporalScope(next)!.components.filter(c => c.type === 'qss3_integrator')).toEqual(temporalScope(original)!.components.filter(c => c.type === 'qss3_integrator'));
    expect(temporalScope(next)!.connections).toEqual(temporalScope(original)!.connections);
  });
  it('roundtrips the confirmed zone and complete offline geography through JSON and local saving', () => {
    const next = applyTerritorialZone(request(), geography(), 'demo-B');
    expect(serializeModel(deserializeModel(JSON.parse(JSON.stringify(next))))).toEqual(next);
    expect(serializeModel(loadWorkspace(saveWorkspace(deserializeModel(next))))).toEqual(next);
  });
  it('rejects divergence between applied selection, temporal data and graph', () => {
    for (const mutate of [
      (r: RunRequest) => { r.territory!.accessibility = .2; },
      (r: RunRequest) => { r.temporal!.parameters.a = .2; },
      (r: RunRequest) => { temporalScope(r)!.components.find(c => c.id === 'a')!.parameters.value = .2; },
      (r: RunRequest) => { r.territory!.zoneId = 'absent'; },
      (r: RunRequest) => { Object.assign(r.territory!, { arbitrary: 1 }); },
    ]) { const r = applyTerritorialZone(request(), geography(), 'demo-A'); mutate(r); expect(() => validateRequest(r)).toThrow(); expect(() => deserializeModel(r)).toThrow(); }
  });
  it('preserves ordinary v1 and v3 models unchanged; does not require territorial fields', () => {
    for (const example of [legacy1, legacy3, model]) { validateRequest(example); expect(serializeModel(deserializeModel(example))).toEqual(example); }
  });
  it('rejects changes of access during the run while keeping ordinary interventions available', () => {
    const r = applyTerritorialZone(request(), geography(), 'demo-A');
    r.temporal!.interventions.push({ time: 1, parameter: 'a', oldValue: .1, newValue: .2, scenario: r.temporal!.scenario, unit: 'ratio', provenance: 'test' });
    expect(() => validateRequest(r)).toThrow(); expect(() => applyTerritorialZone(r, geography(), 'demo-B')).toThrow();
  });
});
