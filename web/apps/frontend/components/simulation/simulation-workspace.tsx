'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Fish, Pause, Play, RotateCcw, Waves } from 'lucide-react';
import type { RunRequest } from '@contracts';
import type { HttpResult } from '@/lib/api/client';
import { ResultsPanel } from '@/components/panels/results-panel';
import { applyMapping, catchIncrement, classifyBiomassStatus, modelUnit, normalizeRun, observationAt, statusInfo, trendAt, type AlertConfig, type Mapping, type Trajectory } from '@/lib/simulation/trajectory';

const Chart = dynamic(() => import('./workshop-chart'), { ssr: false, loading: () => <p>Chargement du graphique…</p> });
const fmt = (value?: number) => value !== undefined && Number.isFinite(value) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) : 'Indisponible';
const defaultConfig: AlertConfig = { proximityRatio: 0.2, slopeTolerance: 0 };

export function SimulationWorkspace({ result, request, stale, status, error, active }: { result?: HttpResult; request?: RunRequest; stale: boolean; status: string; error?: string; active: boolean }) {
  const runs = useMemo(() => result && request ? normalizeRun(result, request) : [], [result, request]);
  const [selection, setSelection] = useState('');
  const run = runs.find(r => r.id === selection) ?? runs.find(r => r.series.some(s => s.kind === 'biomass_total')) ?? runs[0];
  const [audience, setAudience] = useState('fisher');
  useEffect(() => { try { if (localStorage.getItem('irritator-audience') === 'scientific') setAudience('scientific'); } catch { /* Optional preference. */ } }, []);
  const chooseAudience = (value: string) => { setAudience(value); try { localStorage.setItem('irritator-audience', value); } catch { /* Optional preference. */ } };
  return <section className="simulation-workspace" hidden={!active} aria-label="Espace Simulation">
    <div className="workshop-heading"><div><span className="workshop-eyebrow">ATELIER PARTICIPATIF · PÊCHERIE DU LAC DE GUIERS</span><h1>Que devient la quantité de poissons dans le lac ?</h1><p>Explorer une situation simulée, prendre le temps d’en discuter.</p></div><span className="run-badge">{result ? 'SORTIES DU MOTEUR' : 'EN ATTENTE D’UNE EXÉCUTION'}</span></div>
    <div className="workshop-selection"><label>Situation simulée<select aria-label="Situation simulée" disabled={!runs.length} value={run?.id ?? ''} onChange={e => setSelection(e.target.value)}>{!runs.length && <option value="">Aucune trajectoire disponible</option>}{runs.map(r => <option key={r.id} value={r.id}>{r.label}{r.status !== 'completed' ? ` · ${r.status}` : ''}</option>)}</select></label><div className="audience-toggle" role="group" aria-label="Public de la lecture"><button aria-pressed={audience === 'fisher'} onClick={() => chooseAudience('fisher')}>Lecture pêcheur</button><button aria-pressed={audience === 'scientific'} onClick={() => chooseAudience('scientific')}>Scientifique</button></div></div>
    {error && <p className="error-banner" role="alert">{error}{result ? ' · L’exécution précédente reste affichée.' : ''}</p>}
    {(status === 'Validation' || status === 'Exécution') && <p className="notice" role="status">Calcul en cours dans Irritator… {result ? 'Les données affichées sont celles de l’exécution précédente.' : ''}</p>}
    {stale && result && <p className="stale-banner" role="status">Modèle modifié : les résultats affichés proviennent de l’exécution précédente.</p>}
    {!result ? <div className="workshop-empty"><Waves size={42} /><h2>Aucune simulation pour le moment</h2><p>Ouvrez votre modèle dans Modélisation, sélectionnez ses observations, puis lancez la simulation.</p><p>Aucune donnée de démonstration n’est substituée aux sorties du moteur.</p></div> : <>
      {run ? <Playback key={`${result.runId}:${run.id}`} run={run} active={active && status !== 'Exécution' && status !== 'Validation'} fisher={audience === 'fisher'} scientific={<ResultsPanel result={result} request={request} stale={false} status={status} />} /> : <><p hidden={audience !== 'fisher'} className="workshop-empty">Cette exécution ne contient aucune observation de trajectoire. Activez les observateurs dans le constructeur, ou consultez les décisions et événements dans la lecture Scientifique.</p><div className="scientific-workspace" hidden={audience !== 'scientific'}><ResultsPanel result={result} request={request} stale={false} status={status} /></div></>}
    </>}
  </section>;
}

function Playback({ run: original, active, fisher, scientific }: { run: Trajectory; active: boolean; fisher: boolean; scientific: React.ReactNode }) {
  const [mapping, setMapping] = useState<Mapping>();
  const run = useMemo(() => applyMapping(original, mapping), [original, mapping]);
  const [config, setConfig] = useState<AlertConfig>(defaultConfig);
  const biomass = run.series.find(s => s.kind === 'biomass_total');
  const capture = run.series.find(s => s.kind === 'catch_cumulative') ?? run.series.find(s => s.kind.startsWith('catch_'));
  const timeline = biomass?.points ?? capture?.points ?? run.series[0]?.points ?? [];
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [reduced, setReduced] = useState(false);
  const [sound, setSound] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [configError, setConfigError] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const previousStatus = useRef('unknown');
  const silentMove = useRef(true);
  const selectedIndex = Math.min(index, Math.max(0, timeline.length - 1));
  const point = timeline[selectedIndex];
  const time = point?.time;
  const value = biomass?.points[selectedIndex]?.value;
  const trend = biomass ? trendAt(biomass.points, selectedIndex) : undefined;
  const statuses = useMemo(() => biomass?.points.map((p, i) => classifyBiomassStatus(p.value, trendAt(biomass.points, i), config)) ?? [], [biomass, config]);
  const state = statuses[selectedIndex] ?? 'unknown';
  const info = statusInfo[state];
  const caught = capture ? observationAt(capture.points, time) : undefined;
  const increment = capture?.kind === 'catch_cumulative' && caught ? catchIncrement(capture.points, caught.index) : undefined;
  const periodic = capture?.kind === 'catch_cumulative' ? increment : caught?.point.value;
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(media.matches);
    change(); media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => () => { void audio.current?.close(); }, []);
  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => {
    if (!playing || !active || selectedIndex >= timeline.length - 1) return;
    const duration = (timeline.at(-1)?.time ?? 0) - (timeline[0]?.time ?? 0);
    const delta = timeline[selectedIndex + 1]!.time - timeline[selectedIndex]!.time;
    // Presentation duration of ~20 seconds at 1x, proportional to recorded time gaps.
    const delay = Math.max(24, duration > 0 ? delta / duration * 20000 / speed : 250 / speed);
    const timer = setTimeout(() => { silentMove.current = false; setIndex(i => i + 1); if (selectedIndex + 1 === timeline.length - 1) setPlaying(false); }, delay);
    return () => clearTimeout(timer);
  }, [playing, active, selectedIndex, timeline, speed]);
  useEffect(() => {
    const entered = state !== previousStatus.current;
    previousStatus.current = state;
    if (silentMove.current) { silentMove.current = false; return; }
    if (!entered || !active || !sound || !['near_threshold', 'critical_crossed'].includes(state)) return;
    const ctx = audio.current;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain(); oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.frequency.value = state === 'critical_crossed' ? 440 : 660;
      gain.gain.setValueAtTime(0.025, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      oscillator.start(); oscillator.stop(ctx.currentTime + 0.2);
    } catch { setAudioError('Audio indisponible ; les alertes visuelles restent actives.'); setSound(false); }
  }, [state, selectedIndex, config, playing, active, sound]);
  const enableAudio = async (enabled: boolean) => {
    if (!enabled) { setSound(false); return; }
    try { const ctx = audio.current ?? new AudioContext(); audio.current = ctx; await ctx.resume(); if (ctx.state !== 'running') throw new Error(); silentMove.current = true; setSound(true); setAudioError(''); }
    catch { setAudioError('Le navigateur ne permet pas le son. Les alertes visuelles restent actives.'); setSound(false); }
  };
  const move = (next: number) => { silentMove.current = true; setPlaying(false); setIndex(next); };
  const changeConfig = (patch: Partial<AlertConfig>) => {
    const next = { ...config, ...patch };
    if (!Number.isFinite(next.proximityRatio) || !Number.isFinite(next.slopeTolerance) || (next.bCrit !== undefined && !Number.isFinite(next.bCrit * (1 + next.proximityRatio)))) {
      setConfigError('Saisir des réglages finis et compatibles avec l’échelle des observations.'); return;
    }
    setConfigError(''); silentMove.current = true; setConfig(next);
  };
  const captureTitle = capture?.kind === 'catch_rate' ? 'Débit de capture observé' : capture?.kind === 'catch_interval' ? 'Quantité pêchée par intervalle' : 'Quantité totale pêchée depuis le début';
  const accessible = run.parameters.a !== undefined && run.parameters.a >= 0 && run.parameters.a <= 1 && value !== undefined ? run.parameters.a * value : undefined;
  return <>
    {run.status !== 'completed' && <p className="stale-banner" role="status">Résultats partiels ou indisponibles ({run.status}). La lecture s’arrête au dernier point effectivement fourni.</p>}
    {run.warnings.map(w => <p key={w} className="stale-banner" role="status">{w}</p>)}
    {configError && <p className="error-banner" role="alert">{configError}</p>}
    <div hidden={!fisher}>
      <div className={`qualitative-banner status-${state}${playing && active ? ' is-reading' : ''}`}><span className="status-symbol" aria-hidden="true">{info.icon}</span><div role="status" aria-live="polite" aria-atomic="true"><span className="workshop-eyebrow">ÉTAT DE LA PÊCHERIE SIMULÉE</span><h2>{info.title}</h2><p>{info.explanation}</p></div><span className="banner-time">t = {fmt(time)}</span></div>
      <div className="workshop-metrics"><Metric label="Poissons dans tout le lac · biomasse totale" value={fmt(value)} unit={biomass?.unit ?? modelUnit} /><Metric label="Évolution entre deux observations · ΔB/Δt" value={fmt(trend)} unit={`${biomass?.unit ?? modelUnit} / ${run.timeUnit}`} /><Metric label={capture?.kind === 'catch_rate' ? 'Débit de capture' : 'Pêche sur la dernière période observée'} value={fmt(periodic)} unit={capture ? capture.kind === 'catch_rate' ? `${capture.unit} / ${run.timeUnit}` : capture.unit : modelUnit} /></div>
      <div className="workshop-main-grid"><article className="workshop-card biomass-card"><h2>Comment évolue la quantité de poissons dans tout le lac ?</h2><p>Le curseur suit les observations enregistrées. Les marches sont un guide visuel, sans interpolation.</p>{biomass?.points.length ? <Chart series={biomass} timeUnit={run.timeUnit} index={selectedIndex} time={time} statuses={statuses} config={config} biomass /> : <p className="unavailable">Biomasse non disponible pour cette exécution. Vérifiez les observateurs et leur correspondance ci-dessous.</p>}<div className="status-legend" aria-label="Légende des états">{Object.entries(statusInfo).map(([key, s]) => <span key={key}><i style={{ background: s.color }} />{s.title.toLocaleLowerCase('fr-FR')}</span>)}</div>{config.bCrit !== undefined && <p>Seuil choisi pour l’atelier : {fmt(config.bCrit)} {biomass?.unit ?? modelUnit} · marge {fmt(config.proximityRatio * 100)} %. Convention pédagogique, sans validation écologique.</p>}</article>
        <article className="workshop-card"><h2>Le lac en mouvement</h2><p>Une représentation symbolique pour accompagner la discussion.</p><div className={`lake-illustration status-${state}${playing && active && !reduced ? ' moving' : ''}`} aria-hidden="true"><div className="lake-ripple" />{Array.from({ length: 12 }, (_, i) => <Fish key={i} size={22 + i % 3 * 5} style={{ left: `${8 + (i * 29) % 80}%`, top: `${25 + (i * 17) % 45}%`, animationDelay: `${-i * 0.7}s` }} />)}</div><p className="illustration-note">Visualisation illustrative, non proportionnelle au nombre réel de poissons.</p>{accessible !== undefined && <div className="accessibility-note"><strong>Accessibilité : {fmt(run.parameters.a! * 100)} %</strong><p>{fmt(accessible)} {biomass?.unit} accessibles dans la convention du modèle.</p><p>Fraction de la biomasse totale du lac ; aucun stock autonome par zone.</p></div>}</article>
      </div>
      <div className="workshop-secondary-grid"><article className="workshop-card"><h2>{captureTitle}</h2><p>{capture?.kind === 'catch_rate' ? 'Débit fourni par le moteur, sans intégration ni conversion en capture annuelle.' : 'Les observations gardent leur unité et leur période d’origine.'}</p>{capture?.points.length ? <Chart series={capture} timeUnit={run.timeUnit} index={selectedIndex} time={time} statuses={statuses} config={config} /> : <p className="unavailable">Capture non disponible : activez l’observation C dans le modèle ou le wrapper, puis relancez.</p>}<p>À t = {fmt(time)} : {fmt(caught?.point.value)} {capture?.unit ?? modelUnit}{capture?.kind === 'catch_rate' ? ` / ${run.timeUnit}` : ''}.</p>{increment !== undefined && caught && <p>ΔC = {fmt(increment)} sur [{fmt(capture!.points[caught.index - 1]?.time)} ; {fmt(time)}], en temps du modèle. Ce n’est pas une capture annuelle.</p>}</article><article className="workshop-card explanation"><h2>Ce que raconte la simulation</h2><p>{info.explanation}</p><p>{trend === undefined ? 'La tendance n’est pas déterminée à cet instant.' : trend < -config.slopeTolerance ? 'Entre les deux dernières observations, la quantité de poissons diminue.' : 'Entre les deux dernières observations, la quantité de poissons augmente ou reste stable.'}</p><p>Ces résultats simulés dépendent des hypothèses biologiques et de l’effort de pêche du scénario. Ils ne constituent pas une prévision certaine de l’état réel du lac.</p><aside>Les couleurs décrivent un seuil choisi pour l’atelier. Elles aident à discuter des hypothèses avec les participants.</aside></article></div>
    </div>
    <div className="scientific-workspace" hidden={fisher}>{scientific}<p className="scientific-cursor">Curseur commun : t = {fmt(time)} ({run.timeUnit}) · observation {selectedIndex + 1}/{timeline.length} · B = {fmt(value)} · C/débit = {fmt(caught?.point.value)}. Les graphiques scientifiques complets conservent toutes les sorties.</p></div>
    <div className="timeline-player" aria-label="Lecture des observations"><div className="timeline-buttons"><button className="primary" disabled={timeline.length < 2} onClick={() => { if (selectedIndex === timeline.length - 1) move(0); setPlaying(p => !p); }}>{playing && active ? <Pause size={16} /> : <Play size={16} />}{playing && active ? 'Pause' : selectedIndex > 0 && selectedIndex < timeline.length - 1 ? 'Reprendre' : 'Lancer l’animation'}</button><button disabled={!timeline.length} onClick={() => move(0)}><RotateCcw size={16} />Recommencer</button><output aria-label="Temps courant" aria-live="off">t = {fmt(time)} / {fmt(timeline.at(-1)?.time)} ({run.timeUnit})</output></div><label className="timeline-slider">Parcourir le temps simulé<input aria-label="Position temporelle" type="range" min={0} max={Math.max(0, timeline.length - 1)} value={selectedIndex} disabled={!timeline.length} aria-valuetext={`Observation ${selectedIndex + 1}, temps ${fmt(time)} ${run.timeUnit}, biomasse ${fmt(value)}`} onChange={e => move(Number(e.target.value))} /></label><div className="timeline-settings"><label><input type="checkbox" checked={sound} onChange={e => void enableAudio(e.target.checked)} /> Son des alertes</label><label>Vitesse<select aria-label="Vitesse de lecture" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[0.5, 1, 2, 4].map(v => <option key={v} value={v}>{String(v).replace('.', ',')}×</option>)}</select></label><label><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /> Mouvement réduit</label><label>Seuil choisi pour l’atelier<input aria-label="Seuil choisi pour l’atelier" type="number" min="0" step="any" placeholder="Non défini" value={config.bCrit ?? ''} onChange={e => { const n = e.target.value === '' ? undefined : Number(e.target.value); changeConfig({ bCrit: n !== undefined && n > 0 && Number.isFinite(n) ? n : undefined }); }} /></label><label>Marge (%)<input aria-label="Marge de proximité (%)" type="number" min="0" step="any" value={config.proximityRatio * 100} onChange={e => changeConfig({ proximityRatio: Math.max(0, Number(e.target.value) || 0) / 100 })} /></label></div><p>Lecture des sorties enregistrées uniquement · aucun recalcul du moteur · son bref et facultatif à l’entrée en orange ou rouge pendant la lecture.</p>{audioError && <p role="status">{audioError}</p>}</div>
    <details className="workshop-hypotheses"><summary>Comprendre les hypothèses, les unités et les observateurs</summary><p>Exécution réelle : <code>{run.runId}</code> · modèle {run.model} · {run.label} · moteur/adaptateur {run.provenance}.</p><p>Unités physiques, date d’exécution et origine calendaire non fournies par le contrat actuel. Aucune conversion en tonnes ou en années n’est appliquée. N désigne le stock global dans le graphe Schaefer reconnu ; sa dimension physique reste à valider.</p><p>Dans le graphe Schaefer livré : dN/dt = rN(1 − N/K) − qaEN ; dC/dt = qaEN. Les coefficients a et q sont déjà pris en compte par le moteur. Le frontend ne recalcule pas la pêche.</p><p>Paramètres du scénario : {Object.entries(run.parameters).map(([k, v]) => `${k} = ${fmt(v)}`).join(' ; ') || 'non disponibles'}. Tolérance de pente : {fmt(config.slopeTolerance)} (variation observée divisée par Δt ; aucune hystérésis).</p><label>Tolérance de pente<input aria-label="Tolérance de pente" type="number" min="0" step="any" value={config.slopeTolerance} onChange={e => changeConfig({ slopeTolerance: Math.max(0, Number(e.target.value) || 0) })} /></label><p>La correspondance automatique vérifie les types, les connexions et les signes du graphe Schaefer fourni. Pour un autre modèle, confirmez explicitement la sémantique des observateurs. La correspondance reste une convention de cet affichage.</p><div className="mapping-fields"><label>Biomasse totale du lac<select aria-label="Observateur de biomasse totale" value={biomass?.id ?? ''} onChange={e => { move(0); setMapping({ biomass: e.target.value || undefined, capture: capture?.id, captureKind: capture?.kind as Mapping['captureKind'] }); }}><option value="">Non disponible</option>{run.series.map(s => <option key={s.id} value={s.id} disabled={s.id === capture?.id}>{s.id}</option>)}</select></label><label>Capture<select aria-label="Observateur de capture" value={capture?.id ?? ''} onChange={e => { move(0); setMapping({ biomass: biomass?.id, capture: e.target.value || undefined, captureKind: capture?.kind as Mapping['captureKind'] }); }}><option value="">Non disponible</option>{run.series.map(s => <option key={s.id} value={s.id} disabled={s.id === biomass?.id}>{s.id}</option>)}</select></label><label>Nature de la capture<select aria-label="Nature de la capture" value={capture?.kind ?? 'catch_cumulative'} onChange={e => { move(0); setMapping({ biomass: biomass?.id, capture: capture?.id, captureKind: e.target.value as Mapping['captureKind'] }); }}><option value="catch_cumulative">Cumul C(t)</option><option value="catch_rate">Débit H(t)</option><option value="catch_interval">Capture par intervalle</option></select></label></div><p>{run.series.map(s => `${s.id} → ${s.kind} (${s.unit})`).join(' ; ')}</p></details>
  </>;
}
function Metric({ label, value, unit }: { label: string; value: string; unit: string }) { return <article className="metric-card"><h2>{label}</h2><p><strong>{value}</strong> <span>{unit}</span></p></article>; }
