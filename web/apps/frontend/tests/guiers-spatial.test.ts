import { describe, expect, it } from 'vitest';
import { guiersGrid, guiersIdentity, parseGuiersCandidate } from '../../../packages/contracts/guiers-spatial';
import { validateAtlasGeometry } from '../../../packages/contracts/geo-atlas';
import { guiersTestReference as reference, syntheticGuiersAlternative, syntheticGuiersCandidate, syntheticGuiersFishing } from './guiers-fixture';

function parse(bundle: ReturnType<typeof syntheticGuiersCandidate>) {
  return parseGuiersCandidate(JSON.stringify(bundle), reference);
}

describe('référentiels SIG de Guiers', () => {
  it('rend H disponible sans source locale et conserve les treize trous', () => {
    expect(reference.geometry.type).toBe('Polygon');
    expect(reference.geometry.coordinates).toHaveLength(14);
    expect(guiersGrid(reference, 'H', 1000)?.cells).toHaveLength(405);
    expect(guiersGrid(reference, 'H', 500)?.cells).toHaveLength(1283);
    expect(guiersGrid(reference, 'E', 1000)).toBeUndefined();
    expect(guiersGrid(reference, 'H_PLUS', 1000)).toBeUndefined();
    expect(guiersGrid(reference, 'HP_PLUS', 1000, parse(syntheticGuiersCandidate()))).toBeUndefined();
  });

  it('charge E et H+ avec deux résolutions, les parties H+ gardant le référentiel H', () => {
    const b = parse(syntheticGuiersAlternative());
    const p = guiersGrid(reference, 'H_PLUS', 1000, b)!;
    expect(p.gridLines).toBe(reference.grids[1000].gridLines);
    expect(p.cells.map(c => c.waterAreaM2)).toEqual(reference.grids[1000].cells.map(c => c.waterAreaM2));
    expect(p.cells.every(c => c.candidateProtectedFraction === null && c.theoreticalTyphaFraction === null)).toBe(true);
    expect(guiersGrid(reference, 'E', 500, b)?.cells).toHaveLength(1);
    const hash = reference.hydroSha256;
    expect(guiersIdentity('H', 1000, hash)).not.toEqual(guiersIdentity('H', 500, hash));
    expect(guiersIdentity('E', 1000, hash, 'xyz')).not.toEqual(guiersIdentity('H_PLUS', 1000, hash, 'xyz'));
    expect(guiersIdentity('H_PLUS', 1000, hash, 'xyz')).not.toEqual(guiersIdentity('H_PLUS', 1000, hash, 'abc'));
  });

  it('rejette Lv+, une incohérence de maîtrise du domaine ou des droits manquants', () => {
    const b = syntheticGuiersCandidate();
    expect(() => parseGuiersCandidate(JSON.stringify({ ...b, configuration: 'Lv+' }), reference)).toThrow();
    expect(() => parseGuiersCandidate(JSON.stringify({ ...b, hydroSha256: 'b'.repeat(64) }), reference)).toThrow(/empreinte/);
    const source = b.sources.villages!;
    expect(() => parse({ ...b, sources: { villages: { ...source, rightsEvidence: '' } } })).toThrow(/autorisation/);
    b.grids[1000]!.cells[0]!.waterAreaM2 += 20;
    expect(() => parse(b)).toThrow(/Aire|masque|Bilan/);
  });

  it('rejette les IDs doublés et la confusion entre une couche absente et une fraction nulle', () => {
    const b = syntheticGuiersCandidate();
    b.layers.villages!.push(b.layers.villages![0]!);
    expect(() => parse(b)).toThrow(/dupliqué/);
    b.layers.villages!.pop();
    b.grids[1000] = structuredClone(b.grids[1000]!);
    b.grids[1000]!.cells[0]!.candidateProtectedFraction = 0;
    expect(() => parse(b)).toThrow(/Fraction de zone/);
  });

  it('garde les sommets source répétés dans une couche candidate et préserve la règle de l’atlas historique', () => {
    const b = syntheticGuiersAlternative();
    const geometry = b.layers.lac![0]!.geometry;
    if (geometry.type !== 'Polygon') throw new Error('Fixture polygonale requise');
    const ring = geometry.coordinates[0]!;
    ring.splice(2, 0, [...ring[1]!]);
    expect(() => validateAtlasGeometry(geometry)).toThrow(/Sommet répété/);
    expect(parse(b).layers.lac![0]!.geometry).toEqual(geometry);
  });

  it('charge le périmètre V2 sans substituer ses aires à H ni changer les identités V1', () => {
    const b = parse(syntheticGuiersFishing());
    expect(guiersGrid(reference, 'HP_PLUS', 500, b)?.areaM2).toBe(250000);
    expect(guiersGrid(reference, 'H_PLUS', 500, b)?.areaM2).toBe(reference.grids[500].areaM2);
    expect(b.fishingDomain?.villages[0]).toMatchObject({ insidePerimeterMask: false, accessPoint: null });
    expect(guiersIdentity('HP_PLUS', 500, reference.hydroSha256, 'bundle')).toMatch(/^2:HP_PLUS:500:/);
    expect(guiersIdentity('H_PLUS', 500, reference.hydroSha256, 'bundle')).toMatch(/^1:H_PLUS:500:/);
  });

  it('rejette un bilan V2 incohérent, un accès imputé et un graphe impossible', () => {
    const b = syntheticGuiersFishing();
    b.fishingDomain!.removedGeometry = null;
    expect(() => parse(b)).toThrow(/Bilan/);
    const c = syntheticGuiersFishing();
    c.fishingDomain!.villages[0]!.insideWater = true;
    expect(() => parse(c)).toThrow(/point d’accès/);
    const d = syntheticGuiersFishing();
    d.connectivity!.HP_PLUS_500!.parts.components = 2;
    expect(() => parse(d)).toThrow(/connectivité/);
  });
});
