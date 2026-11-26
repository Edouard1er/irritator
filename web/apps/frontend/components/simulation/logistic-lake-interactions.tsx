import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, StepBack, StepForward } from 'lucide-react';
import { errorText } from '@/lib/api/client';
import {
  lakeExchangeIntensities, lakeExchangeResolutions, lakeFullNetworkResolution, lakeFullTopology,
  lakeNetworkConnected, lakeNetworkSize, lakeResolutionId, lakeWetFrontier,
  runLakeBatch, runLakeBatches, samplingTimeline, type LakeExchangeIntensity, type LakePlan,
} from '@/lib/simulation/spatial-experiment';
import {
  configureLake, formatSmall, initialLakeView, lakeAlpha, lakeComparisonColors, lakeDataset, lakeDensityDispersion, lakeDisplays,
  lakeExchangeDirection, lakeExchangeReading, lakeMonth, lakeNetworkNetFlows, lakeNumber, lakePlaybackInterval, lakePlaybackSpeeds, lakePrimaryColor,
  lakeReading, lakeScenarioLabel, lakeSignedTonnes, lakeSyntheticNotice, lakeTonnes, lakeTotalTonnes, type LakeCell, type LakeDataset,
  type LakeExchangeOverlay, type LakeInputs,
} from '@/lib/simulation/lake-exploration';
import type { LakeViewSnapshot } from '@/lib/simulation/lake-view-export';
import { DistributionInputs, LakeExport, RunProgress } from './logistic-lake-controls';
import { LakeTrajectoryPicker, maxLakeComparisons } from './logistic-lake-picker';
import { LakeMapLegend, LakeMapPane } from './logistic-lake-readings';
import { LakeTrajectoryChart, type LakeCurve } from './logistic-lake-trajectories';
import { SpatialFullscreen } from './spatial-fullscreen';
import styles from './logistic-spatial.module.css';

const initialInputs: LakeInputs = { resolution: '6x3', kind: 'homogeneous', alpha: 0.6, profile: 'sigmoid-v2' };
const pairColor = '#481c70';
const networkColors = [lakePrimaryColor, pairColor, '#923b25', '#304e9b', '#14624b', '#87465c'];
const fullTitle = 'Réseau complet — grille 6 × 3';
const limits = lakeDisplays.ratio.limits;
const edgeKey = ({ a, b }: LakeExchangeOverlay) => `${a} ${b}`;

export function LogisticLakeInteractions({ visible, active }: { visible: boolean; active: boolean }) {
  const [inputs, setInputs] = useState(initialInputs);
  const { resolution } = inputs;
  const [plan, setPlan] = useState<LakePlan>();
  const [reload, setReload] = useState(0);
  const [planError, setPlanError] = useState('');
  const [mode, setMode] = useState<'none' | 'pair' | 'network' | 'full-network'>('none');
  const exchangeEnabled = mode !== 'none';
  const networkMode = mode === 'network';
  const fullMode = mode === 'full-network';
  const [showArrows, setShowArrows] = useState(true);
  const [incidentOnly, setIncidentOnly] = useState(false);
  const [flowSort, setFlowSort] = useState('absolute');
  const [mu, setMu] = useState<LakeExchangeIntensity>(0.5);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [picking, setPicking] = useState<'a' | 'b'>();
  const [pairError, setPairError] = useState('');
  const [networkCells, setNetworkCells] = useState<readonly string[]>([]);
  const [excludedEdges, setExcludedEdges] = useState<ReadonlySet<string>>(() => new Set());
  const [pickingNetwork, setPickingNetwork] = useState(true);
  const [networkError, setNetworkError] = useState('');
  const [selected, setSelected] = useState('');
  const [extras, setExtras] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [view, setView] = useState(initialLakeView);
  const [results, setResults] = useState<{ baseline: LakeDataset; exchanged?: LakeDataset }>();
  const [progress, setProgress] = useState<{ done: number; count?: number }>();
  const [failure, setFailure] = useState('');
  const running = useRef<AbortController | null>(null);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof lakePlaybackSpeeds)[number]>(1);
  const { simulation, samplingInterval } = plan?.domain.parameters ?? {};
  const timeline = useMemo(() => simulation && samplingInterval ? samplingTimeline(simulation, samplingInterval) : [],
    [simulation, samplingInterval]);
  const end = timeline.length - 1;
  const time = timeline[tick] ?? 0;
  const neighbors = useMemo(() => {
    const candidates = new Map<string, NonNullable<ReturnType<typeof lakeWetFrontier>>>();
    const origin = plan?.domain.cells.find(cell => cell.id === a);
    if (plan && origin) {
      for (const cell of plan.domain.cells) {
        const frontier = lakeWetFrontier(plan.mesh, origin, cell);
        if (frontier) candidates.set(cell.id, frontier);
      }
    }
    return candidates;
  }, [a, plan]);
  const frontier = mode === 'pair' ? neighbors.get(b) : undefined;
  const fullTopology = useMemo(() => plan && fullMode ? lakeFullTopology(plan.mesh) : undefined, [fullMode, plan]);
  const { edges: availableEdges, candidates } = useMemo(() => {
    const edges: LakeExchangeOverlay[] = [];
    const candidates = new Set<string>();
    if (plan && networkMode) {
      const members = plan.domain.cells.filter(cell => networkCells.includes(cell.id));
      const occupied = new Set(networkCells);
      for (const cell of plan.domain.cells) {
        for (const origin of members) {
          if (occupied.has(cell.id) && origin.id >= cell.id) continue;
          const frontier = lakeWetFrontier(plan.mesh, origin, cell);
          if (!frontier) continue;
          if (occupied.has(cell.id)) edges.push({ a: origin.id, b: cell.id, frontier });
          else candidates.add(cell.id);
        }
        if (!members.length) candidates.add(cell.id);
      }
    }
    return { edges, candidates };
  }, [networkCells, networkMode, plan]);
  const edges = useMemo(() => availableEdges.filter(edge => !excludedEdges.has(edgeKey(edge))), [availableEdges, excludedEdges]);
  const connectionChoices = useMemo(() => availableEdges.map(edge => {
    const key = edgeKey(edge);
    const checked = !excludedEdges.has(key);
    return { edge, key, checked, required: checked && !lakeNetworkConnected(networkCells, edges.filter(candidate => candidate !== edge)) };
  }), [availableEdges, edges, excludedEdges, networkCells]);
  const canExtendNetwork = networkCells.length < lakeNetworkSize.max && candidates.size > 0;
  const ready = mode === 'none' || fullMode || (networkMode ? networkCells.length >= lakeNetworkSize.min : !!frontier);
  const fixed = useMemo(() => networkMode ? networkCells : mode === 'pair' ? [a, b].filter(Boolean) : [selected].filter(Boolean),
    [a, b, selected, mode, networkCells, networkMode]);
  const colors = useMemo(() => {
    const marks = new Map(fixed.map((id, index) => [id, networkMode ? networkColors[index]! : index === 0 ? lakePrimaryColor : pairColor]));
    for (const [id, color] of extras) if (!marks.has(id)) marks.set(id, color);
    return marks;
  }, [extras, fixed, networkMode]);
  const neighborIds = useMemo(() => networkMode ? pickingNetwork && canExtendNetwork && networkCells.length ? candidates : undefined
    : picking === 'b' ? new Set(neighbors.keys()) : undefined,
  [candidates, canExtendNetwork, neighbors, networkCells.length, networkMode, pickingNetwork, picking]);
  const curves = useMemo<LakeCurve[]>(() => {
    if (!results) return [];
    return [...colors].flatMap(([id, color]) => {
      const points = results.baseline.trajectories.get(id)!.samples;
      const changed = results.exchanged?.trajectories.get(id)?.samples;
      const selected = fixed.includes(id);
      if (!changed || (!fullMode && !selected)) return [{ name: id, points, color, selected }];
      return [
        { name: `${id} · B`, points: changed, color, selected },
        { name: `${id} · A`, points, color, selected, dashed: true },
      ];
    });
  }, [colors, fixed, fullMode, results]);

  useEffect(() => {
    const controller = new AbortController();
    void configureLake({ ...initialInputs, resolution }, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setPlan(next);
      setSelected(next.domain.cells.reduce((best, cell) => cell.wetFraction > best.wetFraction ? cell : best).id);
    }).catch(cause => { if (!controller.signal.aborted) setPlanError(errorText(cause)); });
    return () => controller.abort();
  }, [resolution, reload]);

  useEffect(() => () => running.current?.abort(), []);

  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);

  useEffect(() => {
    if (!active || !playing || !results) return;
    const timer = window.setTimeout(() => {
      setTick(tick + 1);
      if (tick + 1 >= end) setPlaying(false);
    }, lakePlaybackInterval / speed);
    return () => window.clearTimeout(timer);
  }, [active, end, playing, results, speed, tick]);

  function resetResults() {
    running.current?.abort();
    running.current = null;
    setProgress(undefined);
    setResults(undefined);
    setFailure('');
    setTick(0);
    setPlaying(false);
  }

  function changeInputs(next: LakeInputs) {
    resetResults();
    setInputs(next);
    if (resolution === next.resolution) return;
    setPlan(undefined);
    setPlanError('');
    setA('');
    setB('');
    setPairError('');
    setPicking(mode === 'pair' ? 'a' : undefined);
    setNetworkCells([]);
    setExcludedEdges(new Set());
    setPickingNetwork(true);
    setNetworkError('');
    setExtras(new Map());
    setView(initialLakeView);
  }

  function inspect(id: string) {
    setSelected(id);
    if (!exchangeEnabled || fullMode) removeCell(id);
  }

  function chooseA(id: string) {
    if (a !== id) {
      resetResults();
      setA(id);
      setB('');
      removeCell(id);
    }
    setPairError('');
    if (id) inspect(id);
    setPicking(id ? 'b' : 'a');
  }

  function chooseB(id: string) {
    if (id && !neighbors.has(id)) {
      setPairError(`${id} ne partage pas de frontière humide de longueur positive avec ${a}.`);
      return;
    }
    if (b !== id) {
      resetResults();
      setB(id);
      removeCell(id);
    }
    setPairError('');
    if (id) inspect(id);
    setPicking(id ? undefined : 'b');
  }

  function selectOnMap(id: string) {
    if (!running.current && picking === 'a') chooseA(id);
    else if (!running.current && picking === 'b') chooseB(id);
    else if (!running.current && networkMode && pickingNetwork && networkCells.length < lakeNetworkSize.max && !networkCells.includes(id)) {
      addNetworkCell(id);
    }
    else inspect(id);
  }

  function addNetworkCell(id: string) {
    if (!id || !canExtendNetwork) return;
    if (!candidates.has(id)) {
      setNetworkError(`${id} ne partage pas de frontière humide de longueur positive avec le réseau.`);
      return;
    }
    resetResults();
    setNetworkError('');
    setNetworkCells([...networkCells, id]);
    setPickingNetwork(true);
    removeCell(id);
    inspect(id);
  }

  function undoNetworkCell() {
    const remaining = networkCells.slice(0, -1);
    const remainingEdges = availableEdges.filter(({ a, b }) => remaining.includes(a) && remaining.includes(b));
    const retainedEdges = remainingEdges.filter(edge => !excludedEdges.has(edgeKey(edge)));
    resetResults();
    setNetworkError('');
    setNetworkCells(remaining);
    setExcludedEdges(lakeNetworkConnected(remaining, retainedEdges)
      ? new Set(remainingEdges.map(edgeKey).filter(key => excludedEdges.has(key))) : new Set());
    setPickingNetwork(true);
    if (remaining.length) inspect(remaining.at(-1)!);
  }

  function toggleNetworkEdge(key: string, enabled: boolean) {
    const excluded = new Set(excludedEdges);
    if (enabled) excluded.delete(key);
    else excluded.add(key);
    resetResults();
    setExcludedEdges(excluded);
  }

  function removeCell(id: string) {
    setExtras(previous => previous.has(id) ? new Map([...previous].filter(([cell]) => cell !== id)) : previous);
  }

  function addCell(id: string) {
    setExtras(previous => {
      if (fixed.includes(id) || previous.has(id) || previous.size >= maxLakeComparisons) return previous;
      const color = lakeComparisonColors.find(candidate => ![...previous.values()].includes(candidate))!;
      return new Map(previous).set(id, color);
    });
  }

  async function run() {
    if (!plan || running.current || !ready) return;
    resetResults();
    const controller = new AbortController();
    const { signal } = controller;
    running.current = controller;
    setProgress({ done: 0 });
    try {
      const baseline = inputs.kind === 'homogeneous' ? plan : await configureLake(inputs, signal);
      const coupled = fullMode ? await configureLake(inputs, signal, { mode, mu })
        : networkMode ? await configureLake(inputs, signal, {
        cells: networkCells, edges: edges.map(({ a, b }) => [a, b] as const), mu,
      }) : exchangeEnabled ? await configureLake(inputs, signal, { a, b, mu }) : undefined;
      signal.throwIfAborted();
      const count = baseline.domain.batches.length + (coupled?.domain.batches.length ?? 0);
      const execute: Parameters<typeof runLakeBatches>[2] = request => runLakeBatch(request, signal);
      setProgress({ done: 0, count });
      const independent = await runLakeBatches(baseline.domain, baseline.reference, execute, {
        signal, onProgress: done => setProgress({ done, count }),
      });
      const exchanged = coupled && await runLakeBatches(coupled.domain, undefined, execute, {
        signal, onProgress: done => setProgress({ done: baseline.domain.batches.length + done, count }),
      });
      signal.throwIfAborted();
      setResults({
        baseline: lakeDataset(baseline.domain, independent),
        ...(coupled && exchanged && { exchanged: lakeDataset(coupled.domain, exchanged) }),
      });
      if (networkMode) setPickingNetwork(false);
      setTick(0);
    } catch (cause) {
      if (!signal.aborted) setFailure(errorText(cause));
    } finally {
      if (running.current === controller) {
        running.current = null;
        setProgress(undefined);
      }
    }
  }

  if (!visible) return null;
  const baseline = results?.baseline;
  const exchanged = results?.exchanged;
  const network = exchanged?.trace.network;
  const fullNetwork = exchanged?.trace.fullNetwork ?? fullTopology;
  const exchanges = (fullMode ? fullNetwork?.edges ?? [] : networkMode ? network?.edges ?? edges : frontier ? [{ a, b, frontier }] : [])
    .map(edge => lakeExchangeReading(edge, exchanged, exchanged?.trace.fullNetwork?.mu ?? network?.mu ?? exchanged?.trace.exchange?.mu ?? mu, tick));
  const visibleEdges = fullMode && incidentOnly ? exchanges.filter(edge => edge.a === selected || edge.b === selected) : exchanges;
  const arrows = fullMode && !showArrows ? [] : visibleEdges;
  const exchange = mode === 'pair' ? exchanges[0] : undefined;
  const direction = exchange && lakeExchangeDirection(exchange);
  const netFlows = networkMode || fullMode ? lakeNetworkNetFlows(exchanges) : undefined;
  const baselineTitle = fullMode ? 'A · Croissance logistique indépendante' : 'A · Sans échange';
  const exchangeTitle = `B · ${fullMode ? fullTitle : networkMode ? 'Réseau local' : 'Échange'} (μ = ${lakeAlpha(mu)} mois⁻¹)`;
  const timeControls = (label: string) => <div className={styles.exchangeTime}>
    <label>Mois simulé <strong data-exchange-time={time}>{lakeMonth.format(time)}</strong>
      <input type="range" aria-label={label} value={time} min={simulation?.start ?? 0} max={simulation?.end ?? 20}
        step={samplingInterval ?? 0.1} disabled={!baseline} aria-valuetext={`${lakeMonth.format(time)} mois`}
        onChange={event => { setPlaying(false); setTick(Math.round(Number(event.currentTarget.value) / samplingInterval!)); }} />
    </label>
    <div className={styles.playActions}>
      <button type="button" aria-label="Observation précédente" disabled={!baseline || tick === 0}
        onClick={() => { setPlaying(false); setTick(tick - 1); }}><StepBack size={16} aria-hidden="true" /></button>
      <button type="button" disabled={!baseline} onClick={() => {
        if (tick === end && !playing) setTick(0);
        setPlaying(!playing);
      }}>{playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{playing ? 'Pause' : 'Lire'}</button>
      <button type="button" aria-label="Observation suivante" disabled={!baseline || tick === end}
        onClick={() => { setPlaying(false); setTick(tick + 1); }}><StepForward size={16} aria-hidden="true" /></button>
      <button type="button" disabled={!baseline} onClick={() => { setPlaying(false); setTick(0); }}>
        <RotateCcw size={16} aria-hidden="true" /> Remettre au début
      </button>
      <label className={styles.dimensions}>Vitesse
        <select value={speed} onChange={event => {
          const next = lakePlaybackSpeeds.find(value => value === Number(event.currentTarget.value));
          if (next) setSpeed(next);
        }}>{lakePlaybackSpeeds.map(value => <option key={value} value={value}>×{value}</option>)}</select>
      </label>
    </div>
  </div>;
  const fullscreenControls = timeControls('Temps en plein écran');
  const commonMap = plan && {
    mesh: plan.mesh, cells: plan.domain.cells, reference: undefined, display: 'ratio' as const, limits, tick, time,
    selected, select: selectOnMap, view, setView, highlights: colors, workshop: false, initialKnown: !!baseline, neighbors: neighborIds,
    exchangeCells: exchangeEnabled && !fullMode ? fixed : undefined,
  };
  const snapshot: LakeViewSnapshot | undefined = plan && baseline ? {
    mesh: plan.mesh, cells: plan.domain.cells, display: 'ratio', limits, adaptive: false, tick, time, view, selected, highlights: colors,
    maps: [{ title: baselineTitle, dataset: baseline },
      ...(exchanged ? [{ title: exchangeTitle, dataset: exchanged, exchanges: arrows,
        ...(fullMode && { frontiers: visibleEdges }) }] : [])],
  } : undefined;

  return <section className={styles.lakeExperience} data-network={networkMode || undefined}
    data-full-network={fullMode || undefined} aria-label="Interactions spatiales">
    <p className={styles.lakeNotice}>{lakeSyntheticNotice}</p>
    <fieldset className={styles.exchangeSettings} disabled={!!progress}>
      <legend>Paramètres communs</legend>
      <div className={styles.lakeOptions}>
        <label className={styles.dimensions}>Résolution du lac
          <select value={resolution} disabled={fullMode} onChange={event => changeInputs({ ...inputs, resolution: event.currentTarget.value })}>
            {lakeExchangeResolutions.map(size => <option key={lakeResolutionId(size)} value={lakeResolutionId(size)}>
              {size.rows} × {size.columns}
            </option>)}
          </select>
        </label>
        <DistributionInputs inputs={inputs} applied={baseline ? inputs : undefined} label="Distribution biologique"
          profileLabel="Profil du gradient" intensityLabel="Intensité du gradient α"
          change={distribution => changeInputs({ ...distribution, resolution })} />
      </div>
      <div className={styles.lakeOptions}>
        <label className={styles.dimensions}>Échange de biomasse
          <select value={mode} onChange={event => {
            const next = event.currentTarget.value;
            if (next !== 'none' && next !== 'pair' && next !== 'network' && next !== 'full-network') return;
            if (next === 'full-network' && resolution !== lakeFullNetworkResolution) {
              changeInputs({ ...inputs, resolution: lakeFullNetworkResolution });
            } else resetResults();
            setMode(next);
            setPicking(next === 'pair' ? !a ? 'a' : !b ? 'b' : undefined : undefined);
            setPickingNetwork(true);
            setPairError('');
            setNetworkError('');
            setExtras(new Map());
          }}>
            <option value="none">Sans échange</option>
            <option value="pair">Échange entre deux cellules voisines</option>
            <option value="network">Réseau local de cellules connectées</option>
            <option value="full-network">{fullTitle}</option>
          </select>
        </label>
        {exchangeEnabled && <label className={styles.dimensions}>Intensité d’échange μ (mois⁻¹)
          <select value={mu} onChange={event => {
            const next = lakeExchangeIntensities.find(value => value === Number(event.currentTarget.value));
            if (next !== undefined) { resetResults(); setMu(next); }
          }}>
            {lakeExchangeIntensities.map(value => <option value={value} key={value}>{lakeAlpha(value)}</option>)}
          </select>
        </label>}
      </div>
      {exchangeEnabled && <p className={styles.coverage}>μ est une intensité expérimentale d’échange, sans calibration physique.</p>}
      {mode === 'pair' && <>
        <div className={styles.exchangePair}>
          <label className={styles.dimensions}>Cellule A
            <select value={a} disabled={!plan} onChange={event => chooseA(event.currentTarget.value)}>
              <option value="">Choisir</option>
              {plan?.domain.cells.map(cell => <option key={cell.id} value={cell.id}>{cell.id}</option>)}
            </select>
          </label>
          <button type="button" disabled={!plan} aria-pressed={picking === 'a'} onClick={() => { setPicking('a'); setPairError(''); }}>Choisir A sur la carte</button>
          <label className={styles.dimensions}>Cellule B
            <select value={b} disabled={!neighbors.size} onChange={event => chooseB(event.currentTarget.value)}>
              <option value="">Choisir</option>
              {[...neighbors.keys()].map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <button type="button" disabled={!neighbors.size} aria-pressed={picking === 'b'} onClick={() => { setPicking('b'); setPairError(''); }}>Choisir B sur la carte</button>
        </div>
        <p aria-live="polite" className={styles.coverage}>
          {picking === 'a' ? 'Sélectionnez la cellule A sur la carte.'
            : picking === 'b' ? neighbors.size ? 'Sélectionnez une voisine humide de A sur la carte.' : 'Cette cellule n’a pas de voisine humide. Choisissez une autre cellule A.'
              : frontier ? `Paire choisie · ${a} ↔ ${b}` : ''}
        </p>
        {pairError && <p role="alert" className={styles.error}>{pairError}</p>}
      </>}
      {networkMode && <>
        <div className={styles.exchangePair}>
          <label className={styles.dimensions}>Ajouter une cellule au réseau
            <select value="" disabled={!canExtendNetwork} onChange={event => addNetworkCell(event.currentTarget.value)}>
              <option value="">Choisir</option>
              {[...candidates].map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <button type="button" disabled={!canExtendNetwork} aria-pressed={pickingNetwork}
            onClick={() => { setPickingNetwork(!pickingNetwork); setNetworkError(''); }}>Ajouter sur la carte</button>
          <button type="button" disabled={!networkCells.length} onClick={undoNetworkCell}>Retirer la dernière cellule</button>
        </div>
        <p className={styles.coverage} aria-live="polite">
          {networkCells.length ? `${networkCells.length} / ${lakeNetworkSize.max} cellules · ${networkCells.join(' · ')}`
            : 'Choisissez une première cellule humide.'}
          {networkCells.length > 0 && networkCells.length < lakeNetworkSize.min && (canExtendNetwork
            ? ' Ajoutez des voisines humides pour relier trois cellules.' : ' Aucune voisine humide disponible.')}
        </p>
        {!!connectionChoices.length && <div className={styles.networkConnections} role="group" aria-label="Connexions du réseau">
          {connectionChoices.map(({ edge, key, checked, required }) => <label key={key}>
            <input type="checkbox" checked={checked} disabled={required} onChange={event => toggleNetworkEdge(key, event.currentTarget.checked)} />
            {edge.a} ↔ {edge.b}
          </label>)}
          <small>Les connexions nécessaires à la continuité du réseau restent cochées.</small>
        </div>}
        {networkError && <p role="alert" className={styles.error}>{networkError}</p>}
      </>}
    </fieldset>
    <div className={styles.runActions}>
      <span className={styles.status} role="status" data-phase={results ? 'completed' : progress ? 'running' : failure ? 'error' : 'idle'}>
        {results ? 'Terminé' : progress ? 'En cours' : failure ? 'Erreur' : 'Non lancé'}
      </span>
      {progress && <RunProgress progress={progress} cancel={resetResults} />}
      <button type="button" className="primary" disabled={!plan || !!progress || !ready}
        onClick={() => void run()}><Play size={16} aria-hidden="true" /> {exchangeEnabled ? 'Simuler les deux scénarios' : 'Simuler sans échange'}</button>
    </div>
    {planError && <p role="alert" className={styles.error}>Chargement du contour impossible · {planError} <button type="button"
      onClick={() => { setPlanError(''); setReload(value => value + 1); }}>Réessayer</button></p>}
    {!plan && !planError && <p role="status">Chargement du contour HydroLAKES…</p>}
    {failure && <p role="alert" className={styles.error}>Simulation impossible · {failure}</p>}
    {plan && commonMap && <>
      {timeControls('Temps simulé')}
      <SpatialFullscreen active={active} label="Cartes des scénarios"
        controls={<div className={styles.exchangeFullscreenTime}>{fullscreenControls}</div>} className={styles.exchangeMaps}>
        <div className={styles.lakeMode}>
          <p className={styles.coverage}>{lakeScenarioLabel(inputs)} · r = {lakeNumber.format(plan.domain.parameters.growth)} mois⁻¹</p>
          <LakeExport snapshot={snapshot} resolution={resolution} />
        </div>
        <LakeMapLegend display="ratio" limits={limits} adaptive={false} available={!!baseline} workshop={false} />
        {fullMode && <div className={styles.fullNetworkControls}>
          <label className={styles.dimensions}>Cellule consultée
            <select value={selected} onChange={event => inspect(event.currentTarget.value)}>
              {plan.domain.cells.map(cell => <option key={cell.id} value={cell.id}>{cell.id}</option>)}
            </select>
          </label>
          <label><input type="checkbox" checked={showArrows} onChange={event => setShowArrows(event.currentTarget.checked)} /> Flèches d’échange</label>
          <label><input type="checkbox" checked={incidentOnly} onChange={event => setIncidentOnly(event.currentTarget.checked)} /> Frontières de la cellule sélectionnée</label>
          {fullNetwork && <p className={styles.fullNetworkSummary} aria-live="polite">
            <strong data-full-cells={fullNetwork.cells.length}>{fullNetwork.cells.length} cellules humides</strong>
            {' · '}<strong data-full-edges={fullNetwork.edges.length}>{fullNetwork.edges.length} frontières actives</strong>
            {' · '}{fullNetwork.components.length === 1 ? '1 composante connexe' : `${fullNetwork.components.length} composantes connexes`}
          </p>}
        </div>}
        {direction && exchange?.flux !== undefined && <p className={styles.exchangeFlow}
          data-exchange-flux={exchange.flux} data-exchange-direction={direction}>
          <strong>{direction} · {formatSmall(Math.abs(exchange.flux))} t/mois</strong>
          <small>Flux reconstitué à partir des biomasses natives observées.</small>
        </p>}
        {networkMode && exchanged && <div className={styles.networkFlows} aria-label="Flux des connexions du réseau" role="group">
          <ul>{exchanges.map(edge => <li key={edgeKey(edge)}
            data-network-edge={edgeKey(edge)} data-exchange-flux={edge.flux} data-exchange-direction={lakeExchangeDirection(edge)}>
            <strong>{edge.flux ? lakeExchangeDirection(edge) : `${edge.a} ↔ ${edge.b}`}</strong>
            {' · '}{formatSmall(Math.abs(edge.flux!))} t/mois
          </li>)}</ul>
          <small>Flux reconstitués à partir des biomasses natives observées.</small>
        </div>}
        <div className={styles.lakeMaps} data-comparison={exchangeEnabled || undefined}>
          <LakeMapPane {...commonMap} title={baselineTitle} label="Carte sans échange" dataset={baseline} />
          {exchangeEnabled && <LakeMapPane {...commonMap} title={exchangeTitle} label="Carte avec échange" dataset={exchanged}
            exchanges={arrows} frontiers={fullMode ? visibleEdges : undefined} />}
        </div>
        {fullMode && baseline && exchanged && <FullNetworkReadings baseline={baseline} exchanged={exchanged}
          tick={tick} netFlows={netFlows!} />}
        {baseline && exchanged && <ExchangeReadings baseline={baseline} exchanged={exchanged}
          cells={fixed.map(id => baseline.cells.get(id)!)} tick={tick} netFlows={netFlows} />}
        {fullMode && exchanged && <div className={styles.networkFlows} aria-label="Flux aux frontières humides" role="group">
          <div className={styles.fullNetworkControls}>
            <strong>Flux aux frontières humides</strong>
            <label className={styles.dimensions}>Trier les flux
              <select value={flowSort} onChange={event => setFlowSort(event.currentTarget.value)}>
                <option value="absolute">Amplitude décroissante</option>
                <option value="topology">Identifiants des cellules</option>
              </select>
            </label>
          </div>
          <ul>{(flowSort === 'absolute' ? [...visibleEdges].sort((a, b) => Math.abs(b.flux!) - Math.abs(a.flux!)) : visibleEdges)
            .map(edge => <li key={edgeKey(edge)} data-network-edge={edgeKey(edge)} data-exchange-flux={edge.flux}>
              <strong>{edge.flux ? lakeExchangeDirection(edge) : `${edge.a} ↔ ${edge.b}`}</strong>
              {' · '}{formatSmall(Math.abs(edge.flux!))} t/mois
            </li>)}</ul>
          {!visibleEdges.length && <p>Aucune frontière humide pour {selected}.</p>}
          <small>Flux reconstitués à partir des biomasses natives observées.</small>
        </div>}
      </SpatialFullscreen>
      {baseline && <section className={styles.panel} aria-label="Résultats par cellule">
        <SpatialFullscreen active={active} label="Trajectoires des scénarios" controls={fullscreenControls}>
          <LakeTrajectoryPicker cells={plan.domain.cells} selected={selected} colors={colors} fixed={exchangeEnabled && !fullMode ? fixed : undefined}
            select={inspect} add={addCell} remove={removeCell} />
          {exchanged && <p className={styles.coverage}>{fullMode ? 'Tirets pour A, trait plein pour B.'
            : `${networkMode ? 'Cellules du réseau' : 'Paire sélectionnée'} · tirets pour A, trait plein pour B. Autres cellules · trajectoire commune.`}</p>}
          {active && simulation && <LakeTrajectoryChart curves={curves} tick={tick} time={time} start={simulation.start} end={simulation.end} />}
        </SpatialFullscreen>
      </section>}
    </>}
  </section>;
}

function FullNetworkReadings({ baseline, exchanged, tick, netFlows }: {
  baseline: LakeDataset; exchanged: LakeDataset; tick: number; netFlows: ReadonlyMap<string, number>;
}) {
  const totalA = baseline.totals[tick]!;
  const totalB = exchanged.totals[tick]!;
  const balance = [...netFlows.values()].reduce((sum, net) => sum + net, 0);
  const dispersionA = lakeDensityDispersion(baseline, tick);
  const dispersionB = lakeDensityDispersion(exchanged, tick);
  return <dl className={styles.domainMetrics} aria-label="Indicateurs du réseau complet">
    <div><dt>Biomasse totale A</dt><dd data-full-total-a={totalA}>{lakeTotalTonnes(totalA)}</dd></div>
    <div><dt>Biomasse totale B</dt><dd data-full-total-b={totalB}>{lakeTotalTonnes(totalB)}</dd></div>
    <div><dt>Écart B − A</dt><dd data-full-delta={totalB - totalA}>{lakeSignedTonnes(totalB - totalA)}</dd></div>
    <div><dt>Bilan instantané ΣFₙₑₜ</dt><dd data-full-balance={balance}>{formatSmall(balance)} t/mois</dd></div>
    <div><dt>Dispersion pondérée des densités A</dt><dd data-full-dispersion-a={dispersionA}>{formatSmall(dispersionA)} t²/km²</dd></div>
    <div><dt>Dispersion pondérée des densités B</dt><dd data-full-dispersion-b={dispersionB}>{formatSmall(dispersionB)} t²/km²</dd></div>
  </dl>;
}

function ExchangeReadings({ baseline, exchanged, cells, tick, netFlows }: {
  baseline: LakeDataset; exchanged: LakeDataset; cells: readonly LakeCell[]; tick: number; netFlows: ReadonlyMap<string, number> | undefined;
}) {
  return <div className={styles.lakeComparison}>
    <table>
      <caption>{netFlows ? 'Biomasse, densité et flux net du réseau' : 'Biomasse et densité de la paire sélectionnée'}</caption>
      <thead><tr>
        <th scope="col">Cellule et scénario</th><th scope="col">Biomasse</th><th scope="col">Densité</th>
        <th scope="col">Gain depuis le mois 0</th><th scope="col">Écart à A</th>
        {netFlows && <th scope="col">Flux net (t/mois)</th>}
      </tr></thead>
      <tbody>{cells.flatMap(cell => {
        const control = lakeReading(baseline, cell.id, tick)!.value;
        return ([['A', baseline], ['B', exchanged]] as const).map(([scenario, dataset]) => {
          const reading = lakeReading(dataset, cell.id, tick)!;
          const gain = reading.value - lakeReading(dataset, cell.id, 0)!.value;
          const net = netFlows && (scenario === 'A' ? 0 : netFlows.get(cell.id) ?? 0);
          return <tr key={cell.id + scenario} data-pair-cell={netFlows ? undefined : cell.id} data-pair-scenario={netFlows ? undefined : scenario}
            data-network-cell={netFlows ? cell.id : undefined} data-network-scenario={netFlows ? scenario : undefined}>
            <th scope="row">{cell.id} · {scenario}</th>
            <td data-pair-biomass={reading.value}>{lakeTonnes(reading.value)}</td>
            <td data-pair-density={reading.density}>{formatSmall(reading.density)} t/km²</td>
            <td data-pair-gain={gain}>{lakeSignedTonnes(gain)}</td>
            <td data-pair-delta={scenario === 'B' ? reading.value - control : undefined}>
              {scenario === 'B' ? lakeSignedTonnes(reading.value - control) : '—'}
            </td>
            {net !== undefined && <td data-network-net-flux={net}>{net > 0 ? '+' : ''}{formatSmall(net)}</td>}
          </tr>;
        });
      })}</tbody>
    </table>
  </div>;
}
