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
export const lakeMaxAlpha = 0.6;
export type LakeDistribution = { kind: 'homogeneous' } | { kind: 'gradient' | 'wet-gradient'; alpha: number };

export function lakeDistributionId(distribution: LakeDistribution): string {
  return distribution.kind === 'homogeneous' ? distribution.kind : `${distribution.kind}-${distribution.alpha}`;
}

type Point = readonly [number, number];
type Ring = readonly Point[];
type Bounds = { x: number; y: number; width: number; height: number };

export type LakeCell = Bounds & {
  id: string;
  row: number;
  column: number;
  wetFraction: number;
  wetCentroid: Point;
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

// Half-plane clipping preserves area and first moments. When a concave ring
// splits, overlapping boundary edges between its pieces cancel in the sums.
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

function clippedMoments(ring: Ring, { x, y, width, height }: Bounds) {
  let local: Ring = ring.map(([px, py]) => [(px - x) / width, (py - y) / height]);
  local = clipRing(clipRing(local, 0, 0, true), 0, 1, false);
  local = clipRing(clipRing(local, 1, 0, true), 1, 1, false);
  if (local.length < 3) return { area: 0, momentX: 0, momentY: 0 };
  let twiceArea = 0;
  let sixMomentX = 0;
  let sixMomentY = 0;
  let [px, py] = local.at(-1)!;
  for (const [qx, qy] of local) {
    const cross = px * qy - py * qx;
    twiceArea += cross;
    sixMomentX += (px + qx) * cross;
    sixMomentY += (py + qy) * cross;
    [px, py] = [qx, qy];
  }
  if (twiceArea === 0) return { area: 0, momentX: 0, momentY: 0 };
  const orientation = Math.sign(twiceArea);
  return { area: Math.abs(twiceArea) / 2,
    momentX: orientation * sixMomentX / 6, momentY: orientation * sixMomentY / 6 };
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
      const wet = clippedMoments(outer, bounds);
      for (const hole of holes) {
        const dry = clippedMoments(hole, bounds);
        wet.area -= dry.area;
        wet.momentX -= dry.momentX;
        wet.momentY -= dry.momentY;
      }
      const fraction = wet.area;
      if (fraction < -fractionTolerance || fraction > 1 + fractionTolerance) {
        throw new Error('La fraction humide calculée est hors limites.');
      }
      if (fraction <= fractionTolerance) discardedWetFraction += Math.max(0, fraction);
      else {
        const id = rows === lakeRows ? `C${row}${column}` : `C${row}_${column}`;
        // Moments use cell-local coordinates. Bound roundoff at cell edges.
        const localX = Math.min(1, Math.max(0, wet.momentX / fraction));
        const localY = Math.min(1, Math.max(0, wet.momentY / fraction));
        cells.push({ ...bounds, id, row, column, wetFraction: Math.min(1, fraction),
          wetCentroid: [bounds.x + bounds.width * localX, bounds.y + bounds.height * localY] });
      }
    }
  }
  if (!cells.length) throw new Error('Le contour HydroLAKES ne contient aucune cellule humide mesurable.');
  return { ...resolution, width, height, rings, cells, fractionTolerance, discardedWetFraction };
}
