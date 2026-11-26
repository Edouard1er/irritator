'use client';
import { memo, useId, useLayoutEffect, useMemo, useRef, type PointerEvent } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import type { LakeMesh } from '@/lib/simulation/spatial-experiment';
import { initialLakeView, lakeExchangeDirection, lakeExchangePath, lakeFraming, lakeMapColor, lakeMapReading, lakeOutline,
  type LakeCell, type LakeDataset, type LakeDisplay, type LakeExchangeOverlay, type LakeView } from '@/lib/simulation/lake-exploration';
import styles from './logistic-spatial.module.css';

const tonnes = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const arrowDirections: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};
const zoomLevels = [1, 1.5, 2, 3, 4, 6, 8];

const LakeRegions = memo(function LakeRegions({ cells, selected, select, inspect, neighbors }: {
  cells: readonly LakeCell[]; selected: string; select: (id: string) => void; inspect: (id: string | undefined) => void;
  neighbors?: ReadonlySet<string> | undefined;
}) {
  return <>{cells.map(cell => <rect key={cell.id} className={styles.lakeCell}
    x={cell.x} y={cell.y} width={cell.width} height={cell.height} vectorEffect="non-scaling-stroke"
    role="button" tabIndex={selected === cell.id ? 0 : -1} aria-label={cell.id} aria-pressed={selected === cell.id}
    data-cell={cell.id} data-row={cell.row} data-column={cell.column} data-wet-fraction={cell.wetFraction} data-area={cell.area}
    data-wet-neighbor={neighbors?.has(cell.id) || undefined}
    onPointerEnter={() => inspect(cell.id)} onPointerLeave={() => inspect(undefined)}
    onClick={() => { inspect(undefined); select(cell.id); }}
    onKeyDown={event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      inspect(undefined);
      select(cell.id);
    }}>
    <title>{cell.id}</title>
  </rect>)}</>;
});

function numericAttribute(element: SVGRectElement, attribute: string, value?: number) {
  if (value === undefined) element.removeAttribute(attribute);
  else element.setAttribute(attribute, String(value));
}

export const LogisticLakeGrid = memo(function LogisticLakeGrid({
  mesh, cells, dataset, reference, display, limits, tick, time, selected, select, inspect, view, setView, label, highlights,
  exchange, neighbors, pairCells,
}: {
  mesh: LakeMesh;
  cells: readonly LakeCell[];
  dataset: LakeDataset | undefined;
  reference: LakeDataset | undefined;
  display: LakeDisplay;
  limits: readonly [number, number, number];
  tick: number;
  time: number;
  selected: string;
  select: (id: string) => void;
  inspect: (id: string | undefined) => void;
  view: LakeView;
  setView: React.Dispatch<React.SetStateAction<LakeView>>;
  label: string;
  highlights: ReadonlyMap<string, string>;
  exchange?: LakeExchangeOverlay | undefined;
  neighbors?: ReadonlySet<string> | undefined;
  pairCells?: readonly string[] | undefined;
}) {
  const clip = useId();
  const regions = useRef<SVGGElement>(null);
  const outline = useMemo(() => lakeOutline(mesh), [mesh]);
  const gesture = useRef<{ pointer: number; x: number; y: number; scale: number; view: typeof view; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const width = mesh.width + 0.04;
  const height = mesh.height + 0.04;
  const zoomIndex = zoomLevels.indexOf(view.zoom);
  const markedCells = useMemo(() => cells.filter(cell => highlights.has(cell.id)), [cells, highlights]);
  const { viewBox, markerRadius } = lakeFraming(mesh, view);
  const exchangePath = exchange && lakeExchangePath(exchange, markerRadius);

  useLayoutEffect(() => {
    if (!regions.current) return;
    // Geometry is stable while playing. Update the readings together before the next paint.
    const nodes = regions.current.children;
    for (const node of nodes) {
      const region = node as SVGRectElement;
      const id = region.dataset.cell!;
      const { reading, value } = lakeMapReading(dataset, reference, id, tick, display);
      numericAttribute(region, 'data-biomass', reading?.value);
      numericAttribute(region, 'data-observed-time', reading?.time);
      numericAttribute(region, 'data-biomass-ratio', reading?.ratio);
      numericAttribute(region, 'data-map-value', value);
      const source = reading ? 'native' : undefined;
      const belowHalf = reading && reading.ratio < 0.5 ? 'true' : undefined;
      if (region.dataset.source !== source) {
        if (source) region.dataset.source = source;
        else delete region.dataset.source;
      }
      if (region.dataset.belowHalf !== belowHalf) {
        if (belowHalf) region.dataset.belowHalf = belowHalf;
        else delete region.dataset.belowHalf;
      }
      if (id === selected && reading) region.setAttribute('aria-description', `${tonnes.format(reading.value)} t`);
      else if (region.hasAttribute('aria-description')) region.removeAttribute('aria-description');
      const fill = value === undefined ? '' : lakeMapColor(value, limits, display);
      if (region.style.fill !== fill) region.style.fill = fill;
    }
  }, [cells, dataset, reference, display, limits, selected, tick]);

  function constrain({ zoom, dx, dy }: typeof view) {
    const xLimit = width * (1 - 1 / zoom) / 2;
    const yLimit = height * (1 - 1 / zoom) / 2;
    return { zoom, dx: Math.max(-xLimit, Math.min(xLimit, dx)), dy: Math.max(-yLimit, Math.min(yLimit, dy)) };
  }

  function startDrag(event: PointerEvent<SVGSVGElement>) {
    suppressClick.current = false;
    if (view.zoom === 1 || !event.isPrimary || event.button !== 0) return;
    const scale = event.currentTarget.getScreenCTM()?.a;
    if (scale) gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, scale, view, moved: false };
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setView(constrain({ ...drag.view, dx: drag.view.dx - dx / drag.scale, dy: drag.view.dy - dy / drag.scale }));
  }

  function endDrag(event: PointerEvent<SVGSVGElement>) {
    if (gesture.current?.pointer === event.pointerId) gesture.current = null;
  }

  return <figure className={styles.lakeFigure}>
    <div className={styles.mapTools} role="group" aria-label="Cadrage de la carte">
      <button type="button" aria-label="Zoom avant" disabled={zoomIndex === zoomLevels.length - 1}
        onClick={() => setView(constrain({ ...view, zoom: zoomLevels[zoomIndex + 1]! }))}><Plus size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Zoom arrière" disabled={zoomIndex === 0}
        onClick={() => setView(constrain({ ...view, zoom: zoomLevels[zoomIndex - 1]! }))}><Minus size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Réinitialiser le cadrage" disabled={zoomIndex === 0}
        onClick={() => setView(initialLakeView)}><RotateCcw size={15} aria-hidden="true" /> Réinitialiser</button>
    </div>
    <svg className={styles.lakeGrid} role="group" aria-label={label}
      tabIndex={0} aria-description="Après avoir zoomé, déplacez la carte par glisser ou avec les flèches."
      viewBox={viewBox}
      data-rows={mesh.rows} data-columns={mesh.columns} data-time={time} data-zoom={view.zoom}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onPointerLeave={event => {
        inspect(undefined);
        if (!gesture.current?.moved) endDrag(event);
      }}
      onClickCapture={event => {
        if (suppressClick.current && event.detail > 0) event.stopPropagation();
        suppressClick.current = false;
      }}
      onKeyDown={event => {
        const direction = arrowDirections[event.key];
        if (!direction || view.zoom === 1) return;
        event.preventDefault();
        setView(current => constrain({ ...current, dx: current.dx + direction[0] * width / current.zoom / 8,
          dy: current.dy + direction[1] * height / current.zoom / 8 }));
      }}>
      <defs>
        <clipPath id={clip}>
          <path d={outline} clipRule="evenodd" />
        </clipPath>
      </defs>
      <g ref={regions} clipPath={`url(#${clip})`}>
        <LakeRegions cells={cells} selected={selected} select={select} inspect={inspect} neighbors={neighbors} />
      </g>
      {markedCells.map(cell => {
        const paired = pairCells?.includes(cell.id);
        const radius = markerRadius * (paired ? 1.65 : cell.id === selected ? 1 : 0.7);
        return <circle key={cell.id} className={styles.lakeMarker} aria-hidden="true"
          data-map-selection={cell.id} data-selected={cell.id === selected || undefined} data-pair-marker={paired || undefined}
          cx={cell.wetCentroid[0]} cy={cell.wetCentroid[1]}
          r={radius} stroke={highlights.get(cell.id)} vectorEffect="non-scaling-stroke" />;
      })}
      <path className={styles.lakeOutline} d={outline} fill="none" vectorEffect="non-scaling-stroke" aria-hidden="true" />
      {exchange && <g clipPath={`url(#${clip})`} pointerEvents="none" aria-hidden="true"
        data-exchange-pair={`${exchange.a} ${exchange.b}`} data-flow-direction={lakeExchangeDirection(exchange)} data-flow={exchange.flux}>
        <path d={exchangePath} fill="none" stroke="white" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={exchangePath} fill="none" stroke="#183343" strokeWidth={3} strokeLinecap="round"
          strokeDasharray={exchange.flux ? undefined : '3 3'} vectorEffect="non-scaling-stroke" />
      </g>}
    </svg>
    <figcaption>Lac de Guiers · Contour HydroLAKES · Grille {mesh.rows} × {mesh.columns}</figcaption>
  </figure>;
});
