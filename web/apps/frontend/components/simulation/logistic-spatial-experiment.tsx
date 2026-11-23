'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { RunRequest } from '@contracts';
import { errorText, runSimulation } from '@/lib/api/client';
import {
  constantDomain, constantDomainCell, lakeDistributionId, lakeMaxAlpha, lakeResolutionId, lakeResolutions,
  LakeRunError, runLakeBatch, runLakeBatches, samplingTimeline,
  spatialApply, spatialCells, spatialDimensions, spatialDrafts, spatialReading,
  spatialRequest, spatialResize, spatialTotals, spatialTrajectories,
  type LakeDistribution, type LakePlan, type LakeRunTrace, type SpatialCell, type SpatialDimension, type SpatialDraft, type SpatialDrafts, type SpatialMode, type SpatialTotal, type SpatialTrajectory,
} from '@/lib/simulation/spatial-experiment';
import { LogisticLakeGrid } from './logistic-lake-grid';
import { LogisticTrajectories, LogisticTrajectoryPlot, logisticSeriesColor } from './logistic-trajectories';
import { SpatialFullscreen } from './spatial-fullscreen';
import styles from './logistic-spatial.module.css';

const biomass = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
const tileBiomass = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const month = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 });
const wetPercent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumSignificantDigits: 5 });
const surface = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 5 });
const lakeComparisonMonths = [0, 10, 20];
const lakeGradientNotice = 'Gradient biologique synthétique — non calibré';
const lakeDistributionOptions = [
  { kind: 'homogeneous', label: 'Distribution homogène' },
  { kind: 'gradient', label: 'Gradient nord-sud' },
  { kind: 'wet-gradient', label: 'Gradient pondéré par surface humide' },
] as const;
type LakeInputs = { resolution: string; kind: LakeDistribution['kind']; alpha: number };
const defaultLakeInputs: LakeInputs = { resolution: lakeResolutionId(lakeResolutions[0]), kind: 'homogeneous', alpha: 0.3 };
const legend = [
  ['zero', '0 %'],
  ['low', '0 < B/K < 50 %'],
  ['below', '50 % ≤ B/K < 100 %'],
  ['capacity', '100 %'],
  ['above', 'Plus de 100 %'],
] as const;

type Phase =
  | { status: 'idle' }
  | { status: 'running'; completedBatches?: number }
  | { status: 'completed'; grids: Map<Grid, SpatialTrajectory[]> }
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

type Grid = SpatialDimension | 'lake';
type SquareConfiguration = { dimension: SpatialDimension; request: RunRequest; cells: SpatialCell[] };
type LakeConfiguration = { dimension: 'lake' } & LakePlan;
type Configuration = SquareConfiguration | LakeConfiguration;
type Validation = { cell: string; message: string; fields?: Partial<Record<keyof SpatialDraft, string>> | undefined };

function nominalConfiguration(dimension: SpatialDimension, mode: SpatialMode): SquareConfiguration {
  const request = spatialRequest(dimension, mode);
  return { dimension, request, cells: spatialCells(request) };
}

async function configureLake(inputs: LakeInputs, signal: AbortSignal): Promise<LakeConfiguration> {
  const query = new URLSearchParams({ resolution: inputs.resolution, distribution: inputs.kind, alpha: String(inputs.alpha) });
  const response = await fetch(`/api/logistic-lake?${query}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const plan: LakePlan = await response.json();
  return { dimension: 'lake', ...plan };
}

function largestLakeCell(domain: LakePlan['domain']) {
  return domain.cells.reduce((largest, cell) => cell.wetFraction > largest.wetFraction ? cell : largest).id;
}

const lakeConfigurationId = ({ rows, columns, distribution }: LakePlan['domain']['parameters']) =>
  `${lakeResolutionId({ rows, columns })}-${lakeDistributionId(distribution)}`;

function downloadTrace(trace: LakeRunTrace) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `lac-de-guiers-${trace.parameters.distribution.kind === 'homogeneous'
    ? lakeResolutionId(trace.parameters) : lakeConfigurationId(trace.parameters)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [mode, setMode] = useState<SpatialMode | 'lake'>('independent');
  const [lakeVisited, setLakeVisited] = useState(false);
  return <section className={styles.experiment} aria-labelledby="logistic-spatial-heading">
    <header className={styles.heading}>
      <div>
        <h1 id="logistic-spatial-heading">Expérience logistique spatiale</h1>
        <p>Démonstration sur grille fictive — données biologiques synthétiques</p>
      </div>
      <label className={styles.dimensions}>
        Mode de l’expérience
        <select value={mode} onChange={event => {
          const value = event.currentTarget.value;
          if (value === 'lake') setLakeVisited(true);
          setMode(value === 'constant' || value === 'lake' ? value : 'independent');
        }}>
          <option value="independent">Populations indépendantes</option>
          <option value="constant">Domaine constant</option>
          <option value="lake">Silhouette du lac</option>
        </select>
      </label>
    </header>
    <SpatialExperimentMode mode="independent" visible={mode === 'independent'} active={active && mode === 'independent'} />
    <SpatialExperimentMode mode="constant" visible={mode === 'constant'} active={active && mode === 'constant'} />
    {lakeVisited && <LakeExperiment visible={mode === 'lake'} active={active && mode === 'lake'} />}
  </section>;
}

type Visibility = { visible: boolean; active: boolean };

function LakeExperiment({ visible, active }: Visibility) {
  const [configuration, setConfiguration] = useState<LakeConfiguration>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await configureLake(defaultLakeInputs, controller.signal);
        if (!controller.signal.aborted) setConfiguration(next);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => controller.abort();
  }, [attempt]);
  if (configuration) return <SpatialExperimentMode mode="lake" lakeConfiguration={configuration} visible={visible} active={active} />;
  if (!visible) return null;
  return error ? <>
    <p className={styles.error} role="alert">Chargement du contour impossible · {error}</p>
    <button onClick={() => { setError(''); setAttempt(value => value + 1); }}>Recharger le contour</button>
  </> : <p role="status">Chargement du contour HydroLAKES…</p>;
}

function SpatialExperimentMode({ mode, visible, active, lakeConfiguration }: Visibility & (
  { mode: SpatialMode; lakeConfiguration?: never } | { mode: 'lake'; lakeConfiguration: LakeConfiguration }
)) {
  const fixed = mode === 'constant';
  const [configuration, setConfiguration] = useState(() => lakeConfiguration ?? nominalConfiguration(3, fixed ? 'constant' : 'independent'));
  const lake = configuration.dimension === 'lake' ? configuration : undefined;
  const editable = mode === 'independent';
  const { dimension } = configuration;
  const square = configuration.dimension === 'lake' ? undefined : configuration;
  const cells: readonly SpatialCell[] = configuration.dimension === 'lake' ? configuration.domain.cells : configuration.cells;
  const simulation = configuration.dimension === 'lake' ? configuration.domain.parameters.simulation : configuration.request.simulation;
  const samplingInterval = cells[0]!.samplingInterval;
  const timeline = useMemo(() => samplingTimeline(simulation, samplingInterval), [simulation, samplingInterval]);
  const [drafts, setDrafts] = useState<SpatialDrafts>({});
  const [validation, setValidation] = useState<Validation>();
  const appliedValues = useMemo(() => spatialDrafts(cells), [cells]);
  const [phase, setPhase] = useState<Phase>({ status: 'idle' });
  const [lakeTraces, setLakeTraces] = useState<Partial<Record<string, LakeRunTrace>>>({});
  const [lakeComparisons, setLakeComparisons] = useState<Partial<Record<string, SpatialTotal[]>>>({});
  const [lakeInputs, setLakeInputs] = useState(defaultLakeInputs);
  const [lakePreparing, setLakePreparing] = useState(false);
  const [lakeConfigurationError, setLakeConfigurationError] = useState('');
  const [cursor, setCursor] = useState(beginning);
  const [selected, setSelected] = useState(() => lakeConfiguration ? largestLakeCell(lakeConfiguration.domain) : 'C02');
  const [compared, setCompared] = useState<string[]>([]);
  const running = useRef<AbortController | null>(null);
  const preparing = useRef<AbortController | null>(null);
  useEffect(() => () => { running.current?.abort(); preparing.current?.abort(); }, []);
  const lastTick = timeline.length - 1;
  const time = timeline[cursor.tick] ?? simulation.start;
  const ready = phase.status === 'completed';
  const byId = useMemo(() => new Map(phase.status === 'completed'
    ? phase.grids.get(dimension)?.map(trajectory => [trajectory.cell.id, trajectory] as const)
    : []), [phase, dimension]);
  const totals = useMemo(() => fixed && phase.status === 'completed' ? spatialDimensions.map(size => ({
    size, name: gridLabel(size), points: spatialTotals(phase.grids.get(size) ?? [], timeline),
    ...aggregateStyles[size],
  })) : [], [fixed, phase, timeline]);
  const lakeTotals = useMemo(() => lake && phase.status === 'completed'
    ? spatialTotals(phase.grids.get('lake') ?? [], timeline) : [], [lake, phase, timeline]);
  const currentTotal = lake ? lakeTotals[cursor.tick]?.value : totals.find(({ size }) => size === dimension)?.points[cursor.tick]?.value;
  const chartSeries = useMemo(() => Array.from(byId.values()).filter(({ cell }) =>
    cell.id === selected || compared.includes(cell.id)), [byId, selected, compared]);
  const selectedCell = cells.find(cell => cell.id === selected)!;
  const selectedWetCell = lake?.domain.cells.find(cell => cell.id === selected);
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
    if (running.current || preparing.current) return;
    const controller = new AbortController();
    running.current = controller;
    setCursor(beginning);
    setPhase(next.dimension === 'lake' ? { status: 'running', completedBatches: 0 } : { status: 'running' });
    let runningDimension = next.dimension;
    try {
      const grids = new Map<Grid, SpatialTrajectory[]>();
      if (next.dimension === 'lake') {
        const { domain } = next;
        const { observations, trace } = await runLakeBatches(domain, next.reference, request => runLakeBatch(request, controller.signal), {
          signal: controller.signal,
          onProgress: completedBatches => {
            if (running.current === controller) setPhase({ status: 'running', completedBatches });
          },
        });
        if (running.current !== controller || controller.signal.aborted) return;
        const trajectories = domain.cells.map((cell, index) => ({ cell, samples: observations[index]!.samples,
          constant: false, ...domain.parameters.simulation }));
        const configurationId = lakeConfigurationId(domain.parameters);
        grids.set('lake', trajectories);
        setLakeTraces(previous => ({ ...previous, [configurationId]: trace }));
        setLakeComparisons(previous => ({ ...previous, [configurationId]: spatialTotals(trajectories, lakeComparisonMonths) }));
        setPhase({ status: 'completed', grids });
        return;
      }
      // Run one native request at a time against the same API used by the independent mode.
      const configurations = fixed ? spatialDimensions.map(size =>
        size === next.dimension ? next : nominalConfiguration(size, 'constant')) : [next];
      for (const { dimension, request, cells } of configurations) {
        runningDimension = dimension;
        const result = await runSimulation(request);
        if (controller.signal.aborted) return;
        grids.set(dimension, spatialTrajectories(request, result, cells));
      }
      setConfiguration(next);
      if (appliedCell) setDrafts(previous => withoutDraft(previous, appliedCell));
      setPhase({ status: 'completed', grids });
    } catch (cause) {
      if (controller.signal.aborted || running.current !== controller) return;
      if (next.dimension === 'lake' && cause instanceof LakeRunError) {
        setLakeTraces(previous => ({ ...previous, [lakeConfigurationId(next.domain.parameters)]: cause.trace }));
      }
      setPhase({ status: 'error', message: fixed && runningDimension !== 'lake'
        ? `Grille ${gridLabel(runningDimension)} · ${errorText(cause)}` : errorText(cause) });
    } finally {
      if (running.current === controller) running.current = null;
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
    if (!square || running.current) return;
    const result = spatialApply(square.request, { [selected]: draft }, square.cells);
    if (!result.ok) {
      setValidation({ cell: selected, fields: result.errors[selected], message: result.message });
      return;
    }
    setValidation(undefined);
    void run({ dimension: square.dimension, request: result.request, cells: result.cells }, selected);
  }

  function changeDimension(value: string) {
    const nextDimension = spatialDimensions.find(size => String(size) === value);
    if (!square || !nextDimension || nextDimension === dimension || running.current) return;

    try {
      const next = fixed ? nominalConfiguration(nextDimension, 'constant') : spatialResize(square.request, square.cells, nextDimension);
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

  function cancelLakeRun() {
    running.current?.abort();
    running.current = null;
    setPhase({ status: 'idle' });
    setCursor(beginning);
  }

  async function changeLakeConfiguration(inputs: LakeInputs) {
    if (!lake) return;
    cancelLakeRun();
    preparing.current?.abort();
    const controller = new AbortController();
    preparing.current = controller;
    setLakeInputs(inputs);
    setLakePreparing(true);
    setLakeConfigurationError('');
    try {
      const next = await configureLake(inputs, controller.signal);
      if (controller.signal.aborted) return;
      setConfiguration(next);
      if (lakeResolutionId(lake.mesh) !== inputs.resolution) {
        setSelected(largestLakeCell(next.domain));
        setCompared([]);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setLakeConfigurationError(errorText(cause));
    } finally {
      if (preparing.current === controller) {
        preparing.current = null;
        setLakePreparing(false);
      }
    }
  }

  function restore() {
    if (dimension === 'lake' || running.current) return;
    const nominal = nominalConfiguration(dimension, 'independent');
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

  function seek(requested: number) {
    const tick = Math.round((requested - simulation.start) / samplingInterval);
    setCursor(value => ({ ...value, tick, playing: false }));
  }

  if (!visible) return null;

  const trace = lake && phase.status !== 'running' && !lakePreparing && !lakeConfigurationError
    ? lakeTraces[lakeConfigurationId(lake.domain.parameters)] : undefined;
  const distribution = lake?.domain.parameters.distribution;
  const gradient = distribution?.kind === 'homogeneous' ? undefined : distribution;
  const fullscreenControls = <>
    {gradient && <span className={styles.gradientNotice}>{lakeGradientNotice}</span>}
    <label className={styles.fullscreenTime}>
      {selected} · {month.format(time)} mois
      <input type="range" aria-label="Temps en plein écran" min={simulation.start} max={simulation.end}
        step={samplingInterval} value={time} disabled={!ready} onChange={event => seek(Number(event.currentTarget.value))} />
    </label>
  </>;
  const area = lake?.domain.parameters.areaKm2 ?? constantDomain.area;

  return <>
    {lake && <div className={styles.lakeOptions}>
      <label className={styles.dimensions}>
        Distribution biologique
        <select value={lakeInputs.kind} onChange={event => {
          const option = lakeDistributionOptions.find(({ kind }) => kind === event.currentTarget.value);
          if (option) void changeLakeConfiguration({ ...lakeInputs, kind: option.kind });
        }}>
          {lakeDistributionOptions.map(({ kind, label }) => <option key={kind} value={kind}>{label}</option>)}
        </select>
      </label>
      {lakeInputs.kind !== 'homogeneous' && <>
        <label className={styles.gradientIntensity}>
          <span>Intensité du gradient α <strong>{formatParameter(lakeInputs.alpha)}</strong></span>
          <input type="range" min={0} max={lakeMaxAlpha} step={0.01} value={lakeInputs.alpha}
            aria-label="Intensité du gradient α" aria-valuetext={formatParameter(lakeInputs.alpha)}
            onChange={event => void changeLakeConfiguration({ ...lakeInputs, alpha: Number(event.currentTarget.value) })} />
        </label>
        <p className={styles.gradientNotice}>{lakeGradientNotice}</p>
      </>}
    </div>}
    <div className={styles.runActions}>
      <span className={styles.status} data-phase={phase.status} role="status">{lakePreparing ? 'Préparation du maillage…' : statusLabel[phase.status]}</span>
      {lake && phase.status === 'running' && <>
        <label className={styles.progress}>
          <progress value={phase.completedBatches ?? 0} max={lake.domain.batches.length} />
          <span aria-live="polite">{phase.completedBatches ?? 0} / {lake.domain.batches.length} lots natifs</span>
        </label>
        <button type="button" onClick={cancelLakeRun}>Annuler le calcul</button>
      </>}
      {trace && <button type="button" onClick={() => downloadTrace(trace)}>Télécharger la trace JSON</button>}
      {editable && <button onClick={restore} disabled={phase.status === 'running'}>
        <RotateCcw size={15} aria-hidden="true" /> Restaurer les paramètres initiaux
      </button>}
      <button className="primary" onClick={() => void run(configuration)}
        disabled={phase.status === 'running' || lakePreparing || Boolean(lakeConfigurationError)}
        title={fixed ? undefined : 'Exécuter la configuration appliquée'}>
        <Play size={16} aria-hidden="true" /> {fixed ? 'Simuler les trois grilles' : 'Lancer la simulation'}
      </button>
    </div>

    {lakeConfigurationError && <div className={styles.error} role="alert">
      <p>Préparation du lac impossible · {lakeConfigurationError}</p>
      <button type="button" onClick={() => void changeLakeConfiguration(lakeInputs)}>Réessayer</button>
    </div>}
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
        <input id="logistic-spatial-time" type="range" min={simulation.start} max={simulation.end}
          step={samplingInterval} value={time} disabled={!ready}
          aria-valuetext={month.format(time) + ' mois'}
          onChange={event => seek(Number(event.currentTarget.value))} />
        <div className={styles.tickLabels} aria-hidden="true">
          <span>{simulation.start}</span><span>{simulation.end} mois</span>
        </div>
      </div>
      <strong className={styles.time} aria-label="Instant consulté" data-time={time}>{month.format(time)} <small>mois</small></strong>
    </section>

    {lake && <div className={styles.lakeComparison}>
      <table>
        <caption>Biomasses totales simulées (t) · Grille {lakeInputs.resolution.replace('x', ' × ')}</caption>
        <thead><tr><th scope="col">Distribution</th>
          {lakeComparisonMonths.map(instant => <th key={instant} scope="col">{instant} mois</th>)}
        </tr></thead>
        <tbody>
          {lakeDistributionOptions.map(({ kind, label }) => {
            const alpha = lakeInputs.alpha;
            const id = lakeDistributionId(kind === 'homogeneous' ? { kind } : { kind, alpha });
            const points = lakeComparisons[`${lakeInputs.resolution}-${id}`];
            return <tr key={kind}>
              <th scope="row">{label}{kind !== 'homogeneous' && ` · α = ${formatParameter(alpha)}`}</th>
              {lakeComparisonMonths.map((instant, index) => {
                const value = points?.[index]?.value;
                return <td key={instant} data-comparison-biomass={value ?? undefined}>
                  {value == null ? 'À simuler' : biomass.format(value)}
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>}

    <div className={styles.panels} data-mode={mode}>
      <SpatialFullscreen as="section" className={styles.panel} aria-labelledby="logistic-spatial-grid"
        active={active} label={lake && 'Biomasse par cellule'} controls={fullscreenControls}>
        <div className={styles.panelHeading}>
          <h2 id="logistic-spatial-grid">Biomasse par cellule</h2>
          <span>Tonnes</span>
        </div>
        {lake ? <label className={styles.dimensions}>
          Résolution du lac
          <select value={lakeInputs.resolution} onChange={event => void changeLakeConfiguration({
            ...lakeInputs, resolution: event.currentTarget.value,
          })}>
            {lakeResolutions.map(size => <option key={lakeResolutionId(size)} value={lakeResolutionId(size)}>
              {size.rows} × {size.columns}
            </option>)}
          </select>
        </label> : <label className={styles.dimensions}>
          Dimensions de la grille
          <select value={dimension} disabled={phase.status === 'running'} onChange={event => changeDimension(event.currentTarget.value)}>
            {spatialDimensions.map(size => <option key={size} value={size}>{gridLabel(size)}</option>)}
          </select>
        </label>}
        {(fixed || lake) && <SpatialFullscreen active={active} label={lake && 'Indicateurs du domaine'} controls={fullscreenControls}>
          <dl className={styles.domainMetrics} aria-label="Domaine de la grille">
          <div><dt>Surface totale</dt><dd>{biomass.format(area)} km²</dd></div>
          {dimension === 'lake'
            ? <div><dt>Cellules humides</dt><dd>{cells.length}</dd></div>
            : <div><dt>Surface par cellule</dt><dd>{biomass.format(constantDomainCell(dimension).area)} km²</dd></div>}
          <div><dt>Capacité totale</dt><dd>{biomass.format(area * constantDomain.capacityDensity)} t</dd></div>
          {lake && <div><dt>Biomasse initiale totale</dt><dd>{biomass.format(lake.domain.parameters.initialTonnes)} t</dd></div>}
          <div><dt>Biomasse totale</dt><dd data-total-biomass={currentTotal ?? undefined}>
            {currentTotal == null ? (ready ? 'Point absent' : '—') : biomass.format(currentTotal) + ' t'}
          </dd></div>
          </dl>
        </SpatialFullscreen>}
        {lake ? <>
          <SpatialFullscreen active={active} label="Carte du lac" controls={fullscreenControls}>
            <LogisticLakeGrid key={lakeResolutionId(lake.mesh)} mesh={lake.mesh} cells={lake.domain.cells}
              showLowRatios={gradient !== undefined && gradient.alpha > 0}
              trajectories={byId} time={time} selected={selected} select={setSelected} />
          </SpatialFullscreen>
          <p className={styles.coverage}>La surface de référence est répartie selon la fraction humide des cases dans la projection locale.</p>
        </> : <>
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
        </>}
      </SpatialFullscreen>

      {fixed && <section className={styles.panel} aria-labelledby="logistic-aggregate-heading">
        <div className={styles.panelHeading}>
          <h2 id="logistic-aggregate-heading">Biomasse totale par taille de grille</h2>
          <span>Tonnes</span>
        </div>
        {ready ? <>
          {active && <LogisticTrajectoryPlot label="Trajectoires de biomasse totale" time={time}
            start={simulation.start} end={simulation.end}
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
        <SpatialFullscreen active={active} label={lake && 'Détails de la cellule'} controls={fullscreenControls}>
        <div className={styles.panelHeading}>
          <h2>Cellule {selectedCell.id}</h2>
          {selectedTrajectory?.constant && <span className={styles.equilibriumLabel}>Équilibre dédupliqué</span>}
        </div>
        {selectedWetCell ? <dl className={styles.parameters} aria-label="Paramètres de la cellule">
          <div><dt>Fraction humide</dt><dd>{wetPercent.format(selectedWetCell.wetFraction)}</dd></div>
          <div><dt>Surface humide</dt><dd>{surface.format(selectedWetCell.area)} km²</dd></div>
          <div><dt>Biomasse initiale N₀</dt><dd>{biomass.format(selectedCell.initial)} t</dd></div>
          <div><dt>Taux de croissance r</dt><dd>{biomass.format(selectedCell.growth)} mois⁻¹</dd></div>
          <div><dt>Capacité de charge K</dt><dd>{biomass.format(selectedCell.capacity)} t</dd></div>
          <div><dt>Biomasse observée</dt><dd>{selectedReading ? `${biomass.format(selectedReading.value)} t` : '—'}</dd></div>
          {gradient && <div><dt>Rapport local B/K</dt><dd>{selectedReading ? percent.format(selectedReading.ratio) : '—'}</dd></div>}
        </dl> : fixed ? <dl className={styles.parameters} aria-label="Paramètres de la cellule">
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
        {editable && simulated && <>
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
        </SpatialFullscreen>

        <SpatialFullscreen active={active} label={lake && 'Trajectoires'} controls={fullscreenControls}>
        {ready ? <>
          {active && <LogisticTrajectories series={chartSeries} time={time} start={simulation.start} end={simulation.end} />}
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
        </SpatialFullscreen>
      </section>
    </div>
  </>;
}
