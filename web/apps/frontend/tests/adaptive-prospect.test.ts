import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateRequest, type RunRequest } from '@contracts';
import { deserializeModel, serializeModel } from '@/lib/modeling/model';
import { saveWorkspace, loadWorkspace } from '@/lib/serialization/workspace';

for (const name of ['decision-adaptive-prospect-selection', 'decision-adaptive-prospect-baseline', 'decision-adaptive-prospect-alternative-plant', 'tstar-schaefer-adaptive-prospect'])
  it('8N retains native history wiring, provenance and adaptive parameters through workspace export: ' + name, () => {
    const request = JSON.parse(readFileSync(new URL('../../../examples/' + name + '-v3.json', import.meta.url), 'utf8')) as RunRequest;
    validateRequest(request);
    const restored = serializeModel(loadWorkspace(saveWorkspace(deserializeModel(request))));
    expect(restored).toEqual(request);
  });
