import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectStructure, validateRequest, wrapperOccurrences, type RunRequest } from '@contracts';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { scopeView, applyScopeView } from '@/lib/modeling/hierarchy';
const load = (file: string): RunRequest => JSON.parse(readFileSync(new URL('../../../examples/' + file + '-v3.json', import.meta.url), 'utf8'));
describe('8L graphical prospective library', () => {
  for (const file of ['decision-select-prospect-model', 'tstar-schaefer-select-prospect']) it('preserves the full selection graph and both prospective definitions: ' + file, () => {
    const m = load(file); validateRequest(m); expect(inspectStructure(m)).toEqual([]);
    expect(serializeModel(deserializeModel(m))).toEqual(m);
    const ws = wrapperOccurrences(m); expect(ws.map(w => w.component)).toEqual(['forecast/M1', 'forecast/M2']);
    expect(ws[0]!.experiment.definition).not.toBe(ws[1]!.experiment.definition);
    expect(ws.every(w => w.experiment.dynamicPlan && w.experiment.execution?.resultMode === 'collect')).toBe(true);
  });
  it('edits a generic selection threshold through a definition view and preserves scientific export', () => {
    const state = deserializeModel(load('decision-select-prospect-model'));
    const view = scopeView(state, 'SelectProspective'); view.request.model.components.find(c => c.id === 'less')!.parameters.right = -2;
    const edited = applyScopeView(state, 'SelectProspective', view);
    expect(serializeModel(edited).model.definitions!.find(d => d.id === 'SelectProspective')!.components.find(c => c.id === 'less')!.parameters.right).toBe(-2);
  });
  it('rejects an invalid definition even when its route will never be selected', () => {
    const m = load('decision-select-prospect-model');
    m.model.definitions!.find(d => d.id === 'ProspectiveLibrary')!.components.find(c => c.id === 'M2')!.experiment!.definition = 'Absent';
    expect(inspectStructure(m)[0]?.code).toBe('DEFINITION_NOT_FOUND'); expect(() => validateRequest(m)).toThrow();
  });
});
