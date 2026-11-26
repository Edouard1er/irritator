import { useState, type ComponentProps } from 'react';
import { formatSmall, lakeLegend, lakeNumber, lakeReading, lakeSignedTonnes, lakeTonnes, lakeTotalTonnes,
  type LakeCell, type LakeDataset, type LakeDisplay } from '@/lib/simulation/lake-exploration';
import { LogisticLakeGrid } from './logistic-lake-grid';
import styles from './logistic-spatial.module.css';

const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 3 });
const signedPercent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 3, signDisplay: 'exceptZero' });

export function LakeCellDetails({ cell, dataset, tick, scientificDetails = false, initialKnown = true, workshop = false }: {
  cell: LakeCell; dataset: LakeDataset | undefined; tick: number; scientificDetails?: boolean; initialKnown?: boolean; workshop?: boolean;
}) {
  const reading = lakeReading(dataset, cell.id, tick);
  const observedInitial = lakeReading(dataset, cell.id, 0)?.value;
  const gain = reading && observedInitial !== undefined ? reading.value - observedInitial : undefined;
  return <dl className={styles.parameters} aria-label="Paramètres de la cellule">
    {!workshop && <div><dt>Surface humide</dt><dd>{formatSmall(cell.area)} km²</dd></div>}
    <div><dt>Biomasse initiale</dt><dd>{lakeTonnes(observedInitial ?? (initialKnown ? cell.initial : undefined))}</dd></div>
    <div><dt>{workshop ? 'Biomasse simulée' : 'Biomasse observée'}</dt><dd data-local-biomass={reading?.value}>{lakeTonnes(reading?.value)}</dd></div>
    <div><dt>Gain depuis le départ</dt><dd data-local-gain={gain}>{lakeSignedTonnes(gain)}</dd></div>
    <div><dt>Évolution relative</dt><dd>{gain === undefined || !observedInitial ? '—' : signedPercent.format(gain / observedInitial)}</dd></div>
    {!workshop && <>
      <div><dt>Densité</dt><dd data-local-density={reading?.density}>{reading ? `${lakeNumber.format(reading.density)} t/km²` : '—'}</dd></div>
      <div><dt>Biomasse / capacité</dt><dd>{reading ? percent.format(reading.ratio) : '—'}</dd></div>
    </>}
    {scientificDetails && <>
      <div><dt>Fraction humide</dt><dd>{formatSmall(cell.wetFraction * 100)} %</dd></div>
      <div><dt>Taux de croissance r</dt><dd>{lakeNumber.format(cell.growth)} mois⁻¹</dd></div>
      <div><dt>Capacité de charge K</dt><dd>{lakeTonnes(cell.capacity)}</dd></div>
    </>}
  </dl>;
}

export function LakeDomainMetrics({ area, cells, initial, capacity, dataset, tick }: {
  area: number; cells: number; initial: number; capacity: number; dataset: LakeDataset | undefined; tick: number;
}) {
  const total = dataset?.totals[tick];
  const observedInitial = dataset?.totals[0];
  const gain = total !== undefined && observedInitial !== undefined ? total - observedInitial : undefined;
  return <dl className={styles.domainMetrics} aria-label="Domaine de la grille">
    <div><dt>Biomasse totale</dt><dd data-total-biomass={total}>{total === undefined ? '—' : lakeNumber.format(total) + ' t'}</dd></div>
    <div><dt>Gain total depuis le mois 0</dt><dd data-total-gain={gain}>{lakeSignedTonnes(gain)}</dd></div>
    <div><dt>Capacité totale atteinte</dt><dd>{total === undefined ? '—' : percent.format(total / capacity)}</dd></div>
    <div><dt>Capacité totale</dt><dd>{lakeNumber.format(capacity)} t</dd></div>
    <div><dt>Biomasse initiale totale</dt><dd>{lakeNumber.format(observedInitial ?? initial)} t</dd></div>
    <div><dt>Surface totale · cellules humides</dt><dd>{lakeNumber.format(area)} km² · {cells}</dd></div>
  </dl>;
}

export function LakeMapLegend({ display, limits, adaptive, available, workshop }: {
  display: LakeDisplay; limits: readonly [number, number, number]; adaptive: boolean; available: boolean; workshop: boolean;
}) {
  const { label, unit, colors, ticks, showScale, explanation, referenceLabel } = lakeLegend(display, limits, adaptive, available);
  const difference = display === 'difference';
  return <div className={styles.lakeLegend} aria-label={display === 'ratio' ? 'Rapport biomasse sur capacité' : label}
    data-map-display={display} data-scale-min={showScale ? limits[0] : undefined} data-scale-max={showScale ? limits[2] : undefined}
    data-scale-unit={unit} data-scale-mode={difference && adaptive ? 'month' : 'fixed'}>
    <strong>{label} ({unit})</strong>
    {showScale && <div className={styles.lakeScale} style={{ borderImage: `linear-gradient(90deg, ${colors.join(', ')}) 1` }}>
      {ticks.map((text, index) => <span key={index} className={ticks.length === 1 ? styles.lakeScaleZero : undefined}>{text}</span>)}
    </div>}
    <p>{explanation}</p>
    {referenceLabel && <p>{referenceLabel}</p>}
    <p><i className={styles.lakeNoData} aria-hidden="true" /> {workshop ? 'Valeur simulée indisponible' : 'Observation indisponible'}</p>
  </div>;
}

export function LakeMapPane({ title, initialKnown, workshop, ...grid }: Omit<ComponentProps<typeof LogisticLakeGrid>, 'inspect'> & {
  title: string; initialKnown: boolean; workshop: boolean;
}) {
  const [hovered, setHovered] = useState<string>();
  const id = hovered ?? grid.selected;
  const cell = grid.dataset?.cells.get(id) ?? (!grid.dataset && grid.cells.find(cell => cell.id === id));
  const total = grid.dataset?.totals[grid.tick];
  const initial = grid.dataset?.totals[0];
  const gain = total !== undefined && initial !== undefined ? total - initial : undefined;
  return <div className={styles.lakeMapPane}>
    <h3>{title}</h3>
    <div className={styles.lakeSummary}>
      <p className={styles.lakeMapTotal}>Biomasse totale <strong data-map-total={total}>{lakeTotalTonnes(total)}</strong></p>
      {workshop && <p className={styles.lakeMapTotal}>Évolution depuis le début <strong data-map-gain={gain}>{lakeSignedTonnes(gain)}</strong></p>}
    </div>
    <LogisticLakeGrid {...grid} inspect={setHovered} />
    {cell && <div className={styles.lakeMapDetails} data-hovered={!!hovered || undefined}>
      <h4>{hovered ? 'Cellule survolée' : 'Cellule sélectionnée'} · <span style={{ color: grid.highlights.get(cell.id) }}>{cell.id}</span></h4>
      <LakeCellDetails cell={cell} dataset={grid.dataset} tick={grid.tick} initialKnown={initialKnown} workshop={workshop} />
    </div>}
  </div>;
}
