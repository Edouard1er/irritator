import { describe, expect, it, vi } from 'vitest';
import { activeGeoFeatures, serializeGeoAtlas, validateGeoAtlas, maxAtlasBytes, type GeoAtlasFeature, type GeoAtlasV1, type Position } from '../../../packages/contracts/geo-atlas';
import atlasData from '@/data/geography/lac-de-guiers.atlas.json';
import { exportGeoAtlas, geoAtlasStorageKey, parseGeoAtlas, saveGeoAtlas } from '@/lib/serialization/geo-atlas';
import { mapToTerritory } from '@/lib/modeling/geo-to-territory';
import { nativeRequest, applyTerritorialZone, temporalScope, validateRequest, type RunRequest } from '@contracts';
import { scientificFingerprint } from '@/lib/modeling/model';
import model from '../../../examples/atelier-interventions-month-v3.json';
const atlas=()=>structuredClone(atlasData) as GeoAtlasV1;
const empty=():GeoAtlasV1=>({...atlas(),sources:[],features:[]});
const ring:Position[]=[[-15.85,16.1],[-15.84,16.1],[-15.84,16.11],[-15.85,16.1]];
export function declaration(a:GeoAtlasV1,geometry:GeoAtlasFeature['geometry']={type:'Polygon',coordinates:[ring]}):GeoAtlasFeature {
  if(!a.sources.some(s=>s.id==='workshop-local'))a.sources.push({id:'workshop-local',title:'Exercice fictif de test',organization:'Atelier de test',classification:'workshop-declaration'});
  const f:GeoAtlasFeature={type:'Feature',id:`test-${a.features.length}`,geometry,properties:{name:'Lieu fictif de test',kind:geometry?.type==='Point'||geometry===null?'fishing-point':'fishing-area',sourceId:'workshop-local',evidence:'declared-unverified',precision:geometry?'approximate':'unknown',share:'workshop-only',recordedAt:a.updatedAt}};
  a.features.push(f);return f;
}
describe('GeoAtlas independent closed contract',()=>{
  it('accepts an empty atlas and never invents a coordinate for a verbal place',()=>{validateGeoAtlas(empty());const a=empty();declaration(a,null);expect(parseGeoAtlas(serializeGeoAtlas(a))).toEqual(a);expect(a.features[0]!.geometry).toBeNull();});
  it('loads the actual HydroLAKES feature with all islands, provenance and no reserve geometry',()=>{const a=atlas();validateGeoAtlas(a);expect(a.features[0]!.id).toBe('hydrolakes-1520');expect(a.features[0]!.geometry?.type).toBe('Polygon');expect((a.features[0]!.geometry as {coordinates:Position[][]}).coordinates).toHaveLength(14);expect(a.sources[0]!.sourceFileSha256).toMatch(/^[a-f0-9]{64}$/);expect(a.features.slice(1).every(f=>f.geometry===null)).toBe(true);});
  it.each(['version','crs','unknown','duplicate-feature','duplicate-source','missing-source','date','revision','source-license','source-version','source-date','source-hash','source-proof','reserve-shape','kind'] as const)('rejects %s without mutating a valid atlas',kind=>{
    const a=atlas(),before=serializeGeoAtlas(a),bad=structuredClone(a);
    switch(kind){case 'version':Object.assign(bad,{version:2});break;case 'crs':Object.assign(bad,{crs:'EPSG:3857'});break;case 'unknown':Object.assign(bad.features[0]!.properties,{person:'no'});break;case 'duplicate-feature':bad.features.push(bad.features[0]!);break;case 'duplicate-source':bad.sources.push(bad.sources[0]!);break;case 'missing-source':bad.features[0]!.properties.sourceId='missing';break;case 'date':bad.updatedAt='2026-02-30T00:00:00.000Z';break;case 'revision':bad.revision=0;break;case 'source-license':delete bad.sources[0]!.license;break;case 'source-version':delete bad.sources[0]!.datasetVersion;break;case 'source-date':delete bad.sources[0]!.retrievedAt;break;case 'source-hash':delete bad.sources[0]!.sourceFileSha256;break;case 'source-proof':bad.features[0]!.properties.evidence='declared-unverified';break;case 'reserve-shape':bad.features[3]!.geometry={type:'Polygon',coordinates:[ring]};break;case 'kind':bad.features[0]!.geometry={type:'Point',coordinates:ring[0]!};break;}
    expect(()=>validateGeoAtlas(bad)).toThrow();expect(serializeGeoAtlas(a)).toBe(before);
  });
  it.each([NaN,Infinity,-Infinity,181,-181])('rejects invalid longitude %s',n=>{const a=empty();declaration(a,{type:'Point',coordinates:[n,16]});expect(()=>validateGeoAtlas(a)).toThrow();});
  it.each([91,-91,NaN,Infinity])('rejects invalid latitude %s',n=>{const a=empty();declaration(a,{type:'Point',coordinates:[-16,n]});expect(()=>validateGeoAtlas(a)).toThrow();});
  it.each([
    [[0,0],[1,0],[1,1],[0,1]], // open
    [[0,0],[1,0],[2,0],[0,0]], // zero area
    [[0,0],[3,3],[0,2],[2,0],[0,0]], // crossing with nonzero area
    [[0,0],[1,0],[1,1],[1,0],[0,0]], // duplicate
  ].map(r=>({ring:r})))('rejects invalid polygon $ring',({ring:r})=>{const a=empty();declaration(a,{type:'Polygon',coordinates:[r as Position[]]});expect(()=>validateGeoAtlas(a)).toThrow();});
  it('validates holes and rejects overlaps in multipolygons',()=>{const a=empty(),f=declaration(a,{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]]});validateGeoAtlas(a);f.geometry={type:'MultiPolygon',coordinates:[[ring],[ring]]};expect(()=>validateGeoAtlas(a)).toThrow(/superpos/);});
  it('keeps a point outside the lake unchanged rather than clipping or inventing access',()=>{const a=empty();declaration(a,{type:'Point',coordinates:[12,40]});validateGeoAtlas(a);expect(a.features[0]!.geometry).toEqual({type:'Point',coordinates:[12,40]});});
  it('retains original corrections and refuses missing, forked or future originals',()=>{const a=empty(),f=declaration(a);const newer=declaration(a);newer.properties.supersedesId=f.id;validateGeoAtlas(a);expect(a.features).toHaveLength(2);expect(activeGeoFeatures(a)).toEqual([newer]);const fork=declaration(a);fork.properties.supersedesId=f.id;expect(()=>validateGeoAtlas(a)).toThrow(/correction/);});
  it('bounds volume, names and future migrations, and rejects truncated files',()=>{expect(()=>parseGeoAtlas('{broken')).toThrow(/illisible/);expect(()=>parseGeoAtlas(' '.repeat(maxAtlasBytes+1))).toThrow(/volumineux/);const a=empty();for(let i=0;i<257;i++)declaration(a,null);expect(()=>validateGeoAtlas(a)).toThrow(/256/);});
});
describe('collection authorization and persistence',()=>{
  it('permits public references without consent, blocks private saving/export separately from decisions',()=>{const storage={setItem:vi.fn()};const a=atlas();saveGeoAtlas(storage,a,false);expect(storage.setItem).toHaveBeenCalledWith(geoAtlasStorageKey,serializeGeoAtlas(a));declaration(a,null);expect(()=>saveGeoAtlas(storage,a,false)).toThrow(/Autorisation/);expect(()=>exportGeoAtlas(a,false)).toThrow(/Autorisation/);saveGeoAtlas(storage,a,true);expect(()=>exportGeoAtlas(a,true)).toThrow(/Vérifiez/);a.features.at(-1)!.properties.share='exportable-with-review';expect(parseGeoAtlas(exportGeoAtlas(a,true))).toEqual(a);});
  it('validates before touching storage and does not erase an archive on quota',()=>{const storage={setItem:vi.fn(()=>{throw new Error('quota');})},a=atlas();expect(()=>saveGeoAtlas(storage,a,true)).toThrow(/archive/);storage.setItem.mockClear();Object.assign(a,{unknown:1});expect(()=>saveGeoAtlas(storage,a,true)).toThrow();expect(storage.setItem).not.toHaveBeenCalled();});
});
describe('explicit preparation and native separation',()=>{
  it.each([1,10,100])('adding %s places leaves the complete scientific/native requests identical',count=>{const r=structuredClone(model) as unknown as RunRequest,before=scientificFingerprint(r),native=JSON.stringify(nativeRequest(r)),a=empty();for(let i=0;i<count;i++)declaration(a,null);parseGeoAtlas(serializeGeoAtlas(a));expect(scientificFingerprint(r)).toBe(before);expect(JSON.stringify(nativeRequest(r))).toBe(native);});
  it.each([0,.123456789,1])('prepares exactly explicit access %s and applies only a through existing contracts',access=>{const a=empty(),f=declaration(a),r=structuredClone(model) as unknown as RunRequest,before=structuredClone(r),g=mapToTerritory(a,f.id,access,'Hypothèse de test',true,true);expect(g.demonstration).toBe(false);expect(g.features[0]!.properties.id).toBe(f.id);expect(r).toEqual(before);const next=applyTerritorialZone(r,g,f.id);validateRequest(next);const expected=structuredClone(r);expected.temporal!.parameters.a=access;temporalScope(expected)!.components.find(c=>c.id==='a')!.parameters.value=access;expect(nativeRequest(next)).toEqual(nativeRequest(expected));expect(nativeRequest(next)).not.toHaveProperty('territory');});
  it.each([undefined,NaN,Infinity,-.1,1.1,'0.1'])('rejects invalid access %s',value=>{const a=empty(),f=declaration(a);expect(()=>mapToTerritory(a,f.id,value,'Explicit',true,true)).toThrow();});
  it('requires consent, provenance, confirmation and polygonal fishing area',()=>{const a=empty(),f=declaration(a);expect(()=>mapToTerritory(a,f.id,.2,'',true,true)).toThrow();expect(()=>mapToTerritory(a,f.id,.2,'Explicit',false,true)).toThrow();expect(()=>mapToTerritory(a,f.id,.2,'Explicit',true)).toThrow(/Autorisation/);for(const geometry of [null,{type:'Point' as const,coordinates:ring[0]!}]){const p=declaration(a,geometry);expect(()=>mapToTerritory(a,p.id,.2,'Explicit',true,true)).toThrow(/polygonal/);}});
  it('does not allow atlas fields through the closed scientific contract',()=>{expect(()=>validateRequest({...model,geoAtlas:atlas()})).toThrow();});
});
