import { lakeDefaultGradientProfile, lakeDistributionId, type LakeDistribution, type LakeDomain, type LakeGradientProfile, type LakeMesh,
  lakeExchangeFlux, type LakeExchangeInputs, type LakeExchangePlan, type LakeFullNetworkInputs, type LakeFullNetworkPlan,
  type LakeNetworkInputs, type LakeNetworkPlan, type LakePlan,
  type LakeRunTrace, type SpatialTrajectory, type WetFrontier,
  type runLakeBatches } from './spatial-experiment';

export type LakeInputs = { resolution: string; kind: LakeDistribution['kind']; alpha: number; profile?: LakeGradientProfile };
export type LakeCell = LakeDomain['cells'][number];
export type LakeDisplay = 'ratio' | 'density' | 'difference';
export type LakeScaleMode = 'fixed' | 'month';
export type LakeReading = { time: number; value: number; ratio: number; density: number };
export type LakeDataset = {
  cells: ReadonlyMap<string, LakeCell>;
  trajectories: ReadonlyMap<string, SpatialTrajectory>;
  totals: readonly number[];
  trace: LakeRunTrace;
};

export const lakeDatasetLimit = 3;
export const lakeComparisonMonths = [0, 10, 20];
export const lakePlaybackInterval = 90;
export const lakePlaybackSpeeds = [1, 2, 4] as const;
export const lakePrimaryColor = '#202c38';
export const lakeComparisonColors = [
  '#0072b2', '#b54f00', '#007a59', '#9e3d87', '#956a00',
  '#6745ad', '#a92235', '#007b85', '#724b32', '#52721c',
];
export const lakeSyntheticNotice = 'Simulation expérimentale — données biologiques synthétiques';
export const lakeDistributionOptions = [
  { kind: 'homogeneous', label: 'Distribution homogène' },
  { kind: 'gradient', label: 'Gradient nord-sud' },
  { kind: 'wet-gradient', label: 'Gradient pondéré par surface humide' },
] as const;

export const lakeDisplays = {
  ratio: { label: 'Biomasse / capacité', unit: '%', limits: [0, 50, 100], colors: ['#236795', '#e3f3ed', '#218877'] },
  density: { label: 'Densité de biomasse', unit: 't/km²', limits: [0, 150, 300], colors: ['#f0f4fa', '#75a3bf', '#17476b'] },
  difference: { label: 'Écart au scénario homogène', unit: 'points de %', limits: [0, 0, 0], colors: ['#a74a14', '#f6f3eb', '#69389b'] },
} as const;

const paletteSteps = 128;
type ColorStops = readonly [string, string, string];
const lakePalettes = new Map<ColorStops, readonly string[]>(Object.values(lakeDisplays).map(({ colors }) => {
  const channels = colors.map(color => [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16)));
  const palette = Array.from({ length: 2 * paletteSteps + 1 }, (_, index) => {
    const segment = index < paletteSteps ? 0 : 1;
    const weight = index / paletteSteps - segment;
    const rgb = channels[segment]!.map((base, channel) => Math.round(base + (channels[segment + 1]![channel]! - base) * weight));
    return `rgb(${rgb.join(', ')})`;
  });
  return [colors, palette];
}));

export const lakeKey = ({ resolution, kind, alpha, profile }: LakeInputs) =>
  `${resolution}-${lakeDistributionId(kind === 'homogeneous' ? { kind } : { kind, alpha, ...(profile ? { profile } : {}) })}`;

export const lakeAlpha = (alpha: number) => String(alpha).replace('.', ',');
export const lakeProfileLabels = { 'linear-v1': 'Linéaire historique', 'sigmoid-v2': 'Sigmoïde contrastée' } as const;
export function lakeScenarioLabel({ kind, alpha, profile }: Omit<LakeInputs, 'resolution'>) {
  const label = kind !== 'homogeneous' && profile === 'sigmoid-v2'
    ? (kind === 'wet-gradient' ? 'Sigmoïde · centroïdes humides' : 'Sigmoïde · milieu des lignes')
    : lakeDistributionOptions.find(option => option.kind === kind)!.label;
  return label + (kind === 'homogeneous' ? '' : ` · α = ${lakeAlpha(alpha)}`);
}

export const lakeMonth = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const lakeNumber = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
const significant = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 5 });
const scientific = new Intl.NumberFormat('fr-FR', { notation: 'scientific', maximumSignificantDigits: 4 });
const signedNumber = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5, signDisplay: 'exceptZero' });
export const formatSmall = (value: number) => Math.abs(value) >= 1e-4 || value === 0 ? significant.format(value) : scientific.format(value);
export const lakeTonnes = (value: number | undefined) => value === undefined ? '—' : `${formatSmall(value)} t`;
export const lakeTotalTonnes = (value: number | undefined) => value === undefined ? '—' : `${lakeNumber.format(value)} t`;
export const lakeSignedTonnes = (value: number | undefined) => value === undefined ? '—'
  : `${value !== 0 && Math.abs(value) < 1e-4 ? (value > 0 ? '+' : '') + scientific.format(value) : signedNumber.format(value)} t`;

export const initialLakeView = { zoom: 1, dx: 0, dy: 0 };
export type LakeView = typeof initialLakeView;
export const lakeOutline = (mesh: LakeMesh) => mesh.rings.map(ring =>
  'M' + ring.map(point => point.join(',')).join('L') + 'Z').join('');
export const lakeFraming = (mesh: LakeMesh, { zoom, dx, dy }: LakeView) => {
  const width = (mesh.width + 0.04) / zoom;
  const height = (mesh.height + 0.04) / zoom;
  return { viewBox: `${(mesh.width - width) / 2 + dx} ${(mesh.height - height) / 2 + dy} ${width} ${height}`,
    markerRadius: width * 0.014 };
};

export type LakeExchangeOverlay = { a: string; b: string; frontier: WetFrontier; flux?: number };

export function lakeWetFrontierPath({ axis, boundary, segments }: WetFrontier) {
  return segments.map(({ start, end }) => axis === 0
    ? `M${boundary},${start}L${boundary},${end}`
    : `M${start},${boundary}L${end},${boundary}`).join('');
}

export function lakeExchangePath({ frontier, flux }: LakeExchangeOverlay, radius: number) {
  const { axis, boundary, segments, direction } = frontier;
  const segment = segments.reduce((longest, next) => next.end - next.start > longest.end - longest.start ? next : longest);
  const center = (segment.start + segment.end) / 2;
  const length = Math.min(3 * radius, (segment.end - segment.start) / 2);
  const toward = direction * (flux !== undefined && flux < 0 ? -1 : 1);
  const point = (along: number, across = 0) => (axis === 0
    ? [boundary + toward * along, center + across]
    : [center + across, boundary + toward * along]).join(',');
  const head = Math.min(radius, length / 2);
  return `M${point(-length)}L${point(length)}` + (flux
    ? `M${point(length - head, head)}L${point(length)}L${point(length - head, -head)}` : '');
}

export function lakeExchangeDirection({ a, b, flux }: LakeExchangeOverlay) {
  return flux === undefined ? undefined : flux > 0 ? `${a} → ${b}` : flux < 0 ? `${b} → ${a}` : 'Flux nul';
}

export function lakeExchangeReading(edge: LakeExchangeOverlay, dataset: LakeDataset | undefined, mu: number, tick: number): LakeExchangeOverlay {
  const a = lakeReading(dataset, edge.a, tick);
  const b = lakeReading(dataset, edge.b, tick);
  if (!dataset || !a || !b) return edge;
  return { ...edge, flux: lakeExchangeFlux(mu, dataset.cells.get(edge.a)!.area, dataset.cells.get(edge.b)!.area, a.density, b.density) };
}

export function lakeNetworkNetFlows(edges: readonly LakeExchangeOverlay[]) {
  const net = new Map<string, number>();
  for (const { a, b, flux } of edges) {
    if (flux === undefined) continue;
    net.set(a, (net.get(a) ?? 0) - flux);
    net.set(b, (net.get(b) ?? 0) + flux);
  }
  return net;
}

export const lakeMapInk = { noData: '#edf3f3', grid: '#477a74', outline: '#3b6665' };

export function lakeLegend(display: LakeDisplay, limits: readonly [number, number, number], adaptive: boolean, available: boolean) {
  const { label, unit, colors } = lakeDisplays[display];
  const difference = display === 'difference';
  const zero = limits[0] === limits[2];
  return {
    label, unit, colors: zero ? [colors[1], colors[1]] : colors,
    ticks: (zero ? [0] : limits).map(value => `${difference && value > 0 ? '+' : ''}${formatSmall(value)} ${unit}`),
    showScale: !difference || available,
    explanation: difference ? (adaptive ? 'Échelle ajustée au mois consulté.' : 'Échelle fixe sur tous les mois des scénarios affichés.')
      : display === 'ratio' ? '0 % correspond à une cellule sans biomasse, 100 % à sa capacité.'
        : 'La biomasse est rapportée à la surface humide de la cellule.',
    referenceLabel: difference ? 'Référence · distribution homogène simulée sur la même grille.' : undefined,
  };
}

export function retainLakeDataset(
  datasets: ReadonlyMap<string, LakeDataset>, key: string, dataset: LakeDataset, protectedKeys: readonly string[],
) {
  const next = new Map(datasets);
  next.delete(key);
  next.set(key, dataset);
  while (next.size > lakeDatasetLimit) {
    const oldest = [...next.keys()].find(id => !protectedKeys.includes(id)) ?? next.keys().next().value!;
    next.delete(oldest);
  }
  return next;
}

export function configureLake(inputs: LakeInputs, signal: AbortSignal): Promise<LakePlan>;
export function configureLake(inputs: LakeInputs, signal: AbortSignal, exchange: LakeExchangeInputs): Promise<LakeExchangePlan>;
export function configureLake(inputs: LakeInputs, signal: AbortSignal, exchange: LakeNetworkInputs): Promise<LakeNetworkPlan>;
export function configureLake(inputs: LakeInputs, signal: AbortSignal, exchange: LakeFullNetworkInputs): Promise<LakeFullNetworkPlan>;
export async function configureLake({ resolution, kind, alpha, profile }: LakeInputs, signal: AbortSignal,
  exchange?: LakeExchangeInputs | LakeNetworkInputs | LakeFullNetworkInputs) {
  const query = new URLSearchParams({ resolution, distribution: kind, alpha: String(alpha) });
  if (kind !== 'homogeneous') query.set('profile', profile ?? lakeDefaultGradientProfile);
  if (exchange) {
    query.set('mu', String(exchange.mu));
    if ('mode' in exchange) {
      query.set('mode', exchange.mode);
    } else if ('cells' in exchange) {
      query.set('cells', exchange.cells.join(','));
      for (const edge of exchange.edges) query.append('edge', edge.join(','));
    } else {
      query.set('a', exchange.a);
      query.set('b', exchange.b);
    }
  }
  const response = await fetch(`/api/logistic-lake?${query}`, { signal });
  if (!response.ok) {
    if (exchange && response.status === 400) {
      const { message } = await response.json();
      throw new Error(message);
    }
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export function lakeDataset(domain: LakeDomain, { observations, trace }: Awaited<ReturnType<typeof runLakeBatches>>): LakeDataset {
  const cells = new Map(domain.cells.map(cell => [cell.id, cell]));
  const totals = Array<number>(observations[0]!.samples.length).fill(0);
  const trajectories = new Map(domain.cells.map((cell, index) => {
    const samples = observations[index]!.samples;
    samples.forEach(({ value }, tick) => { totals[tick] = totals[tick]! + value; });
    return [cell.id, { cell, samples, constant: false, ...domain.parameters.simulation }] as const;
  }));
  return { cells, totals, trajectories, trace };
}

export function lakeReading(dataset: LakeDataset | undefined, id: string, tick: number): LakeReading | undefined {
  const cell = dataset?.cells.get(id);
  const sample = dataset?.trajectories.get(id)?.samples[tick];
  if (!cell || !sample) return undefined;
  return { ...sample, ratio: sample.value / cell.capacity, density: sample.value / cell.area };
}

export function lakeDensityDispersion(dataset: LakeDataset, tick: number) {
  const area = [...dataset.cells.values()].reduce((sum, cell) => sum + cell.area, 0);
  const mean = dataset.totals[tick]! / area;
  let dispersion = 0;
  for (const cell of dataset.cells.values()) {
    const reading = lakeReading(dataset, cell.id, tick)!;
    dispersion += cell.area * (reading.density - mean) ** 2;
  }
  return dispersion;
}

export function lakeMapValue(display: LakeDisplay, reading?: LakeReading, reference?: LakeReading) {
  if (!reading) return undefined;
  if (display === 'ratio') return reading.ratio * 100;
  if (display === 'density') return reading.density;
  return reference ? (reading.ratio - reference.ratio) * 100 : undefined;
}

export function lakeMapReading(
  dataset: LakeDataset | undefined, reference: LakeDataset | undefined, id: string, tick: number, display: LakeDisplay,
) {
  const reading = lakeReading(dataset, id, tick);
  const baseline = display === 'difference' ? (dataset === reference ? reading : lakeReading(reference, id, tick)) : undefined;
  return { reading, value: lakeMapValue(display, reading, baseline) };
}

export function lakeDifferenceLimit(datasets: readonly (LakeDataset | undefined)[], reference?: LakeDataset, tick?: number) {
  if (!reference) return 0;
  let limit = 0;
  for (const dataset of datasets) {
    if (!dataset || dataset === reference) continue;
    for (const [id, trajectory] of dataset.trajectories) {
      const baseline = reference.trajectories.get(id);
      if (!baseline) continue;
      const first = tick ?? 0;
      const end = tick === undefined ? trajectory.samples.length : tick + 1;
      for (let index = first; index < end; index++) {
        const a = trajectory.samples[index];
        const b = baseline.samples[index];
        if (a && b) limit = Math.max(limit, Math.abs(a.value / trajectory.cell.capacity - b.value / baseline.cell.capacity) * 100);
      }
    }
  }
  return limit;
}

export function lakeMapColor(value: number, limits: readonly [number, number, number], display: LakeDisplay) {
  const [min, middle, max] = limits;
  const palette = lakePalettes.get(lakeDisplays[display].colors)!;
  const fraction = min === max ? 1 : value >= middle ? 1 + (value - middle) / (max - middle) : (value - min) / (middle - min);
  const index = Math.max(0, Math.min(palette.length - 1, Math.round(fraction * paletteSteps)));
  return palette[index]!;
}
