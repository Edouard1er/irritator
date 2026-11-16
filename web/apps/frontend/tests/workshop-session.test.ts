import { describe, expect, it } from 'vitest';
import { validateWorkshopSession, type DecisionSnapshot, type WorkshopDecisionRecord } from '../../../packages/contracts/workshop-session';
import { addRecord, compareDecisions, createSession, updateRecord } from '@/lib/workshop/session';
import { decisionsStorageKey, parseSession, saveSession, serializeSession } from '@/lib/serialization/workshop-session';
import { scenarios, choices } from '@/lib/workshop/scenarios';
import { nativeRequest, validateRequest } from '@contracts';
import model from '../../../examples/atelier-interventions-month-v3.json';
import { scientificFingerprint } from '@/lib/modeling/model';
import type { RunRequest } from '@contracts';
const time = '2026-11-16T10:00:00.000Z';
const d = (choiceId = 'seek-information'): DecisionSnapshot => ({ status: 'answered', choiceId, sources: ['other-fisher'], confidence: 'medium', reasons: 'Témoignages divergents.', recordedAt: time });
const record = (): WorkshopDecisionRecord => ({ id: crypto.randomUUID(), participantCode: 'P-01', scenarioId: 'S1-captures', scenarioVersion: 1, activityIds: [], before: d() });
function setup() { const r = record(); return { r, s: addRecord(createSession(time), r, true) }; }
function complete() { const { r, s } = setup(); const exposed = updateRecord(s, r.id, { presentation: { kind: 'discussion-card', supportId: 'S1-captures-discussion-card-v1', presentedAt: time } }, true); return { r, s: updateRecord(exposed, r.id, { after: d('reduce-trips') }, true) }; }
describe('Independent research session contract', () => {
  it('accepts minimal and complete sessions and preserves all fields through JSON/storage', () => {
    expect(() => validateWorkshopSession(createSession(time))).not.toThrow();
    const { s } = complete(); const encoded = serializeSession(s); expect(parseSession(encoded)).toEqual(s);
    const values = new Map<string, string>(); saveSession({ setItem: (k, v) => { values.set(k, v); } }, s, true);
    expect(parseSession(values.get(decisionsStorageKey)!)).toEqual(s);
  });
  it.each([
    ['version', (s: any) => { s.version = 2; }], ['unknown session field', (s: any) => { s.phone = 'forbidden'; }],
    ['unknown record field', (s: any) => { s.records[0]!.name = 'forbidden'; }], ['duplicate', (s: any) => { s.records.push(s.records[0]!); }],
    ['choice', (s: any) => { s.records[0]!.before.choiceId = 'increase-trips'; }], ['scenario version', (s: any) => { s.records[0]!.scenarioVersion = 2; }],
    ['scenario prototype', (s: any) => { s.records[0]!.scenarioId = '__proto__'; }], ['invalid date', (s: any) => { s.records[0]!.before.recordedAt = '2026-02-30T00:00:00.000Z'; }],
    ['long text', (s: any) => { s.records[0]!.before.reasons = 'x'.repeat(501); }], ['unknown source', (s: any) => { s.records[0]!.before.sources = ['rumour']; }],
    ['duplicate source', (s: any) => { s.records[0]!.before.sources = ['other-fisher', 'other-fisher']; }], ['code', (s: any) => { s.records[0]!.participantCode = ''; }],
    ['uuid', (s: any) => { s.id = 'bad'; }], ['after orphan', (s: any) => { s.records[0]!.after = d(); }], ['before missing', (s: any) => { delete s.records[0]!.before; }],
    ['unsupported kind', (s: any) => { s.records[0]!.presentation = { kind: 'plot', presentedAt: time }; }],
    ['other needs description', (s: any) => { s.records[0]!.before.choiceId = 'other'; }],
    ['scenario coercion', (s: any) => { s.records[0]!.scenarioId = ['S1-captures']; }],
    ['confidence coercion', (s: any) => { s.records[0]!.before.confidence = ['low']; }],
    ['unsure with action', (s: any) => { s.records[0]!.before.status = 'unsure'; }],
    ['broken chain', (s: any) => { s.records[0]!.attemptsPreviousId = crypto.randomUUID(); }],
  ])('rejects %s without changing existing data', (_, mutate) => {
    const { s } = setup(), old = serializeSession(s), bad = structuredClone(s); mutate(bad);
    expect(() => parseSession(JSON.stringify(bad))).toThrow(); expect(serializeSession(s)).toBe(old);
  });
  it('distinguishes calculation from presentation, allows D1 correction only before exposure and chains corrections', () => {
    const { s, r } = setup(); const corrected = updateRecord(s, r.id, { before: d('maintain') }, true);
    expect(s.records[0]!.before.choiceId).toBe('seek-information'); expect(corrected.records[0]!.before.choiceId).toBe('maintain');
    expect(() => updateRecord(s, r.id, { after: d() }, true)).toThrow();
    const exposed = updateRecord(corrected, r.id, { presentation: { kind: 'discussion-map', supportId: 'S1-captures-discussion-map-v1', presentedAt: time } }, true);
    expect(() => updateRecord(exposed, r.id, { before: d() }, true)).toThrow(/verrouillée/);
    expect(() => updateRecord(exposed, r.id, { presentation: exposed.records[0]!.presentation }, true)).toThrow();
    const chained = addRecord(exposed, { ...record(), attemptsPreviousId: r.id }, true);
    expect(chained.records[1]!.attemptsPreviousId).toBe(r.id); expect(exposed.records).toHaveLength(1);
    expect(() => addRecord(exposed, record(), true)).toThrow(/chaîné/);
    expect(() => updateRecord(exposed, r.id, { presentation: undefined }, true)).toThrow(/effacée/);
    expect(() => updateRecord(exposed, r.id, { scenarioId: 'S3-couts' } as any, true)).toThrow(/immuable/);
  });
  it('never stores without collection authorization, including updates and explicit saves', () => {
    const { s, r } = setup(); expect(() => addRecord(s, record(), false)).toThrow();
    expect(() => updateRecord(s, r.id, { before: d() }, false)).toThrow();
    const values = new Map(); expect(() => saveSession({ setItem: (k, v) => { values.set(k, v); } }, s, false)).toThrow(); expect(values.size).toBe(0);
  });
  it('protects the last saved data against corrupt JSON, quota and validation errors', () => {
    const { s } = setup(); let previous = serializeSession(s);
    expect(() => parseSession('{')).toThrow(/illisible/);
    expect(() => saveSession({ setItem: () => { throw new Error('quota'); } }, s, true)).toThrow(/dernière sauvegarde/);
    expect(parseSession(previous)).toEqual(s);
    expect(() => saveSession({ setItem: (_, v) => { previous = v; } }, { ...s, version: 8 } as any, true)).toThrow();
    expect(parseSession(previous)).toEqual(s);
  });
  it.each(['S1-captures', 'S2-reserve', 'S3-couts'] as const)('records versioned %s with allowed discussion support', id => {
    const r = { ...record(), scenarioId: id, before: d(choices(id)[0]!.id) };
    const s = addRecord(createSession(time), r, true), kind = id === 'S2-reserve' ? 'discussion-map' : 'discussion-card';
    expect(() => updateRecord(s, r.id, { presentation: { kind, supportId: `${id}-${kind}-v1`, presentedAt: time } }, true)).not.toThrow();
    expect(scenarios[id].version).toBe(1); expect(['proposed', 'hypothetical']).toContain(scenarios[id].status);
  });
  it('requires native provenance, rejects fake native fields on discussion and native S2/S3', () => {
    const { s, r } = setup(); const p = { kind: 'native-simulation' as const, runId: crypto.randomUUID(), modelId: 'lake', modelFingerprint: 'executed-request', requestSchemaVersion: 3 as const, assumptionsNote: 'Non calibré', presentedAt: time };
    expect(() => updateRecord(s, r.id, { presentation: p }, true)).not.toThrow();
    for (const key of ['runId', 'modelId', 'modelFingerprint'] as const) expect(() => updateRecord(s, r.id, { presentation: { ...p, [key]: '' } }, true)).toThrow();
    expect(() => updateRecord(s, r.id, { presentation: { kind: 'discussion-card', supportId: 'S1-captures-discussion-card-v1', presentedAt: time, runId: 'fake' } as any }, true)).toThrow();
    for (const scenarioId of ['S2-reserve', 'S3-couts'] as const) {
      const q = { ...record(), scenarioId, before: d(choices(scenarioId)[0]!.id) };
      expect(() => updateRecord(addRecord(createSession(time), q, true), q.id, { presentation: p }, true)).toThrow();
    }
  });
  it('compares qualitatively without scores, including other text and uncertainty', () => {
    const { s } = complete(); const r = s.records[0]!;
    expect(compareDecisions()).toBe('not-comparable'); expect(compareDecisions(r)).toBe('changed');
    expect(compareDecisions({ ...r, after: r.before })).toBe('maintained');
    expect(compareDecisions({ ...r, after: { ...d(), status: 'unsure', choiceId: undefined } })).toBe('uncertain');
    expect(compareDecisions({ ...r, before: { ...d('other'), otherChoice: 'A' }, after: { ...d('other'), otherChoice: 'B' } })).toBe('changed');
  });
  it('leaves native request, E/q/a, initial state and scientific identity strictly unchanged', () => {
    const request = structuredClone(model) as unknown as RunRequest; validateRequest(request);
    const before = JSON.stringify(nativeRequest(request)), fp = scientificFingerprint(request), params = structuredClone(request.temporal);
    const { s } = complete(); parseSession(serializeSession(s));
    expect(JSON.stringify(nativeRequest(request))).toBe(before); expect(request.temporal).toEqual(params); expect(scientificFingerprint(request)).toBe(fp);
    expect(() => validateRequest({ ...request, workshopSession: s })).toThrow();
  });
});
