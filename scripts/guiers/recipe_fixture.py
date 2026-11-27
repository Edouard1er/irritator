"""Generate a local Guiers test bundle with invented supplemental layers."""

from argparse import Namespace
from datetime import date
from pathlib import Path
import sys

import shapefile
from shapely.geometry import box, mapping
from shapely.geometry.polygon import orient

from audit_sig import WGS, execute, json_file


def main(workspace, acquired_at):
    data = workspace / "data"
    data.mkdir(parents=True, exist_ok=True)
    for name, bounds in {
        "lac": (-15.91, 16.1, -15.79, 16.35),
        "zoneExclusionPeche": (-15.90, 16.23, -15.86, 16.26),
        "tipha_theoric": (-15.91, 16.30, -15.86, 16.34),
    }.items():
        with shapefile.Writer(str(data / name), shapeType=shapefile.POLYGON) as writer:
            writer.field("id", "C")
            writer.poly([list(orient(box(*bounds), sign=-1).exterior.coords)])
            writer.record("1")
        (data / f"{name}.prj").write_text(WGS.to_wkt(), encoding="utf-8")
    with shapefile.Writer(str(data / "villages"), shapeType=shapefile.POINT) as writer:
        for name in ("id", "name", "population"):
            writer.field(name, "C")
        writer.point(-15.84, 16.24)
        writer.record("1", "Village synthétique", "")
    (data / "villages.prj").write_text(WGS.to_wkt(), encoding="utf-8")
    perimeter = workspace / "perimeter.geojson"
    json_file(perimeter, mapping(box(-16.1, 16.2, -15.6, 16.7)))
    root = Path(__file__).resolve().parents[2]
    execute(Namespace(hydro=root / "web/apps/frontend/data/geography/guiers-hydrolakes-1520.original.geojson",
                      etienne=data, etienne_commit="1" * 40, acquired_at=acquired_at,
                      local_use_proof="Jeu synthétique V2.1", perimeter_geojson=perimeter,
                      mask_author="Recette synthétique V2.1", out=workspace / "sorties"))


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve(), date.fromisoformat(sys.argv[2]))
