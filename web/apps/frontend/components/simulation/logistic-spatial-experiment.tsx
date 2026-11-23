'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { errorText, runSimulation } from '@/lib/api/client';
import { spatialCells, spatialReading, spatialRequest, spatialTimeline, spatialTrajectories, type SpatialTrajectory } from '@/lib/simulation/spatial-experiment';
import { LogisticTrajectories, logisticSeriesColor } from './logistic-trajectories';
import styles from './logistic-spatial.module.css';

const biomass = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
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
  | { status: 'completed'; trajectories: SpatialTrajectory[] }
  | { status: 'error'; message: string };
const statusLabel = { idle: 'Non lancé', running: 'En cours', completed: 'Terminé', error: 'Erreur' };
const beginning = { tick: 0, playing: false, started: false };

function ratioColor(ratio: number | undefined) {
  if (ratio === undefined) return 'unavailable';
  if (ratio === 0) return 'zero';
  if (ratio < 0.5) return 'low';
  if (ratio < 1) return 'below';
  return ratio === 1 ? 'capacity' : 'above';
}

export function LogisticSpatialExperiment({ active }: { active: boolean }) {
  const [request] = useState(spatialRequest);
  const cells = useMemo(() => spatialCells(request), [request]);
  const timeline = useMemo(() => spatialTimeline(request), [request]);
  const [phase, setPhase] = useState<Phase>({ status: 'idle' });
  const [cursor, setCursor] = useState(beginning);
  const [selected, setSelected] = useState('C02');
  const [compared, setCompared] = useState<string[]>([]);
  const running = useRef(false);
  const lastTick = timeline.length - 1;
  const time = timeline[cursor.tick] ?? request.simulation.start;
  const ready = phase.status === 'completed';
  const byId = useMemo(() => new Map(phase.status === 'completed'
    ? phase.trajectories.map(trajectory => [trajectory.cell.id, trajectory] as const)
    : []), [phase]);
  const chartSeries = useMemo(() => Array.from(byId.values()).filter(({ cell }) =>
    cell.id === selected || compared.includes(cell.id)), [byId, selected, compared]);
  const selectedCell = cells.find(cell => cell.id === selected)!;
  const selectedTrajectory = byId.get(selected);
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

  async function run() {
    if (running.current) return;
    running.current = true;
    setCursor(beginning);
    setPhase({ status: 'running' });
    try {
      const result = await runSimulation(request);
      setPhase({ status: 'completed', trajectories: spatialTrajectories(request, result) });
    } catch (cause) {
      setPhase({ status: 'error', message: errorText(cause) });
    } finally {
      running.current = false;
    }
  }

  function togglePlayback() {
    setCursor(value => value.playing
      ? { ...value, playing: false }
      : { tick: value.tick === lastTick ? 0 : value.tick, playing: true, started: true });
  }

  return <section className={styles.experiment} aria-labelledby="logistic-spatial-heading">
    <header className={styles.heading}>
      <div>
        <h1 id="logistic-spatial-heading">Expérience logistique spatiale</h1>
        <p>Démonstration sur grille fictive — données biologiques synthétiques</p>
      </div>
      <div className={styles.runActions}>
        <span className={styles.status} data-phase={phase.status} role="status">{statusLabel[phase.status]}</span>
        <button className="primary" onClick={() => void run()} disabled={phase.status === 'running'}>
          <Play size={16} aria-hidden="true" /> Lancer la simulation
        </button>
      </div>
    </header>

    {phase.status === 'error' && <p className={styles.error} role="alert">Simulation impossible · {phase.message}</p>}

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

    <div className={styles.panels}>
      <section className={styles.panel} aria-labelledby="logistic-spatial-grid">
        <div className={styles.panelHeading}>
          <h2 id="logistic-spatial-grid">Biomasse par cellule</h2>
          <span>Tonnes</span>
        </div>
        <div className={styles.grid}>
          {cells.map(cell => {
            const trajectory = byId.get(cell.id);
            const reading = trajectory ? spatialReading(trajectory, time) : null;
            return <button className={styles.tile} key={cell.id} aria-label={cell.id} aria-pressed={selected === cell.id}
              aria-describedby={'logistic-spatial-value-' + cell.id}
              data-cell={cell.id} data-tone={ratioColor(reading?.ratio)} data-biomass={reading?.value}
              data-observed-time={reading?.time} data-source={reading?.source}
              title={reading ? reading.value + ' t' : undefined} onClick={() => setSelected(cell.id)}>
              <span className={styles.tileTop}><strong>{cell.id}</strong>
                {reading && <span>{percent.format(reading.ratio)}</span>}
              </span>
              <span className={styles.tileValue} id={'logistic-spatial-value-' + cell.id}>
                {reading ? <>{biomass.format(reading.value)} <small>t</small></> : ready ? 'Point absent' : '—'}
              </span>
              {trajectory?.constant && <span className={styles.constant}>Équilibre</span>}
            </button>;
          })}
        </div>
        <div className={styles.legend} aria-label="Légende du rapport biomasse sur capacité">
          <strong>Rapport B/K</strong>
          <ul>{legend.map(([color, text]) => <li key={color}><i aria-hidden="true" data-tone={color} />{text}</li>)}</ul>
        </div>
      </section>

      <section className={styles.panel} aria-label={'Paramètres de ' + selectedCell.id}>
        <div className={styles.panelHeading}>
          <h2>Cellule {selectedCell.id}</h2>
          {selectedTrajectory?.constant && <span className={styles.equilibriumLabel}>Équilibre dédupliqué</span>}
        </div>
        <dl className={styles.parameters}>
          <div><dt>Biomasse initiale N₀</dt><dd>{biomass.format(selectedCell.initial)} t</dd></div>
          <div><dt>Taux de croissance r</dt><dd>{biomass.format(selectedCell.growth)} mois⁻¹</dd></div>
          <div><dt>Capacité K</dt><dd>{biomass.format(selectedCell.capacity)} t</dd></div>
        </dl>
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
        </> : <div className={styles.chartMessage}>Lancez la simulation pour consulter les trajectoires.</div>}

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
  </section>;
}
