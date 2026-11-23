'use client';
import { useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { spatialReading, type LakeDomain, type LakeMesh, type SpatialTrajectory } from '@/lib/simulation/spatial-experiment';
import styles from './logistic-spatial.module.css';

const tonnes = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const initialView = { zoom: 1, dx: 0, dy: 0 };
const zoomLevels = [1, 1.5, 2, 3, 4, 6, 8];

export function LogisticLakeGrid({ mesh, cells, trajectories, time, selected, select, showLowRatios }: {
  mesh: LakeMesh;
  cells: readonly LakeDomain['cells'][number][];
  trajectories: ReadonlyMap<string, SpatialTrajectory>;
  time: number;
  selected: string;
  select: (id: string) => void;
  showLowRatios: boolean;
}) {
  const clip = useId();
  const outline = useMemo(() => mesh.rings.map(ring =>
    'M' + ring.map(point => point.join(',')).join('L') + 'Z').join(''), [mesh]);
  const [view, setView] = useState(initialView);
  const gesture = useRef<{ pointer: number; x: number; y: number; scale: number; view: typeof view; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const width = mesh.width + 0.04;
  const height = mesh.height + 0.04;
  const zoomIndex = zoomLevels.indexOf(view.zoom);
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

  const arrowDirections: Record<string, readonly [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };

  return <figure className={styles.lakeFigure} data-low-ratios={showLowRatios || undefined}>
    <div className={styles.mapTools} role="group" aria-label="Cadrage de la carte">
      <button type="button" aria-label="Zoom avant" disabled={zoomIndex === zoomLevels.length - 1}
        onClick={() => setView(constrain({ ...view, zoom: zoomLevels[zoomIndex + 1]! }))}><Plus size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Zoom arrière" disabled={zoomIndex === 0}
        onClick={() => setView(constrain({ ...view, zoom: zoomLevels[zoomIndex - 1]! }))}><Minus size={16} aria-hidden="true" /></button>
      <button type="button" aria-label="Réinitialiser le cadrage" disabled={zoomIndex === 0}
        onClick={() => setView(initialView)}><RotateCcw size={15} aria-hidden="true" /> Réinitialiser</button>
    </div>
    <svg className={styles.lakeGrid} role="group" aria-label="Grille humide du lac de Guiers"
      tabIndex={0} aria-description="Après avoir zoomé, déplacez la carte par glisser ou avec les flèches."
      viewBox={`${(mesh.width - width / view.zoom) / 2 + view.dx} ${(mesh.height - height / view.zoom) / 2 + view.dy} ${width / view.zoom} ${height / view.zoom}`}
      data-rows={mesh.rows} data-columns={mesh.columns} data-time={time} data-zoom={view.zoom}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onPointerLeave={event => { if (!gesture.current?.moved) endDrag(event); }}
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
      <g clipPath={`url(#${clip})`}>
        {cells.map(cell => {
          const trajectory = trajectories.get(cell.id);
          const reading = trajectory ? spatialReading(trajectory, time) : null;
          const saturation = reading ? Math.max(0, Math.min(100, (reading.ratio - 0.5) * 200)) : 0;
          const belowHalf = showLowRatios && reading !== null && reading.ratio < 0.5;
          const lowerSaturation = belowHalf ? Math.max(0, Math.min(100, (0.5 - reading.ratio) * 400)) : 0;
          return <rect key={cell.id} className={styles.lakeCell} x={cell.x} y={cell.y} width={cell.width} height={cell.height}
            vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={cell.id} aria-pressed={selected === cell.id}
            aria-description={reading ? `${tonnes.format(reading.value)} t` : undefined}
            data-cell={cell.id} data-row={cell.row} data-column={cell.column} data-wet-fraction={cell.wetFraction}
            data-area={cell.area} data-biomass={reading?.value} data-observed-time={reading?.time} data-source={reading?.source}
            data-biomass-ratio={reading?.ratio} data-below-half={belowHalf || undefined}
            style={{ '--lake-saturation': `${belowHalf ? lowerSaturation : saturation}%` } as CSSProperties}
            onClick={() => select(cell.id)} onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              select(cell.id);
            }}>
            <title>{cell.id}{reading ? ` · ${tonnes.format(reading.value)} t` : ''}</title>
          </rect>;
        })}
      </g>
      <path className={styles.lakeOutline} d={outline} fill="none" vectorEffect="non-scaling-stroke" aria-hidden="true" />
    </svg>
    <figcaption>Lac de Guiers · Contour HydroLAKES · Grille {mesh.rows} × {mesh.columns}</figcaption>
    <div className={styles.lakeScale} aria-label="Rapport biomasse sur capacité">
      {showLowRatios ? <><span>25 %</span><span>50 %</span><span>100 %</span></>
        : <><span>50 %</span><span>Biomasse / capacité</span><span>100 %</span></>}
    </div>
    {showLowRatios && <span className={styles.lakeScaleTitle}>Biomasse / capacité</span>}
  </figure>;
}
