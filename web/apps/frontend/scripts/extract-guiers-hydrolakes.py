"""Reproduce the bundled subset using Python stdlib only. No coordinates entered by hand.
Usage: python scripts/extract-guiers-hydrolakes.py PATH/TO/HydroLAKES_polys_v10_shp.zip
Run from web/apps/frontend. Download URL and licensing are in data/geography/README.md.
"""
import hashlib
import json
import pathlib
import struct
import sys
import zipfile

archive = pathlib.Path(sys.argv[1])
expected = '9ef63498569dd7ccd0b8d8852da026e009a75f42d293f00e483f3b9fcfe8e1f9'
with archive.open('rb') as f:
    digest = hashlib.file_digest(f, 'sha256').hexdigest()
assert digest == expected, 'Source archive differs: review version before regeneration'
z = zipfile.ZipFile(archive)
base = 'HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10'
projection = z.read(base + '.prj').decode()
assert 'GCS_WGS_1984' in projection and 'UNIT["Degree"' in projection
with z.open(base + '.dbf') as f:
    header = f.read(32)
    count, header_length, record_length = struct.unpack_from('<IHH', header, 4)
    fields = []
    for _ in range((header_length - 33) // 32):
        field = f.read(32)
        fields.append((field[:11].split(b'\0')[0].decode(), field[16]))
    assert f.read(1) == b'\r'
    matches = []
    for index in range(count):
        record = f.read(record_length)
        if b'Guiers' not in record:
            continue
        offset = 1
        row = {}
        for key, length in fields:
            row[key] = record[offset:offset+length].decode('latin1').strip()
            offset += length
        if row['Lake_name'] == 'Guiers' and row['Country'] == 'Senegal':
            matches.append((index, row))
assert len(matches) == 1
index, row = matches[0]
assert row['Hylak_id'] == '1520' and row['Poly_src'] == 'SWBD'
offset, length = struct.unpack_from('>II', z.read(base+'.shx'), 100+index*8)
with z.open(base+'.shp') as f:
    f.read(offset*2)
    record_number, record_words = struct.unpack('>II', f.read(8))
    assert record_number == index+1 and record_words == length
    record = f.read(length*2)
assert struct.unpack_from('<I', record)[0] == 5  # Polygon
parts_count, points_count = struct.unpack_from('<II', record, 36)
parts = list(struct.unpack_from('<'+'I'*parts_count, record, 44)) + [points_count]
points = [list(struct.unpack_from('<2d', record, 44+4*parts_count+i*16)) for i in range(points_count)]
rings = [points[a:b] for a,b in zip(parts,parts[1:])]
signed = lambda r: sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(r,r[1:]))
assert signed(rings[0]) < 0 and all(signed(r)>0 for r in rings[1:])
assert all(r[0] == r[-1] for r in rings)
assert all(-180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in points)
target = pathlib.Path('data/geography')
target.mkdir(parents=True, exist_ok=True)
original = {'type':'Feature','properties':row,'geometry':{'type':'Polygon','coordinates':rings}}
(target/'guiers-hydrolakes-1520.original.geojson').write_text(json.dumps(original,ensure_ascii=False)+'\n',encoding='utf-8')
# Preserve every vertex and every island. Only reverse orientation and round to 7 decimals.
geometry = {'type':'Polygon','coordinates':[[[round(x,7),round(y,7)] for x,y in reversed(r)] for r in rings]}
timestamp = '2026-11-16T15:43:19.000Z'  # actual first extraction; not the observation date
source = {'id':'hydrolakes-v10','title':'HydroLAKES v1.0 · Guiers (1520)','organization':'HydroSHEDS / auteurs HydroLAKES, 2016',
 'classification':'verified-dataset','sourceUrl':'https://www.hydrosheds.org/products/hydrolakes','license':'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
 'datasetVersion':'HydroLAKES_polys_v10, Hylak_id=1520, Poly_src=SWBD','retrievedAt':timestamp,
 'geometryValidAt':'SWBD / SRTM, février 2000 (référence ancienne, pas la rive actuelle)',
 'transformation':'DBF: Guiers/Senegal/1520 ; SHX→SHP ; WGS84 conservé ; tous les 1458 sommets et 13 îles conservés ; anneaux inversés RFC7946, arrondi 7 décimales ; aucun lissage ni découpage.',
 'sourceFileSha256':digest,'attribution':'© auteurs HydroLAKES (2016), Messager et al., doi:10.1038/ncomms13603 ; extrait et orientation adaptés pour Irritator Web.',
 'limitations':'Contour hydrologique, ni limite de pêche ni réserve. SWBD : données sources ~30 m, précision finale variable après traitements HydroLAKES. Rive ancienne et saisonnière ; validation locale actuelle absente. Aucune profondeur ou biomasse dérivée.'}
clpa = {'id':'clpa-dagana-2026','title':'Plan d’action CLPA Dagana 2026 (octobre 2025), pp. 8 et 10','organization':'Service départemental des pêches et de la surveillance de Dagana','classification':'institutional-plan','datasetVersion':'Document du kit 2.3.B, octobre 2025','limitations':'Document départemental de programmation. Licence publique non établie ; aucun vecteur fourni. Sensibilisation est/ouest sans secteurs de pêche ; étude et balisage de réserve sollicités, réalisation non attestée.'}
features = [{'type':'Feature','id':'hydrolakes-1520','geometry':geometry,'properties':{'name':'Lac de Guiers — contour hydrologique ancien','kind':'water-outline','sourceId':source['id'],'evidence':'reference-outline','precision':'exact-source','share':'exportable-with-review'}}]
for ident,name,kind in [('mbane-clpa','Mbane — repère de sensibilisation est','reference-place'),('ngnith-clpa','Ngnith — repère de sensibilisation ouest','reference-place'),('reserve-clpa','Témeye-Toucouleur — étude de limite et balisage sollicités','reserve-information')]:
    features.append({'type':'Feature','id':ident,'geometry':None,'properties':{'name':name,'kind':kind,'sourceId':clpa['id'],'evidence':'planned-unlocated','precision':'unknown','share':'exportable-with-review'}})
atlas = {'kind':'irritator.level2.geo-atlas','version':1,'id':'guiers-hydrolakes-v10','revision':1,'createdAt':timestamp,'updatedAt':timestamp,'crs':'EPSG:4326','sources':[source,clpa],'features':features}
(target/'lac-de-guiers.hydrolakes.geojson').write_text(json.dumps({'type':'FeatureCollection','features':[features[0]]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(target/'lac-de-guiers.atlas.json').write_text(json.dumps(atlas,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'source_sha256':digest,'dbf_record_zero_based':index,'attributes':row,'bounds':struct.unpack_from('<4d',record,4),'rings':parts_count,'vertices':points_count,'source_crs':projection},indent=2))
