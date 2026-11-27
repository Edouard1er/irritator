import { geometryPoints, validateAtlasGeometry, type GeoGeometry, type Position } from './geo-atlas.js';

export const guiersResolutions = [1000, 500] as const;
export type GuiersResolution = typeof guiersResolutions[number];
export type GuiersConfiguration = 'H' | 'E' | 'H_PLUS' | 'HP_PLUS';
export const candidateLayers = ['lac', 'villages', 'zoneExclusionPeche', 'tipha_theoric'] as const;
type CandidateLayer = typeof candidateLayers[number];
type PolygonGeometry = Exclude<GeoGeometry, { type: 'Point' }>;
export const maxGuiersCandidateBytes = 5 * 1024 * 1024;
const areaTolerance = 0.001;

export interface GuiersCell {
  id: string; xIndex: number; yIndex: number; cellAreaM2: number;
  waterAreaM2: number; waterFraction: number; waterComponentCount: number; neighbors: string[];
  candidateProtectedFraction: number | null; theoreticalTyphaFraction: number | null; nearestVillageId: string | null;
}
export interface GuiersGrid {
  crs: 'EPSG:32628'; originM: [0, 0]; resolutionM: GuiersResolution;
  areaM2: number; cells: GuiersCell[]; gridLines: Position[][]; displayBoundsIndices: [number, number, number, number];
}
export interface GuiersReference {
  kind: 'irritator.guiers.reference'; version: 1; hydroSha256: string;
  source: { url: string; attribution: string; acquiredAt: string; observationContext: string; license: string };
  geometry: PolygonGeometry;
  grids: Record<GuiersResolution, GuiersGrid>;
}
interface LocalSource {
  id: string; url: string; attribution: string; version: string; files: Record<string, string>; acquiredAt: string;
  observationDate: null; license: null; rights: 'local_study_reviewed'; rightsEvidence: string;
  declaredCrs: string; metadataCrs: string | null; readCrs: 'EPSG:4326'; encoding: string; transformation: string;
  technical: 'checked_by_pipeline'; empirical: 'unconfirmed'; institutional: 'unconfirmed'; permittedUse: string;
}
interface CandidateFeature<G extends GeoGeometry = GeoGeometry> {
  type: 'Feature'; id: string; geometry: G;
  properties: { sourceId: string; name?: string | null; population?: number | null; id?: string | number | null };
}
export interface GuiersComparison {
  intersectionKm2: number; unionKm2: number; jaccard: number; hydroOnlyKm2: number; alternativeOnlyKm2: number;
}
interface ConnectivitySummary {
  version: 'water_parts_v1' | 'aggregate_cells_v1'; nodes: number; edges: number; components: number;
  largest: { cells: number; nodes: number; areaM2: number }; maxCells: number; isolatedNodes: number; isolatedAreaM2: number;
}
export interface GuiersConnectivity {
  parts: ConnectivitySummary; legacy: ConnectivitySummary; blockedLegacyInterfaces: number;
}
export interface GuiersWaterParts {
  version: 'water_parts_v1';
  nodes: { id: string; cellId: string; waterAreaM2: number; neighbors: string[]; geometry: PolygonGeometry; labelPoint: Position }[];
  edges: { a: string; b: string; interfaceLengthM: number }[];
}
type ConnectivityKey = `${GuiersConfiguration}_${GuiersResolution}`;
interface GuiersFishingDomain {
  geometry: PolygonGeometry;
  removedGeometry: PolygonGeometry | null;
  mask: { id: 'south_cut_min_northing_E_v1' | 'researcher_polygon_v1'; version: 1; crs: 'EPSG:32628';
    status: 'candidate_manual_review_required'; maskSha256: string; author: string; justification: string; southNorthingM: number | null;
    source: { id: string; version: string; files: Record<string, string> } | { id: 'researcher_geojson'; sha256: string; readCrs: 'EPSG:4326' };
    hydroSha256: string; observationDate: null; parameters: { boundsUtmM: [number, number, number, number] }; hashing: string };
  grids: Record<GuiersResolution, GuiersGrid>;
  villages: { id: string; insideWater: boolean; insidePerimeterMask: boolean; accessPoint: null; distanceToWaterM: number }[];
  boundsCutWgs84: Position[][];
  sensitivity: { id: 'south_cut_min_northing_envelope_v1'; southNorthingM: number; retainedKm2: number; removedKm2: number } | null;
}
export interface GuiersCandidate {
  kind: 'irritator.guiers.candidate'; version: 1 | 2; hydroSha256: string;
  sources: Partial<Record<CandidateLayer, LocalSource>>;
  grids: Partial<Record<GuiersResolution, GuiersGrid>>;
  alternativeGrids: Partial<Record<GuiersResolution, GuiersGrid>>;
  layers: { lac?: CandidateFeature<PolygonGeometry>[]; villages?: CandidateFeature<Extract<GeoGeometry, { type: 'Point' }>>[];
    zoneExclusionPeche?: CandidateFeature<PolygonGeometry>[]; tipha_theoric?: CandidateFeature<PolygonGeometry>[] };
  comparison: GuiersComparison | null; anomalies: string[];
  fishingDomain?: GuiersFishingDomain;
  connectivity?: Partial<Record<ConnectivityKey, GuiersConnectivity>>;
}

type RawObject = Record<string, unknown>;
function requireSig(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function fields(input: unknown, allowed?: readonly string[]): RawObject {
  requireSig(input && typeof input === 'object' && !Array.isArray(input), 'Objet SIG attendu.');
  const object = input as RawObject;
  requireSig(!allowed || Object.keys(object).every(key => allowed.includes(key)), 'Champ SIG inconnu.');
  return object;
}
function text(value: unknown, max = 512): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
}
function numeric(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function array(input: unknown, min: number, max: number): unknown[] {
  requireSig(Array.isArray(input) && input.length >= min && input.length <= max, 'Nombre d’éléments SIG hors limites.');
  return input as unknown[];
}
function localPosition(pos: unknown): pos is Position {
  return Array.isArray(pos) && pos.length === 2 && numeric(pos[0], -16.5, -15) && numeric(pos[1], 15, 17);
}
function date(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

function validateGrid(input: unknown, resolution: GuiersResolution, villages?: Set<string>, reserves = false, typha = false): asserts input is GuiersGrid {
  const grid = fields(input, ['crs', 'originM', 'resolutionM', 'areaM2', 'cells', 'gridLines', 'displayBoundsIndices']);
  const square = resolution ** 2;
  requireSig(grid.crs === 'EPSG:32628' && array(grid.originM, 2, 2).every(n => n === 0) && grid.resolutionM === resolution &&
    numeric(grid.areaM2, areaTolerance, 1e9), 'Projection, origine, aire ou résolution SIG invalide.');
  const [west, south, east, north] = array(grid.displayBoundsIndices, 4, 4);
  requireSig(numeric(west, 1, 10000) && numeric(south, 1, 10000) && numeric(east, west + 1, west + 250) &&
    numeric(north, south + 1, south + 250) && [west, south, east, north].every(Number.isSafeInteger),
    'Indices de la grille d’affichage invalides.');
  const columns = east - west + 1, rows = north - south + 1;
  array(grid.gridLines, rows + columns, rows + columns).forEach((line, i) => {
    const count = i < columns ? rows : columns;
    requireSig(array(line, count, count).every(localPosition), 'Grille d’affichage hors emprise.');
  });
  const cells = new Map<string, GuiersCell>();
  let total = 0;
  for (const raw of array(grid.cells, 1, 3500)) {
    const c = fields(raw, ['id', 'xIndex', 'yIndex', 'cellAreaM2', 'waterAreaM2', 'waterFraction', 'waterComponentCount',
      'neighbors', 'candidateProtectedFraction', 'theoreticalTyphaFraction', 'nearestVillageId']);
    requireSig(Number.isSafeInteger(c.xIndex) && numeric(c.xIndex, 340000 / resolution, 500000 / resolution) &&
      Number.isSafeInteger(c.yIndex) && numeric(c.yIndex, 1650000 / resolution, 1900000 / resolution) &&
      c.xIndex >= west && c.xIndex < east && c.yIndex >= south && c.yIndex < north &&
      c.id === `utm28n:h${resolution}:x${c.xIndex}:y${c.yIndex}` && !cells.has(c.id),
      'Indices ou identifiant de cellule invalides.');
    requireSig(c.cellAreaM2 === square && numeric(c.waterAreaM2, areaTolerance, square + areaTolerance) &&
      c.waterAreaM2 > areaTolerance && numeric(c.waterFraction, 0, 1) &&
      Math.abs(c.waterFraction - Math.min(1, c.waterAreaM2 / square)) < 1e-12 &&
      Number.isSafeInteger(c.waterComponentCount) && numeric(c.waterComponentCount, 1, 128), 'Aire, fraction ou composantes invalides.');
    requireSig(reserves ? numeric(c.candidateProtectedFraction, 0, 1) : c.candidateProtectedFraction === null,
      'Fraction de zone candidate incohérente.');
    requireSig(typha ? numeric(c.theoreticalTyphaFraction, 0, 1) : c.theoreticalTyphaFraction === null,
      'Fraction de Typha incohérente.');
    requireSig(villages ? text(c.nearestVillageId, 96) && villages.has(c.nearestVillageId) : c.nearestVillageId === null,
      'Village proche inconnu ou incohérent.');
    const neighbors = array(c.neighbors, 0, 4);
    requireSig(neighbors.every(value => text(value, 64)) && new Set(neighbors).size === neighbors.length &&
      (c.waterComponentCount === 1 || neighbors.length === 0), 'Voisinage d’une cellule invalide ou ambigu.');
    total += c.waterAreaM2;
    cells.set(c.id, raw as GuiersCell);
  }
  requireSig(Math.abs(total - grid.areaM2) <= Math.max(0.01, 1e-9 * grid.areaM2), 'Bilan d’aire SIG incohérent.');
  for (const c of cells.values()) for (const id of c.neighbors) {
    const n = cells.get(id);
    requireSig(n && n.neighbors.includes(c.id) && Math.abs(n.xIndex - c.xIndex) + Math.abs(n.yIndex - c.yIndex) === 1,
      'Lien aquatique absent, diagonal ou non réciproque.');
  }
}

function validateCandidateSource(input: unknown, layer: CandidateLayer): asserts input is LocalSource {
  const s = fields(input, ['id', 'url', 'attribution', 'version', 'files', 'acquiredAt', 'observationDate', 'license', 'rights',
    'rightsEvidence', 'declaredCrs', 'metadataCrs', 'readCrs', 'encoding', 'transformation', 'technical', 'empirical',
    'institutional', 'permittedUse']);
  requireSig(s.id === `viabFishSng:${layer}` && s.url === 'https://github.com/ElCep/viabFishSng' &&
    text(s.version, 40) && /^[a-f0-9]{40}$/.test(s.version) && date(s.acquiredAt) &&
    s.readCrs === 'EPSG:4326' && s.technical === 'checked_by_pipeline' && s.empirical === 'unconfirmed' &&
    s.institutional === 'unconfirmed' && s.rights === 'local_study_reviewed' && s.license === null && s.observationDate === null &&
    (s.metadataCrs === null || text(s.metadataCrs)), 'Provenance ou qualification de couche candidate invalide.');
  for (const key of ['attribution', 'rightsEvidence', 'declaredCrs', 'encoding', 'transformation', 'permittedUse']) {
    requireSig(text(s[key]), 'Métadonnées ou référence d’autorisation locale absentes.');
  }
  const files = fields(s.files, ['shp', 'shx', 'dbf', 'prj', 'cpg', 'qmd'].map(ext => `${layer}.${ext}`));
  for (const ext of ['shp', 'shx', 'dbf', 'prj']) requireSig(Object.hasOwn(files, `${layer}.${ext}`), 'Composant de source absent.');
  requireSig(Object.values(files).every(hash => text(hash, 64) && /^[a-f0-9]{64}$/.test(hash)), 'Empreinte de source invalide.');
}

function sha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validateFishingDomain(input: unknown, reference: GuiersReference, villageIds: Set<string>,
  reserves: boolean, typha: boolean, lac: unknown, budget: { vertices: number }): asserts input is GuiersFishingDomain {
  const domain = fields(input, ['geometry', 'removedGeometry', 'mask', 'grids', 'villages', 'boundsCutWgs84', 'sensitivity']);
  for (const geometry of [domain.geometry, ...(domain.removedGeometry === null ? [] : [domain.removedGeometry])]) {
    validateAtlasGeometry(geometry, budget, true);
    requireSig(geometry.type !== 'Point' && geometryPoints(geometry).every(localPosition), 'Contour de pêche ou retrait invalide.');
  }
  const mask = fields(domain.mask, ['id', 'version', 'crs', 'status', 'source', 'hydroSha256', 'author', 'justification',
    'observationDate', 'southNorthingM', 'parameters', 'maskSha256', 'hashing']);
  requireSig(mask.version === 1 && mask.crs === 'EPSG:32628' && mask.status === 'candidate_manual_review_required' &&
    mask.hydroSha256 === reference.hydroSha256 && sha256(mask.maskSha256) && text(mask.hashing) && mask.observationDate === null &&
    text(mask.author) && text(mask.justification), 'Provenance du périmètre candidat invalide.');
  const [west, south, east, north] = array(fields(mask.parameters, ['boundsUtmM']).boundsUtmM, 4, 4);
  requireSig(numeric(west, 300000, 600000) && numeric(east, west, 600000) && east > west &&
    numeric(south, 1600000, 2000000) && numeric(north, south, 2000000) && north > south, 'Emprise du masque invalide.');
  if (mask.id === 'south_cut_min_northing_E_v1') {
    const source = fields(mask.source, ['id', 'version', 'files']);
    const original = lac as LocalSource | undefined;
    const files = fields(source.files);
    requireSig(original && source.id === original.id && source.version === original.version && mask.southNorthingM === south &&
      Object.keys(files).length === Object.keys(original.files).length && Object.entries(original.files).every(([k, v]) => files[k] === v),
      'La coupure doit référencer la version locale du contour E.');
  } else {
    const source = fields(mask.source, ['id', 'sha256', 'readCrs']);
    requireSig(mask.id === 'researcher_polygon_v1' && mask.southNorthingM === null && source.id === 'researcher_geojson' &&
      source.readCrs === 'EPSG:4326' && sha256(source.sha256), 'Source du périmètre explicite invalide.');
  }
  const grids = fields(domain.grids, ['500', '1000']);
  for (const resolution of guiersResolutions) {
    const grid = grids[resolution];
    validateGrid(grid, resolution, villageIds.size ? villageIds : undefined, reserves, typha);
    const hCells = new Map(reference.grids[resolution].cells.map(c => [c.id, c.waterAreaM2]));
    requireSig(grid.cells.every(c => hCells.has(c.id) && c.waterAreaM2 <= hCells.get(c.id)! + areaTolerance),
      'Les cellules du périmètre de pêche doivent rester dans H.');
  }
  const area = (grids[1000] as GuiersGrid).areaM2;
  const hydroArea = reference.grids[1000].areaM2;
  requireSig(Math.abs(area - (grids[500] as GuiersGrid).areaM2) <= areaTolerance && area <= hydroArea + areaTolerance &&
    (domain.removedGeometry !== null || Math.abs(area - hydroArea) <= areaTolerance), 'Bilan d’aire du périmètre invalide.');
  const visited = new Set<string>();
  for (const entry of array(domain.villages, villageIds.size, villageIds.size)) {
    const village = fields(entry, ['id', 'insideWater', 'insidePerimeterMask', 'accessPoint', 'distanceToWaterM']);
    requireSig(text(village.id, 96) && villageIds.has(village.id) && !visited.has(village.id) &&
      typeof village.insideWater === 'boolean' && typeof village.insidePerimeterMask === 'boolean' && village.accessPoint === null &&
      numeric(village.distanceToWaterM, 0, 3e5) && (!village.insideWater || (village.insidePerimeterMask && village.distanceToWaterM === 0)),
      'Situation du village ou point d’accès invalide.');
    visited.add(village.id);
  }
  requireSig(array(domain.boundsCutWgs84, 0, 5000).every(line => array(line, 2, 5000).every(localPosition)), 'Interface de coupure invalide.');
  if (domain.sensitivity !== null) {
    const s = fields(domain.sensitivity, ['id', 'southNorthingM', 'retainedKm2', 'removedKm2']);
    requireSig(s.id === 'south_cut_min_northing_envelope_v1' && numeric(s.southNorthingM, 1600000, 2000000) &&
      numeric(s.retainedKm2, 0, hydroArea / 1e6 + 1e-9) && numeric(s.removedKm2, 0, hydroArea / 1e6 + 1e-9) &&
      Math.abs((s.retainedKm2 + s.removedKm2) * 1e6 - hydroArea) <= areaTolerance, 'Variante de sensibilité incohérente.');
  }
}

function validateConnectivity(input: unknown, grid: GuiersGrid) {
  const c = fields(input, ['parts', 'legacy', 'blockedLegacyInterfaces']);
  requireSig(Number.isSafeInteger(c.blockedLegacyInterfaces) && numeric(c.blockedLegacyInterfaces, 0, 2 * grid.cells.length),
    'Nombre d’interfaces historiques bloquées invalide.');
  for (const key of ['parts', 'legacy'] as const) {
    const s = fields(c[key], ['version', 'nodes', 'edges', 'components', 'largest', 'maxCells', 'isolatedNodes', 'isolatedAreaM2']);
    const expectedNodes = key === 'parts' ? grid.cells.reduce((n, cell) => n + cell.waterComponentCount, 0) : grid.cells.length;
    requireSig(s.version === (key === 'parts' ? 'water_parts_v1' : 'aggregate_cells_v1') && s.nodes === expectedNodes &&
      Number.isSafeInteger(s.edges) && numeric(s.edges, 0, expectedNodes * 128) && Number.isSafeInteger(s.components) &&
      numeric(s.components, Math.max(1, expectedNodes - s.edges), expectedNodes) && Number.isSafeInteger(s.isolatedNodes) &&
      numeric(s.isolatedNodes, 0, s.components) && numeric(s.isolatedAreaM2, 0, grid.areaM2 + areaTolerance) &&
      (s.isolatedNodes === 0) === (s.isolatedAreaM2 === 0), 'Résumé de connectivité invalide.');
    const largest = fields(s.largest, ['cells', 'nodes', 'areaM2']);
    requireSig(Number.isSafeInteger(largest.nodes) && numeric(largest.nodes, 1, expectedNodes) &&
      Number.isSafeInteger(largest.cells) && numeric(largest.cells, 1, Math.min(largest.nodes, grid.cells.length)) &&
      Number.isSafeInteger(s.maxCells) && numeric(s.maxCells, largest.cells, grid.cells.length) &&
      numeric(largest.areaM2, Number.MIN_VALUE, grid.areaM2 + areaTolerance), 'Plus grande composante incohérente.');
  }
}

export function parseGuiersCandidate(raw: string, reference: GuiersReference): GuiersCandidate {
  requireSig(new TextEncoder().encode(raw).length <= maxGuiersCandidateBytes, 'Fichier SIG trop volumineux (5 Mio maximum).');
  const value: unknown = JSON.parse(raw);
  const b = fields(value, ['kind', 'version', 'hydroSha256', 'sources', 'grids', 'alternativeGrids', 'layers', 'comparison', 'anomalies', 'fishingDomain', 'connectivity']);
  requireSig(b.kind === 'irritator.guiers.candidate' && (b.version === 1 || b.version === 2) && b.hydroSha256 === reference.hydroSha256,
    'Format, version ou empreinte HydroLAKES incompatibles. Lv+ exige un jeu de preuves par couche.');
  const sources = fields(b.sources, candidateLayers);
  const layers = fields(b.layers, candidateLayers);
  requireSig(Object.keys(layers).length > 0 && Object.keys(layers).length === Object.keys(sources).length, 'Couches candidates absentes ou incomplètes.');
  const ids = new Set<string>(), villageIds = new Set<string>(), commits = new Set<string>(), budget = { vertices: 0 };
  for (const layer of candidateLayers) {
    if (!Object.hasOwn(layers, layer)) continue;
    const source = sources[layer];
    validateCandidateSource(source, layer);
    commits.add(source.version);
    for (const rawFeature of array(layers[layer], 1, layer === 'lac' ? 1 : 128)) {
      const f = fields(rawFeature, ['type', 'id', 'geometry', 'properties']);
      const prefix = `${layer}:${source.version}:`;
      requireSig(f.type === 'Feature' && text(f.id, 96) && f.id.startsWith(prefix) &&
        /^\d{3,}$/.test(f.id.slice(prefix.length)) && !ids.has(f.id), 'Identifiant candidat invalide ou dupliqué.');
      ids.add(f.id);
      validateAtlasGeometry(f.geometry, budget, true);
      requireSig(geometryPoints(f.geometry).every(localPosition) &&
        (layer === 'villages') === (f.geometry.type === 'Point'), 'Type ou emprise de couche incompatible.');
      const p = fields(f.properties);
      requireSig(Object.keys(p).length <= 24 && Object.entries(p).every(([k, v]) =>
        /^[\w-]{1,64}$/.test(k) && (v === null || text(v) || v === '' || numeric(v, -1e12, 1e12))),
        'Attributs de couche invalides.');
      requireSig(p.sourceId === source.id, 'Source d’objet incohérente.');
      if (layer === 'villages') {
        requireSig((p.name === null || text(p.name, 160)) && (p.population === null ||
          (Number.isSafeInteger(p.population) && numeric(p.population, 0, 1e9))), 'Nom ou population de village invalide.');
        villageIds.add(f.id);
      }
    }
  }
  requireSig(commits.size === 1, 'Les couches candidates doivent provenir de la même version source.');
  const plus = fields(b.grids, ['500', '1000']), alternative = fields(b.alternativeGrids, ['500', '1000']);
  const enriched = Boolean(layers.villages || layers.zoneExclusionPeche || layers.tipha_theoric);
  requireSig(Object.keys(plus).length === (enriched ? 2 : 0) &&
    Object.keys(alternative).length === (layers.lac ? 2 : 0), 'Résolutions candidates incomplètes.');
  for (const resolution of guiersResolutions) {
    const grid = plus[resolution], baseline = reference.grids[resolution];
    if (enriched) {
      validateGrid(grid, resolution, layers.villages ? villageIds : undefined, Boolean(layers.zoneExclusionPeche), Boolean(layers.tipha_theoric));
      const cells = new Map(grid.cells.map(c => [c.id, c]));
      requireSig(cells.size === baseline.cells.length && Math.abs(grid.areaM2 - baseline.areaM2) <= 1e-5 &&
        baseline.cells.every(c => {
          const match = cells.get(c.id);
          return match && Math.abs(match.waterAreaM2 - c.waterAreaM2) <= 1e-6 &&
            match.waterComponentCount === c.waterComponentCount && c.neighbors.every(n => match.neighbors.includes(n)) &&
            match.neighbors.length === c.neighbors.length;
        }), 'H+ doit reprendre exactement le masque et la topologie de H.');
      // Always use the shipped H geometry, indices, areas and grid lines for H+.
      plus[resolution] = { ...baseline, cells: baseline.cells.map(c => {
        const { candidateProtectedFraction, theoreticalTyphaFraction, nearestVillageId } = cells.get(c.id)!;
        return { ...c, candidateProtectedFraction, theoreticalTyphaFraction, nearestVillageId };
      }) };
    }
    if (layers.lac) validateGrid(alternative[resolution], resolution);
  }
  requireSig(array(b.anomalies, 0, 160).every(note => text(note)), 'Anomalie SIG invalide.');
  if (layers.lac) {
    const m = fields(b.comparison, ['intersectionKm2', 'unionKm2', 'jaccard', 'hydroOnlyKm2', 'alternativeOnlyKm2']);
    const h = reference.grids[1000].areaM2 / 1e6;
    const e = (alternative[1000] as GuiersGrid).areaM2 / 1e6;
    requireSig(numeric(m.intersectionKm2, 0, Math.min(h, e)) && numeric(m.unionKm2, 0, h + e + 1e-8) &&
      numeric(m.jaccard, 0, 1) && numeric(m.hydroOnlyKm2, 0, h + 1e-8) && numeric(m.alternativeOnlyKm2, 0, e + 1e-8) &&
      Math.abs(h - m.intersectionKm2 - m.hydroOnlyKm2) < 1e-7 && Math.abs(e - m.intersectionKm2 - m.alternativeOnlyKm2) < 1e-7 &&
      Math.abs(h + e - m.intersectionKm2 - m.unionKm2) < 1e-7 && Math.abs(m.intersectionKm2 / m.unionKm2 - m.jaccard) < 1e-7 &&
      Math.abs(e * 1e6 - (alternative[500] as GuiersGrid).areaM2) < 0.001, 'Bilan de comparaison H/E incohérent.');
  } else requireSig(b.comparison === null, 'Comparaison invalide en l’absence du contour E.');
  if (b.version === 2) {
    validateFishingDomain(b.fishingDomain, reference, villageIds, Boolean(layers.zoneExclusionPeche),
      Boolean(layers.tipha_theoric), sources.lac, budget);
    const expected = new Map<string, GuiersGrid>();
    for (const h of guiersResolutions) {
      expected.set(`H_${h}`, reference.grids[h]);
      expected.set(`HP_PLUS_${h}`, b.fishingDomain.grids[h]);
      if (layers.lac) expected.set(`E_${h}`, alternative[h] as GuiersGrid);
      if (enriched) expected.set(`H_PLUS_${h}`, plus[h] as GuiersGrid);
    }
    const connectivity = fields(b.connectivity, [...expected.keys()]);
    for (const [key, grid] of expected) validateConnectivity(connectivity[key], grid);
  } else requireSig(!Object.hasOwn(b, 'fishingDomain') && !Object.hasOwn(b, 'connectivity'), 'Le périmètre de pêche exige un fichier SIG version 2.');
  return value as GuiersCandidate;
}

export function guiersGrid(reference: GuiersReference, configuration: GuiersConfiguration, resolution: GuiersResolution, candidate?: GuiersCandidate) {
  if (configuration === 'E') return candidate?.alternativeGrids[resolution];
  if (configuration === 'H_PLUS') return candidate?.grids[resolution];
  if (configuration === 'HP_PLUS') return candidate?.fishingDomain?.grids[resolution];
  return reference.grids[resolution];
}

export function guiersIdentity(configuration: GuiersConfiguration, resolution: GuiersResolution, hydroSha256: string, candidateSha256?: string) {
  if (configuration !== 'H' && !candidateSha256) throw new Error('Empreinte du référentiel candidat requise.');
  return [configuration === 'HP_PLUS' ? 2 : 1, configuration, resolution, hydroSha256, configuration === 'H' ? '' : candidateSha256].join(':');
}
