// Test-only bounded first-campaign graphs for process resource measurement.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { dynamicUncertainty } from './decision-8i-fixture.mjs';
const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true });
for (const n of [2, 4, 6]) {
  const m = dynamicUncertainty(), p = m.model.definitions.find(d => d.id === 'BuildPlan');
  p.components.find(c => c.id === 'lowCount').parameters.left = n / 2;
  const removed = Array.from({ length: 3 - n / 2 }, (_, i) => 'lowValue' + (i + n / 2)).flatMap(id => [id, id + 'Tag']);
  p.components = p.components.filter(c => !removed.includes(c.id));
  p.connections = p.connections.filter(e => !removed.includes(e.from.component) && !removed.includes(e.to.component));
  m.simulation.end = 2;
  writeFileSync(resolve(out, `campaign-${n}.json`), JSON.stringify(m));
}
