import { lakeWetFrontier } from './lake-wet-frontier.js';
import type { LakeNetworkEdge } from './logistic-lake-network.js';
import type { LakeMesh } from './logistic-lake.js';

export const lakeFullNetworkResolution = '6x3';

export function lakeFullTopology(mesh: LakeMesh) {
  const wet = mesh.cells.filter(cell => cell.wetFraction > 0).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const cells = wet.map(cell => cell.id);
  const edges: LakeNetworkEdge[] = wet.flatMap((a, index) => wet.slice(index + 1).flatMap(b => {
    const frontier = lakeWetFrontier(mesh, a, b);
    return frontier ? [{ a: a.id, b: b.id, frontier }] : [];
  }));
  const pending = new Set(cells);
  const components: string[][] = [];
  while (pending.size) {
    const group = new Set([pending.values().next().value!]);
    for (const id of group) {
      pending.delete(id);
      for (const { a, b } of edges) {
        if (id === a) group.add(b);
        if (id === b) group.add(a);
      }
    }
    components.push([...group].sort());
  }
  return { cells, edges, components };
}
