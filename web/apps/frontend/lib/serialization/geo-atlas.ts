import { serializeGeoAtlas, validateGeoAtlas, maxAtlasBytes, type GeoAtlasV1 } from '../../../../packages/contracts/geo-atlas';
export { serializeGeoAtlas, maxAtlasBytes };
export const geoAtlasStorageKey = 'irritator.level2.geo-atlas.v1';
export function parseGeoAtlas(text: string): GeoAtlasV1 {
  if (new TextEncoder().encode(text).length > maxAtlasBytes) throw new Error('Atlas trop volumineux (2 Mio maximum).');
  let value: unknown; try { value=JSON.parse(text); } catch { throw new Error('Fichier cartographique illisible.'); }
  validateGeoAtlas(value); return value;
}
export function isDeclaration(atlas: GeoAtlasV1, sourceId: string) { return atlas.sources.find(s=>s.id===sourceId)?.classification==='workshop-declaration'; }
/** Consent must be confirmed for this collection, independently of D1/D2. No silent filtering. */
export function saveGeoAtlas(storage: Pick<Storage,'setItem'>, atlas: GeoAtlasV1, authorized: boolean) {
  if (!authorized && atlas.features.some(f=>isDeclaration(atlas,f.properties.sourceId))) throw new Error('Autorisation cartographique requise : exercice éphémère seulement.');
  const text=serializeGeoAtlas(atlas);
  try { storage.setItem(geoAtlasStorageKey,text); } catch { throw new Error('Sauvegarde de la carte impossible. La dernière archive est conservée.'); }
}
export function exportGeoAtlas(atlas: GeoAtlasV1, authorized: boolean) {
  if (atlas.features.some(f=>isDeclaration(atlas,f.properties.sourceId)) && !authorized) throw new Error('Autorisation cartographique requise pour exporter les lieux.');
  if (atlas.features.some(f=>isDeclaration(atlas,f.properties.sourceId) && f.properties.share!=='exportable-with-review')) throw new Error('Vérifiez et autorisez le partage de chaque déclaration, y compris ses versions originales, avant export.');
  return serializeGeoAtlas(atlas);
}
