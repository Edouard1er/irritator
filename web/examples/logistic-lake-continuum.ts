// The experiment constants are explicit so the continuous reference can run
// without the cell generator, runner, or frontend.
export const lakeContinuumParameters = {
  areaKm2: 300,
  initialTonnes: 45_000,
  capacityTonnes: 90_000,
  growthPerMonth: 0.35,
  horizonMonths: 20,
  samplingIntervalMonths: 0.1,
} as const;

type Point = readonly [number, number];
type Edge = { north: Point; south: Point };
type Band = { top: number; height: number; topWidth: number; bottomWidth: number };
const maxPanelsPerBand = 1024;

function projectedRings(data: unknown): Point[][] {
  const collection = data as { type?: unknown; features?: unknown } | null;
  const feature = Array.isArray(collection?.features) && collection.features.length === 1
    ? collection.features[0] as { geometry?: { type?: unknown; coordinates?: unknown } } | null : null;
  const geometry = feature?.geometry;
  if (collection?.type !== 'FeatureCollection' || geometry?.type !== 'Polygon' ||
      !Array.isArray(geometry.coordinates) || !geometry.coordinates.length) {
    throw new Error('La référence continue attend un polygone HydroLAKES.');
  }
  const rings = geometry.coordinates as Point[][];
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4 || ring.some(point =>
      !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) ||
      ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1]) {
      throw new Error('Anneau HydroLAKES invalide.');
    }
  }

  const exterior = rings[0]!;
  const west = Math.min(...exterior.map(([longitude]) => longitude));
  const latitudes = exterior.map(([, latitude]) => latitude);
  const north = Math.max(...latitudes);
  const south = Math.min(...latitudes);
  const height = north - south;
  if (!(height > 0)) throw new Error('Emprise nord-sud HydroLAKES invalide.');

  // Same affine projection as the experiment. Its y axis increases southward.
  const longitudeScale = Math.cos((north + south) * Math.PI / 360) / height;
  return rings.map(ring => ring.map(([longitude, latitude]) =>
    [(longitude - west) * longitudeScale, (north - latitude) / height]));
}

function longitudeAt({ north: [nx, ny], south: [sx, sy] }: Edge, y: number) {
  return nx + (sx - nx) * ((y - ny) / (sy - ny));
}

function wetBands(rings: Point[][]): Band[] {
  const levels = new Set<number>();
  const edges: Edge[] = [];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!;
      const b = ring[i]!;
      levels.add(a[1]);
      if (a[1] !== b[1]) edges.push(a[1] < b[1] ? { north: a, south: b } : { north: b, south: a });
    }
  }

  const boundaries = [...levels].sort((a, b) => a - b);
  const bands: Band[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const top = boundaries[i - 1]!;
    const bottom = boundaries[i]!;
    // Use edges that cross the interior of the band. Horizontal edges and
    // vertices on its boundaries do not contribute extra intersections.
    const intersections = edges.filter(({ north, south }) => north[1] <= top && south[1] >= bottom)
      .map(edge => ({ top: longitudeAt(edge, top), bottom: longitudeAt(edge, bottom) }))
      .sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
    if (intersections.length % 2 !== 0) throw new Error('Section HydroLAKES ouverte.');

    let topWidth = 0;
    let bottomWidth = 0;
    // Even-odd intervals across all rings exclude islands regardless of
    // winding and include disconnected wet parts of a section.
    for (let j = 0; j < intersections.length; j += 2) {
      const left = intersections[j]!;
      const right = intersections[j + 1]!;
      topWidth += Math.max(0, right.top - left.top);
      bottomWidth += Math.max(0, right.bottom - left.bottom);
    }
    bands.push({ top, height: bottom - top, topWidth, bottomWidth });
  }
  return bands;
}

function quadrature(bands: Band[], area: number, alpha: number, normalization: number, panelsPerBand: number) {
  const { initialTonnes, capacityTonnes } = lakeContinuumParameters;
  const nodes = [(1 - 1 / Math.sqrt(3)) / 2, (1 + 1 / Math.sqrt(3)) / 2];
  const count = bands.length * panelsPerBand * nodes.length;
  const areaWeights = new Float64Array(count);
  const initialRatios = new Float64Array(count);
  let index = 0;
  for (const { top, height, topWidth, bottomWidth } of bands) {
    const weight = height / (2 * panelsPerBand * area);
    for (let panel = 0; panel < panelsPerBand; panel++) {
      for (const node of nodes) {
        const fraction = (panel + node) / panelsPerBand;
        const y = top + fraction * height;
        const width = (1 - fraction) * topWidth + fraction * bottomWidth;
        areaWeights[index] = weight * width;
        initialRatios[index] = (initialTonnes / capacityTonnes) * (1 + alpha * (0.5 - y)) / normalization;
        index++;
      }
    }
  }
  return { areaWeights, initialRatios };
}

function integrate(months: readonly number[], { areaWeights, initialRatios }: ReturnType<typeof quadrature>) {
  const { growthPerMonth, capacityTonnes } = lakeContinuumParameters;
  return months.map(time => {
    const q = Math.exp(-growthPerMonth * time);
    let sum = 0;
    let correction = 0;
    for (let i = 0; i < areaWeights.length; i++) {
      const initial = initialRatios[i]!;
      const value = areaWeights[i]! * initial / (q + (1 - q) * initial);
      const adjusted = value - correction;
      const next = sum + adjusted;
      correction = (next - sum) - adjusted;
      sum = next;
    }
    return capacityTonnes * sum;
  });
}

/** Continuous reference over the local projected HydroLAKES polygon. */
export function lakeContinuumFromGeoJson(data: unknown) {
  const rings = projectedRings(data);
  const bands = wetBands(rings);
  let projectedArea = 0;
  let projectedNorthSouthMoment = 0;
  for (const { top, height, topWidth, bottomWidth } of bands) {
    // W is affine on each band. Integrate W and yW exactly in real arithmetic.
    const area = height * (topWidth + bottomWidth) / 2;
    projectedArea += area;
    projectedNorthSouthMoment += top * area + height ** 2 * (topWidth + 2 * bottomWidth) / 6;
  }
  if (!(projectedArea > 0)) throw new Error('Le contour HydroLAKES ne contient aucune surface humide.');
  const meanY = projectedNorthSouthMoment / projectedArea;

  function trajectory(alpha: number, months: readonly number[], toleranceTonnes = 1e-8) {
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 0.6) throw new RangeError('Intensité hors de [0 ; 0,6].');
    if (!months.length || !months.every(time => time >= 0)) throw new RangeError('Dates non négatives attendues.');
    if (!Number.isFinite(toleranceTonnes) || toleranceTonnes <= 0) throw new RangeError('Tolérance positive attendue.');
    const normalization = 1 + alpha * (0.5 - meanY);
    const refinements: { panelsPerBand: number; maxDifferenceTonnes: number | null }[] = [];
    let previous: number[] | undefined;
    let agreements = 0;
    for (let panelsPerBand = 1; panelsPerBand <= maxPanelsPerBand; panelsPerBand *= 2) {
      const totalsTonnes = integrate(months, quadrature(bands, projectedArea, alpha, normalization, panelsPerBand));
      const maxDifferenceTonnes = previous === undefined ? null
        : totalsTonnes.reduce((max, value, i) => Math.max(max, Math.abs(value - previous![i]!)), 0);
      refinements.push({ panelsPerBand, maxDifferenceTonnes });
      agreements = maxDifferenceTonnes !== null && maxDifferenceTonnes <= toleranceTonnes ? agreements + 1 : 0;
      if (agreements === 2) return { totalsTonnes, normalization, toleranceTonnes, refinements };
      previous = totalsTonnes;
    }
    throw new Error(`Quadrature non stabilisée à ${toleranceTonnes} t après ${maxPanelsPerBand} panneaux par bande.`);
  }

  return { projectedArea, projectedNorthSouthMoment, meanY, ringCount: rings.length, bandCount: bands.length, trajectory };
}
