import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, StepBack, StepForward } from 'lucide-react';
import { errorText } from '@/lib/api/client';
import {
  lakeExchangeFlux, lakeExchangeIntensities, lakeExchangeResolutions, lakeResolutionId, lakeWetFrontier,
  runLakeBatch, runLakeBatches, samplingTimeline, type LakeExchangeIntensity, type LakePlan,
} from '@/lib/simulation/spatial-experiment';
import {
  configureLake, formatSmall, initialLakeView, lakeAlpha, lakeComparisonColors, lakeDataset, lakeDisplays,
  lakeExchangeDirection, lakeMonth, lakeNumber, lakePlaybackInterval, lakePlaybackSpeeds, lakePrimaryColor,
  lakeReading, lakeScenarioLabel, lakeSignedTonnes, lakeSyntheticNotice, lakeTonnes, type LakeCell, type LakeDataset,
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
const baselineTitle = 'A · Sans échange';
const limits = lakeDisplays.ratio.limits;

export function LogisticLakeInteractions({ visible, active }: { visible: boolean; active: boolean }) {
  const [inputs, setInputs] = useState(initialInputs);
  const { resolution } = inputs;
  const [plan, setPlan] = useState<LakePlan>();
  const [reload, setReload] = useState(0);
  const [planError, setPlanError] = useState('');
  const [exchangeEnabled, setExchangeEnabled] = useState(false);
  const [mu, setMu] = useState<LakeExchangeIntensity>(0.5);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [picking, setPicking] = useState<'a' | 'b'>();
  const [pairError, setPairError] = useState('');
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
  const frontier = exchangeEnabled ? neighbors.get(b) : undefined;
  const fixed = useMemo(() => exchangeEnabled ? [a, b].filter(Boolean) : [selected].filter(Boolean),
    [a, b, selected, exchangeEnabled]);
  const colors = useMemo(() => {
    const marks = new Map(fixed.map((id, index) => [id, index === 0 ? lakePrimaryColor : pairColor]));
    for (const [id, color] of extras) if (!marks.has(id)) marks.set(id, color);
    return marks;
  }, [extras, fixed]);
  const neighborIds = useMemo(() => picking === 'b' ? new Set(neighbors.keys()) : undefined, [neighbors, picking]);
  const curves = useMemo<LakeCurve[]>(() => {
    if (!results) return [];
    return [...colors].flatMap(([id, color]) => {
      const points = results.baseline.trajectories.get(id)!.samples;
      const changed = results.exchanged?.trajectories.get(id)?.samples;
      const selected = fixed.includes(id);
      if (!changed || !selected) return [{ name: id, points, color, selected }];
      return [
        { name: `${id} · B`, points: changed, color, selected },
        { name: `${id} · A`, points, color, selected, dashed: true },
      ];
    });
  }, [colors, fixed, results]);

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
    setPicking(exchangeEnabled ? 'a' : undefined);
    setExtras(new Map());
    setView(initialLakeView);
  }

  function inspect(id: string) {
    setSelected(id);
    if (!exchangeEnabled) removeCell(id);
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
    else inspect(id);
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
    if (!plan || running.current || (exchangeEnabled && !frontier)) return;
    resetResults();
    const controller = new AbortController();
    const { signal } = controller;
    running.current = controller;
    setProgress({ done: 0 });
    try {
      const baseline = inputs.kind === 'homogeneous' ? plan : await configureLake(inputs, signal);
      const coupled = exchangeEnabled ? await configureLake(inputs, signal, { a, b, mu }) : undefined;
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
  const parameters = exchanged?.trace.exchange;
  const readingA = lakeReading(exchanged, a, tick);
  const readingB = lakeReading(exchanged, b, tick);
  const exchange: LakeExchangeOverlay | undefined = frontier ? { a, b, frontier } : undefined;
  if (exchange && parameters && readingA && readingB) {
    exchange.flux = lakeExchangeFlux(parameters.mu, exchanged!.cells.get(a)!.area, exchanged!.cells.get(b)!.area,
      readingA.density, readingB.density);
  }
  const direction = exchange && lakeExchangeDirection(exchange);
  const exchangeTitle = `B · Échange (μ = ${lakeAlpha(mu)} mois⁻¹)`;
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
    pairCells: exchangeEnabled ? fixed : undefined,
  };
  const snapshot: LakeViewSnapshot | undefined = plan && baseline ? {
    mesh: plan.mesh, cells: plan.domain.cells, display: 'ratio', limits, adaptive: false, tick, time, view, selected, highlights: colors,
    maps: [{ title: baselineTitle, dataset: baseline },
      ...(exchanged && exchange ? [{ title: exchangeTitle, dataset: exchanged, exchange }] : [])],
  } : undefined;

  return <section className={styles.lakeExperience} aria-label="Interactions spatiales">
    <p className={styles.lakeNotice}>{lakeSyntheticNotice}</p>
    <fieldset className={styles.exchangeSettings} disabled={!!progress}>
      <legend>Paramètres communs</legend>
      <div className={styles.lakeOptions}>
        <label className={styles.dimensions}>Résolution du lac
          <select value={resolution} onChange={event => changeInputs({ ...inputs, resolution: event.currentTarget.value })}>
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
          <select value={exchangeEnabled ? 'pair' : 'none'} onChange={event => {
            const enabled = event.currentTarget.value === 'pair';
            resetResults();
            setExchangeEnabled(enabled);
            setPicking(enabled && !a ? 'a' : enabled && !b ? 'b' : undefined);
            setPairError('');
            setExtras(new Map());
          }}>
            <option value="none">Sans échange</option>
            <option value="pair">Échange entre deux cellules voisines</option>
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
      {exchangeEnabled && <>
        <p className={styles.coverage}>μ est une intensité expérimentale d’échange, sans calibration physique.</p>
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
    </fieldset>
    <div className={styles.runActions}>
      <span className={styles.status} role="status" data-phase={results ? 'completed' : progress ? 'running' : failure ? 'error' : 'idle'}>
        {results ? 'Terminé' : progress ? 'En cours' : failure ? 'Erreur' : 'Non lancé'}
      </span>
      {progress && <RunProgress progress={progress} cancel={resetResults} />}
      <button type="button" className="primary" disabled={!plan || !!progress || (exchangeEnabled && !frontier)}
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
        {direction && exchange?.flux !== undefined && <p className={styles.exchangeFlow}
          data-exchange-flux={exchange.flux} data-exchange-direction={direction}>
          <strong>{direction} · {formatSmall(Math.abs(exchange.flux))} t/mois</strong>
          <small>Flux reconstitué à partir des biomasses natives observées.</small>
        </p>}
        <div className={styles.lakeMaps} data-comparison={exchangeEnabled || undefined}>
          <LakeMapPane {...commonMap} title={baselineTitle} label="Carte sans échange" dataset={baseline} />
          {exchangeEnabled && <LakeMapPane {...commonMap} title={exchangeTitle} label="Carte avec échange" dataset={exchanged} exchange={exchange} />}
        </div>
        {baseline && exchanged && <PairReadings baseline={baseline} exchanged={exchanged}
          cells={[baseline.cells.get(a)!, baseline.cells.get(b)!]} tick={tick} />}
      </SpatialFullscreen>
      {baseline && <section className={styles.panel} aria-label="Résultats par cellule">
        <SpatialFullscreen active={active} label="Trajectoires des scénarios" controls={fullscreenControls}>
          <LakeTrajectoryPicker cells={plan.domain.cells} selected={selected} colors={colors} fixed={exchangeEnabled ? fixed : undefined}
            select={inspect} add={addCell} remove={removeCell} />
          {exchanged && <p className={styles.coverage}>Paire sélectionnée · tirets pour A, trait plein pour B. Autres cellules · trajectoire commune.</p>}
          {active && simulation && <LakeTrajectoryChart curves={curves} tick={tick} time={time} start={simulation.start} end={simulation.end} />}
        </SpatialFullscreen>
      </section>}
    </>}
  </section>;
}

function PairReadings({ baseline, exchanged, cells, tick }: {
  baseline: LakeDataset; exchanged: LakeDataset; cells: readonly LakeCell[]; tick: number;
}) {
  return <div className={styles.lakeComparison}>
    <table>
      <caption>Biomasse et densité de la paire sélectionnée</caption>
      <thead><tr>
        <th scope="col">Cellule et scénario</th><th scope="col">Biomasse</th><th scope="col">Densité</th>
        <th scope="col">Gain depuis le mois 0</th><th scope="col">Écart à A</th>
      </tr></thead>
      <tbody>{cells.flatMap(cell => {
        const control = lakeReading(baseline, cell.id, tick)!.value;
        return ([['A', baseline], ['B', exchanged]] as const).map(([scenario, dataset]) => {
          const reading = lakeReading(dataset, cell.id, tick)!;
          const gain = reading.value - lakeReading(dataset, cell.id, 0)!.value;
          return <tr key={cell.id + scenario} data-pair-cell={cell.id} data-pair-scenario={scenario}>
            <th scope="row">{cell.id} · {scenario}</th>
            <td data-pair-biomass={reading.value}>{lakeTonnes(reading.value)}</td>
            <td data-pair-density={reading.density}>{formatSmall(reading.density)} t/km²</td>
            <td data-pair-gain={gain}>{lakeSignedTonnes(gain)}</td>
            <td data-pair-delta={scenario === 'B' ? reading.value - control : undefined}>
              {scenario === 'B' ? lakeSignedTonnes(reading.value - control) : '—'}
            </td>
          </tr>;
        });
      })}</tbody>
    </table>
  </div>;
}
