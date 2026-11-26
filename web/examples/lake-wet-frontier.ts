import type { LakeCell, LakeMesh } from './logistic-lake.js';

export type WetFrontier = {
  axis: 0 | 1;
  boundary: number;
  segments: { start: number; end: number }[];
  direction: 1 | -1;
};

/** Open intervals of the common edge lying strictly inside the wet polygon. */
export function lakeWetFrontier(mesh: LakeMesh, a: LakeCell, b: LakeCell): WetFrontier | undefined {
  if (Math.abs(a.row - b.row) + Math.abs(a.column - b.column) !== 1) return;
  const axis = a.column === b.column ? 1 : 0;
  const transverse = axis === 0 ? 1 : 0;
  const direction = b.column > a.column || b.row > a.row ? 1 : -1;
  const boundary = axis === 0
    ? Math.max(a.column, b.column) * mesh.width / mesh.columns
    : Math.max(a.row, b.row) * mesh.height / mesh.rows;
  const start = axis === 0 ? a.row * mesh.height / mesh.rows : a.column * mesh.width / mesh.columns;
  const end = axis === 0 ? (a.row + 1) * mesh.height / mesh.rows : (a.column + 1) * mesh.width / mesh.columns;
  const tolerance = 64 * Number.EPSILON * Math.max(mesh.width, mesh.height);
  const cuts = [start, end];
  const rings = mesh.rings.map(ring => {
    const crossings: number[] = [];
    const boundarySegments: [number, number][] = [];
    for (const [index, p] of ring.entries()) {
      const q = ring[(index + 1) % ring.length]!;
      const u = p[axis] - boundary;
      const v = q[axis] - boundary;
      if (u === 0) cuts.push(p[transverse]);
      if (u === 0 && v === 0) {
        boundarySegments.push([Math.min(p[transverse], q[transverse]), Math.max(p[transverse], q[transverse])]);
      } else if ((u > 0) !== (v > 0)) {
        // Half-open rule counts a vertex crossing once and a tangency twice or zero times.
        const crossing = u === 0 ? p[transverse] : v === 0 ? q[transverse]
          : p[transverse] + (q[transverse] - p[transverse]) * (-u / (v - u));
        crossings.push(crossing);
        cuts.push(crossing);
      }
    }
    return { crossings, boundarySegments };
  });
  const positions = cuts.filter(value => value >= start && value <= end).sort((x, y) => x - y);
  const segments: WetFrontier['segments'] = [];
  for (let index = 1; index < positions.length; index++) {
    const lo = positions[index - 1]!;
    const hi = positions[index]!;
    if (hi - lo <= tolerance) continue;
    const middle = lo + (hi - lo) / 2;
    const wet = rings.every(({ crossings, boundarySegments }, ring) =>
      !boundarySegments.some(([min, max]) => middle >= min && middle <= max) &&
      (crossings.filter(crossing => crossing > middle).length % 2 === (ring === 0 ? 1 : 0)));
    if (wet) segments.push({ start: lo, end: hi });
  }
  if (segments.length) return { axis, boundary, segments, direction };
}
