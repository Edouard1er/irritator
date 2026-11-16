import type { TerritoryGeography } from '@contracts';

/** Synthetic rectangles at the origin. These are not places or boundaries at Lac de Guiers. */
export const territoryDemo: TerritoryGeography = {
  type: 'FeatureCollection', id: 'synthetic-demo-v1', name: 'Territoire fictif',
  source: 'Géométrie synthétique pour démonstration logicielle ; aucune donnée du lac de Guiers.', demonstration: true,
  features: [
    { type: 'Feature', properties: { id: 'demo-lake', name: 'Plan d’eau fictif', role: 'lake' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 4], [0, 4], [0, 0]]] } },
    { type: 'Feature', properties: { id: 'demo-A', name: 'Zone fictive A', role: 'zone', accessibility: .1, provenance: 'Valeur pédagogique fictive A : 0,10 ; non calibrée.' }, geometry: { type: 'Polygon', coordinates: [[[.2, .2], [2.8, .2], [2.8, 1.8], [.2, 1.8], [.2, .2]]] } },
    { type: 'Feature', properties: { id: 'demo-B', name: 'Zone fictive B', role: 'zone', accessibility: .4, provenance: 'Valeur pédagogique fictive B : 0,40 ; non calibrée.' }, geometry: { type: 'Polygon', coordinates: [[[.2, 2.2], [2.8, 2.2], [2.8, 3.8], [.2, 3.8], [.2, 2.2]]] } },
  ],
};
