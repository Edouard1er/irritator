import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, StepBack, StepForward } from 'lucide-react';
import { errorText } from '@/lib/api/client';
import { lakeResolutionId, lakeResolutions, LakeRunError, runLakeBatch, runLakeBatches,
  samplingTimeline, type LakePlan, type LakeRunTrace } from '@/lib/simulation/spatial-experiment';
import { configureLake, initialLakeView, lakeComparisonColors, lakeComparisonMonths, lakeDataset, lakeDifferenceLimit, lakeDisplays,
  lakeDistributionOptions, lakeKey, lakeMonth, lakeNumber, lakePlaybackInterval, lakePlaybackSpeeds, lakePrimaryColor, lakeReading, lakeScenarioLabel, lakeSignedTonnes,
  lakeSyntheticNotice, lakeTonnes, retainLakeDataset, type LakeDataset, type LakeDisplay, type LakeInputs,
  type LakeScaleMode } from '@/lib/simulation/lake-exploration';
import { downloadLakeFile, type LakeViewSnapshot } from '@/lib/simulation/lake-view-export';
import { DistributionInputs, LakeExport, RunProgress } from './logistic-lake-controls';
import { LakeCellDetails, LakeDomainMetrics, LakeMapLegend, LakeMapPane } from './logistic-lake-readings';
import { LakeTrajectoryPicker, maxLakeComparisons } from './logistic-lake-picker';
import { LakeTrajectoryChart, type LakeCurve } from './logistic-lake-trajectories';
import { SpatialFullscreen } from './spatial-fullscreen';
import styles from './logistic-spatial.module.css';

const defaultInputs: LakeInputs = { resolution: lakeResolutionId(lakeResolutions[0]), kind: 'homogeneous', alpha: 0.3 };
type Distribution = Omit<LakeInputs, 'resolution'>;
const homogeneous: Distribution = { kind: 'homogeneous', alpha: 0.3 };
const northSouth: Distribution = { kind: 'gradient', alpha: 0.3 };
const wetGradient: Distribution = { kind: 'wet-gradient', alpha: 0.6 };
const contrast: Distribution = { ...wetGradient, profile: 'sigmoid-v2' };
const demos: readonly { label: string; primary: Distribution; secondary?: Distribution }[] = [
  { label: 'Biomasse initiale homogène', primary: homogeneous },
  { label: 'Gradient sigmoïde · 0,3', primary: { ...contrast, alpha: 0.3 } },
  { label: 'Gradient sigmoïde · 0,6', primary: contrast },
  { label: 'Comparer homogène / sigmoïde', primary: homogeneous, secondary: contrast },
  { label: 'Gradient nord-sud · 0,3', primary: northSouth },
  { label: 'Gradient pondéré par surface humide · 0,6', primary: wetGradient },
  { label: 'Comparer homogène / gradient', primary: homogeneous, secondary: northSouth },
];
const gradientNotice = 'Gradient biologique synthétique — non calibré';
const beginning = { tick: 0, playing: false, started: false };
const statusLabel = { idle: 'Non lancé', running: 'En cours', completed: 'Terminé', error: 'Erreur' };

type PendingRun = { key: string; controller: AbortController };
type Progress = { key: string; done: number; count?: number };
type Failure = { key: string; message: string; trace?: LakeRunTrace };

function downloadTrace(trace: LakeRunTrace) {
  const { distribution } = trace.parameters;
  const resolution = lakeResolutionId(trace.parameters);
  const name = distribution.kind === 'homogeneous' ? resolution : lakeKey({ resolution, ...distribution });
  downloadLakeFile(new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' }), `lac-de-guiers-${name}.json`);
}

export function LogisticLakeExperiment({ visible, active }: { visible: boolean; active: boolean }) {
  const [plan, setPlan] = useState<LakePlan>();
  const [inputs, setInputs] = useState(defaultInputs);
  const [draft, setDraft] = useState<Distribution>(homogeneous);
  const [workshop, setWorkshop] = useState(false);
  const [scheduled, setScheduled] = useState<readonly LakeInputs[]>([]);
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
  const [alternateInputs, setAlternateInputs] = useState(wetGradient);
  const [alternateDraft, setAlternateDraft] = useState(wetGradient);
  const [cursor, setCursor] = useState(beginning);
  const [speed, setSpeed] = useState<(typeof lakePlaybackSpeeds)[number]>(1);
  const [loop, setLoop] = useState(false);
  const [selected, setSelected] = useState('');
  const [compared, setCompared] = useState<ReadonlyMap<string, string>>(() => new Map());
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
      const ids = new Set(next.domain.cells.map(cell => cell.id));
      setSelected(previous => ids.has(previous) ? previous : largest.id);
      setCompared(previous => [...previous.keys()].every(id => ids.has(id))
        ? previous : new Map([...previous].filter(([id]) => ids.has(id))));
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
  const draftInputs = { ...draft, resolution: inputs.resolution };
  const primaryChanged = lakeKey(draftInputs) !== primaryKey;
  const secondaryInputs = { ...alternateInputs, resolution: inputs.resolution };
  const secondaryKey = lakeKey(secondaryInputs);
  const alternateTarget = { ...alternateDraft, resolution: inputs.resolution };
  const secondaryChanged = lakeKey(alternateTarget) !== secondaryKey;
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
  const highlights = useMemo(() => new Map<string, string>(selected ? [[selected, lakePrimaryColor], ...compared] : compared),
    [selected, compared]);
  const chartSeries = useMemo<LakeCurve[]>(() => {
    if (!primary) return [];
    return [...highlights].flatMap(([id, color]) => {
      const trajectory = primary.trajectories.get(id);
      return trajectory ? [{
        name: id, points: trajectory.samples, color, selected: id === selected,
      }] : [];
    });
  }, [primary, selected, highlights]);

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
    setScheduled([]);
  }

  function changeInputs(next: LakeInputs, launch: readonly LakeInputs[] = []) {
    cancelRun();
    setScheduled(launch);
    if (lakeKey(inputs) === lakeKey(next) && !planError) return;
    preparing.current?.abort();
    setPlanning(true);
    setPlanError('');
    setFailure(undefined);
    setInputs({ ...next });
    if (inputs.resolution !== next.resolution) {
      setCursor(beginning);
      setSelected('');
      setCompared(new Map());
      setView(initialLakeView);
    } else {
      setCursor(value => ({ ...value, playing: false }));
    }
  }

  function showDemo(demo: typeof demos[number]) {
    const resolution = ['18x9', '24x12', '48x24'].includes(inputs.resolution) ? inputs.resolution : '18x9';
    const next = { ...demo.primary, resolution };
    const comparison = demo.secondary && { ...demo.secondary, resolution };
    setDraft(demo.primary);
    setComparing(!!comparison);
    if (demo.secondary) {
      setAlternateInputs(demo.secondary);
      setAlternateDraft(demo.secondary);
    }
    setCursor(value => ({ ...value, playing: false }));
    changeInputs(next, comparison ? [next, comparison] : [next]);
  }

  const removeCell = useCallback((id: string) => {
    setCompared(colors => colors.has(id) ? new Map([...colors].filter(([other]) => other !== id)) : colors);
  }, []);
  const selectCell = useCallback((id: string) => {
    setSelected(id);
    removeCell(id);
  }, [removeCell]);
  const addCell = useCallback((id: string) => {
    setCompared(colors => {
      if (id === selected || colors.has(id) || colors.size >= maxLakeComparisons) return colors;
      const usedColors = new Set(colors.values());
      const color = lakeComparisonColors.find(candidate => !usedColors.has(candidate));
      return color ? new Map(colors).set(id, color) : colors;
    });
  }, [selected]);

  async function run(target: LakeInputs) {
    const key = lakeKey(target);
    if (!planReady || running.current || datasets.has(key)) return;
    const controller = new AbortController();
    const task = { key, controller };
    running.current = task;
    setFailure(undefined);
    setProgress({ key, done: 0 });
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
      const dataset = lakeDataset(domain, { observations, trace });
      const protectedKeys = protectedScenarios.current;
      setDatasets(previous => retainLakeDataset(previous, key, dataset, protectedKeys));
      setSummaries(previous => new Map(previous).set(key, milestoneTicks.map(tick => dataset.totals[tick]!)));
    } catch (cause) {
      if (running.current !== task || controller.signal.aborted) return;
      setFailure({ key, message: errorText(cause), ...(cause instanceof LakeRunError ? { trace: cause.trace } : {}) });
      setScheduled([]);
    } finally {
      if (running.current === task) {
        running.current = null;
        setProgress(undefined);
      }
    }
  }

  const runScheduled = useEffectEvent(() => {
    const [target, ...rest] = scheduled;
    if (!target || !planReady || running.current) return;
    setScheduled(rest);
    if (!datasets.has(lakeKey(target))) void run(target);
  });
  useEffect(() => {
    runScheduled();
  }, [scheduled, planReady, progress]);

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
    <button onClick={() => changeInputs(inputs, scheduled)}>Recharger le contour</button>
  </> : <p role="status">Chargement du contour HydroLAKES…</p>;

  const trace = planReady && phase !== 'running' ? primary?.trace ?? primaryFailure?.trace : undefined;
  const selectedCell = primary?.cells.get(selected) ?? plan.domain.cells.find(cell => cell.id === selected);
  const selectedReading = lakeReading(primary, selected, cursor.tick);
  const total = primary?.totals[cursor.tick];
  const alternateTotal = secondary?.totals[cursor.tick];
  const totalDifference = total !== undefined && alternateTotal !== undefined ? alternateTotal - total : undefined;
  const resolutionControl = <label className={styles.dimensions}>Résolution du lac
    <select value={inputs.resolution} onChange={event => changeInputs({ ...inputs, resolution: event.currentTarget.value })}>
      {lakeResolutions.map(size => <option key={lakeResolutionId(size)} value={lakeResolutionId(size)}>{size.rows} × {size.columns}</option>)}
    </select>
  </label>;
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
    <span className={styles.lakeNotice}>{lakeSyntheticNotice}</span>
    {!workshop && inputs.kind !== 'homogeneous' && <span className={styles.gradientNotice}>{gradientNotice}</span>}
    <div className={styles.playActions}>{stepControls}{playbackSettings}</div>
    <div className={styles.fullscreenTime}>{selected} · {lakeMonth.format(time)} mois {timeSlider('Temps en plein écran')}</div>
  </div>;
  const commonMap = { mesh: plan.mesh, cells: plan.domain.cells, reference, display, limits, tick: cursor.tick,
    time, selected, select: selectCell, view, setView, workshop, highlights };
  const snapshot: LakeViewSnapshot | undefined = primary && (!comparing || secondary) && (display !== 'difference' || reference) ? {
    mesh: plan.mesh, cells: plan.domain.cells, reference, display, limits, tick: cursor.tick, time, view, selected, highlights,
    adaptive: scale === 'month', maps: [
      { title: lakeScenarioLabel(inputs), dataset: primary },
      ...(secondary ? [{ title: lakeScenarioLabel(secondaryInputs), dataset: secondary }] : []),
    ],
  } : undefined;
  const optionalRun = (target: LakeInputs, label: string) => {
    const key = lakeKey(target);
    const failed = failure?.key === key && key !== primaryKey ? failure : undefined;
    if (datasets.has(key)) return <p className={styles.coverage}>
      {workshop ? 'Simulation disponible' : 'Observations disponibles'} · {lakeScenarioLabel(target)}
    </p>;
    if (progress?.key === primaryKey && key === primaryKey) return <p>Simulation en cours.</p>;
    return <div className={styles.lakeScenarioState}>
      {failed && <p role="alert" className={styles.error}>Simulation impossible · {failed.message}</p>}
      {!workshop && failed?.trace && <button type="button" onClick={() => downloadTrace(failed.trace!)}>Télécharger la trace de l’erreur</button>}
      {progress?.key === key ? <RunProgress progress={progress} cancel={cancelRun} workshop={workshop} /> : <>
        <p>{failed ? 'Calcul à réessayer.' : 'Scénario à simuler.'}</p>
        <button type="button" disabled={!!progress || !planReady} onClick={() => void run(target)}>{label}</button>
      </>}
    </div>;
  };

  return <div className={styles.lakeExperience} data-workshop={workshop || undefined}>
    <div className={styles.lakeMode}>
      <p className={styles.lakeNotice}>{lakeSyntheticNotice}</p>
      <button type="button" aria-pressed={workshop} onClick={() => setWorkshop(value => !value)}>Mode atelier</button>
    </div>
    {workshop && <section className={styles.lakeDemos} aria-label="Scénarios de démonstration">
      <h2>Scénarios de démonstration</h2>
      <p>Les grilles 18 × 9 et 24 × 12 conviennent à la présentation. La grille 48 × 24 permet d’examiner le détail.</p>
      <div>{demos.map(demo => <button type="button" key={demo.label} onClick={() => showDemo(demo)}>{demo.label}</button>)}</div>
    </section>}
    <div className={styles.lakeOptions}>
      {workshop && resolutionControl}
      <DistributionInputs inputs={draft} applied={primary ? inputs : undefined} label="Distribution biologique"
        profileLabel="Profil du gradient" intensityLabel="Intensité du gradient α" change={setDraft} />
      {!workshop && draft.kind !== 'homogeneous' && <p className={styles.gradientNotice}>{gradientNotice}</p>}
    </div>
    <div className={styles.runActions}>
      <span className={styles.status} data-phase={phase} role="status">{planning ? 'Préparation du maillage…' : statusLabel[phase]}</span>
      {progress?.key === primaryKey && <RunProgress progress={progress} cancel={cancelRun} workshop={workshop} />}
      {!workshop && trace && <button type="button" onClick={() => downloadTrace(trace)}>Télécharger la trace JSON</button>}
      <button className="primary" type="button" onClick={() => changeInputs(draftInputs, [draftInputs])}
        disabled={!planReady || (!primaryChanged && (!!progress || !!primary))}>
        <Play size={16} aria-hidden="true" /> {draft.kind !== 'homogeneous' || primaryChanged ? 'Appliquer et simuler' : 'Lancer la simulation'}
      </button>
    </div>
    {planError && <div className={styles.error} role="alert">
      <p>Préparation du lac impossible · {planError}</p>
      <button type="button" onClick={() => changeInputs(inputs, scheduled)}>Réessayer</button>
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
        {!workshop && resolutionControl}
        {!workshop && <SpatialFullscreen active={active} label="Indicateurs du domaine" controls={fullscreenControls}>
          <LakeDomainMetrics area={plan.domain.parameters.areaKm2} cells={plan.domain.cells.length}
            initial={plan.domain.parameters.initialTonnes} capacity={capacity} dataset={primary} tick={cursor.tick} />
        </SpatialFullscreen>}

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
            {!workshop && <label className={styles.dimensions}>Cellule à consulter
              <select value={selected} onChange={event => selectCell(event.currentTarget.value)}>
                {cellOptions}
              </select>
            </label>}
            <label className={styles.lakeCheck}><input type="checkbox" checked={comparing} onChange={event => {
              if (!event.currentTarget.checked) {
                if (running.current?.key === secondaryKey && secondaryKey !== primaryKey) cancelRun();
                else setScheduled(targets => targets.filter(target => lakeKey(target) !== secondaryKey || secondaryKey === primaryKey));
              }
              setComparing(event.currentTarget.checked);
            }} /> Comparer deux scénarios</label>
            <LakeExport snapshot={snapshot} resolution={inputs.resolution} />
          </div>
          {comparing && <div className={styles.lakeSecondary}>
            <DistributionInputs inputs={alternateDraft} applied={secondary ? alternateInputs : undefined}
              label="Distribution à comparer" profileLabel="Profil du gradient comparé"
              intensityLabel="Intensité du gradient comparé α" change={setAlternateDraft} />
            {!workshop && alternateDraft.kind !== 'homogeneous' && <p className={styles.gradientNotice}>{gradientNotice}</p>}
            {secondaryChanged ? <button type="button" disabled={!planReady || (!!progress && progress.key !== secondaryKey)}
              onClick={() => {
                cancelRun();
                setAlternateInputs(alternateDraft);
                setScheduled([alternateTarget]);
              }}>Appliquer et simuler le scénario comparé</button> : optionalRun(secondaryInputs,
              alternateDraft.kind === 'homogeneous' ? 'Lancer le scénario comparé' : 'Appliquer et simuler le scénario comparé')}
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
          <LakeMapLegend display={display} limits={limits} adaptive={scale === 'month'} available={!!reference && ready} workshop={workshop} />
          {comparing && <p className={styles.lakeDelta}>
            Écart de biomasse totale (droite − gauche) <strong data-map-total-difference={totalDifference}>{lakeSignedTonnes(totalDifference)}</strong>
          </p>}
          <div className={styles.lakeMaps} data-comparison={comparing || undefined}>
            <LakeMapPane key={lakeResolutionId(plan.mesh)} {...commonMap} dataset={primary} initialKnown={!!planReady}
              title={lakeScenarioLabel(inputs)} label="Grille humide du lac de Guiers" />
            {comparing && <LakeMapPane key={`comparaison-${lakeResolutionId(plan.mesh)}`} {...commonMap} dataset={secondary}
              initialKnown={!!planReady && secondaryKey === primaryKey}
              title={lakeScenarioLabel(secondaryInputs)} label="Grille humide du lac de Guiers · comparaison" />}
          </div>
          {!workshop && <p className={styles.coverage}>La surface de référence est répartie selon la fraction humide dans la projection locale.</p>}
        </SpatialFullscreen>
      </SpatialFullscreen>

      <section className={styles.panel} aria-label={`Paramètres de ${selected}`}>
        <SpatialFullscreen active={active} label="Détails de la cellule" controls={fullscreenControls}>
          <div className={styles.panelHeading}><h2>Cellule <span style={{ color: highlights.get(selected) }}>{selected}</span></h2>
            {!workshop && <span>Valeurs locales</span>}</div>
          {selectedCell && <LakeCellDetails cell={selectedCell} dataset={primary} tick={cursor.tick}
            scientificDetails={!workshop} workshop={workshop} initialKnown={!!planReady} />}
          {primary && !selectedReading && <p className={styles.coverage}>Aucune observation à cet instant.</p>}
        </SpatialFullscreen>
        <SpatialFullscreen active={active} label="Trajectoires" controls={fullscreenControls}>
          <LakeTrajectoryPicker cells={plan.domain.cells} selected={selected} colors={highlights}
            select={selectCell} add={addCell} remove={removeCell} />
          {primary ? <>
            {active && <LakeTrajectoryChart time={time} tick={cursor.tick}
              start={simulation.start} end={simulation.end} curves={chartSeries} />}
            <ul className={styles.series} aria-label="Séries à l’instant consulté">
              {chartSeries.map(({ name, color, points, selected }) => {
                const value = points[cursor.tick]?.value;
                return <li key={name} data-series-cell={name}
                  data-selected={selected || undefined} data-time={time} data-biomass={value}>
                  <i aria-hidden="true" style={{ background: color }} />
                  <strong>{name}</strong>
                  <span>{value == null ? 'Point absent' : lakeTonnes(value)}</span>
                </li>;
              })}
            </ul>
          </> : <div className={styles.chartMessage}>{phase === 'running'
            ? 'Simulation en cours.' : 'Lancez la simulation pour consulter les trajectoires.'}</div>}
        </SpatialFullscreen>
      </section>
    </div>

    {!workshop && <div className={styles.lakeComparison}>
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
              <th scope="row">{lakeScenarioLabel(target)}</th>
              {lakeComparisonMonths.map((instant, index) => {
                const value = points?.[index];
                return <td key={instant} data-comparison-biomass={value}>{value === undefined ? 'À simuler' : lakeNumber.format(value)}</td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
  </div>;
}
