import type { RunRequest } from './index.js';
import { temporalScope, validateTemporal } from './temporal.js';

export type Polygon = number[][][];
export interface GeographicFeature {
  type: 'Feature';
  properties: { id: string; name: string; role: 'lake' | 'zone'; accessibility?: number; provenance?: string };
  geometry: { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] };
}
export interface TerritoryGeography {
  type: 'FeatureCollection';
  id: string;
  name: string;
  source: string;
  demonstration: boolean;
  features: GeographicFeature[];
}
export interface TerritorialSelection {
  geography: TerritoryGeography;
  zoneId: string;
  accessibility: number;
  provenance: string;
  parameter: 'a';
}

const fail = (message: string): never => { throw new Error(message); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Objet GeoJSON attendu.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Propriété géographique non reconnue.');
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 500; }
export function validateAccessibility(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail('Accessibilité requise entre 0 et 1, finie et sans dimension.');
}
function polygon(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 128) fail('Polygone vide ou trop complexe.');
  for (const ring of value as unknown[]) {
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > 20000) fail('Anneau GeoJSON invalide.');
    for (const point of ring as unknown[]) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(n => typeof n === 'number' && Number.isFinite(n)) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) fail('Coordonnées longitude/latitude invalides.');
    }
    const points = ring as number[][];
    if (points[0]![0] !== points.at(-1)![0] || points[0]![1] !== points.at(-1)![1]) fail('Anneau GeoJSON non fermé.');
    const area = points.slice(1).reduce((sum, p, i) => sum + points[i]![0]! * p[1]! - p[0]! * points[i]![1]!, 0);
    if (Math.abs(area) < 1e-14) fail('Anneau GeoJSON sans surface.');
  }
}
/** Local, offline contract. Passing validation does not establish geographic authority. */
export function validateGeography(input: unknown): asserts input is TerritoryGeography {
  const data = object(input);
  keys(data, ['type', 'id', 'name', 'source', 'demonstration', 'features']);
  if (data.type !== 'FeatureCollection' || !text(data.id) || !text(data.name) || !text(data.source) || typeof data.demonstration !== 'boolean' || !Array.isArray(data.features) || data.features.length > 128) fail('Collection GeoJSON : identifiant, nom, source et statut de démonstration requis (128 éléments maximum).');
  const ids = new Set<string>();
  for (const item of data.features as unknown[]) {
    const f = object(item), p = object(f.properties), g = object(f.geometry);
    keys(f, ['type', 'properties', 'geometry']); keys(p, ['id', 'name', 'role', 'accessibility', 'provenance']); keys(g, ['type', 'coordinates']);
    if (f.type !== 'Feature' || !text(p.id) || !text(p.name) || !['lake', 'zone'].includes(String(p.role))) fail('Chaque élément exige un identifiant stable, un nom et un rôle lake/zone.');
    if (ids.has(p.id as string)) fail('Identifiant géographique dupliqué.'); ids.add(p.id as string);
    if (p.accessibility !== undefined) validateAccessibility(p.accessibility);
    if (p.provenance !== undefined && !text(p.provenance)) fail('Provenance invalide.');
    if (g.type === 'Polygon') polygon(g.coordinates);
    else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length && g.coordinates.length <= 128) g.coordinates.forEach(polygon);
    else fail('Géométrie Polygon ou MultiPolygon requise.');
  }
}
export function geographicZone(geography: TerritoryGeography, id: string): GeographicFeature {
  return geography.features.find(f => f.properties.role === 'zone' && f.properties.id === id) ?? fail('Zone inexistante.');
}
/** Algebraic display only; never integrates a biological trajectory or alters N. */
export function accessibleBiomass(biomass: number | undefined, accessibility: number | undefined): number | undefined {
  if (biomass === undefined || !Number.isFinite(biomass) || biomass < 0 || accessibility === undefined) return undefined;
  validateAccessibility(accessibility);
  return biomass * accessibility;
}
export function validateTerritory(request: RunRequest) {
  const t = request.territory;
  if (!t) return;
  if (request.schemaVersion !== 3 || !request.temporal) fail('Sélection territoriale : expérience temporelle v3 requise.');
  validateGeography(t.geography);
  const zone = geographicZone(t.geography, t.zoneId).properties;
  validateAccessibility(t.accessibility);
  if (t.parameter !== 'a' || !text(t.provenance) || t.provenance !== zone.provenance || t.accessibility !== zone.accessibility || request.temporal!.parameters.a !== t.accessibility || request.temporal!.interventions.some(row => row.parameter === 'a')) fail('La zone et le paramètre a doivent avoir une source de vérité unique ; les changements d’accès en cours de simulation restent réservés à un prochain incrément.');
  if (temporalScope(request)?.components.find(c => c.id === 'a')?.parameters.value !== t.accessibility) fail('Paramètre a du graphe différent de la sélection territoriale.');
}
/** Explicit confirmation only. Prepare a copy and validate before committing to UI state. */
export function applyTerritorialZone(request: RunRequest, geography: TerritoryGeography, id: string): RunRequest {
  validateGeography(geography);
  const zone = geographicZone(geography, id).properties;
  validateAccessibility(zone.accessibility);
  if (!text(zone.provenance)) fail('Provenance de l’accessibilité requise.');
  validateTemporal(request);
  const temporal = request.temporal ?? fail('Ouvrez le modèle atelier-interventions-month-v3 pour préparer une zone.');
  if (temporal.interventions.some(row => row.parameter === 'a')) fail('Une intervention modifie déjà l’accès. Préparez une nouvelle expérience sans changement d’accès.');
  const next = structuredClone(request);
  next.temporal!.parameters.a = zone.accessibility;
  temporalScope(next)!.components.find(c => c.id === 'a')!.parameters.value = zone.accessibility;
  next.territory = { geography: structuredClone(geography), zoneId: id, accessibility: zone.accessibility, provenance: zone.provenance!, parameter: 'a' };
  validateTemporal(next); validateTerritory(next);
  return next;
}
export function initialTerritorialBiomass(request: RunRequest): number | undefined {
  try { validateTemporal(request); } catch { return undefined; }
  if (!request.temporal) return undefined;
  const n = temporalScope(request)?.components.find(c => c.id === 'N')?.parameters.X;
  return n !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined;
}
