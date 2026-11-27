"""Cartes d’audit autonomes, sans fond distant ni dépendance graphique."""

from xml.sax.saxutils import escape

import shapely
from shapely.geometry import LineString, Point


def write_maps(out, hydro, alternative, retained, removed, mask, crossings, provenance, sensitivity):
    shapes = [g for g in (hydro, alternative) if g is not None]
    west, south, east, north = shapely.union_all(shapes).bounds
    cut_y = provenance["southNorthingM"]
    sensitivity_y = sensitivity["southNorthingM"] if sensitivity else None
    boundary = LineString([(west, cut_y), (east, cut_y)]) if cut_y is not None else mask.boundary
    variation = LineString([(west, sensitivity_y), (east, sensitivity_y)]) if sensitivity_y is not None else None
    palettes = dict(hydro="#80badc", alternative="#067a70", retained="#2476a5", removed="#ecad62",
                    cut="#a2294e", sensitivity="#6e55aa", crossing="#a2294e")

    def number(value, decimals=2):
        return f"{value:.{decimals}f}".replace(".", ",")

    def label(x, y, value, size=15, **attrs):
        details = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
        return f'<text x="{x}" y="{y}" font-size="{size}" {details}>{escape(value)}</text>'

    def panel(x, top, width, height, bounds, title, layers, scale_km, panel_id):
        x0, y0, x1, y1 = bounds
        scale = min((width-40)/(x1-x0), (height-73)/(y1-y0))
        left = x+(width-scale*(x1-x0))/2
        upper = top+47+(height-62-scale*(y1-y0))/2

        def project(a, b):
            return left+(a-x0)*scale, upper+(y1-b)*scale

        def vertex(a, b):
            tx, ty = project(a, b)
            return f"{tx:.2f},{ty:.2f}"

        def paths(geom):
            if geom.is_empty:
                return ""
            if geom.geom_type == "Polygon":
                return " ".join("M"+" L".join(vertex(*p) for p in ring.coords)+" Z"
                                for ring in (geom.exterior, *geom.interiors))
            if geom.geom_type == "LineString":
                return "M"+" L".join(vertex(*p) for p in geom.coords)
            if hasattr(geom, "geoms"):
                return " ".join(paths(g) for g in geom.geoms)
            return ""

        bottom = top+height-13
        start = x+21
        end = start+1000*scale_km*scale
        mark = x+width-27
        body = [f'<rect x="{x}" y="{top}" width="{width}" height="{height}" rx="12" fill="#fff" stroke="#d1dce2"/>',
                label(x+17, top+27, title, 16, font_weight="700"),
                f'<clipPath id="{panel_id}"><rect x="{x+12}" y="{top+43}" width="{width-24}" height="{height-67}"/></clipPath>',
                f'<g clip-path="url(#{panel_id})">']
        for geom, colour, fill, stroke_width, dash in layers:
            if geom is not None:
                style = f' stroke-dasharray="{dash}"' if dash else ""
                body.append(f'<path d="{paths(geom)}" fill="{colour if fill else "none"}" fill-rule="evenodd" '
                            f'stroke="{colour}" stroke-width="{stroke_width}"{style}/>')
        for i, geom in enumerate(shapely.get_parts(crossings), 1) if panel_id == "detail" else ():
            if geom.length <= 0:
                continue
            target = geom.interpolate(0.5, normalized=True)
            sx, sy = project(target.x, target.y)
            # A callout pointing from outside the shore keeps the water interface visible.
            gap = 45 + 17*(i-1)
            body.extend((f'<path d="M{sx:.2f},{sy:.2f} l{gap},-30" stroke="#a2294e" fill="none"/>',
                         label(sx+gap+4, sy-30, str(i), 13, font_weight="700", fill=palettes["cut"])))
        body.extend(("</g>", label(mark, top+62, "N", 14, text_anchor="middle", font_weight="700"),
                     f'<path d="M{mark},{top+67} l-5,14 h10 Z" fill="#183845"/>',
                     f'<path d="M{start},{bottom-5} v5 H{end} v-5" stroke="#183845" fill="none"/>',
                     label(end+6, bottom, f"{scale_km} km", 11)))
        return body

    def filled(geom, name):
        return (geom, palettes[name], True, 0.45, None)

    def line(geom, name, width=1.6, dash=None):
        return (geom, palettes[name], False, width, dash)

    def document(filename, title, subtitle, body, notes, height):
        header = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 {height}" width="1170" height="{height}" role="img">',
                  f'<title>{escape(title)}</title><desc>{escape(subtitle)}</desc>',
                  '<rect width="100%" height="100%" fill="#f1f6f8"/>',
                  '<g font-family="Segoe UI, Arial, sans-serif" fill="#183845">',
                  label(28, 43, title, 29, font_weight="700"), label(28, 70, subtitle, 15)]
        footer = [label(28, height-60+i*19, note, 13) for i, note in enumerate(notes)]
        (out/filename).write_text("\n".join([*header, *body, *footer, "</g></svg>\n"]), encoding="utf-8")

    full = (west-1200, south-1600, east+1200, north+1600)
    common = [line(boundary, "cut", dash="7 5"), line(variation, "sensitivity", dash="3 5")]
    overlay = [filled(retained, "retained"), filled(removed, "removed"), line(alternative, "alternative"),
               *common, line(crossings, "crossing", 4)]
    panels = []
    for i, (title, layers) in enumerate([
        (f"H · {number(hydro.area/1e6)} km²", [filled(hydro, "hydro"), *common]),
        (f"E · {number(alternative.area/1e6)} km²" if alternative is not None else "E indisponible",
         [filled(alternative, "alternative"), *common]),
        (f"Lₚ · {number(retained.area/1e6)} km²", [filled(retained, "retained"), *common]),
        (f"H moins Lₚ · {number(removed.area/1e6)} km²", overlay),
    ]):
        panels.extend(panel(28+280*i, 93, 273, 530, full, title, layers, 10, f"overview{i}"))
    notes = ["Bleu : eau conservée · ocre : eau exclue du domaine candidat · vert : contour E · rouge : limite de travail.",
             "Pointillés violets : sensibilité issue d’envelope. Les traits rouges épais désignent les interfaces aquatiques tronquées.",
             "Nord de grille et échelles en UTM 28N. HydroLAKES v1.0 (CC BY 4.0) et viabFishSng. Consultation locale, audit sans validation terrain."]
    document("carte-comparative-hp-plus.svg", "Lac de Guiers · périmètre candidat de pêche en pirogue",
             "HydroLAKES complet, contour Étienne Delay, eau conservée et extension exclue · même emprise et même échelle", panels, notes, 704)

    target = crossings if not crossings.is_empty else (Point((west+east)/2, cut_y) if cut_y is not None else retained.representative_point())
    tx0, ty0, tx1, ty1 = target.bounds
    detail = (tx0-2700, min(ty0, sensitivity_y if sensitivity_y is not None else ty0)-1350, tx1+2700, ty1+1350)
    detail_body = panel(28, 93, 1114, 444, detail, "Coupure et continuité de l’eau dans HydroLAKES", overlay, 1, "detail")
    thresholds = f"Y de la coupure · {number(cut_y, 3)} m" if cut_y is not None else "Polygone proposé par le chercheur"
    if sensitivity:
        thresholds += f" · Sensibilité · {number(sensitivity_y, 3)} m"
    notes[1] = f"Longueur totale des interfaces tronquées : {number(crossings.length)} m. Les repères numérotés pointent vers ces interfaces."
    document("carte-detail-coupure.svg", "Lac de Guiers · détail du périmètre candidat", thresholds, detail_body, notes, 620)
