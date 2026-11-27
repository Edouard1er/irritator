import data from '../data/geography/guiers-metric-reference.json' with { type: 'json' };
import connectivity from '../data/geography/guiers-connectivity-h.json' with { type: 'json' };
import type { GuiersCandidate, GuiersConnectivity, GuiersReference, GuiersResolution } from '../../../packages/contracts/guiers-spatial';

export const guiersTestReference = data as unknown as GuiersReference;

/** Invented records for import tests, independent of viabFishSng. */
export function syntheticGuiersCandidate(): GuiersCandidate {
  const version = '1'.repeat(40);
  const id = `villages:${version}:001`;
  const grids = Object.fromEntries(([1000, 500] as const).map(h => [h, {
    ...guiersTestReference.grids[h],
    cells: guiersTestReference.grids[h].cells.map(c => ({ ...c, nearestVillageId: id })),
  }])) as GuiersCandidate['grids'];
  return { kind: 'irritator.guiers.candidate', version: 1, hydroSha256: guiersTestReference.hydroSha256,
    sources: { villages: { id: 'viabFishSng:villages', url: 'https://github.com/ElCep/viabFishSng',
      attribution: 'Cas synthétique', version, acquiredAt: '2026-11-27',
      files: Object.fromEntries(['shp', 'shx', 'dbf', 'prj'].map(ext => [`villages.${ext}`, 'a'.repeat(64)])),
      observationDate: null, license: null, rights: 'local_study_reviewed', rightsEvidence: 'Fixture synthétique',
      declaredCrs: 'WGS84', metadataCrs: null, readCrs: 'EPSG:4326', encoding: 'UTF-8',
      transformation: 'Reprojection de la fixture', technical: 'checked_by_pipeline', empirical: 'unconfirmed',
      institutional: 'unconfirmed', permittedUse: 'Test local' } },
    grids, alternativeGrids: {}, comparison: null, anomalies: [],
    layers: { villages: [{ type: 'Feature', id, geometry: { type: 'Point', coordinates: [-15.85, 16.1] },
      properties: { name: 'Village synthétique', population: null, sourceId: 'viabFishSng:villages' } }] } };
}

export function syntheticGuiersAlternative(): GuiersCandidate {
  const b = syntheticGuiersCandidate();
  const v = b.sources.villages!;
  b.sources.lac = { ...v, id: 'viabFishSng:lac',
    files: Object.fromEntries(Object.entries(v.files).map(([key, value]) => [key.replace('villages', 'lac'), value])) };
  b.layers.lac = [{ type: 'Feature', id: `lac:${v.version}:001`, properties: { sourceId: 'viabFishSng:lac' },
    geometry: { type: 'Polygon', coordinates: [[[-15.85, 16.1], [-15.84, 16.1], [-15.84, 16.11], [-15.85, 16.11], [-15.85, 16.1]]] } }];
  for (const resolution of [500, 1000] as GuiersResolution[]) {
    const baseline = guiersTestReference.grids[resolution];
    const cell = baseline.cells.find(c => c.waterAreaM2 > 250000 - 0.001)!;
    b.alternativeGrids[resolution] = { ...baseline, areaM2: 250000, cells: [{ ...cell,
      waterAreaM2: 250000, waterFraction: 250000 / cell.cellAreaM2, waterComponentCount: 1, neighbors: [] }] };
  }
  const h = guiersTestReference.grids[1000].areaM2 / 1e6;
  b.comparison = { hydroOnlyKm2: h - 0.1, alternativeOnlyKm2: 0.15, unionKm2: h + 0.15,
    intersectionKm2: 0.1, jaccard: 0.1 / (h + 0.15) };
  return b;
}

export function syntheticGuiersFishing(): GuiersCandidate {
  const b = syntheticGuiersAlternative(), areaM2 = 250000;
  const grids = {} as NonNullable<GuiersCandidate['fishingDomain']>['grids'];
  const summaries: NonNullable<GuiersCandidate['connectivity']> = {};
  for (const h of [1000, 500] as const) {
    const hSummary = connectivity.grids[h] as GuiersConnectivity;
    summaries[`H_${h}`] = summaries[`H_PLUS_${h}`] = hSummary;
    const part = { nodes: 1, edges: 0, components: 1, largest: { cells: 1, nodes: 1, areaM2 },
      maxCells: 1, isolatedNodes: 1, isolatedAreaM2: areaM2 };
    summaries[`E_${h}`] = summaries[`HP_PLUS_${h}`] = { parts: { ...part, version: 'water_parts_v1' },
      legacy: { ...part, version: 'aggregate_cells_v1' }, blockedLegacyInterfaces: 0 };
    const [cell] = b.alternativeGrids[h]!.cells;
    grids[h] = { ...b.alternativeGrids[h]!, cells: [{ ...cell!, nearestVillageId: b.layers.villages![0]!.id }] };
  }
  return { ...b, version: 2, connectivity: summaries, fishingDomain: {
    geometry: b.layers.lac![0]!.geometry, removedGeometry: guiersTestReference.geometry, grids,
    mask: { id: 'researcher_polygon_v1', version: 1, crs: 'EPSG:32628', status: 'candidate_manual_review_required',
      source: { id: 'researcher_geojson', sha256: '1'.repeat(64), readCrs: 'EPSG:4326' }, hydroSha256: b.hydroSha256,
      maskSha256: 'b'.repeat(64), author: 'Chercheur de la fixture', justification: 'Scénario fictif de recette',
      southNorthingM: null, observationDate: null, parameters: { boundsUtmM: [390000, 1750000, 430000, 1820000] }, hashing: 'SHA256' },
    villages: [{ id: b.layers.villages![0]!.id, insideWater: false, insidePerimeterMask: false, accessPoint: null, distanceToWaterM: 100 }],
    boundsCutWgs84: [[[-15.85, 16.1], [-15.84, 16.1]]], sensitivity: null,
  } };
}
