export const lakeRows = 6;
export const lakeColumns = 3;
export const lakeResolutions = [
  { rows: lakeRows, columns: lakeColumns },
  { rows: 12, columns: 6 },
  { rows: 18, columns: 9 },
  { rows: 24, columns: 12 },
  { rows: 36, columns: 18 },
  { rows: 48, columns: 24 },
] as const;
export type LakeResolution = typeof lakeResolutions[number];
export const lakeResolutionId = ({ rows, columns }: { rows: number; columns: number }) => `${rows}x${columns}`;

type Point = readonly [number, number];
type Ring = readonly Point[];
type Bounds = { x: number; y: number; width: number; height: number };

export type LakeCell = Bounds & {
  id: string;
  row: number;
  column: number;
  wetFraction: number;
};

export type LakeMesh = LakeResolution & {
  width: number;
  height: number;
  rings: Ring[];
  cells: LakeCell[];
  fractionTolerance: number;
  discardedWetFraction: number;
};

export function lakeMeshFromGeoJson(data: unknown, resolution: LakeResolution = lakeResolutions[0]): LakeMesh {
  const collection = data as { type?: unknown; features?: { geometry?: { type?: unknown; coordinates?: unknown } }[] } | null;
  const geometry = Array.isArray(collection?.features) && collection.features.length === 1
    ? collection.features[0]?.geometry : undefined;
  if (collection?.type !== 'FeatureCollection' || geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    throw new Error('Le contour HydroLAKES doit contenir un polygone.');
  }
  const rings = geometry.coordinates as Point[][];
  if (rings.length === 0 || rings.some(ring => !Array.isArray(ring) || ring.length < 4 ||
    ring.some(point => !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) ||
    ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1])) {
    throw new Error('Les anneaux du contour HydroLAKES sont invalides.');
  }

  const outer = rings[0]!;
  const west = Math.min(...outer.map(([longitude]) => longitude));
  const east = Math.max(...outer.map(([longitude]) => longitude));
  const south = Math.min(...outer.map(([, latitude]) => latitude));
  const north = Math.max(...outer.map(([, latitude]) => latitude));
  // Local equirectangular display, with north at the top and height normalized to 1.
  const longitudeScale = Math.cos((south + north) * Math.PI / 360);
  const width = (east - west) * longitudeScale / (north - south);
  const projected = rings.map(ring => ring.slice(0, -1).map(([longitude, latitude]): Point =>
    [(longitude - west) * longitudeScale / (north - south), (north - latitude) / (north - south)]));
  return clipLakeMesh(projected, width, 1, resolution);
}

// Half-plane clipping preserves the signed area integral, including when a
// concave ring's clipped pieces are joined by cancelling edges on the boundary.
function clipRing(ring: Ring, axis: 0 | 1, boundary: number, keepGreater: boolean): Ring {
  const clipped: Point[] = [];
  if (!ring.length) return clipped;
  const other = axis === 0 ? 1 : 0;
  const inside = (point: Point) => keepGreater ? point[axis] >= boundary : point[axis] <= boundary;
  let previous = ring.at(-1)!;
  for (const current of ring) {
    if (inside(previous) !== inside(current)) {
      const t = (boundary - previous[axis]) / (current[axis] - previous[axis]);
      const transverse = previous[other] + t * (current[other] - previous[other]);
      clipped.push(axis === 0 ? [boundary, transverse] : [transverse, boundary]);
    }
    if (inside(current)) clipped.push(current);
    previous = current;
  }
  return clipped;
}

function clippedArea(ring: Ring, { x, y, width, height }: Bounds): number {
  let local: Ring = ring.map(([px, py]) => [(px - x) / width, (py - y) / height]);
  local = clipRing(clipRing(local, 0, 0, true), 0, 1, false);
  local = clipRing(clipRing(local, 1, 0, true), 1, 1, false);
  if (local.length < 3) return 0;
  let twiceArea = 0;
  let [px, py] = local.at(-1)!;
  for (const [qx, qy] of local) {
    twiceArea += px * qy - py * qx;
    [px, py] = [qx, qy];
  }
  return Math.abs(twiceArea) / 2;
}

/** Rings are open in display coordinates, with the exterior first. */
export function clipLakeMesh(rings: Ring[], width: number, height: number, resolution: LakeResolution = lakeResolutions[0]): LakeMesh {
  const [outer, ...holes] = rings;
  if (!outer || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('L’emprise du contour HydroLAKES est invalide.');
  }

  const { rows, columns } = resolution;
  const cells: LakeCell[] = [];
  // Unit-square shoelace sums: allow roundoff proportional to the number of
  // input vertices. Positive residuals under this threshold are tracked.
  const fractionTolerance = 64 * Number.EPSILON * rings.reduce((count, ring) => count + ring.length, 0);
  let discardedWetFraction = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const bounds = { x: column * width / columns, y: row * height / rows,
        width: width / columns, height: height / rows };
      const fraction = holes.reduce((area, hole) => area - clippedArea(hole, bounds), clippedArea(outer, bounds));
      if (fraction < -fractionTolerance || fraction > 1 + fractionTolerance) {
        throw new Error('La fraction humide calculée est hors limites.');
      }
      if (fraction <= fractionTolerance) discardedWetFraction += Math.max(0, fraction);
      else {
        const id = rows === lakeRows ? `C${row}${column}` : `C${row}_${column}`;
        cells.push({ ...bounds, id, row, column, wetFraction: Math.min(1, fraction) });
      }
    }
  }
  if (!cells.length) throw new Error('Le contour HydroLAKES ne contient aucune cellule humide mesurable.');
  return { ...resolution, width, height, rings, cells, fractionTolerance, discardedWetFraction };
}
