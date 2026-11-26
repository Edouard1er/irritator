import { useState, type ComponentProps } from 'react';
import { lakeDisplays, lakeReading, type LakeCell, type LakeDataset, type LakeDisplay } from '@/lib/simulation/lake-exploration';
import { LogisticLakeGrid } from './logistic-lake-grid';
import styles from './logistic-spatial.module.css';

export const lakeMonth = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const lakeNumber = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
const significant = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 5 });
const scientific = new Intl.NumberFormat('fr-FR', { notation: 'scientific', maximumSignificantDigits: 4 });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 3 });
const signedPercent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 3, signDisplay: 'exceptZero' });
const signedNumber = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5, signDisplay: 'exceptZero' });

export const formatSmall = (value: number) => Math.abs(value) >= 1e-4 || value === 0 ? significant.format(value) : scientific.format(value);
export const lakeTonnes = (value: number | undefined) => value === undefined ? '—' : `${formatSmall(value)} t`;
export const lakeSignedTonnes = (value: number | undefined) => value === undefined ? '—'
  : `${value !== 0 && Math.abs(value) < 1e-4 ? (value > 0 ? '+' : '') + scientific.format(value) : signedNumber.format(value)} t`;

export function LakeCellDetails({ cell, dataset, tick, scientificDetails = false, initialKnown = true }: {
  cell: LakeCell; dataset: LakeDataset | undefined; tick: number; scientificDetails?: boolean; initialKnown?: boolean;
}) {
  const reading = lakeReading(dataset, cell.id, tick);
  const observedInitial = lakeReading(dataset, cell.id, 0)?.value;
  const gain = reading && observedInitial !== undefined ? reading.value - observedInitial : undefined;
  return <dl className={styles.parameters} aria-label="Paramètres de la cellule">
    <div><dt>Surface humide</dt><dd>{formatSmall(cell.area)} km²</dd></div>
    <div><dt>Biomasse initiale</dt><dd>{lakeTonnes(observedInitial ?? (initialKnown ? cell.initial : undefined))}</dd></div>
    <div><dt>Biomasse observée</dt><dd data-local-biomass={reading?.value}>{lakeTonnes(reading?.value)}</dd></div>
    <div><dt>Gain depuis le départ</dt><dd data-local-gain={gain}>{lakeSignedTonnes(gain)}</dd></div>
    <div><dt>Évolution relative</dt><dd>{gain === undefined || !observedInitial ? '—' : signedPercent.format(gain / observedInitial)}</dd></div>
    <div><dt>Densité</dt><dd data-local-density={reading?.density}>{reading ? `${lakeNumber.format(reading.density)} t/km²` : '—'}</dd></div>
    <div><dt>Biomasse / capacité</dt><dd>{reading ? percent.format(reading.ratio) : '—'}</dd></div>
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

export function LakeMapLegend({ display, limits, adaptive, available }: {
  display: LakeDisplay; limits: readonly [number, number, number]; adaptive: boolean; available: boolean;
}) {
  const { label, unit, colors } = lakeDisplays[display];
  const difference = display === 'difference';
  const showScale = !difference || available;
  return <div className={styles.lakeLegend} aria-label={display === 'ratio' ? 'Rapport biomasse sur capacité' : label}
    data-map-display={display} data-scale-min={showScale ? limits[0] : undefined} data-scale-max={showScale ? limits[2] : undefined}
    data-scale-unit={unit} data-scale-mode={difference && adaptive ? 'month' : 'fixed'}>
    <strong>{label} ({unit})</strong>
    {showScale && <div className={styles.lakeScale} style={{ borderImage: `linear-gradient(90deg, ${(limits[0] === limits[2] ? [colors[1], colors[1]] : colors).join(', ')}) 1` }}>
      {limits[0] === limits[2] ? <span className={styles.lakeScaleZero}>0 {unit}</span> : limits.map(value =>
        <span key={value}>{difference && value > 0 ? '+' : ''}{formatSmall(value)} {unit}</span>)}
    </div>}
    <p>{difference ? (adaptive ? 'Échelle ajustée au mois consulté.' : 'Échelle fixe sur tous les mois des scénarios affichés.')
      : display === 'ratio' ? '0 % correspond à une cellule sans biomasse, 100 % à sa capacité.'
        : 'La biomasse est rapportée à la surface humide de la cellule.'}</p>
    {difference && <p>Référence · distribution homogène simulée sur la même grille.</p>}
    <p><i className={styles.lakeNoData} aria-hidden="true" /> Observation indisponible</p>
  </div>;
}

export function LakeMapPane({ title, initialKnown, ...grid }: Omit<ComponentProps<typeof LogisticLakeGrid>, 'inspect'> & {
  title: string; initialKnown: boolean;
}) {
  const [hovered, setHovered] = useState<string>();
  const id = hovered ?? grid.selected;
  const cell = grid.dataset?.cells.get(id) ?? (!grid.dataset && grid.cells.find(cell => cell.id === id));
  const total = grid.dataset?.totals[grid.tick];
  return <div className={styles.lakeMapPane}>
    <h3>{title}</h3>
    <p className={styles.lakeMapTotal}>Biomasse totale <strong data-map-total={total}>{total === undefined ? '—' : lakeNumber.format(total) + ' t'}</strong></p>
    <LogisticLakeGrid {...grid} inspect={setHovered} />
    {cell && <div className={styles.lakeMapDetails} data-hovered={!!hovered || undefined}>
      <h4>{hovered ? 'Cellule survolée' : 'Cellule sélectionnée'} · {cell.id}</h4>
      <LakeCellDetails cell={cell} dataset={grid.dataset} tick={grid.tick} initialKnown={initialKnown} />
    </div>}
  </div>;
}
