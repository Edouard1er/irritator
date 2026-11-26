import {
  formatSmall, lakeExchangeDirection, lakeExchangePath, lakeFraming, lakeLegend, lakeMapColor, lakeMapInk, lakeMapReading, lakeMonth, lakeOutline,
  lakeSignedTonnes, lakeSyntheticNotice, lakeTotalTonnes, type LakeCell, type LakeDataset, type LakeDisplay, type LakeExchangeOverlay, type LakeView,
} from './lake-exploration';
import { lakeDistributionProfile, type LakeMesh } from './spatial-experiment';

export type LakeViewSnapshot = {
  mesh: LakeMesh;
  cells: readonly LakeCell[];
  maps: readonly { title: string; dataset: LakeDataset; exchange?: LakeExchangeOverlay }[];
  reference?: LakeDataset;
  display: LakeDisplay;
  limits: readonly [number, number, number];
  adaptive: boolean;
  tick: number;
  time: number;
  view: LakeView;
  selected: string;
  highlights: ReadonlyMap<string, string>;
};

const escapeXml = (text: string) => text.replace(/[<>&"']/g, char => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[char]!);

export function lakeViewSvg({ mesh, cells, maps, reference, display, limits, adaptive, tick, time, view, selected, highlights }: LakeViewSnapshot) {
  const width = maps.length === 2 ? 1360 : 900;
  const height = 940;
  const cardWidth = (width - 64 - 20 * (maps.length - 1)) / maps.length;
  const outline = lakeOutline(mesh);
  const { viewBox, markerRadius } = lakeFraming(mesh, view);
  const legend = lakeLegend(display, limits, adaptive, !!reference);
  const { noData, grid, outline: shore } = lakeMapInk;
  const line = 'vector-effect="non-scaling-stroke"';
  const comparison = maps.length === 2 ? maps[1]!.dataset.totals[tick]! - maps[0]!.dataset.totals[tick]! : undefined;
  const panels = maps.map(({ title, dataset, exchange }, index) => {
    const { distribution } = dataset.trace.parameters;
    const profile = lakeDistributionProfile(distribution);
    const total = dataset.totals[tick]!;
    const gain = total - dataset.totals[0]!;
    const regions = cells.map(cell => {
      const { reading, value } = lakeMapReading(dataset, reference, cell.id, tick, display);
      const fill = value === undefined ? noData : lakeMapColor(value, limits, display);
      return `<rect data-cell="${escapeXml(cell.id)}" data-wet-fraction="${cell.wetFraction}" data-area="${cell.area}"`
        + (reading ? ` data-biomass="${reading.value}" data-observed-time="${reading.time}"` : '')
        + (value === undefined ? '' : ` data-map-value="${value}"`)
        + ` x="${cell.x}" y="${cell.y}" width="${cell.width}" height="${cell.height}" fill="${fill}"`
        + ` stroke="${cell.id === selected ? '#143f43' : grid}" stroke-width="${cell.id === selected ? 3 : 1}" ${line}/>`;
    }).join('');
    const markers = cells.filter(cell => highlights.has(cell.id)).map(cell =>
      `<circle cx="${cell.wetCentroid[0]}" cy="${cell.wetCentroid[1]}" r="${markerRadius * (cell.id === selected ? 1 : 0.7)}"`
      + ` fill="none" stroke="${escapeXml(highlights.get(cell.id)!)}" stroke-width="${cell.id === selected ? 3 : 2}" ${line}/>`).join('');
    const exchangePath = exchange && lakeExchangePath(exchange, markerRadius);
    const direction = exchange && lakeExchangeDirection(exchange);
    return `<g transform="translate(${32 + index * (cardWidth + 20)} 112)" data-map-total="${total}"
  data-distribution="${distribution.kind}" data-profile="${profile}" data-alpha="${distribution.kind === 'homogeneous' ? 0 : distribution.alpha}">
  <rect width="${cardWidth}" height="622" rx="14" fill="#fff" stroke="#d4e2df"/>
  <text x="20" y="34" font-size="24" font-weight="700">${escapeXml(title)}</text>
  <text x="20" y="62" font-size="18">Biomasse totale · ${lakeTotalTonnes(total)}</text>
  <text x="20" y="85" font-size="16">Évolution depuis le début · ${lakeSignedTonnes(gain)}</text>
  ${distribution.kind === 'homogeneous' ? '' : `<text x="${cardWidth - 20}" y="85" text-anchor="end" font-size="16">Profil ${profile}</text>`}
  <svg x="20" y="101" width="${cardWidth - 40}" height="502" viewBox="${viewBox}" overflow="hidden">
    <g clip-path="url(#lake-shore)">${regions}</g>
    ${markers}
    <path d="${outline}" fill="none" stroke="${shore}" ${line}/>
    ${exchange ? `<g clip-path="url(#lake-shore)" data-exchange-pair="${escapeXml(exchange.a + ' ' + exchange.b)}">
      <path d="${exchangePath}" stroke="white" stroke-width="6" stroke-linecap="round" fill="none" ${line}/>
      <path d="${exchangePath}" stroke="#183343" stroke-width="3" stroke-linecap="round" fill="none" ${line}
        ${exchange.flux ? '' : 'stroke-dasharray="3 3"'}/>
    </g>` : ''}
  </svg>
  ${direction && exchange?.flux !== undefined ? `<text x="20" y="611" font-size="15" data-flow="${exchange.flux}">
    ${escapeXml(direction)} · ${formatSmall(Math.abs(exchange.flux))} t/mois · reconstitué</text>` : ''}
</g>`;
  });
  const scaleWidth = 420;
  const scale = legend.showScale ? `<rect x="0" y="12" width="${scaleWidth}" height="12" fill="url(#lake-legend)"/>`
    + legend.ticks.map((tickLabel, index) => {
      const x = legend.ticks.length === 1 ? scaleWidth / 2 : scaleWidth * index / (legend.ticks.length - 1);
      const anchor = x === 0 ? 'start' : x === scaleWidth ? 'end' : 'middle';
      return `<text x="${x}" y="45" text-anchor="${anchor}" font-size="15">${escapeXml(tickLabel)}</text>`;
    }).join('') : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
  role="img" aria-labelledby="lake-title lake-desc" data-time="${time}" data-rows="${mesh.rows}" data-columns="${mesh.columns}">
<title id="lake-title">Lac de Guiers · Simulation logistique spatiale</title>
<desc id="lake-desc">${lakeSyntheticNotice}</desc>
<defs>
  <clipPath id="lake-shore"><path d="${outline}" clip-rule="evenodd"/></clipPath>
  <linearGradient id="lake-legend">${legend.colors.map((color, index) =>
    `<stop offset="${index / (legend.colors.length - 1)}" stop-color="${color}"/>`).join('')}</linearGradient>
</defs>
<rect width="100%" height="100%" fill="#f5faf8"/>
<g font-family="Arial, sans-serif" fill="#193a40">
  <text x="32" y="48" font-size="31" font-weight="700">Lac de Guiers · Simulation logistique spatiale</text>
  <text x="32" y="82" font-size="19">${lakeSyntheticNotice}</text>
  ${comparison === undefined ? '' : `<text x="${width - 32}" y="82" text-anchor="end" font-size="16" data-map-total-difference="${comparison}">Écart de biomasse totale (droite − gauche) · ${lakeSignedTonnes(comparison)}</text>`}
  ${panels.join('\n')}
  <g transform="translate(32 771)" data-scale-unit="${legend.unit}" data-scale-min="${limits[0]}" data-scale-max="${limits[2]}">
    <text font-size="20" font-weight="700">${legend.label} (${legend.unit})</text>
    ${scale}
    <text y="70" font-size="15">${legend.explanation}</text>
    ${legend.referenceLabel ? `<text y="90" font-size="15">${legend.referenceLabel}</text>` : ''}
    <rect y="102" width="12" height="12" fill="${noData}" stroke="${grid}"/>
    <text x="20" y="113" font-size="15">Valeur simulée indisponible</text>
  </g>
  <text x="32" y="918" font-size="17" font-weight="700">Mois simulé ${lakeMonth.format(time)} · Grille ${mesh.rows} × ${mesh.columns} · Contour HydroLAKES</text>
</g>
</svg>`;
}

export function downloadLakeFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function lakeSvgToPng(svg: Blob) {
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = image.naturalWidth * scale;
    canvas.height = image.naturalHeight * scale;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image PNG indisponible.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Image PNG indisponible.'));
    }, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
