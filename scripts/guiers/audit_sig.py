#!/usr/bin/env python3
"""Audit du lac de Guiers, hors ligne, sans réparation des géométries."""
import argparse
import hashlib
import json
import math
from collections import Counter
from datetime import date
from itertools import combinations, pairwise
from pathlib import Path
import re
import subprocess

import pyproj
import shapefile
import shapely
from shapely.geometry import LineString, MultiPolygon, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.validation import explain_validity

WGS = pyproj.CRS.from_epsg(4326)
UTM = pyproj.CRS.from_epsg(32628)
TO_UTM = pyproj.Transformer.from_crs(WGS, UTM, always_xy=True).transform
TO_WGS = pyproj.Transformer.from_crs(UTM, WGS, always_xy=True).transform
AREA_EPS = 1e-3
EDGE_EPS = 1e-6
POLYGONS = ("Polygon", "MultiPolygon")
LAYERS = {"lac": 1, "envelope": 1, "villages": 35, "zoneExclusionPeche": 4, "tipha_theoric": 5}
THEMES = {"villages": "villages", "reserves": "zoneExclusionPeche", "typha": "tipha_theoric"}
HYDRO_URL = "https://www.hydrosheds.org/products/hydrolakes"
VIAB_URL = "https://github.com/ElCep/viabFishSng"
MANIFEST = Path(__file__).with_name("source_manifest.json")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def verify(geom, label, kinds):
    require(not geom.is_empty and geom.geom_type in kinds, f"{label}: type inattendu ou géométrie vide")
    require(not geom.has_z and all(math.isfinite(n) for p in shapely.get_coordinates(geom) for n in p),
            f"{label}: coordonnées 2D finies requises")
    require(geom.is_valid, f"{label}: {explain_validity(geom)}. Révision manuelle requise.")
    return geom


def geographic(geom, label, kinds):
    verify(geom, label, kinds)
    west, south, east, north = geom.bounds
    require(-16.5 <= west <= east <= -15 and 15 <= south <= north <= 17,
            f"{label}: bornes incompatibles avec le lac de Guiers en WGS84")
    return verify(shapely.transform(geom, TO_UTM, interleaved=False), f"{label} UTM", kinds)


def parts(geom):
    if geom.geom_type == "Polygon" and not geom.is_empty:
        return [geom]
    if hasattr(geom, "geoms"):
        return [part for g in geom.geoms for part in parts(g)]
    return []


def orientation(geom):
    if geom.geom_type == "Polygon":
        return orient(geom, sign=1)
    if geom.geom_type == "MultiPolygon":
        return MultiPolygon([orient(poly, sign=1) for poly in geom.geoms])
    return geom


def read_hydro(path, expected):
    raw = path.read_bytes()
    canonical = raw.replace(b"\r\n", b"\n")
    require(git_blob(canonical) == expected["original_git_blob_sha1"], "HydroLAKES original: empreinte divergente")
    obj = json.loads(raw)
    features = obj.get("features") if obj.get("type") == "FeatureCollection" else [obj]
    require(not obj.get("crs") and len(features) == 1 and features[0].get("type") == "Feature",
            "Extrait HydroLAKES RFC 7946 à un objet requis")
    feature = features[0]
    prop = feature["properties"]
    require(str(prop.get("Hylak_id")) == "1520" and
            tuple(prop.get(k) for k in ("Lake_name", "Country", "Poly_src")) ==
            ("Guiers", "Senegal", "SWBD"), "HydroLAKES 1520 Guiers (SWBD) requis")
    geo = shape(feature["geometry"])
    metric = geographic(geo, "HydroLAKES", POLYGONS)
    require(sum(len(p.interiors) for p in parts(metric)) == 13, "HydroLAKES: 13 anneaux intérieurs attendus")
    display = path.with_name("lac-de-guiers.hydrolakes.geojson")
    files = {path.name: digest(canonical)}
    if display.is_file():
        data = display.read_bytes()
        require(git_blob(data.replace(b"\r\n", b"\n")) == expected["display_geojson_git_blob_sha1"],
                "HydroLAKES affichage: empreinte divergente")
        files[display.name] = digest(data.replace(b"\r\n", b"\n"))
    source = dict(id="hydrolakes-v10-1520", url=HYDRO_URL, attribution="Messager et al. (2016), DOI 10.1038/ncomms13603",
                  version="1.0 / 1520", files=files, canonicalSha256=digest(canonical),
                  hashing="SHA256 des extraits avec fins de lignes LF",
                  acquiredAt="2026-11-16", observationDate=None,
                  observationContext="SWBD/SRTM historique, collecte principale février 2000",
                  license="CC BY 4.0", rights="open_attributed", rightsEvidence=HYDRO_URL,
                  declaredCrs="EPSG:4326 (RFC 7946)", readCrs="EPSG:4326",
                  transformation="PROJ always_xy vers EPSG:32628", technical="checked_by_pipeline",
                  empirical="unconfirmed_for_current_shoreline", institutional="unconfirmed",
                  permittedUse="Attribution requise")
    return metric, feature["geometry"], prop, source, digest(canonical)


def load_layer(folder, name, version):
    base = folder / name
    for suffix in (".shp", ".shx", ".dbf", ".prj"):
        require(base.with_suffix(suffix).is_file(), f"{name}: {suffix} manquant")
    prj = base.with_suffix(".prj").read_text(encoding="utf-8-sig")
    require(pyproj.CRS.from_wkt(prj).equals(WGS, ignore_axis_order=True), f"{name}: PRJ différent de WGS84")
    cpg = base.with_suffix(".cpg")
    enc = cpg.read_text(encoding="utf-8-sig").strip() if cpg.exists() else "utf-8"
    if enc.isdecimal():
        enc = f"cp{enc}"
    records = []
    with shapefile.Reader(str(base), encoding=enc, encodingErrors="strict") as reader:
        for i, sr in enumerate(reader.iterShapeRecords(), 1):
            raw = sr.shape
            require(raw.shapeType == (shapefile.POINT if name == "villages" else shapefile.POLYGON),
                    f"{name}/{i}: ShapeType 2D incompatible")
            require(all(len(p) == 2 and all(math.isfinite(v) for v in p) for p in raw.points),
                    f"{name}/{i}: coordonnées binaires non finies")
            if name != "villages":
                ends = [*raw.parts, len(raw.points)]
                require(all(b-a >= 4 and raw.points[a] == raw.points[b-1] for a, b in zip(ends, ends[1:])),
                        f"{name}/{i}: anneau source non fermé")
            geo = shape(raw.__geo_interface__)
            metric = geographic(geo, f"{name}/{i}", ("Point",) if name == "villages" else POLYGONS)
            if name != "villages":
                require(sum(1 + len(part.interiors) for part in parts(geo)) == len(raw.parts),
                        f"{name}/{i}: nombre d’anneaux décodés incohérent")
            props = sr.record.as_dict()
            json.dumps(props, allow_nan=False)
            if name == "villages":
                props["name"] = props["name"].strip() or None
                population = str(props["population"]).strip() if props["population"] is not None else ""
                props["populationSource"] = props["population"]
                props["population"] = int(population) if population.isdecimal() else None
            records.append((f"{name}:{version}:{i:03}", geo, metric, props))
    require(bool(records), f"{name}: couche vide")
    files = {p.name: digest(p.read_bytes()) for suffix in (".shp", ".shx", ".dbf", ".prj", ".cpg", ".qmd")
             if (p := base.with_suffix(suffix)).is_file()}
    qmd = base.with_suffix(".qmd")
    qmd_crs = re.search(r"<authid>\s*([^<]+)", qmd.read_text(encoding="utf-8-sig")) if qmd.is_file() else None
    return records, files, enc, qmd_crs.group(1).strip() if qmd_crs else None


def version_info(folder, expected, supplied_commit):
    if supplied_commit:
        commit = supplied_commit
    else:
        git = ["git", "--no-optional-locks", "-c", f"safe.directory={folder.parent.as_posix()}", "-C", str(folder.parent)]
        commit = subprocess.check_output([*git, "rev-parse", "HEAD"], text=True).strip()
        inputs = [f"data/{path.name}" for path in folder.iterdir() if path.is_file() and
                  path.stem in LAYERS and path.suffix in (".shp", ".shx", ".dbf", ".prj", ".qmd", ".cpg")]
        inputs.extend(path for path in ("README.md", "modelv0.nlogo", "modelv0_viab.nlogo")
                      if (folder.parent / path).is_file())
        if inputs:
            status = subprocess.check_output([*git, "-c", "core.excludesFile=", "status", "--porcelain", "--", *inputs],
                                             text=True).strip()
            require(not status, "viabFishSng: entrées modifiées localement. Figer d’abord la version examinée.")
    require(re.fullmatch(r"[a-f0-9]{40}", commit), "Commit viabFishSng complet requis")
    checks = {}
    for relative, blob in expected.items():
        path = folder.parent / relative
        data = path.read_bytes() if path.is_file() else None
        if data is not None and path.suffix not in (".shp", ".shx", ".dbf"):
            data = data.replace(b"\r\n", b"\n")
        actual = git_blob(data) if data is not None else None
        checks[relative] = dict(expected=blob, actual=actual, matches=actual == blob)
    return commit, checks


def metrics(geom):
    x0, y0, x1, y1 = geom.bounds
    polygons = parts(geom)
    return dict(areaKm2=geom.area/1e6, perimeterKm=geom.length/1000, boundsUtmM=list(geom.bounds),
                extentWidthKm=(x1-x0)/1000, extentHeightKm=(y1-y0)/1000,
                verticesWithClosures=sum(len(p.exterior.coords)+sum(len(r.coords) for r in p.interiors)
                                         for p in polygons),
                holes=sum(len(p.interiors) for p in polygons))


def cell_id(h, x, y):
    return f"utm28n:h{h}:x{x}:y{y}"


def fraction(water, layer):
    if layer is None:
        return None
    value = water.intersection(layer).area/water.area
    require(0 <= value <= 1+1e-9, "Fraction thématique hors bornes")
    return min(1, value)


def wet_components(cells):
    unvisited = set(cells)
    components = []
    for root in cells:
        if root not in unvisited:
            continue
        unvisited.remove(root)
        component = [root]
        for key in component:
            for neighbor in cells[key]["neighbors"]:
                if neighbor in unvisited:
                    unvisited.remove(neighbor)
                    component.append(neighbor)
        components.append(sorted(component))
    return components


def connectivity_summary(nodes, part_graph=False):
    groups = wet_components(nodes)
    summaries = [dict(nodes=len(group), cells=len({nodes[key].get("cellId", key) for key in group}),
                      areaM2=math.fsum(nodes[key]["waterAreaM2"] for key in group)) for group in groups]
    isolates = [node for node in nodes.values() if not node["neighbors"]]
    return dict(version="water_parts_v1" if part_graph else "aggregate_cells_v1", nodes=len(nodes),
                edges=sum(len(n["neighbors"]) for n in nodes.values())//2, components=len(groups),
                largest=max(summaries, key=lambda c: (c["areaM2"], c["cells"], c["nodes"])),
                maxCells=max(c["cells"] for c in summaries), isolatedNodes=len(isolates),
                isolatedAreaM2=math.fsum(n["waterAreaM2"] for n in isolates))


def water_part_graph(waters, h, cells, interfaces):
    by_cell, nodes, edges = {}, {}, []
    for (x, y), water in waters.items():
        key = cell_id(h, x, y)
        by_cell[x, y] = []
        for poly in parts(water):
            part_id = digest(shapely.to_wkb(shapely.normalize(poly), byte_order=1, output_dimension=2))[:16]
            node_id = f"{key}:p{part_id}"
            require(node_id not in nodes and poly.area > 0, "Partie aquatique vide ou identifiant répété")
            by_cell[x, y].append((node_id, poly))
            nodes[node_id] = dict(id=node_id, cellId=key, waterPartId=part_id, waterAreaM2=poly.area, neighbors=[],
                                  geometry=display_geometry(poly), labelPoint=TO_WGS(*poly.representative_point().coords[0]))
        part_area = math.fsum(nodes[node_id]["waterAreaM2"] for node_id, _ in by_cell[x, y])
        require(abs(part_area - cells[key]["waterAreaM2"]) <= AREA_EPS, f"Bilan des parties de {key}")
    for here, there, side in interfaces:
        a_parts = [(key, poly.intersection(side)) for key, poly in by_cell[here]]
        b_parts = [(key, poly.intersection(side)) for key, poly in by_cell[there]]
        for a, a_side in a_parts:
            for b, b_side in b_parts:
                length = a_side.intersection(b_side).length
                if length > EDGE_EPS:
                    nodes[a]["neighbors"].append(b)
                    nodes[b]["neighbors"].append(a)
                    first, second = sorted((a, b))
                    edges.append(dict(a=first, b=second, interfaceLengthM=length))
    nodes = dict(sorted(nodes.items()))
    for node in nodes.values():
        node["neighbors"].sort()
        require(all(node["id"] in nodes[n]["neighbors"] for n in node["neighbors"]), "Lien de partie non réciproque")
    return dict(version="water_parts_v1", crs="EPSG:32628", resolutionM=h, interfaceToleranceM=EDGE_EPS,
                nodes=list(nodes.values()), edges=sorted(edges, key=lambda edge: (edge["a"], edge["b"])),
                summary=connectivity_summary(nodes, part_graph=True))


def grid(lake, h, reserves=None, typha=None, villages=(), *, graphs=None):
    west, south, east, north = lake.bounds
    nx0, nx1 = math.floor(west/h), math.ceil(east/h)
    ny0, ny1 = math.floor(south/h), math.ceil(north/h)
    waters, cells = {}, {}
    for x in range(nx0, nx1):
        for y in range(ny0, ny1):
            wet = lake.intersection(box(x*h, y*h, (x+1)*h, (y+1)*h))
            if wet.area <= AREA_EPS:
                continue
            key = cell_id(h, x, y)
            waters[x, y] = wet
            nearest = min(villages, key=lambda v: (wet.distance(v[2]), v[0]))[0] if villages else None
            require(wet.area <= h*h+AREA_EPS, "Aire aquatique supérieure au carré")
            cells[key] = dict(id=key, xIndex=x, yIndex=y, cellAreaM2=h*h, waterAreaM2=wet.area,
                              waterFraction=min(1, wet.area/(h*h)), candidateProtectedFraction=fraction(wet, reserves),
                              theoreticalTyphaFraction=fraction(wet, typha), nearestVillageId=nearest,
                              waterComponentCount=len(parts(wet)), neighbors=[])
    blocked = 0
    interfaces = []
    for (x, y), wet in waters.items():
        right = [((x+1)*h, y*h), ((x+1)*h, (y+1)*h)]
        above = [(x*h, (y+1)*h), ((x+1)*h, (y+1)*h)]
        for (nx, ny), side in (((x+1, y), right), ((x, y+1), above)):
            neighbor = waters.get((nx, ny))
            if neighbor is None:
                continue
            common = LineString(side)
            interfaces.append(((x, y), (nx, ny), common))
            if common.intersection(wet).intersection(common.intersection(neighbor)).length <= EDGE_EPS:
                continue
            a, b = cells[cell_id(h, x, y)], cells[cell_id(h, nx, ny)]
            if a["waterComponentCount"] != 1 or b["waterComponentCount"] != 1:
                blocked += 1
                continue
            a["neighbors"].append(b["id"])
            b["neighbors"].append(a["id"])
    cells = dict(sorted(cells.items()))
    for cell in cells.values():
        cell["neighbors"].sort()
        require(all(cell["id"] in cells[n]["neighbors"] for n in cell["neighbors"]), "Voisinage non réciproque")
    error = math.fsum(c["waterAreaM2"] for c in cells.values()) - lake.area
    tolerance = max(0.01, 1e-9*lake.area)
    require(abs(error) <= tolerance, f"Bilan d’aire: {error} m², tolérance {tolerance} m²")
    full = sum(abs(c["waterAreaM2"]-h*h) <= AREA_EPS for c in cells.values())
    multipart = [c["id"] for c in cells.values() if c["waterComponentCount"] > 1]
    if graphs is not None:
        graph = water_part_graph(waters, h, cells, interfaces)
        graphs.update(parts=graph, legacy=connectivity_summary(cells), blockedLegacyInterfaces=blocked)
    # Display coordinates only. Subdivide long UTM lines before inverse projection.
    def display_point(x, y):
        return [round(v, 9) for v in TO_WGS(x*h, y*h)]
    lines = [[display_point(x, y) for y in range(ny0, ny1+1)] for x in range(nx0, nx1+1)]
    lines.extend([[display_point(x, y) for x in range(nx0, nx1+1)] for y in range(ny0, ny1+1)])
    return dict(crs="EPSG:32628", originM=[0, 0], resolutionM=h, areaM2=lake.area,
                cells=list(cells.values()), gridLines=lines, displayBoundsIndices=[nx0, ny0, nx1, ny1]), dict(
        active=len(cells), full=full, partial=len(cells)-full, balanceErrorM2=error, balanceToleranceM2=tolerance,
        multipartCells=multipart, blockedEdges=blocked, edgeCount=sum(len(c["neighbors"]) for c in cells.values())//2,
        connectedComponents=wet_components(cells))


def layer_audit(records, by_domain):
    def areas(geom):
        result = {"areaKm2": geom.area/1e6}
        for name, domain in by_domain.items():
            result[name] = (dict(insideKm2=geom.intersection(domain).area/1e6,
                                 outsideKm2=geom.difference(domain).area/1e6) if domain is not None else None)
        return result
    geometries = [row[2] for row in records]
    merged = unary_union(geometries)
    return dict(objects=[dict(id=i, originalId=attrs.get("id"), **areas(g)) for i, _, g, attrs in records],
                sumKm2=math.fsum(g.area for g in geometries)/1e6, union=areas(merged),
                overlaps=[dict(first=a[0], second=b[0], **areas(a[2].intersection(b[2])))
                          for a, b in combinations(records, 2) if a[2].intersection(b[2]).area > 0])


def compare(hydro, alternative):
    intersection = hydro.intersection(alternative).area
    union = hydro.union(alternative).area
    return dict(intersectionKm2=intersection/1e6, unionKm2=union/1e6, jaccard=intersection/union,
                hydroOnlyKm2=hydro.difference(alternative).area/1e6,
                alternativeOnlyKm2=alternative.difference(hydro).area/1e6)


def json_file(path, data, pretty=False):
    options = {"indent": 2} if pretty else {"separators": (",", ":")}
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, **options)+"\n", encoding="utf-8")


def candidate_mask(hydro, hydro_hash, records, sources, args, expected, checks):
    perimeter = getattr(args, "perimeter_geojson", None)
    author = (getattr(args, "mask_author", None) or "Décision du doctorant, recette V2 du 27 novembre 2026").strip()
    require(0 < len(author) <= 512, "Auteur du masque requis (512 caractères au maximum)")
    if perimeter is not None:
        require(bool((getattr(args, "mask_author", None) or "").strip()), "--mask-author requis avec --perimeter-geojson")
        raw = perimeter.read_bytes()
        obj = json.loads(raw)
        require(isinstance(obj, dict) and "crs" not in obj, "Périmètre GeoJSON RFC 7946 en EPSG:4326 requis")
        if obj.get("type") == "Feature":
            obj = obj["geometry"]
        require(isinstance(obj, dict) and "crs" not in obj and obj.get("type") in POLYGONS,
                "Un seul Polygon ou MultiPolygon de périmètre est requis")
        mask = geographic(shape(obj), "Périmètre du chercheur", POLYGONS)
        mode, source, y = "researcher_polygon_v1", {"id": "researcher_geojson", "sha256": digest(raw),
                                                  "readCrs": "EPSG:4326"}, None
        reasoning = "Périmètre de travail fourni par le chercheur, à qualifier manuellement."
    elif "lac" in records and sources["lac"]["version"] == expected["viabFishSng"]["candidate_commit"] and all(
        checks[f"data/lac.{ext}"]["matches"] for ext in ("shp", "dbf", "prj")
    ):
        y = records["lac"][0][2].bounds[1]
        mask = north_mask(hydro, y)
        mode = "south_cut_min_northing_E_v1"
        source = {"id": sources["lac"]["id"], "version": sources["lac"]["version"], "files": sources["lac"]["files"]}
        reasoning = ("Communication personnelle d’Étienne Delay rapportée par le doctorant le 27 novembre 2026. "
                     "L’extension n’entre plus dans son domaine d’étude de la pêche en pirogue. "
                     "Le minimum nord UTM de E fournit une coupure provisoire, sans qualifier l’eau réelle ni la réglementation.")
    else:
        return None, None
    descriptor = dict(id=mode, version=1, crs="EPSG:32628", status="candidate_manual_review_required",
                      source=source, hydroSha256=hydro_hash, author=author, justification=reasoning,
                      observationDate=None, southNorthingM=y, parameters=dict(boundsUtmM=list(mask.bounds)),
                      maskSha256=digest(shapely.to_wkb(shapely.normalize(mask), byte_order=1, output_dimension=2)),
                      hashing="SHA256 du WKB normalisé 2D little endian en EPSG:32628")
    return mask, descriptor


def north_mask(hydro, y):
    west, _, east, north = hydro.bounds
    require(y < north, "Coupure au nord du lac")
    return box(west-1000, y, east+1000, north+1000)


def cut_domain(hydro, mask):
    retained = unary_union(parts(hydro.intersection(mask)))
    removed = unary_union(parts(hydro.difference(mask)))
    verify(retained, "Domaine conservé", POLYGONS)
    balance = math.fsum((retained.area, removed.area, -hydro.area))
    outside = retained.difference(hydro).area
    require(max(abs(balance), outside, retained.intersection(removed).area) <= AREA_EPS, "Bilan ou inclusion du masque")
    # A shared positive-length boundary identifies where previously continuous polygonal water is severed.
    crossings = retained.boundary.intersection(removed.boundary) if not removed.is_empty else LineString()
    segments = [line.length for line in shapely.get_parts(crossings) if line.geom_type == "LineString" and not line.is_empty]
    return retained, removed, crossings, dict(retainedKm2=retained.area/1e6, removedKm2=removed.area/1e6,
        areaBalanceErrorM2=balance, outsideHydroM2=outside, cutWaterInterfaceM=crossings.length,
        cutWaterSegmentLengthsM=sorted(segments, reverse=True))


def display_geometry(geom):
    return mapping(orientation(shapely.transform(geom, TO_WGS, interleaved=False)))


def cut_lines_wgs84(geom):
    return [display_geometry(line)["coordinates"] for line in shapely.get_parts(geom)
            if line.geom_type == "LineString" and not line.is_empty]


def village_domains(villages, domain, mask):
    return [dict(id=key, insideWater=domain.covers(point), insidePerimeterMask=mask.covers(point),
                 accessPoint=None, distanceToWaterM=domain.distance(point))
            for key, _, point, _ in villages]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hydro", required=True, type=Path)
    parser.add_argument("--etienne", type=Path, help="Dossier data du dépôt Git local viabFishSng")
    parser.add_argument("--etienne-commit", help="Commit complet attesté si la copie locale est fournie sans son dépôt Git")
    parser.add_argument("--acquired-at", type=date.fromisoformat, help="Date réelle d’acquisition locale des couches E")
    parser.add_argument("--local-use-proof", help="Référence documentée autorisant la dérivation et la consultation locale des couches E")
    parser.add_argument("--perimeter-geojson", type=Path, help="Polygon ou MultiPolygon RFC 7946 (WGS84), proposé par le chercheur")
    parser.add_argument("--mask-author", help="Auteur de la décision de périmètre, requis pour un polygone explicite")
    parser.add_argument("--out", required=True, type=Path, help="Nouveau dossier sous local-sig-guiers, hors build public")
    args = parser.parse_args()
    try:
        execute(args)
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError,
            shapefile.ShapefileException, shapely.errors.GEOSException, pyproj.exceptions.ProjError) as error:
        parser.exit(2, f"Audit interrompu : {error}\n")


def execute(args):
    local_root = Path(__file__).resolve().parents[2] / "local-sig-guiers"
    out = args.out.resolve()
    require(out.is_relative_to(local_root) and out != local_root and not out.exists(),
            "Choisir un nouveau sous-dossier de local-sig-guiers")
    proof = (args.local_use_proof or "").strip()
    require(not args.etienne or args.acquired_at is not None, "--acquired-at requis avec --etienne")
    require(not args.etienne_commit or args.etienne, "--etienne-commit requiert --etienne")
    require(not proof or (args.etienne and len(proof) <= 512 and not re.search(r"(?:[A-Za-z]:[\\/]|^/)", proof)),
            "Référence d’autorisation locale attendue, sans chemin absolu")
    expected = json.loads(MANIFEST.read_text(encoding="utf-8"))
    hydro, hydro_geometry, hydro_attributes, hydro_source, hydro_hash = read_hydro(args.hydro, expected["hydrolakes"])
    sources, anomalies, records = {}, [], {}
    comparison, alternative, commit = None, None, None
    checks = {}
    if args.etienne:
        folder = args.etienne.resolve()
        require(folder.name == "data", "Fournir le dossier data du clone viabFishSng")
        commit, checks = version_info(folder, expected["viabFishSng"]["git_blob_sha1"], args.etienne_commit)
        if args.etienne_commit:
            anomalies.append("Commit déclaré pour une copie détachée, vérification par blobs disponibles")
        anomalies.extend(
            f"{'Fichier de référence absent' if check['actual'] is None else 'Blob différent de l’audit initial'}: {name}"
            for name, check in checks.items() if not check["matches"])
        for name, count in LAYERS.items():
            if not any((folder / f"{name}{ext}").exists() for ext in (".shp", ".dbf", ".shx", ".prj", ".qmd", ".cpg")):
                anomalies.append(f"Couche absente: {name}")
                continue
            layer, files, encoding, qmd = load_layer(folder, name, commit)
            require(name not in ("lac", "envelope") or len(layer) == 1, f"{name}: contour unique requis")
            if len(layer) != count:
                anomalies.append(f"{name}: {len(layer)} objets, repère initial {count}")
            duplicates = [str(k) for k, n in Counter(row[3].get("id") for row in layer).items() if k is not None and n > 1]
            if duplicates:
                anomalies.append(f"{name}: identifiants attributaires répétés ({', '.join(duplicates)}), clés techniques distinctes")
            if qmd and qmd != "EPSG:4326":
                anomalies.append(f"{name}: QMD indique {qmd}, PRJ et coordonnées stockées indiquent EPSG:4326")
            if name == "villages":
                for i, _, _, village_attributes in layer:
                    if village_attributes["population"] is None and str(village_attributes["populationSource"] or "").strip():
                        anomalies.append(f"{i}: population source non numérique, valeur calculable inconnue")
                    if village_attributes["name"] is None:
                        anomalies.append(f"{i}: nom absent dans la source")
            else:
                for i, geom, _, _ in layer:
                    rings = [ring for polygon in parts(geom) for ring in [polygon.exterior, *polygon.interiors]]
                    repeats = sum(a == b for ring in rings for a, b in pairwise(ring.coords))
                    if repeats:
                        anomalies.append(f"{i}: {repeats} répétition(s) consécutive(s), sommets source conservés")
            records[name] = layer
            sources[name] = dict(id=f"viabFishSng:{name}", url=VIAB_URL, attribution="Étienne Delay / viabFishSng",
                version=commit, files=files, acquiredAt=args.acquired_at.isoformat(), observationDate=None,
                license=None, rights="local_study_reviewed" if proof else "unconfirmed", rightsEvidence=proof or None,
                declaredCrs="PRJ: WGS 84 géographique", metadataCrs=qmd, readCrs="EPSG:4326", encoding=encoding,
                transformation="PROJ always_xy vers EPSG:32628", technical="checked_by_pipeline",
                empirical="unconfirmed", institutional="unconfirmed",
                permittedUse="Consultation locale selon la référence fournie" if proof else "Audit local de la copie fournie")
        if "lac" in records:
            alternative = records["lac"][0][2]
            comparison = compare(hydro, alternative)

    envelope = records["envelope"][0][2] if "envelope" in records else None
    mask, mask_provenance = candidate_mask(hydro, hydro_hash, records, sources, args, expected, checks)
    retained = removed = crossings = balance = sensitivity = None
    if mask is not None:
        retained, removed, crossings, balance = cut_domain(hydro, mask)
    elif alternative is not None:
        anomalies.append("HP_PLUS indisponible : commit et blobs E épinglés requis pour la coupure automatique.")
    if envelope is not None and checks["data/envelope.shp"]["matches"] and commit == expected["viabFishSng"]["candidate_commit"]:
        sensitivity_y = envelope.bounds[1]
        sensitivity_domain, _, _, sensitivity_balance = cut_domain(hydro, north_mask(hydro, sensitivity_y))
        sensitivity = dict(id="south_cut_min_northing_envelope_v1", source=sources["envelope"]["id"],
                           crs="EPSG:32628", southNorthingM=sensitivity_y, **sensitivity_balance, grids={})
        for h in (1000, 500):
            _, counts = grid(sensitivity_domain, h)
            sensitivity["grids"][h] = {key: counts[key] for key in ("active", "full", "partial", "balanceErrorM2")}

    report = dict(version=2, status="geometry_audit_not_field_validation", crs="EPSG:32628", hydro=metrics(hydro),
                  hydroAttributes=hydro_attributes, alternative=metrics(alternative) if alternative is not None else None,
                  envelope=metrics(envelope) if envelope is not None else None,
                  fishingDomain=(dict(configuration="HP_PLUS", geometry=metrics(retained), mask=mask_provenance, **balance)
                                 if retained is not None else None), sensitivity=sensitivity,
                  comparison=comparison, sourceBlobChecks=checks, anomalies=anomalies, grids={},
                  versions=dict(shapely=shapely.__version__, GEOS=shapely.geos_version_string,
                                pyproj=pyproj.__version__, PROJ=pyproj.proj_version_str, pyshp=shapefile.__version__),
                  areaToleranceM2=AREA_EPS, interfaceToleranceM=EDGE_EPS)
    domains = dict(H=hydro, E=alternative, HP_PLUS=retained)
    report["themes"] = {key: layer_audit(records[name], domains) for key, name in THEMES.items()
                        if name in records and key != "villages"}
    villages = records.get("villages", [])
    village_status = village_domains(villages, retained, mask) if retained is not None else None
    report["villages"] = (dict(count=len(villages), missingPopulation=sum(row[3]["population"] is None for row in villages),
        missingName=sum(row[3]["name"] is None for row in villages),
        outsideFishingWater=sum(not entry["insideWater"] for entry in village_status) if village_status is not None else None,
        outsidePerimeterMask=sum(not entry["insidePerimeterMask"] for entry in village_status) if village_status is not None else None,
        fishingDomain=village_status) if villages else None)
    reserves, typha = [unary_union([row[2] for row in records[THEMES[key]]]) if THEMES[key] in records else None
                       for key in ("reserves", "typha")]
    h_grids, e_grids, plus_grids, fishing_grids, graphs = {}, {}, {}, {}, {}
    def audited_grid(name, lake, h, *themes):
        graph = graphs[f"{name}_{h}"] = {}
        payload, counts = grid(lake, h, *themes, graphs=graph)
        report["grids"][f"{name}_{h}"] = {**counts, "waterParts": graph["parts"]["summary"], "legacyConnectivity": graph["legacy"]}
        return payload
    for h in (1000, 500):
        h_grids[h] = audited_grid("H", hydro, h)
        if alternative is not None:
            e_grids[h] = audited_grid("E", alternative, h)
        if any(name in records for name in THEMES.values()):
            plus_grids[h], counts = grid(hydro, h, reserves, typha, villages)
            graphs[f"H_PLUS_{h}"] = graphs[f"H_{h}"]
            report["grids"][f"H_PLUS_{h}"] = {**counts, "waterParts": graphs[f"H_{h}"]["parts"]["summary"],
                                             "legacyConnectivity": graphs[f"H_{h}"]["legacy"]}
            domain_fields = ("id", "waterAreaM2", "waterComponentCount", "neighbors")
            cell_domains = [[tuple(cell[key] for key in domain_fields) for cell in payload["cells"]]
                            for payload in (h_grids[h], plus_grids[h])]
            require(cell_domains[0] == cell_domains[1], "H+ doit reprendre le domaine H")
        if retained is not None:
            fishing_grids[h] = audited_grid("HP_PLUS", retained, h, reserves, typha, villages)
            for key, layer, field in (("reserves", reserves, "candidateProtectedFraction"),
                                       ("typha", typha, "theoreticalTyphaFraction")):
                if layer is not None:
                    by_cell = math.fsum(c[field]*c["waterAreaM2"] for c in fishing_grids[h]["cells"])
                    residual = by_cell - retained.intersection(layer).area
                    require(abs(residual) <= AREA_EPS, f"Bilan thématique HP_PLUS/{key}")
                    report["grids"][f"HP_PLUS_{h}"].setdefault("thematicBalanceErrorM2", {})[key] = residual
    connectivity = {key: dict(parts=graph["parts"]["summary"], legacy=graph["legacy"],
                              blockedLegacyInterfaces=graph["blockedLegacyInterfaces"]) for key, graph in graphs.items()}
    manifest = dict(version=2, hydro={**hydro_source, "sourceAttributes": hydro_attributes}, viabFishSng=sources,
                    fishingMask=mask_provenance, sensitivity=sensitivity)
    out.mkdir(parents=True)
    json_file(out/"report.json", report, pretty=True)
    json_file(out/"provenance.json", manifest, pretty=True)
    json_file(out/"reference-H.json", dict(kind="irritator.guiers.reference", version=1, hydroSha256=hydro_hash,
              source=hydro_source, geometry=hydro_geometry, grids=h_grids))
    json_file(out/"connectivity-H.json", dict(version=1, hydroSha256=hydro_hash,
              grids={h: connectivity[f"H_{h}"] for h in (1000, 500)}))
    json_file(out/"water-part-graphs.json", dict(version=1, status="local_geometry_audit", hydroSha256=hydro_hash,
              maskSha256=mask_provenance["maskSha256"] if mask_provenance else None,
              aliases={key: key.replace("H_PLUS", "H") for key in graphs if key.startswith("H_PLUS_")},
              graphs={key: value for key, value in graphs.items() if not key.startswith("H_PLUS_")}))
    if retained is not None:
        from map_comparison import write_maps
        write_maps(out, hydro, alternative, retained, removed, mask, crossings, mask_provenance, sensitivity)
    if proof and any(name != "envelope" for name in records):
        geo_features = {}
        for name, layer in records.items():
            if name == "envelope":
                continue
            geo_features[name] = [dict(type="Feature", id=i, geometry=mapping(orientation(g)),
                                       properties={**props, "sourceId": sources[name]["id"]}) for i, g, _, props in layer]
        bundle = dict(kind="irritator.guiers.candidate", version=1, hydroSha256=hydro_hash,
                      sources={name: source for name, source in sources.items() if name != "envelope"},
                      grids=plus_grids, alternativeGrids=e_grids, layers=geo_features,
                      comparison=comparison, anomalies=anomalies)
        json_file(out/"candidate-local.json", bundle)
        if retained is not None:
            json_file(out/"candidate-local-v2.json", dict(bundle, version=2, connectivity=connectivity, fishingDomain=dict(
                geometry=display_geometry(retained), removedGeometry=display_geometry(removed) if not removed.is_empty else None,
                mask=mask_provenance, grids=fishing_grids, villages=village_status,
                boundsCutWgs84=cut_lines_wgs84(crossings),
                sensitivity={key: sensitivity[key] for key in ("id", "southNorthingM", "retainedKm2", "removedKm2")} if sensitivity else None)))
            json_file(out/"mask-local.geojson", dict(type="Feature", geometry=display_geometry(mask), properties=mask_provenance))
        json_file(out/"viabFishSng-candidate.geojson", dict(type="FeatureCollection",
                  features=[feature for layer in geo_features.values() for feature in layer]))
    print("Audit local terminé. Le rapport et les sorties sont dans le dossier demandé.")


if __name__ == "__main__":
    main()
