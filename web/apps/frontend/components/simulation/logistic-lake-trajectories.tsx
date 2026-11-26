import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { SpatialTotal } from '@/lib/simulation/spatial-experiment';
import { lakeMonth, lakeNumber } from './logistic-lake-readings';
import styles from './logistic-spatial.module.css';

export type LakeCurve = {
  name: string;
  points: readonly SpatialTotal[];
  color: string;
  selected?: boolean;
  aggregate?: boolean;
};

const levels = [0, 0.25, 0.5, 0.75, 1];
const initialSize = { width: 640, height: 285 };

function axisLimit(curves: readonly LakeCurve[], aggregate: boolean) {
  let max = 0;
  for (const curve of curves) {
    if (!!curve.aggregate !== aggregate) continue;
    for (const point of curve.points) max = Math.max(max, point.value ?? 0);
  }
  if (!max) return 1;
  const unit = 10 ** (Math.floor(Math.log10(max)) - 1);
  return Math.ceil(max / (4 * unit)) * 4 * unit;
}

const LakeCurves = memo(function LakeCurves({ curves, transforms }: {
  curves: readonly LakeCurve[]; transforms: readonly [string, string];
}) {
  return <>{curves.map(curve => {
    // Split the line at a missing observation so it cannot imply a sampled intermediate value.
    const segments: string[][] = [[]];
    for (const { time, value } of curve.points) {
      if (value === null) {
        if (segments.at(-1)!.length) segments.push([]);
      } else segments.at(-1)!.push(`${time},${value}`);
    }
    return <g data-lake-curve={curve.name} key={curve.name} transform={transforms[curve.aggregate ? 1 : 0]}>
      {segments.filter(segment => segment.length).map((segment, index) =>
        <polyline key={index} points={segment.join(' ')} fill="none" stroke={curve.color}
          strokeWidth={curve.selected ? 3.5 : 2} strokeDasharray={curve.aggregate ? '6 4' : undefined}
          vectorEffect="non-scaling-stroke" />)}
    </g>;
  })}</>;
});

export function LakeTrajectoryChart({ curves, tick, time, start, end }: {
  curves: readonly LakeCurve[]; tick: number; time: number; start: number; end: number;
}) {
  const target = useRef<SVGSVGElement>(null);
  const [{ width, height }, setSize] = useState(initialSize);
  const [inspected, setInspected] = useState<number>();
  const cellMax = useMemo(() => axisLimit(curves, false), [curves]);
  const totalMax = useMemo(() => axisLimit(curves, true), [curves]);
  const left = 55;
  const right = Math.max(left + 1, width - 63);
  const top = 27;
  const bottom = Math.max(top + 1, height - 37);
  const xScale = (right - left) / (end - start);
  const yScale = (max: number) => (bottom - top) / max;
  const x = (at: number) => left + (at - start) * xScale;
  const transforms = useMemo(() => [cellMax, totalMax].map(max =>
    `translate(${left - start * xScale} ${bottom}) scale(${xScale} ${-(bottom - top) / max})`) as [string, string],
  [cellMax, totalMax, start, xScale, bottom]);
  const hoverPoint = inspected === undefined ? undefined : curves[0]?.points[inspected];

  useEffect(() => {
    const element = target.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width && height) setSize(current => width === current.width && height === current.height ? current : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div className={styles.chart} role="img" aria-label="Trajectoires logistiques"
    data-time={time} data-series={curves.map(curve => curve.name).join(',')}>
    <svg ref={target} className={`${styles.plot} ${styles.lakePlot}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <text x={left} y={15}>Cellules (t)</text>
      <text x={right} y={15} textAnchor="end">Lac (t)</text>
      {levels.map(fraction => {
        const y = bottom - fraction * (bottom - top);
        return <g key={fraction}>
          <line x1={left} x2={right} y1={y} y2={y} stroke="#dfeae7" />
          <text x={left - 6} y={y + 4} textAnchor="end">{lakeNumber.format(cellMax * fraction)}</text>
          <text x={right + 6} y={y + 4}>{lakeNumber.format(totalMax * fraction)}</text>
          <text x={x(start + fraction * (end - start))} y={bottom + 16} textAnchor="middle">{start + fraction * (end - start)}</text>
        </g>;
      })}
      <text x={(left + right) / 2} y={height - 4} textAnchor="middle">Temps simulé (mois)</text>
      <LakeCurves curves={curves} transforms={transforms} />
      <line x1={x(time)} x2={x(time)} y1={top} y2={bottom} stroke="#436669" strokeDasharray="3 3" data-lake-cursor={time} />
      {curves.map(curve => {
        const point = curve.points[tick];
        if (!point || point.value == null) return null;
        return <circle key={curve.name} cx={x(time)} cy={bottom - point.value * yScale(curve.aggregate ? totalMax : cellMax)}
          r={curve.selected ? 5 : 3.5} fill={curve.color} stroke="white" strokeWidth={1.5}
          data-lake-mark={curve.name} data-biomass={point.value} />;
      })}
      <rect x={left} y={top} width={right - left} height={bottom - top} fill="transparent"
        onPointerMove={event => {
          const box = event.currentTarget.getBoundingClientRect();
          const fraction = (event.clientX - box.left) / box.width;
          const last = (curves[0]?.points.length ?? 1) - 1;
          setInspected(Math.max(0, Math.min(last, Math.round(fraction * last))));
        }} onPointerLeave={() => setInspected(undefined)} />
    </svg>
    {hoverPoint && <div className={styles.lakePlotTooltip} style={{ left: `${x(hoverPoint.time) > width / 2 ? 14 : 50}%` }}>
      <strong>{lakeMonth.format(hoverPoint.time)} mois</strong>
      {curves.map(curve => {
        const value = curve.points[inspected!]?.value;
        return <span key={curve.name}>{curve.name} · {value == null ? 'Point absent' : lakeNumber.format(value) + ' t'}</span>;
      })}
    </div>}
  </div>;
}
