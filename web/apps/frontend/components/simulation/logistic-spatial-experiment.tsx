'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { RunRequest } from '@contracts';
import { errorText, runSimulation } from '@/lib/api/client';
import {
  constantDomain, constantDomainCell, spatialApply, spatialCells, spatialDimensions, spatialDrafts, spatialReading,
  spatialRequest, spatialResize, spatialTimeline, spatialTotals, spatialTrajectories,
  type SpatialCell, type SpatialDimension, type SpatialDraft, type SpatialDrafts, type SpatialMode, type SpatialTrajectory,
} from '@/lib/simulation/spatial-experiment';
import { LogisticTrajectories, LogisticTrajectoryPlot, logisticSeriesColor } from './logistic-trajectories';
import styles from './logistic-spatial.module.css';

const biomass = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
const tileBiomass = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const month = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 });
const legend = [
  ['zero', '0 %'],
  ['low', '0 < B/K < 50 %'],
  ['below', '50 % ≤ B/K < 100 %'],
  ['capacity', '100 %'],
  ['above', 'Plus de 100 %'],
] as const;

type Phase =
  | { status: 'idle' | 'running' }
  | { status: 'completed'; grids: Map<SpatialDimension, SpatialTrajectory[]> }
  | { status: 'error'; message: string };
const statusLabel = { idle: 'Non lancé', running: 'En cours', completed: 'Terminé', error: 'Erreur' };
const beginning = { tick: 0, playing: false, started: false };
const gridLabel = (size: SpatialDimension) => `${size} × ${size}`;
const aggregateStyles = {
  2: { color: '#14645e', dash: 'solid' },
  3: { color: '#9d4a16', dash: 'dash' },
  4: { color: '#7744a2', dash: 'dot' },
} as const;
const formatParameter = (value: number) => String(value).replace('.', ',');
const parameterFields = [
  ['initial', 'Biomasse initiale N₀ (t)'],
  ['growth', 'Taux de croissance r (mois⁻¹)'],
  ['capacity', 'Capacité K (t)'],
] as const;

type Configuration = { dimension: SpatialDimension; request: RunRequest; cells: SpatialCell[] };
type Validation = { cell: string; message: string; fields?: Partial<Record<keyof SpatialDraft, string>> | undefined };

function nominalConfiguration(dimension: SpatialDimension, mode: SpatialMode): Configuration {
  const request = spatialRequest(dimension, mode);
  return { dimension, request, cells: spatialCells(request) };
}

function withoutDraft(previous: SpatialDrafts, cell: string): SpatialDrafts {
  const next = { ...previous };
  delete next[cell];
  return next;
}

function ratioColor(ratio: number | undefined) {
  if (ratio === undefined) return 'unavailable';
  if (ratio === 0) return 'zero';
  if (ratio < 0.5) return 'low';
  if (ratio < 1) return 'below';
  return ratio === 1 ? 'capacity' : 'above';
}

export function LogisticSpatialExperiment({ active }: { active: boolean }) {
  const [mode, setMode] = useState<SpatialMode>('independent');
  return <section className={styles.experiment} aria-labelledby="logistic-spatial-heading">
    <header className={styles.heading}>
      <div>
        <h1 id="logistic-spatial-heading">Expérience logistique spatiale</h1>
        <p>Démonstration sur grille fictive — données biologiques synthétiques</p>
      </div>
      <label className={styles.dimensions}>
        Mode de l’expérience
        <select value={mode} onChange={event => setMode(event.currentTarget.value === 'constant' ? 'constant' : 'independent')}>
          <option value="independent">Populations indépendantes</option>
          <option value="constant">Domaine constant</option>
        </select>
      </label>
    </header>
    <SpatialExperimentMode mode="independent" visible={mode === 'independent'} active={active && mode === 'independent'} />
    <SpatialExperimentMode mode="constant" visible={mode === 'constant'} active={active && mode === 'constant'} />
  </section>;
}

function SpatialExperimentMode({ mode, visible, active }: { mode: SpatialMode; visible: boolean; active: boolean }) {
  const fixed = mode === 'constant';
  const [configuration, setConfiguration] = useState(() => nominalConfiguration(3, mode));
  const { dimension, request, cells } = configuration;
  const timeline = useMemo(() => spatialTimeline(request), [request]);
  const [drafts, setDrafts] = useState<SpatialDrafts>({});
  const [validation, setValidation] = useState<Validation>();
  const appliedValues = useMemo(() => spatialDrafts(cells), [cells]);
  const [phase, setPhase] = useState<Phase>({ status: 'idle' });
  const [cursor, setCursor] = useState(beginning);
  const [selected, setSelected] = useState('C02');
  const [compared, setCompared] = useState<string[]>([]);
  const running = useRef(false);
  const lastTick = timeline.length - 1;
  const time = timeline[cursor.tick] ?? request.simulation.start;
  const ready = phase.status === 'completed';
  const byId = useMemo(() => new Map(phase.status === 'completed'
    ? phase.grids.get(dimension)?.map(trajectory => [trajectory.cell.id, trajectory] as const)
    : []), [phase, dimension]);
  const totals = useMemo(() => fixed && phase.status === 'completed' ? spatialDimensions.map(size => ({
    size, name: gridLabel(size), points: spatialTotals(phase.grids.get(size) ?? [], timeline),
    ...aggregateStyles[size],
  })) : [], [fixed, phase, timeline]);
  const currentTotal = totals.find(({ size }) => size === dimension)?.points[cursor.tick]?.value;
  const chartSeries = useMemo(() => Array.from(byId.values()).filter(({ cell }) =>
    cell.id === selected || compared.includes(cell.id)), [byId, selected, compared]);
  const selectedCell = cells.find(cell => cell.id === selected)!;
  const draft = drafts[selected] ?? appliedValues[selected]!;
  const selectedValidation = validation?.cell === selected ? validation : undefined;
  const pending = cells.filter(cell => drafts[cell.id]).map(cell => cell.id);
  const selectedTrajectory = byId.get(selected);
  const simulated = selectedTrajectory?.cell;
  const selectedReading = selectedTrajectory ? spatialReading(selectedTrajectory, time) : null;

  useEffect(() => {
    if (!active) setCursor(value => value.playing ? { ...value, playing: false } : value);
  }, [active]);

  useEffect(() => {
    if (!active || !ready || !cursor.playing) return;
    const timer = window.setInterval(() => setCursor(value => {
      const tick = Math.min(value.tick + 1, lastTick);
      return { tick, playing: tick < lastTick, started: true };
    }), 90);
    return () => window.clearInterval(timer);
  }, [active, ready, cursor.playing, lastTick]);

  async function run(next: Configuration, appliedCell?: string) {
    if (running.current) return;
    running.current = true;
    setCursor(beginning);
    setPhase({ status: 'running' });
    let runningDimension = next.dimension;
    try {
      const grids = new Map<SpatialDimension, SpatialTrajectory[]>();
      // Run one native request at a time against the same API used by the independent mode.
      const configurations = fixed ? spatialDimensions.map(size =>
        size === next.dimension ? next : nominalConfiguration(size, mode)) : [next];
      for (const { dimension, request, cells } of configurations) {
        runningDimension = dimension;
        const result = await runSimulation(request);
        grids.set(dimension, spatialTrajectories(request, result, cells));
      }
      setConfiguration(next);
      if (appliedCell) setDrafts(previous => withoutDraft(previous, appliedCell));
      setPhase({ status: 'completed', grids });
    } catch (cause) {
      setPhase({ status: 'error', message: fixed ? `Grille ${gridLabel(runningDimension)} · ${errorText(cause)}` : errorText(cause) });
    } finally {
      running.current = false;
    }
  }

  function edit(field: keyof SpatialDraft, value: string) {
    const base = appliedValues[selected]!;
    setDrafts(previous => {
      const next = { ...(previous[selected] ?? base), [field]: value };
      return parameterFields.every(([key]) => next[key] === base[key])
        ? withoutDraft(previous, selected) : { ...previous, [selected]: next };
    });
    setValidation(previous => previous?.cell === selected ? undefined : previous);
  }

  function apply() {
    if (running.current) return;
    const result = spatialApply(request, { [selected]: draft }, cells);
    if (!result.ok) {
      setValidation({ cell: selected, fields: result.errors[selected], message: result.message });
      return;
    }
    setValidation(undefined);
    void run({ dimension, request: result.request, cells: result.cells }, selected);
  }

  function changeDimension(value: string) {
    const nextDimension = spatialDimensions.find(size => String(size) === value);
    if (!nextDimension || nextDimension === dimension || running.current) return;

    try {
      const next = fixed ? nominalConfiguration(nextDimension, mode) : spatialResize(request, cells, nextDimension);
      const activeIds = new Set(next.cells.map(cell => cell.id));
      setConfiguration({ dimension: nextDimension, ...next });
      setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => activeIds.has(id))));
      setSelected(previous => activeIds.has(previous) ? previous : 'C00');
      setCompared(previous => previous.filter(id => activeIds.has(id)));
      setValidation(undefined);
      if (!fixed) {
        setCursor(beginning);
        setPhase({ status: 'idle' });
      }
    } catch (cause) {
      setCursor(beginning);
      setPhase({ status: 'error', message: errorText(cause) });
    }
  }

  function restore() {
    if (running.current) return;
    const nominal = nominalConfiguration(dimension, mode);
    setConfiguration(nominal);
    setDrafts({});
    setValidation(undefined);
    void run(nominal);
  }

  function togglePlayback() {
    setCursor(value => value.playing
      ? { ...value, playing: false }
      : { tick: value.tick === lastTick ? 0 : value.tick, playing: true, started: true });
  }

  if (!visible) return null;

  return <>
    <div className={styles.runActions}>
      <span className={styles.status} data-phase={phase.status} role="status">{statusLabel[phase.status]}</span>
      {!fixed && <button onClick={restore} disabled={phase.status === 'running'}>
        <RotateCcw size={15} aria-hidden="true" /> Restaurer les paramètres initiaux
      </button>}
      <button className="primary" onClick={() => void run(configuration)} disabled={phase.status === 'running'}
        title={fixed ? undefined : 'Exécuter la configuration appliquée'}>
        <Play size={16} aria-hidden="true" /> {fixed ? 'Simuler les trois grilles' : 'Lancer la simulation'}
      </button>
    </div>

    {phase.status === 'error' && <p className={styles.error} role="alert">Simulation impossible · {phase.message}</p>}
    {pending.length > 0 && <p className={styles.pending} data-pending-cells={pending.join(',')} aria-live="polite">
      <strong>Modifications non simulées : {pending.join(', ')}.</strong>
      {ready && <> La grille et les courbes montrent le dernier calcul.</>}
    </p>}

    <section className={styles.timeline} aria-label="Lecture temporelle">
      <div className={styles.playActions}>
        <button onClick={togglePlayback} disabled={!ready}>
          {cursor.playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {cursor.playing ? 'Pause' : cursor.started && cursor.tick < lastTick ? 'Reprendre' : 'Lire'}
        </button>
        <button onClick={() => setCursor(beginning)} disabled={!ready} title="Remettre au début">
          <RotateCcw size={16} aria-hidden="true" /> Remettre au début
        </button>
      </div>
      <div className={styles.scrubber}>
        <label className="sr-only" htmlFor="logistic-spatial-time">Temps simulé</label>
        <input id="logistic-spatial-time" type="range" min={request.simulation.start} max={request.simulation.end}
          step={cells[0]?.samplingInterval} value={time} disabled={!ready}
          aria-valuetext={month.format(time) + ' mois'}
          onChange={event => {
            const requested = Number(event.currentTarget.value);
            const tick = Math.round((requested - request.simulation.start) / cells[0]!.samplingInterval);
            setCursor(value => ({ ...value, tick, playing: false }));
          }} />
        <div className={styles.tickLabels} aria-hidden="true">
          <span>{request.simulation.start}</span><span>{request.simulation.end} mois</span>
        </div>
      </div>
      <strong className={styles.time} aria-label="Instant consulté" data-time={time}>{month.format(time)} <small>mois</small></strong>
    </section>

    <div className={styles.panels} data-mode={mode}>
      <section className={styles.panel} aria-labelledby="logistic-spatial-grid">
        <div className={styles.panelHeading}>
          <h2 id="logistic-spatial-grid">Biomasse par cellule</h2>
          <span>Tonnes</span>
        </div>
        <label className={styles.dimensions}>
          Dimensions de la grille
          <select value={dimension} disabled={phase.status === 'running'} onChange={event => changeDimension(event.currentTarget.value)}>
            {spatialDimensions.map(size => <option key={size} value={size}>{gridLabel(size)}</option>)}
          </select>
        </label>
        {fixed && <dl className={styles.domainMetrics} aria-label="Domaine de la grille">
          <div><dt>Surface totale</dt><dd>{biomass.format(constantDomain.area)} km²</dd></div>
          <div><dt>Surface par cellule</dt><dd>{biomass.format(constantDomainCell(dimension).area)} km²</dd></div>
          <div><dt>Capacité totale</dt><dd>{biomass.format(constantDomain.area * constantDomain.capacityDensity)} t</dd></div>
          <div><dt>Biomasse totale</dt><dd data-total-biomass={currentTotal ?? undefined}>
            {currentTotal == null ? (ready ? 'Point absent' : '—') : biomass.format(currentTotal) + ' t'}
          </dd></div>
        </dl>}
        <div className={styles.grid} data-dimension={dimension}>
          {cells.map(cell => {
            const trajectory = byId.get(cell.id);
            const reading = trajectory ? spatialReading(trajectory, time) : null;
            return <button className={styles.tile} key={cell.id} aria-label={cell.id} aria-pressed={selected === cell.id}
              aria-describedby={'logistic-spatial-value-' + cell.id}
              data-cell={cell.id} data-tone={ratioColor(reading?.ratio)} data-biomass={reading?.value}
              data-pending={drafts[cell.id] ? 'true' : undefined}
              data-observed-time={reading?.time} data-source={reading?.source}
              title={reading ? reading.value + ' t' : undefined} onClick={() => setSelected(cell.id)}>
              <span className={styles.tileTop}><strong>{cell.id}</strong>
                {reading && <span>{percent.format(reading.ratio)}</span>}
              </span>
              <span className={styles.tileValue} id={'logistic-spatial-value-' + cell.id}>
                {reading ? <>{(fixed ? tileBiomass : biomass).format(reading.value)} <small>t</small></> : ready ? 'Point absent' : '—'}
              </span>
              {trajectory?.constant && <span className={styles.constant}>Équilibre</span>}
            </button>;
          })}
        </div>
        <div className={styles.legend} aria-label="Légende du rapport biomasse sur capacité">
          <strong>Rapport B/K</strong>
          <ul>{legend.map(([color, text]) => <li key={color}><i aria-hidden="true" data-tone={color} />{text}</li>)}</ul>
          <p>{fixed
            ? 'La surface est répartie également entre les cellules. Les densités initiale et de capacité sont de 150 et 300 t/km².'
            : 'Chaque cellule a sa propre capacité K. Ajouter des cellules augmente la capacité totale.'}</p>
        </div>
      </section>

      {fixed && <section className={styles.panel} aria-labelledby="logistic-aggregate-heading">
        <div className={styles.panelHeading}>
          <h2 id="logistic-aggregate-heading">Biomasse totale par taille de grille</h2>
          <span>Tonnes</span>
        </div>
        {ready ? <>
          {active && <LogisticTrajectoryPlot label="Trajectoires de biomasse totale" time={time}
            start={request.simulation.start} end={request.simulation.end}
            series={totals.map(series => ({ ...series, current: series.points[cursor.tick]?.value }))} />}
          <ul className={styles.series} aria-label="Biomasses totales à l’instant consulté">
            {totals.map(({ size, name, color, points }) => {
              const value = points[cursor.tick]?.value;
              return <li key={size} data-total-grid={size} data-biomass={value ?? undefined}>
                <i aria-hidden="true" style={{ background: color }} />
                <strong>{name}</strong>
                <span>{value == null ? 'Point absent' : biomass.format(value) + ' t'}</span>
              </li>;
            })}
          </ul>
        </> : <div className={styles.chartMessage}>
          {phase.status === 'running' ? 'Calcul natif des grilles en cours.' : 'Simulez les trois grilles pour superposer leurs trajectoires.'}
        </div>}
      </section>}
      <section className={styles.panel} aria-label={'Paramètres de ' + selectedCell.id}>
        <div className={styles.panelHeading}>
          <h2>Cellule {selectedCell.id}</h2>
          {selectedTrajectory?.constant && <span className={styles.equilibriumLabel}>Équilibre dédupliqué</span>}
        </div>
        {fixed ? <dl className={styles.parameters} aria-label="Paramètres de la cellule">
          <div><dt>N₀</dt><dd>{biomass.format(selectedCell.initial)} t</dd></div>
          <div><dt>r</dt><dd>{biomass.format(selectedCell.growth)} mois⁻¹</dd></div>
          <div><dt>K</dt><dd>{biomass.format(selectedCell.capacity)} t</dd></div>
        </dl> : <form className={styles.parameterEditor} aria-label={'Modifier les paramètres de ' + selectedCell.id}
          onSubmit={event => { event.preventDefault(); apply(); }}>
          <div className={styles.parameterFields}>
            {parameterFields.map(([field, label]) => {
              const inputId = `logistic-${selected}-${field}`;
              const message = selectedValidation?.fields?.[field];
              return <div key={field}>
                <label htmlFor={inputId}>{label}</label>
                <input id={inputId} type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
                  value={draft[field]} disabled={phase.status === 'running'}
                  aria-invalid={message ? true : undefined} aria-describedby={message ? `${inputId}-error` : undefined}
                  onChange={event => edit(field, event.currentTarget.value)} />
                {message && <small className={styles.fieldError} id={`${inputId}-error`}>{message}</small>}
              </div>;
            })}
          </div>
          {selectedValidation && <p className={styles.fieldError} role="alert">{selectedValidation.message}</p>}
          <button type="submit" className="primary" disabled={phase.status === 'running'}>Appliquer et simuler</button>
        </form>}
        {!fixed && simulated && <>
          <h3 className={styles.simulatedHeading}>Paramètres simulés</h3>
          <dl className={styles.parameters} aria-label="Paramètres simulés" data-simulated-cell={simulated.id}
            data-initial={simulated.initial} data-growth={simulated.growth} data-capacity={simulated.capacity}>
            <div><dt>N₀</dt><dd>{formatParameter(simulated.initial)} t</dd></div>
            <div><dt>r</dt><dd>{formatParameter(simulated.growth)} mois⁻¹</dd></div>
            <div><dt>K</dt><dd>{formatParameter(simulated.capacity)} t</dd></div>
          </dl>
        </>}
        {selectedTrajectory?.constant && <p className={styles.coverage}>
          Équilibre dédupliqué par le moteur. La valeur observée à {month.format(selectedTrajectory.start)} mois est maintenue jusqu’à {month.format(selectedTrajectory.end)} mois.
        </p>}
        {selectedTrajectory && !selectedReading && <p className={styles.coverage}>Aucune observation à cet instant.</p>}

        {ready ? <>
          {active && <LogisticTrajectories series={chartSeries} time={time} start={request.simulation.start} end={request.simulation.end} />}
          <ul className={styles.series} aria-label="Séries à l’instant consulté">
            {chartSeries.map(trajectory => {
              const reading = spatialReading(trajectory, time);
              return <li key={trajectory.cell.id} data-series-cell={trajectory.cell.id}
                data-time={time} data-biomass={reading?.value} title={reading && reading.value + ' t' || undefined}>
                <i aria-hidden="true" style={{ background: logisticSeriesColor(trajectory.cell) }} />
                <strong>{trajectory.cell.id}</strong>
                <span>{reading ? biomass.format(reading.value) + ' t' : 'Point absent'}</span>
                {trajectory.constant && <small>Équilibre</small>}
              </li>;
            })}
          </ul>
        </> : <div className={styles.chartMessage}>{phase.status === 'running'
          ? 'Calcul natif en cours.' : 'Lancez la simulation pour consulter les trajectoires.'}</div>}

        <fieldset className={styles.compare}>
          <legend>Comparer les trajectoires</legend>
          {cells.map(cell => <label key={cell.id}>
            <input type="checkbox" aria-label={'Comparer ' + cell.id} checked={cell.id === selected || compared.includes(cell.id)}
              disabled={cell.id === selected} onChange={event => {
                const checked = event.currentTarget.checked;
                setCompared(ids => checked ? [...ids, cell.id] : ids.filter(id => id !== cell.id));
              }} />
            {cell.id}
          </label>)}
        </fieldset>
      </section>
    </div>
  </>;
}
