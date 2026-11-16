import { validateGeoAtlas, activeGeoFeatures, type GeoAtlasV1 } from '../../../../packages/contracts/geo-atlas';
import { validateAccessibility, validateGeography, type TerritoryGeography } from '@contracts';
/** Only prepares geography. Applying it and running the native model are separate actions. */
export function mapToTerritory(atlas: GeoAtlasV1, featureId: string, access: unknown, rationale: string, confirmed: boolean, collectionAuthorized = false): TerritoryGeography {
  validateGeoAtlas(atlas); validateAccessibility(access);
  if (!confirmed || typeof rationale!=='string' || !rationale.trim() || rationale.length>240) throw new Error('Hypothèse explicite, provenance et confirmation requises.');
  const f=activeGeoFeatures(atlas).find(f=>f.id===featureId);
  if (!f || f.properties.kind!=='fishing-area' || !f.geometry || f.geometry.type==='Point') throw new Error('Choisissez un secteur polygonal ; un point ou un nom ne peut pas être simulé.');
  const source=atlas.sources.find(s=>s.id===f.properties.sourceId)!;
  if (source.classification==='workshop-declaration' && !collectionAuthorized) throw new Error('Autorisation cartographique requise : le modèle sauvegarde aussi la géométrie du secteur.');
  const geography: TerritoryGeography={ type:'FeatureCollection', id:`${atlas.id}:r${atlas.revision}`, name:'Secteur hypothétique préparé depuis l’atlas', source:`${source.id} · ${source.title}`.slice(0,500), demonstration:source.classification==='fictional-demo', features:[{type:'Feature',geometry:structuredClone(f.geometry),properties:{id:f.id,name:f.properties.name,role:'zone',accessibility:access,provenance:`${rationale.trim()} · source:${source.id} · atlas:${atlas.id}:r${atlas.revision}`.slice(0,500)}}] };
  validateGeography(geography); return geography;
}
