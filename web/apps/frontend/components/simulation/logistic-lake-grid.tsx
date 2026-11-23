'use client';
import { useId, useMemo, type CSSProperties } from 'react';
import { lakeColumns, lakeRows, spatialReading, type lakeDomain, type LakeMesh, type SpatialTrajectory } from '@/lib/simulation/spatial-experiment';
import styles from './logistic-spatial.module.css';

type LakeDomainCell = ReturnType<typeof lakeDomain>['cells'][number];
const tonnes = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function LogisticLakeGrid({ mesh, cells, trajectories, time, selected, select }: {
  mesh: LakeMesh;
  cells: readonly LakeDomainCell[];
  trajectories: ReadonlyMap<string, SpatialTrajectory>;
  time: number;
  selected: string;
  select: (id: string) => void;
}) {
  const clip = useId();
  const outline = useMemo(() => mesh.rings.map(ring =>
    'M' + ring.map(point => point.join(',')).join('L') + 'Z').join(''), [mesh]);

  return <figure className={styles.lakeFigure}>
    <svg className={styles.lakeGrid} role="group" aria-label="Grille humide du lac de Guiers"
      viewBox={`-0.02 -0.02 ${mesh.width + 0.04} ${mesh.height + 0.04}`}
      data-rows={lakeRows} data-columns={lakeColumns} data-time={time}>
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
          return <rect key={cell.id} className={styles.lakeCell} x={cell.x} y={cell.y} width={cell.width} height={cell.height}
            vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={cell.id} aria-pressed={selected === cell.id}
            aria-description={reading ? `${tonnes.format(reading.value)} t` : undefined}
            data-cell={cell.id} data-row={cell.row} data-column={cell.column} data-wet-fraction={cell.wetFraction}
            data-area={cell.area} data-biomass={reading?.value} data-observed-time={reading?.time} data-source={reading?.source}
            style={{ '--lake-saturation': `${saturation}%` } as CSSProperties}
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
    <figcaption>Lac de Guiers · Contour HydroLAKES · Grille fictive {lakeRows} × {lakeColumns}</figcaption>
    <div className={styles.lakeScale} aria-label="Rapport biomasse sur capacité">
      <span>50 %</span><span>Biomasse / capacité</span><span>100 %</span>
    </div>
  </figure>;
}
