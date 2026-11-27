/** Independent knowledge document. Never part of RunRequest or a native request. */
export type Position = [number, number];
export type GeoGeometry = { type: 'Point'; coordinates: Position } | { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };
export interface GeoSourceRecord {
  id: string; title: string; organization: string;
  classification: 'verified-dataset' | 'workshop-declaration' | 'institutional-plan' | 'fictional-demo';
  sourceUrl?: string; license?: string; datasetVersion?: string; retrievedAt?: string;
  geometryValidAt?: string; transformation?: string; sourceFileSha256?: string; attribution?: string; limitations?: string;
}
export interface GeoAtlasFeature {
  type: 'Feature'; id: string; geometry: GeoGeometry | null;
  properties: {
    name: string; kind: 'water-outline' | 'reference-place' | 'fishing-point' | 'fishing-area' | 'reserve-information';
    sourceId: string; evidence: 'reference-outline' | 'declared-unverified' | 'planned-unlocated' | 'illustrative-only';
    precision: 'exact-source' | 'approximate' | 'unknown'; share: 'workshop-only' | 'exportable-with-review';
    description?: string; recordedAt?: string; supersedesId?: string;
  };
}
export interface GeoAtlasV1 {
  kind: 'irritator.level2.geo-atlas'; version: 1; id: string; revision: number;
  createdAt: string; updatedAt: string; crs: 'EPSG:4326'; sources: GeoSourceRecord[]; features: GeoAtlasFeature[];
}
export const maxAtlasBytes = 2 * 1024 * 1024;
const fail = (s: string): never => { throw new Error(s); };
function object(v: unknown, allowed: string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('Objet cartographique attendu.');
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some(k => !allowed.includes(k))) fail('Champ cartographique inconnu.');
  return o;
}
function text(v: unknown, max = 1000): asserts v is string { if (typeof v !== 'string' || !v.trim() || v.length > max) fail('Texte absent ou trop long.'); }
function id(v: unknown): asserts v is string { text(v, 96); if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(v)) fail('Identifiant cartographique invalide.'); }
function date(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('Date UTC invalide.'); }
function choice(v: unknown, options: string[]) { if (typeof v !== 'string' || !options.includes(v)) fail('Catégorie cartographique inconnue.'); }
function point(v: unknown): asserts v is Position { if (!Array.isArray(v) || v.length !== 2 || !v.every(n => typeof n === 'number' && Number.isFinite(n)) || Math.abs(v[0]) > 180 || Math.abs(v[1]) > 90) fail('Coordonnées longitude/latitude invalides.'); }
const cross = (a: Position, b: Position, c: Position) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a: Position, b: Position, p: Position) => Math.abs(cross(a,b,p)) < 1e-14 && p[0] >= Math.min(a[0],b[0]) && p[0] <= Math.max(a[0],b[0]) && p[1] >= Math.min(a[1],b[1]) && p[1] <= Math.max(a[1],b[1]);
function intersects(a: Position, b: Position, c: Position, d: Position) {
  return cross(a,b,c) * cross(a,b,d) < 0 && cross(c,d,a) * cross(c,d,b) < 0 || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
}
export function pointInRing(p: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) { const a=ring[i]!,b=ring[j]!; if (onSegment(a,b,p)) return true; if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside; }
  return inside;
}
const ringsIntersect = (a: Position[], b: Position[]) => a.slice(1).some((p,i) => b.slice(1).some((q,j) => intersects(a[i]!,p,b[j]!,q)));
function polygon(v: unknown, budget: { vertices: number }, allowAdjacentRepeats: boolean): Position[][] {
  if (!Array.isArray(v) || !v.length || v.length > 32) fail('Polygone vide ou trop complexe.');
  const rings = v as unknown[];
  const poly: Position[][] = [];
  for (const r of rings) {
    if (!Array.isArray(r) || r.length < 4 || r.length > 2048) fail('Anneau : 4 à 2048 sommets requis.');
    const rawRing = r as Position[]; rawRing.forEach(point); budget.vertices += rawRing.length;
    if (budget.vertices > 20000) fail('Atlas trop complexe (20000 sommets maximum).');
    if (String(rawRing[0]) !== String(rawRing.at(-1))) fail('Anneau non fermé. Fermez le secteur.');
    // SHP sources may contain zero-length steps. Keep the source coordinates and
    // ignore only adjacent repetitions when checking the topology of an overlay.
    const ring = allowAdjacentRepeats ? rawRing.filter((p, i) => i === 0 || String(p) !== String(rawRing[i-1])) : rawRing;
    if (ring.length < 4) fail('Anneau dégénéré, sans surface.');
    poly.push(ring);
    const unique = ring.slice(0,-1);
    if (new Set(unique.map(p => p.join(','))).size !== unique.length) fail('Sommet répété.');
    // Translate near the origin to avoid cancellation on small workshop sectors.
    const area = unique.reduce((sum,p,i) => sum + cross(ring[0]!,p,ring[i+1]!),0);
    if (Math.abs(area) < 1e-14) fail('Secteur dégénéré, sans surface.');
    for (let i=0;i<ring.length-1;i++) {
      if (onSegment(ring[i]!,ring[i+1]!,ring[(i+2)%(ring.length-1)]!)) fail('Arête repliée ou sommet colinéaire.');
      for (let j=i+2;j<ring.length-1;j++) if (!(i===0 && j===ring.length-2) && intersects(ring[i]!,ring[i+1]!,ring[j]!,ring[j+1]!)) fail('Secteur auto-croisé.');
    }
  }
  for (let i=1;i<poly.length;i++) {
    if (!pointInRing(poly[i]![0]!,poly[0]!) || ringsIntersect(poly[0]!,poly[i]!)) fail('Trou hors du contour ou touchant le contour.');
    for (let j=1;j<i;j++) if (ringsIntersect(poly[i]!,poly[j]!) || pointInRing(poly[i]![0]!,poly[j]!) || pointInRing(poly[j]![0]!,poly[i]!)) fail('Trous superposés.');
  }
  return poly;
}
/** Shared bounded geometry checks for the atlas and local cartographic overlays. */
export function validateAtlasGeometry(input: unknown, budget = { vertices: 0 }, allowAdjacentRepeats = false): asserts input is GeoGeometry {
  const g=object(input,['type','coordinates']);
  if (g.type==='Point') point(g.coordinates);
  else if (g.type==='Polygon') polygon(g.coordinates,budget,allowAdjacentRepeats);
  else if (g.type==='MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length && g.coordinates.length<=32) {
    const polys=g.coordinates.map(poly => polygon(poly,budget,allowAdjacentRepeats));
    for (let i=0;i<polys.length;i++) for (let j=0;j<i;j++) {
      const x=polys[i]!,y=polys[j]!;
      const inPoly=(p:Position,poly:Position[][])=>pointInRing(p,poly[0]!)&&!poly.slice(1).some(r=>pointInRing(p,r));
      if (x.some(r=>y.some(s=>ringsIntersect(r,s))) || inPoly(x[0]![0]!,y) || inPoly(y[0]![0]!,x)) fail('Parties du multipolygone superposées ou jointives.');
    }
  } else fail('Géométrie non prise en charge.');
}
export function validateGeoAtlas(input: unknown): asserts input is GeoAtlasV1 {
  const a=object(input,['kind','version','id','revision','createdAt','updatedAt','crs','sources','features']);
  if (a.kind !== 'irritator.level2.geo-atlas' || a.version !== 1 || a.crs !== 'EPSG:4326') fail('Version ou projection non prise en charge ; EPSG:4326 requis. Migration explicite nécessaire.');
  id(a.id); date(a.createdAt); date(a.updatedAt);
  if (a.updatedAt < a.createdAt || !Number.isSafeInteger(a.revision) || (a.revision as number)<1) fail('Révision ou chronologie invalide.');
  if (!Array.isArray(a.sources) || a.sources.length>32 || !Array.isArray(a.features) || a.features.length>256) fail('Maximum : 32 sources, 256 lieux (historique compris).');
  const sources=new Map<string,GeoSourceRecord>(), features=new Map<string,GeoAtlasFeature>(), budget={vertices:0};
  for (const raw of a.sources as unknown[]) {
    const s=object(raw,['id','title','organization','classification','sourceUrl','license','datasetVersion','retrievedAt','geometryValidAt','transformation','sourceFileSha256','attribution','limitations']);
    id(s.id); text(s.title); text(s.organization); choice(s.classification,['verified-dataset','workshop-declaration','institutional-plan','fictional-demo']);
    if (sources.has(s.id)) fail('Source dupliquée.');
    for (const k of ['sourceUrl','license','datasetVersion','geometryValidAt','transformation','attribution','limitations']) if (s[k]!==undefined) text(s[k]);
    if (s.sourceUrl!==undefined && !/^https:\/\//.test(s.sourceUrl as string)) fail('URL producteur HTTPS requise.');
    if (s.retrievedAt!==undefined) date(s.retrievedAt);
    if (s.sourceFileSha256!==undefined && !/^[a-f0-9]{64}$/.test(String(s.sourceFileSha256))) fail('Empreinte SHA256 invalide.');
    if (s.classification==='verified-dataset') for (const k of ['sourceUrl','license','datasetVersion','retrievedAt','geometryValidAt','transformation','sourceFileSha256','attribution','limitations']) if (!s[k]) fail(`Source vérifiée incomplète : ${k}.`);
    sources.set(s.id,raw as GeoSourceRecord);
  }
  for (const raw of a.features as unknown[]) {
    const f=object(raw,['type','id','geometry','properties']), p=object(f.properties,['name','kind','sourceId','evidence','precision','share','description','recordedAt','supersedesId']);
    id(f.id); text(p.name,160); id(p.sourceId);
    if (f.type!=='Feature' || features.has(f.id)) fail('Feature invalide ou identifiant dupliqué.');
    const source=sources.get(p.sourceId) ?? fail('Source du lieu absente.');
    choice(p.kind,['water-outline','reference-place','fishing-point','fishing-area','reserve-information']);
    choice(p.precision,['exact-source','approximate','unknown']); choice(p.share,['workshop-only','exportable-with-review']);
    const evidence={ 'verified-dataset':'reference-outline', 'workshop-declaration':'declared-unverified', 'institutional-plan':'planned-unlocated', 'fictional-demo':'illustrative-only' }[source.classification];
    if (p.evidence!==evidence) fail('Origine et statut de preuve incohérents.');
    if (p.description!==undefined) text(p.description);
    if (p.recordedAt!==undefined) { date(p.recordedAt); if (p.recordedAt > a.updatedAt) fail('Déclaration postérieure à la révision.'); }
    if (source.classification==='workshop-declaration' && !p.recordedAt) fail('Date de déclaration requise.');
    if (source.classification==='institutional-plan' && f.geometry!==null) fail('Projet institutionnel non localisé : aucune limite à dessiner.');
    if (p.kind==='reserve-information' && f.geometry!==null) fail('Aucune frontière de réserve certifiée disponible.');
    if (source.classification==='workshop-declaration' && !['fishing-point','fishing-area','reference-place'].includes(p.kind as string)) fail('Une déclaration ne certifie pas un contour.');
    if (f.geometry===null) { if (p.kind==='water-outline' || p.kind==='fishing-area') fail('Contour polygonal requis.'); }
    else {
      const g=f.geometry;
      validateAtlasGeometry(g,budget);
      if (['water-outline','fishing-area'].includes(p.kind as string) && g.type==='Point' || p.kind==='fishing-point' && g.type!=='Point') fail('Nature du lieu et géométrie incompatibles.');
    }
    if (p.kind==='water-outline' && !['verified-dataset','fictional-demo'].includes(source.classification)) fail('Contour sans jeu vectoriel vérifié.');
    if (p.supersedesId!==undefined) { id(p.supersedesId); const original=features.get(p.supersedesId) ?? fail('Original de correction absent ou non antérieur.'); if (source.classification!=='workshop-declaration' || original.properties.sourceId!==p.sourceId || original.properties.recordedAt! > (p.recordedAt as string) || [...features.values()].some(f=>f.properties.supersedesId===p.supersedesId)) fail('Chaîne de correction invalide.'); }
    features.set(f.id,raw as GeoAtlasFeature);
  }
  if (new TextEncoder().encode(JSON.stringify(input)).length > maxAtlasBytes) fail('Atlas trop volumineux (2 Mio maximum).');
}
export function serializeGeoAtlas(atlas: GeoAtlasV1): string { validateGeoAtlas(atlas); const text=JSON.stringify(atlas,null,2)+'\n'; if (new TextEncoder().encode(text).length>maxAtlasBytes) fail('Atlas trop volumineux (2 Mio maximum).'); return text; }
export function activeGeoFeatures(atlas: GeoAtlasV1) { const replaced=new Set(atlas.features.map(f=>f.properties.supersedesId)); return atlas.features.filter(f=>!replaced.has(f.id)); }
export function geometryPoints(g: GeoGeometry | null): Position[] { return !g ? [] : g.type==='Point' ? [g.coordinates] : g.type==='Polygon' ? g.coordinates.flat() : g.coordinates.flat(2); }
