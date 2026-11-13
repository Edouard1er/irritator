import { describe, expect, it } from 'vitest';
import { workshopFixture } from './workshop-fixture';
import { applyMapping, catchIncrement, classifyBiomassStatus, convertQuantity, convertTime, normalizePoints, normalizeRun, observationAt, trendAt } from '@/lib/simulation/trajectory';
const config = { bCrit: 140, proximityRatio: 0.2, slopeTolerance: 1e-9 };
describe('Workshop alert priority and exact boundaries', () => {
  it.each([
    [220, 1, 'favorable'], [220, -1, 'declining'], [168.000001, -1, 'declining'], [168, 1, 'near_threshold'],
    [150, -1, 'near_threshold'], [140.000001, 1, 'near_threshold'], [140, 1, 'critical_crossed'], [120, 1, 'critical_crossed'],
    [220, 0, 'favorable'], [220, undefined, 'unknown'], [NaN, -1, 'unknown'], [Infinity, -1, 'unknown'], [0, 1, 'critical_crossed'], [-10, 1, 'critical_crossed'],
  ])('B=%s, slope=%s → %s', (b, slope, expected) => expect(classifyBiomassStatus(b as number, slope as number | undefined, config)).toBe(expected));
  it('rejects missing or invalid configuration and respects numerical tolerance', () => {
    expect(classifyBiomassStatus(120, -1, { ...config, bCrit: undefined })).toBe('unknown');
    expect(classifyBiomassStatus(120, -1, { ...config, bCrit: 0 })).toBe('unknown');
    expect(classifyBiomassStatus(220, -1e-10, config)).toBe('favorable');
    expect(classifyBiomassStatus(220, 1, { ...config, proximityRatio: -1 })).toBe('unknown');
    expect(classifyBiomassStatus(220, 1, { ...config, bCrit: 1e308, proximityRatio: 1e308 })).toBe('unknown');
  });
  it('classifies the complete trajectory independently of browser refresh', () => {
    const points = [220, 210, 175, 166, 150, 139, 145, 180].map((value, time) => ({ value, time }));
    expect(points.map((p, i) => classifyBiomassStatus(p.value, trendAt(points, i), config))).toEqual(['unknown', 'declining', 'declining', 'near_threshold', 'near_threshold', 'critical_crossed', 'near_threshold', 'favorable']);
  });
});
describe('Recorded time, anomalies and conversions', () => {
  it('sorts stably, preserves simultaneous events and prevents zero-time slopes', () => {
    const warnings: string[] = [], points = normalizePoints([{ time: 2, value: 30 }, { time: 1, value: 20 }, { time: 1, value: 10 }, { time: NaN, value: 1 }], warnings);
    expect(points.map(p => p.value)).toEqual([20, 10, 30]); expect(warnings).toHaveLength(3);
    expect(trendAt(points, 1)).toBeUndefined(); expect(trendAt(points, 2)).toBe(20);
    expect(observationAt(points, 1)?.point.value).toBe(10); expect(observationAt(points, 1.5)).toBeUndefined();
  });
  it('does not bridge missing values or differentiate rates a second time', () => {
    const points = normalizePoints([{ time: 0, value: 1 }, { time: 1, value: NaN }, { time: 2, value: 4 }], []);
    expect(points).toHaveLength(3); expect(trendAt(points, 2)).toBeUndefined(); expect(observationAt(points, 1)).toBeUndefined();
    expect(catchIncrement([{ time: 0, value: 10 }, { time: 0.5, value: 14 }], 1)).toBe(4);
    expect(catchIncrement([{ time: 0, value: 10 }, { time: 1, value: 9 }], 1)).toBeUndefined();
  });
  it('only converts declared compatible quantities and time with an explicit origin', () => {
    expect(convertQuantity(1500, 'kg', 't')).toBe(1.5); expect(convertQuantity(1.5, 't', 'kg')).toBe(1500);
    expect(convertQuantity(1500, 'fish', 't')).toBeUndefined(); expect(convertQuantity(1500, 'model-unit', 't')).toBeUndefined();
    expect(convertTime(24, 'month', 'year', true)).toBe(2); expect(convertTime(24, 'month', 'year', false)).toBeUndefined();
  });
});
describe('Engine output adapter', () => {
  it('maps the verified Schaefer graph, keeps scenario identity, factors and unknown units', () => {
    const { result, request } = workshopFixture(), before = JSON.stringify({ result, request });
    const runs = normalizeRun(result, request);
    expect(runs).toHaveLength(2); expect(runs[0]?.series.map(s => s.kind)).toEqual(['biomass_total', 'catch_cumulative']);
    expect(runs[0]?.parameters.E).toBe(80); expect(runs[1]?.parameters.E).toBe(200); expect(runs[0]?.parameters.a).toBe(1);
    expect(runs[0]?.series[0]?.unit).toBe('unité du modèle'); expect(runs[0]?.timeUnit).toBe('unité du modèle');
    expect(JSON.stringify({ result, request })).toBe(before);
  });
  it('does not infer biomass from a variable name in an altered model', () => {
    const { result, request } = workshopFixture(); request.model.definitions![0]!.connections.pop();
    const run = normalizeRun(result, request)[0]!; expect(run.series.every(s => s.kind === 'other')).toBe(true);
    const mapped = applyMapping(run, { biomass: 'N', capture: 'C', captureKind: 'catch_rate' });
    expect(mapped.series.map(s => s.kind)).toEqual(['biomass_total', 'catch_rate']);
  });
  it('keeps unavailable scenarios without inventing points', () => {
    const { result, request } = workshopFixture(); if (result.schemaVersion === 2) { result.scenarioTrajectories![0]!.observations = []; result.scenarioTrajectories![0]!.status = 'canceled'; }
    expect(normalizeRun(result, request)[0]).toMatchObject({ status: 'canceled', series: [] });
  });
  it('does not combine stocks and catches from different coupled occurrences', () => {
    const { result, request } = workshopFixture();
    request.model.components = ['lakeA', 'lakeB'].map(id => ({ id, type: 'coupled:Schaefer', parameters: {} }));
    result.observations = ['lakeA/N', 'lakeB/C', 'lakeA/C', 'lakeB/N'].map(component => ({ component, samplingInterval: 1, samples: [{ time: 0, value: 150 }] }));
    if (result.schemaVersion === 2) result.scenarioTrajectories = [];
    const runs = normalizeRun(result, request);
    expect(runs).toHaveLength(2); expect(runs[0]!.series.map(s => s.id)).toEqual(['lakeA/N', 'lakeA/C']);
    expect(runs[1]!.series.map(s => s.id)).toEqual(['lakeB/C', 'lakeB/N']);
    expect(runs[0]!.series.map(s => s.kind)).toEqual(['biomass_total', 'catch_cumulative']);
  });
});
