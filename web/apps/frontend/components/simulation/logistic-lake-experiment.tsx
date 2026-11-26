import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Pause, Play, RotateCcw, StepBack, StepForward } from 'lucide-react';
import { errorText } from '@/lib/api/client';
import { lakeMaxAlpha, lakeResolutionId, lakeResolutions, LakeRunError, runLakeBatch, runLakeBatches,
  samplingTimeline, type LakePlan, type LakeRunTrace } from '@/lib/simulation/spatial-experiment';
import { lakeComparisonMonths, lakeDifferenceLimit, lakeDisplays, lakeDistributionOptions, lakeKey, lakePlaybackInterval,
  lakePlaybackSpeeds, lakeReading, retainLakeDataset,
  type LakeCell, type LakeDataset, type LakeDisplay, type LakeInputs, type LakeScaleMode } from '@/lib/simulation/lake-exploration';
import { initialLakeView } from './logistic-lake-grid';
import { LakeCellDetails, LakeDomainMetrics, LakeMapLegend, LakeMapPane, lakeMonth, lakeNumber, lakeSignedTonnes,
  lakeTonnes } from './logistic-lake-readings';
import { LakeTrajectoryChart, type LakeCurve } from './logistic-lake-trajectories';
import { logisticSeriesColor } from './logistic-trajectories';
import { SpatialFullscreen } from './spatial-fullscreen';
import styles from './logistic-spatial.module.css';

const defaultInputs: LakeInputs = { resolution: lakeResolutionId(lakeResolutions[0]), kind: 'homogeneous', alpha: 0.3 };
const alternate: Omit<LakeInputs, 'resolution'> = { kind: 'wet-gradient', alpha: 0.6 };
const gradientNotice = 'Gradient biologique synthétique — non calibré';
const beginning = { tick: 0, playing: false, started: false };
const statusLabel = { idle: 'Non lancé', running: 'En cours', completed: 'Terminé', error: 'Erreur' };
const maxCompared = 3;
const alphaText = (alpha: number) => String(alpha).replace('.', ',');
const distributionLabel = ({ kind, alpha }: LakeInputs) =>
  lakeDistributionOptions.find(option => option.kind === kind)!.label
  + (kind === 'homogeneous' ? '' : ` · α = ${alphaText(alpha)}`);

type PendingRun = { key: string; controller: AbortController };
type Progress = { key: string; done: number; count?: number };
type Failure = { key: string; message: string; trace?: LakeRunTrace };

async function configureLake({ resolution, kind, alpha }: LakeInputs, signal: AbortSignal): Promise<LakePlan> {
  const query = new URLSearchParams({ resolution, distribution: kind, alpha: String(alpha) });
  const response = await fetch(`/api/logistic-lake?${query}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function downloadTrace(trace: LakeRunTrace) {
  const { distribution } = trace.parameters;
  const resolution = lakeResolutionId(trace.parameters);
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `lac-de-guiers-${distribution.kind === 'homogeneous' ? resolution : lakeKey({ resolution, ...distribution })}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LogisticLakeExperiment({ visible, active }: { visible: boolean; active: boolean }) {
  const [plan, setPlan] = useState<LakePlan>();
  const [inputs, setInputs] = useState(defaultInputs);
  const [planError, setPlanError] = useState('');
  const [planning, setPlanning] = useState(true);
  const [datasets, setDatasets] = useState<ReadonlyMap<string, LakeDataset>>(() => new Map());
  const [summaries, setSummaries] = useState<ReadonlyMap<string, readonly number[]>>(() => new Map());
  const [progress, setProgress] = useState<Progress>();
  const [failure, setFailure] = useState<Failure>();
  const running = useRef<PendingRun | null>(null);
  const protectedScenarios = useRef<string[]>([]);
  const preparing = useRef<AbortController | null>(null);
  const [display, setDisplay] = useState<LakeDisplay>('ratio');
  const [scale, setScale] = useState<LakeScaleMode>('fixed');
  const [comparing, setComparing] = useState(false);
  const [alternateInputs, setAlternateInputs] = useState(alternate);
  const [cursor, setCursor] = useState(beginning);
  const [speed, setSpeed] = useState<(typeof lakePlaybackSpeeds)[number]>(1);
  const [loop, setLoop] = useState(false);
  const [selected, setSelected] = useState('');
  const [compared, setCompared] = useState<string[]>([]);
  const [view, setView] = useState(initialLakeView);
  const simulation = plan?.domain.parameters.simulation;
  const interval = plan?.domain.parameters.samplingInterval;
  const timeline = useMemo(() => simulation && interval ? samplingTimeline(simulation, interval) : [], [simulation, interval]);
  const capacity = useMemo(() => plan?.domain.cells.reduce((sum, cell) => sum + cell.capacity, 0), [plan]);

  useEffect(() => {
    const controller = new AbortController();
    preparing.current = controller;
    void configureLake(inputs, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setPlan(next);
      const largest = next.domain.cells.reduce((a, b) => b.wetFraction > a.wetFraction ? b : a);
      setSelected(previous => previous || largest.id);
    }).catch(cause => {
      if (!controller.signal.aborted) setPlanError(errorText(cause));
    }).finally(() => {
      if (preparing.current === controller) {
        preparing.current = null;
        setPlanning(false);
      }
    });
    return () => {
      controller.abort();
      if (preparing.current === controller) preparing.current = null;
    };
  }, [inputs]);

  useEffect(() => () => running.current?.controller.abort(), []);

  const primaryKey = lakeKey(inputs);
  const secondaryInputs = { resolution: inputs.resolution, ...alternateInputs };
  const secondaryKey = lakeKey(secondaryInputs);
  const referenceInputs: LakeInputs = { ...inputs, kind: 'homogeneous' };
  const referenceKey = lakeKey(referenceInputs);
  const planReady = plan && !planning && !planError;
  const primary = planReady ? datasets.get(primaryKey) : undefined;
  const secondary = planReady && comparing ? datasets.get(secondaryKey) : undefined;
  const reference = planReady ? datasets.get(referenceKey) : undefined;
  const ready = !!(primary || secondary);
  const primaryFailure = failure?.key === primaryKey ? failure : undefined;
  const phase = primary ? 'completed' : progress?.key === primaryKey ? 'running' : primaryFailure ? 'error' : 'idle';
  const lastTick = timeline.length - 1;
  const time = timeline[cursor.tick] ?? simulation?.start ?? 0;
  const fixedLimit = useMemo(() => display === 'difference' ? lakeDifferenceLimit([primary, secondary], reference) : 0,
    [display, primary, secondary, reference]);
  const limit = display === 'difference' && scale === 'month' ? lakeDifferenceLimit([primary, secondary], reference, cursor.tick) : fixedLimit;
  const limits = useMemo(() => display === 'difference' ? [-limit || 0, 0, limit] as const : lakeDisplays[display].limits, [display, limit]);
  const milestoneTicks = useMemo(() => lakeComparisonMonths.map(instant => timeline.indexOf(instant)), [timeline]);
  const cellOptions = useMemo(() => plan?.domain.cells.map(cell => <option key={cell.id} value={cell.id}>{cell.id}</option>), [plan]);
  const chartSeries = useMemo<LakeCurve[]>(() => {
    if (!primary) return [];
    const chartIds = [selected, ...compared.filter(id => id !== selected)];
    const chartCells = chartIds.flatMap(id => {
      const trajectory = primary.trajectories.get(id);
      return trajectory ? [{
        name: id, points: trajectory.samples, color: logisticSeriesColor(trajectory.cell), selected: id === selected,
      }] : [];
    });
    return [...chartCells, {
      name: 'Biomasse totale', points: timeline.map((at, tick) => ({ time: at, value: primary.totals[tick]! })),
      color: '#193a40', aggregate: true,
    }];
  }, [primary, selected, compared, timeline]);

  useEffect(() => {
    protectedScenarios.current = [primaryKey, referenceKey, ...(comparing ? [secondaryKey] : [])];
  }, [primaryKey, referenceKey, comparing, secondaryKey]);

  useEffect(() => {
    if (!active || !ready) setCursor(value => value.playing ? { ...value, playing: false } : value);
  }, [active, ready]);

  useEffect(() => {
    if (!active || !ready || !cursor.playing) return;
    const period = lakePlaybackInterval / speed;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedTicks = Math.max(1, Math.floor((now - previous) / period));
      previous += elapsedTicks * period;
      setCursor(current => {
        if (!current.playing) return current;
        const tick = current.tick === lastTick ? 0 : Math.min(lastTick, current.tick + elapsedTicks);
        return { tick, playing: loop || tick < lastTick, started: true };
      });
    }, period);
    return () => window.clearInterval(timer);
  }, [active, ready, cursor.playing, lastTick, speed, loop]);

  function cancelRun() {
    running.current?.controller.abort();
    running.current = null;
    setProgress(undefined);
  }

  function changeInputs(next: LakeInputs) {
    if (lakeKey(inputs) === lakeKey(next) && !planError) return;
    cancelRun();
    preparing.current?.abort();
    setPlanning(true);
    setPlanError('');
    setInputs({ ...next });
    if (inputs.resolution !== next.resolution) {
      setCursor(beginning);
      setSelected('');
      setCompared([]);
      setView(initialLakeView);
    } else {
      setCursor(value => ({ ...value, playing: false }));
    }
  }

  async function run(target: LakeInputs) {
    const key = lakeKey(target);
    if (!planReady || running.current || datasets.has(key)) return;
    const controller = new AbortController();
    const task = { key, controller };
    running.current = task;
    setFailure(undefined);
    setProgress({ key, done: 0 });
    if (key === primaryKey && !secondary) setCursor(beginning);
    try {
      const { domain, reference: analytical } = key === primaryKey ? plan : await configureLake(target, controller.signal);
      if (controller.signal.aborted) return;
      const count = domain.batches.length;
      setProgress({ key, done: 0, count });
      const { observations, trace } = await runLakeBatches(domain, analytical, request => runLakeBatch(request, controller.signal), {
        signal: controller.signal,
        onProgress: done => {
          if (running.current === task) setProgress({ key, done, count });
        },
      });
      if (running.current !== task || controller.signal.aborted) return;
      const cells = new Map(domain.cells.map(cell => [cell.id, cell]));
      const totals = Array<number>(timeline.length).fill(0);
      const trajectories = new Map(domain.cells.map((cell, index) => {
        const samples = observations[index]!.samples;
        samples.forEach(({ value }, tick) => { totals[tick] = totals[tick]! + value; });
        return [cell.id, { cell, samples, constant: false, ...domain.parameters.simulation }] as const;
      }));
      const protectedKeys = protectedScenarios.current;
      setDatasets(previous => retainLakeDataset(previous, key, { cells, totals, trajectories, trace }, protectedKeys));
      setSummaries(previous => new Map(previous).set(key, milestoneTicks.map(tick => totals[tick]!)));
    } catch (cause) {
      if (running.current !== task || controller.signal.aborted) return;
      setFailure({ key, message: errorText(cause), ...(cause instanceof LakeRunError ? { trace: cause.trace } : {}) });
    } finally {
      if (running.current === task) {
        running.current = null;
        setProgress(undefined);
      }
    }
  }

  function togglePlayback() {
    setCursor(value => value.playing ? { ...value, playing: false }
      : { tick: value.tick === lastTick ? 0 : value.tick, playing: true, started: true });
  }

  function seek(tick: number) {
    setCursor(value => ({ ...value, tick: Math.max(0, Math.min(lastTick, tick)), playing: false }));
  }

  if (!visible) return null;
  if (!plan || !simulation || !interval || !capacity) return planError ? <>
    <p className={styles.error} role="alert">Chargement du contour impossible · {planError}</p>
    <button onClick={() => changeInputs(inputs)}>Recharger le contour</button>
  </> : <p role="status">Chargement du contour HydroLAKES…</p>;

  const trace = planReady && phase !== 'running' ? primary?.trace ?? primaryFailure?.trace : undefined;
  const selectedCell = primary?.cells.get(selected) ?? plan.domain.cells.find(cell => cell.id === selected);
  const selectedReading = lakeReading(primary, selected, cursor.tick);
  const total = primary?.totals[cursor.tick];
  const alternateTotal = secondary?.totals[cursor.tick];
  const totalDifference = total !== undefined && alternateTotal !== undefined ? alternateTotal - total : undefined;
  const stepControls = <>
    <button type="button" aria-label="Observation précédente" title="Observation précédente" disabled={!ready || cursor.tick === 0}
      onClick={() => seek(cursor.tick - 1)}><StepBack size={16} aria-hidden="true" /></button>
    <button type="button" onClick={togglePlayback} disabled={!ready}>
      {cursor.playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      {cursor.playing ? 'Pause' : cursor.started && cursor.tick < lastTick ? 'Reprendre' : 'Lire'}
    </button>
    <button type="button" aria-label="Observation suivante" title="Observation suivante" disabled={!ready || cursor.tick === lastTick}
      onClick={() => seek(cursor.tick + 1)}><StepForward size={16} aria-hidden="true" /></button>
    <button type="button" onClick={() => setCursor(beginning)} disabled={!ready} title="Remettre au début">
      <RotateCcw size={16} aria-hidden="true" /> Remettre au début
    </button>
  </>;
  const playbackSettings = <>
    <label className={styles.dimensions}>Vitesse
      <select value={speed} onChange={event => {
        const next = lakePlaybackSpeeds.find(value => value === Number(event.currentTarget.value));
        if (next) setSpeed(next);
      }}>
        {lakePlaybackSpeeds.map(value => <option key={value} value={value}>×{value}</option>)}
      </select>
    </label>
    <label className={styles.lakeCheck}><input type="checkbox" checked={loop}
      onChange={event => setLoop(event.currentTarget.checked)} /> En boucle</label>
  </>;
  const timeSlider = (label: string) => <input type="range" aria-label={label}
    min={simulation.start} max={simulation.end} step={interval} value={time} disabled={!ready}
    aria-valuetext={lakeMonth.format(time) + ' mois'}
    onChange={event => seek(Math.round((Number(event.currentTarget.value) - simulation.start) / interval))} />;
  const fullscreenControls = <div className={styles.lakeFullscreenControls}>
    {inputs.kind !== 'homogeneous' && <span className={styles.gradientNotice}>{gradientNotice}</span>}
    <div className={styles.playActions}>{stepControls}{playbackSettings}</div>
    <div className={styles.fullscreenTime}>{selected} · {lakeMonth.format(time)} mois {timeSlider('Temps en plein écran')}</div>
  </div>;
  const commonMap = { mesh: plan.mesh, cells: plan.domain.cells, reference, display, limits, tick: cursor.tick,
    time, selected, select: setSelected, view, setView };
  const optionalRun = (target: LakeInputs, label: string) => {
    const key = lakeKey(target);
    const failed = failure?.key === key && key !== primaryKey ? failure : undefined;
    if (datasets.has(key)) return <p className={styles.coverage}>Observations disponibles · {distributionLabel(target)}</p>;
    if (progress?.key === primaryKey && key === primaryKey) return <p>Simulation en cours.</p>;
    return <div className={styles.lakeScenarioState}>
      {failed && <p role="alert" className={styles.error}>Simulation impossible · {failed.message}</p>}
      {failed?.trace && <button type="button" onClick={() => downloadTrace(failed.trace!)}>Télécharger la trace de l’erreur</button>}
      {progress?.key === key ? <RunProgress progress={progress} cancel={cancelRun} /> : <>
        <p>{failed ? 'Calcul à réessayer.' : 'Scénario à simuler.'}</p>
        <button type="button" disabled={!!progress || !planReady} onClick={() => void run(target)}>{label}</button>
      </>}
    </div>;
  };

  return <>
    <div className={styles.lakeOptions}>
      <DistributionInputs inputs={inputs} label="Distribution biologique" intensityLabel="Intensité du gradient α"
        change={value => changeInputs({ ...inputs, ...value })} />
      {inputs.kind !== 'homogeneous' && <p className={styles.gradientNotice}>{gradientNotice}</p>}
    </div>
    <div className={styles.runActions}>
      <span className={styles.status} data-phase={phase} role="status">{planning ? 'Préparation du maillage…' : statusLabel[phase]}</span>
      {progress?.key === primaryKey && <RunProgress progress={progress} cancel={cancelRun} />}
      {trace && <button type="button" onClick={() => downloadTrace(trace)}>Télécharger la trace JSON</button>}
      <button className="primary" onClick={() => void run(inputs)} disabled={!!progress || !planReady || !!primary}>
        <Play size={16} aria-hidden="true" /> Lancer la simulation
      </button>
    </div>
    {planError && <div className={styles.error} role="alert">
      <p>Préparation du lac impossible · {planError}</p>
      <button type="button" onClick={() => changeInputs(inputs)}>Réessayer</button>
    </div>}
    {primaryFailure && !planError && <p className={styles.error} role="alert">Simulation impossible · {primaryFailure.message}</p>}

    <section className={`${styles.timeline} ${styles.lakeTimeline}`} aria-label="Lecture temporelle">
      <div className={styles.playActions}>{stepControls}</div>
      <div className={styles.scrubber}>
        {timeSlider('Temps simulé')}
        <div className={styles.tickLabels} aria-hidden="true"><span>{simulation.start}</span><span>{simulation.end} mois</span></div>
      </div>
      <strong className={styles.time} aria-label="Instant consulté" data-time={time}><small>Mois</small> {lakeMonth.format(time)}</strong>
      <div className={styles.lakePlaybackSettings}>{playbackSettings}</div>
    </section>

    <div className={styles.panels} data-mode="lake" data-comparison={comparing || undefined}>
      <SpatialFullscreen as="section" className={styles.panel} aria-labelledby="logistic-spatial-grid"
        active={active} label="Biomasse par cellule" controls={fullscreenControls}>
        <div className={styles.panelHeading}><h2 id="logistic-spatial-grid">Biomasse par cellule</h2></div>
        <label className={styles.dimensions}>Résolution du lac
          <select value={inputs.resolution} onChange={event => changeInputs({ ...inputs, resolution: event.currentTarget.value })}>
            {lakeResolutions.map(size => <option key={lakeResolutionId(size)} value={lakeResolutionId(size)}>{size.rows} × {size.columns}</option>)}
          </select>
        </label>
        <SpatialFullscreen active={active} label="Indicateurs du domaine" controls={fullscreenControls}>
          <LakeDomainMetrics area={plan.domain.parameters.areaKm2} cells={plan.domain.cells.length}
            initial={plan.domain.parameters.initialTonnes} capacity={capacity} dataset={primary} tick={cursor.tick} />
        </SpatialFullscreen>

        <SpatialFullscreen active={active} label="Carte du lac" controls={fullscreenControls}>
          <div className={styles.lakeMapOptions}>
            <label className={styles.dimensions}>Affichage de la carte
              <select value={display} onChange={event => setDisplay(event.currentTarget.value as LakeDisplay)}>
                {Object.entries(lakeDisplays).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
              </select>
            </label>
            {display === 'difference' && <label className={styles.dimensions}>Échelle des écarts
              <select value={scale} onChange={event => setScale(event.currentTarget.value as LakeScaleMode)}>
                <option value="fixed">Fixe sur tous les mois</option>
                <option value="month">Ajustée au mois</option>
              </select>
            </label>}
            <label className={styles.dimensions}>Cellule à consulter
              <select value={selected} onChange={event => setSelected(event.currentTarget.value)}>
                {cellOptions}
              </select>
            </label>
            <label className={styles.lakeCheck}><input type="checkbox" checked={comparing} onChange={event => {
              if (!event.currentTarget.checked && running.current?.key === secondaryKey && secondaryKey !== primaryKey) cancelRun();
              setComparing(event.currentTarget.checked);
            }} /> Comparer deux scénarios</label>
          </div>
          {comparing && <div className={styles.lakeSecondary}>
            <DistributionInputs inputs={alternateInputs} label="Distribution à comparer" intensityLabel="Intensité du gradient comparé α"
              change={next => {
                if (running.current?.key === secondaryKey && secondaryKey !== primaryKey) cancelRun();
                setAlternateInputs(next);
              }} />
            {alternateInputs.kind !== 'homogeneous' && <p className={styles.gradientNotice}>{gradientNotice}</p>}
            {optionalRun(secondaryInputs, 'Lancer le scénario comparé')}
          </div>}
          {display === 'difference' && !reference && <div className={styles.lakeReference}>
            <p>Simulez la distribution homogène sur cette grille pour afficher les écarts.</p>
            {referenceKey !== primaryKey && (!comparing || secondaryKey !== referenceKey)
              ? optionalRun(referenceInputs, 'Simuler la référence homogène')
              : referenceKey === primaryKey && phase === 'idle' && <button type="button" disabled={!!progress || !planReady}
                onClick={() => void run(inputs)}>Simuler la référence homogène</button>}
          </div>}
          {primary && display === 'difference' && reference && !primary.trajectories.get(selected)?.samples[cursor.tick]
            && <p className={styles.coverage}>Observation absente à ce mois pour la cellule sélectionnée.</p>}
          <LakeMapLegend display={display} limits={limits} adaptive={scale === 'month'} available={!!reference && ready} />
          {comparing && <p className={styles.lakeDelta}>
            Écart de biomasse totale (droite − gauche) <strong data-map-total-difference={totalDifference}>{lakeSignedTonnes(totalDifference)}</strong>
          </p>}
          <div className={styles.lakeMaps} data-comparison={comparing || undefined}>
            <LakeMapPane key={lakeResolutionId(plan.mesh)} {...commonMap} dataset={primary} initialKnown={!!planReady}
              title={distributionLabel(inputs)} label="Grille humide du lac de Guiers" />
            {comparing && <LakeMapPane key={`comparaison-${lakeResolutionId(plan.mesh)}`} {...commonMap} dataset={secondary}
              initialKnown={!!planReady && secondaryKey === primaryKey}
              title={distributionLabel(secondaryInputs)} label="Grille humide du lac de Guiers · comparaison" />}
          </div>
          <p className={styles.coverage}>La surface de référence est répartie selon la fraction humide dans la projection locale.</p>
        </SpatialFullscreen>
      </SpatialFullscreen>

      <section className={styles.panel} aria-label={`Paramètres de ${selected}`}>
        <SpatialFullscreen active={active} label="Détails de la cellule" controls={fullscreenControls}>
          <div className={styles.panelHeading}><h2>Cellule {selected}</h2><span>Valeurs locales</span></div>
          {selectedCell && <LakeCellDetails cell={selectedCell} dataset={primary} tick={cursor.tick} scientificDetails initialKnown={!!planReady} />}
          {primary && !selectedReading && <p className={styles.coverage}>Aucune observation à cet instant.</p>}
        </SpatialFullscreen>
        <SpatialFullscreen active={active} label="Trajectoires" controls={fullscreenControls}>
          {primary ? <>
            {active && <LakeTrajectoryChart time={time} tick={cursor.tick}
              start={simulation.start} end={simulation.end} curves={chartSeries} />}
            <ul className={styles.series} aria-label="Séries à l’instant consulté">
              {chartSeries.map(({ name, color, points, selected, aggregate }) => {
                const value = points[cursor.tick]?.value;
                return <li key={name} data-series-cell={aggregate ? undefined : name}
                  data-selected={selected || undefined} data-time={time} data-biomass={value}>
                  <i aria-hidden="true" style={{ background: color }} />
                  <strong>{name}</strong>
                  <span>{value == null ? 'Point absent' : lakeTonnes(value)}</span>
                </li>;
              })}
            </ul>
          </> : <div className={styles.chartMessage}>{phase === 'running'
            ? 'Simulation en cours.' : 'Lancez la simulation pour consulter les trajectoires.'}</div>}
          <LakeTrajectoryPicker cells={plan.domain.cells} selected={selected} compared={compared} setCompared={setCompared} />
        </SpatialFullscreen>
      </section>
    </div>

    <div className={styles.lakeComparison}>
      <table>
        <caption>Biomasses totales simulées (t) · Grille {inputs.resolution.replace('x', ' × ')}</caption>
        <thead><tr><th scope="col">Distribution</th>
          {lakeComparisonMonths.map(instant => <th key={instant} scope="col">{instant} mois</th>)}
        </tr></thead>
        <tbody>
          {lakeDistributionOptions.map(({ kind }) => {
            const target = { ...inputs, kind };
            const points = summaries.get(lakeKey(target));
            return <tr key={kind}>
              <th scope="row">{distributionLabel(target)}</th>
              {lakeComparisonMonths.map((instant, index) => {
                const value = points?.[index];
                return <td key={instant} data-comparison-biomass={value}>{value === undefined ? 'À simuler' : lakeNumber.format(value)}</td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </>;
}

const LakeTrajectoryPicker = memo(function LakeTrajectoryPicker({ cells, selected, compared, setCompared }: {
  cells: readonly LakeCell[]; selected: string; compared: readonly string[]; setCompared: Dispatch<SetStateAction<string[]>>;
}) {
  return <fieldset className={styles.compare}>
    <legend>Comparer les trajectoires</legend>
    {cells.map(cell => <label key={cell.id}>
      <input type="checkbox" aria-label={`Comparer ${cell.id}`} checked={cell.id === selected || compared.includes(cell.id)}
        disabled={cell.id === selected || (!compared.includes(cell.id) && compared.length >= maxCompared)}
        onChange={event => {
          const checked = event.currentTarget.checked;
          setCompared(ids => checked ? [...ids, cell.id] : ids.filter(id => id !== cell.id));
        }} />{cell.id}
    </label>)}
  </fieldset>;
});

function DistributionInputs({ inputs, change, label, intensityLabel }: {
  inputs: Omit<LakeInputs, 'resolution'>;
  change: (value: Omit<LakeInputs, 'resolution'>) => void;
  label: string;
  intensityLabel: string;
}) {
  return <>
    <label className={styles.dimensions}>{label}
      <select value={inputs.kind} onChange={event => {
        const option = lakeDistributionOptions.find(({ kind }) => kind === event.currentTarget.value);
        if (option) change({ ...inputs, kind: option.kind });
      }}>
        {lakeDistributionOptions.map(({ kind, label }) => <option key={kind} value={kind}>{label}</option>)}
      </select>
    </label>
    {inputs.kind !== 'homogeneous' && <label className={styles.gradientIntensity}>
      <span>{intensityLabel} <strong>{alphaText(inputs.alpha)}</strong></span>
      <input type="range" min={0} max={lakeMaxAlpha} step={0.01} value={inputs.alpha}
        aria-label={intensityLabel} aria-valuetext={alphaText(inputs.alpha)}
        onChange={event => change({ ...inputs, alpha: Number(event.currentTarget.value) })} />
    </label>}
  </>;
}

function RunProgress({ progress, cancel }: { progress: Progress; cancel: () => void }) {
  return <>
    {progress.count === undefined ? <span>Préparation du scénario…</span> : <label className={styles.progress}>
      <progress value={progress.done} max={progress.count} />
      <span aria-live="polite">{progress.done} / {progress.count} lots natifs</span>
    </label>}
    <button type="button" onClick={cancel}>Annuler le calcul</button>
  </>;
}
