import json
from argparse import Namespace
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import shapefile
from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping
from shapely.ops import unary_union

from audit_sig import WGS, UTM, cut_domain, execute, geographic, grid, load_layer, north_mask, read_hydro, verify


class TestGuiersAudit(unittest.TestCase):
    def test_holes_partial_and_area_balance(self):
        lake = Polygon(box(0, 0, 1500, 1000).exterior.coords,
                       [box(10, 10, 110, 110).exterior.coords])
        contract, report = grid(lake, 1000)
        self.assertEqual((report["active"], report["partial"], report["full"]), (2, 2, 0))
        self.assertAlmostEqual(contract["areaM2"], 1490000)
        self.assertAlmostEqual(report["balanceErrorM2"], 0)
        self.assertEqual(report["edgeCount"], 1)

    def test_diagonal_and_land_interfaces(self):
        lake = MultiPolygon([box(0, 0, 1000, 1000), box(1000, 1000, 2000, 2000),
                             box(2000, 0, 2500, 500)])
        graphs = {}
        contract, report = grid(lake, 1000, graphs=graphs)
        self.assertEqual(report["active"], 3)
        self.assertFalse(any(cell["neighbors"] for cell in contract["cells"]))
        self.assertEqual(len(report["connectedComponents"]), 3)
        self.assertEqual(graphs["parts"]["summary"]["components"], 3)
        self.assertEqual(graphs["parts"]["summary"]["isolatedAreaM2"], lake.area)

    def test_multipart_never_bridges_two_neighbors(self):
        lake = MultiPolygon([box(0, 0, 1100, 400), box(1900, 600, 3000, 1000)])
        graphs = {}
        contract, report = grid(lake, 1000, graphs=graphs)
        self.assertEqual(report["blockedEdges"], 2)
        self.assertEqual(report["multipartCells"], ["utm28n:h1000:x1:y0"])
        self.assertFalse(any(cell["neighbors"] for cell in contract["cells"]))
        graph = graphs["parts"]
        self.assertEqual(graph["summary"]["components"], 2)
        self.assertEqual(graph["summary"]["isolatedNodes"], 0)
        self.assertEqual([e["interfaceLengthM"] for e in graph["edges"]], [400, 400])
        nodes = {n["id"]: n for n in graph["nodes"]}
        self.assertTrue(all(n["id"] in nodes[p]["neighbors"] for n in nodes.values() for p in n["neighbors"]))
        for cell in contract["cells"]:
            self.assertAlmostEqual(cell["waterAreaM2"], sum(n["waterAreaM2"] for n in nodes.values() if n["cellId"] == cell["id"]))
        reordered = {}
        grid(MultiPolygon(list(reversed(lake.geoms))), 1000, graphs=reordered)
        self.assertEqual(graph, reordered["parts"])

    def test_exact_cut_keeps_a_narrow_channel_and_source_hole(self):
        lake = Polygon(box(0, 0, 2500, 1000).exterior.coords, [box(10, 800, 100, 900).exterior.coords])
        retained, removed, crossings, report = cut_domain(lake, north_mask(lake, 750))
        self.assertEqual(crossings.length, 2500)
        self.assertEqual(report["outsideHydroM2"], 0)
        self.assertEqual(lake.area, retained.area + removed.area)
        self.assertEqual(len(retained.interiors), 1)
        graphs = {}
        grid(retained, 1000, graphs=graphs)
        self.assertEqual(graphs["parts"]["summary"]["components"], 1)
        self.assertEqual([edge["interfaceLengthM"] for edge in graphs["parts"]["edges"]], [250, 250])

    def test_overlap_outside_water_and_missing_theme(self):
        lake = box(0, 0, 1000, 1000)
        reserves = unary_union([box(-500, 0, 400, 1000), box(300, 0, 500, 1000)])
        candidate, _ = grid(lake, 1000, reserves, box(1100, 0, 1200, 10))
        reference, _ = grid(lake, 1000)
        c = candidate["cells"][0]
        self.assertEqual(c["waterAreaM2"], reference["cells"][0]["waterAreaM2"])
        self.assertEqual(c["candidateProtectedFraction"], 0.5)
        self.assertEqual(c["theoreticalTyphaFraction"], 0)
        self.assertIsNone(reference["cells"][0]["theoreticalTyphaFraction"])

    def test_invalid_coordinates_and_shape(self):
        with self.assertRaisesRegex(ValueError, "Self-intersection"):
            verify(Polygon([(0, 0), (10, 10), (0, 10), (10, 0)]), "croisement", ("Polygon",))
        with self.assertRaisesRegex(ValueError, "bornes"):
            geographic(Point(420000, 1800000), "mauvais CRS", ("Point",))
        with self.assertRaisesRegex(ValueError, "finies"):
            verify(Point(float("nan"), 16), "point", ("Point",))

    def test_shapefile_crs_duplicate_ids_and_null_population(self):
        with TemporaryDirectory() as tmp:
            base = Path(tmp) / "villages"
            with (base.with_suffix(".shp").open("w+b") as shp, base.with_suffix(".shx").open("w+b") as shx,
                  base.with_suffix(".dbf").open("w+b") as dbf):
                with shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POINT, encoding="utf-8") as writer:
                    for name in ("id", "name", "population"):
                        writer.field(name, "C")
                    writer.point(-15.87, 16.18)
                    writer.record("1", "École", "")
                    writer.point(-15.90, 16.18)
                    writer.record("1", "Village", "0")
            base.with_suffix(".prj").write_text(UTM.to_wkt(), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "PRJ différent"):
                load_layer(base.parent, base.name, "a"*40)
            base.with_suffix(".prj").write_text(WGS.to_wkt(), encoding="utf-8")
            records, files, encoding, _ = load_layer(base.parent, base.name, "a"*40)
            self.assertEqual(encoding, "utf-8")
            self.assertEqual(len(files), 4)
            self.assertEqual([r[3]["id"] for r in records], ["1", "1"])
            self.assertNotEqual(records[0][0], records[1][0])
            self.assertEqual(records[0][3]["name"], "École")
            self.assertIsNone(records[0][3]["population"])
            self.assertEqual(records[1][3]["population"], 0)
            base.with_suffix(".shx").unlink()
            with self.assertRaisesRegex(ValueError, "shx manquant"):
                load_layer(base.parent, base.name, "a"*40)

    def test_wrong_hydro_fingerprint(self):
        with TemporaryDirectory() as tmp:
            hydro = Path(tmp) / "fake.geojson"
            hydro.write_text(json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "empreinte divergente"):
                read_hydro(hydro, {"original_git_blob_sha1": "a"*40})

    def test_optional_layers_and_authorized_local_export(self):
        root = Path(__file__).resolve().parents[2]
        scratch = root / "local-sig-guiers"
        scratch.mkdir(exist_ok=True)
        with TemporaryDirectory(dir=scratch) as tmp:
            folder = Path(tmp) / "data"
            folder.mkdir()
            base = folder / "villages"
            with (base.with_suffix(".shp").open("w+b") as shp, base.with_suffix(".shx").open("w+b") as shx,
                  base.with_suffix(".dbf").open("w+b") as dbf):
                with shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POINT) as writer:
                    for name in ("id", "name", "population"):
                        writer.field(name, "C")
                    writer.point(-15.84, 16.1)
                    writer.record("1", "Fixture synthétique", "")
            base.with_suffix(".prj").write_text(WGS.to_wkt(), encoding="utf-8")
            args = Namespace(hydro=root/"web/apps/frontend/data/geography/guiers-hydrolakes-1520.original.geojson",
                             etienne=folder, etienne_commit="1"*40, acquired_at=date(2026, 11, 27),
                             local_use_proof=None, out=Path(tmp)/"audit")
            source_attributes = json.loads(args.hydro.read_bytes())["properties"]
            execute(args)
            report = json.loads((args.out/"report.json").read_bytes())
            provenance = json.loads((args.out/"provenance.json").read_bytes())
            self.assertEqual(report["hydroAttributes"], source_attributes)
            self.assertEqual(provenance["hydro"]["sourceAttributes"], source_attributes)
            self.assertEqual(report["hydroAttributes"]["Hylak_id"], "1520")
            self.assertEqual(report["hydroAttributes"]["Lake_area"], "221.01")
            self.assertEqual(provenance["hydro"]["id"], "hydrolakes-v10-1520")
            self.assertNotIn("population", report["hydroAttributes"])
            self.assertFalse((args.out/"candidate-local.json").exists())
            self.assertFalse((args.out/"candidate-local-v2.json").exists())
            self.assertEqual((args.out/"reference-H.json").read_text(encoding="utf-8"),
                             (args.hydro.parent/"guiers-metric-reference.json").read_text(encoding="utf-8"))
            args.local_use_proof, args.out = "Fixture originale du test", Path(tmp)/"permission"
            execute(args)
            b = json.loads((args.out/"candidate-local.json").read_text(encoding="utf-8"))
            self.assertEqual(set(b["layers"]), {"villages"})
            self.assertEqual(set(b["grids"]), {"500", "1000"})
            self.assertIsNone(b["grids"]["500"]["cells"][0]["candidateProtectedFraction"])
            self.assertFalse(b["alternativeGrids"])
            with self.assertRaisesRegex(ValueError, "nouveau sous-dossier"):
                execute(args)
            perimeter = Path(tmp)/"perimeter.geojson"
            perimeter.write_text(json.dumps(mapping(box(-16.1, 16.2, -15.6, 16.7))), encoding="utf-8")
            args.perimeter_geojson, args.out = perimeter, Path(tmp)/"explicit"
            with self.assertRaisesRegex(ValueError, "--mask-author"):
                execute(args)
            args.mask_author = "Chercheur de la fixture"
            execute(args)
            v2 = json.loads((args.out/"candidate-local-v2.json").read_bytes())
            self.assertEqual(v2["version"], 2)
            domain = v2["fishingDomain"]
            self.assertEqual(domain["mask"]["id"], "researcher_polygon_v1")
            self.assertIsNone(domain["mask"]["observationDate"])
            self.assertIsNotNone(domain["removedGeometry"])
            self.assertFalse(domain["villages"][0]["insideWater"])
            self.assertIsNone(domain["villages"][0]["accessPoint"])
            self.assertTrue(domain["boundsCutWgs84"])
            self.assertTrue((args.out/"carte-detail-coupure.svg").is_file())
            self.assertTrue((args.out/"mask-local.geojson").is_file())


if __name__ == "__main__":
    unittest.main()
