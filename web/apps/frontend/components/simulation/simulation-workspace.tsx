'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, Play, RotateCcw, VolumeX, Waves } from 'lucide-react';
import type { RunRequest } from '@contracts';
import type { HttpResult } from '@/lib/api/client';
import { ResultsPanel } from '@/components/panels/results-panel';
import { applyMapping, classifyBiomassStatus, modelUnit, normalizeRun, observationAt, statusInfo, trendAt, type AlertConfig, type Mapping, type Trajectory } from '@/lib/simulation/trajectory';
import { rollingCatch, scenarioLabel } from '@/lib/simulation/indicators';
import { AlertAudio } from '@/lib/simulation/alert-audio';
import { BiomassLake } from './biomass-lake';
import { ResourceGauge } from './resource-gauge';

const Chart = dynamic(() => import('./workshop-chart'), { ssr: false, loading: () => <p>Chargement du graphique…</p> });
const fmt = (value?: number) => value !== undefined && Number.isFinite(value) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) : 'Non disponible';
const defaultConfig: AlertConfig = { proximityRatio: .2, slopeTolerance: 0 };

export function SimulationWorkspace({ result, request, stale, status, error, active }: { result?: HttpResult; request?: RunRequest; stale: boolean; status: string; error?: string; active: boolean }) {
  const runs = useMemo(() => result && request ? normalizeRun(result, request) : [], [result, request]);
  const [selection, setSelection] = useState('');
  const run = runs.find(r => r.id === selection) ?? runs.find(r => r.series.some(s => s.kind === 'biomass_total')) ?? runs[0];
  const [audience, setAudience] = useState('fisher');
  const [presentation, setPresentation] = useState(false);
  const [fullscreenNote, setFullscreenNote] = useState('');
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if(!presentation)return;
    const items=section.current?.closest('.workbench')?.querySelectorAll<HTMLElement>(':scope > .app-header, :scope > .workspace-navigation, :scope > .app-footer');
    const previous=Array.from(items??[]).map(el=>({el,inert:el.inert}));previous.forEach(({el})=>{el.inert=true;});
    return()=>previous.forEach(({el,inert})=>{el.inert=inert;});
  },[presentation]);
  useEffect(() => { try { if (localStorage.getItem('irritator-audience') === 'scientific') setAudience('scientific'); } catch { /* Optional preference. */ } }, []);
  const chooseAudience = (value: string) => { setAudience(value); try { localStorage.setItem('irritator-audience', value); } catch { /* Optional preference. */ } };
  useEffect(() => {
    const fullscreen = () => { if (!document.fullscreenElement) setPresentation(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPresentation(false); if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{}); } };
    document.addEventListener('fullscreenchange',fullscreen);document.addEventListener('keydown',key);
    return () => { document.removeEventListener('fullscreenchange',fullscreen);document.removeEventListener('keydown',key); };
  }, []);
  useEffect(() => { if (!active) { setPresentation(false); if (document.fullscreenElement===section.current)void document.exitFullscreen().catch(()=>{}); } }, [active]);
  const togglePresentation = async () => {
    if (presentation) { setPresentation(false);if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});return; }
    setPresentation(true);setFullscreenNote('');
    try { if(!section.current?.requestFullscreen)throw new Error();await section.current.requestFullscreen(); }
    catch { setFullscreenNote('Présentation dans la fenêtre · Échap pour revenir.'); }
  };
  return <section ref={section} className={`simulation-workspace${presentation ? ' presentation-mode' : ''}`} hidden={!active} aria-label="Espace Simulation">
    <div className="workshop-topline"><div className="workshop-heading"><span className="workshop-eyebrow">LAC DE GUIERS · ATELIER</span><h1>La ressource au fil du temps</h1><span className="run-badge">{result ? 'SORTIES DU MOTEUR' : 'EN ATTENTE'}</span></div>
      <label className="scenario-picker">Situation simulée<select aria-label="Situation simulée" disabled={!runs.length} value={run?.id ?? ''} onChange={e => setSelection(e.target.value)}>{!runs.length && <option value="">Aucune trajectoire disponible</option>}{runs.map(r => <option key={r.id} value={r.id}>{scenarioLabel(r,runs,audience==='fisher')}{r.status !== 'completed' ? ` · ${r.status}` : ''}</option>)}</select></label>
      <div className="audience-toggle" role="group" aria-label="Public de la lecture"><button aria-pressed={audience==='fisher'} onClick={()=>chooseAudience('fisher')}>Lecture pêcheur</button><button aria-pressed={audience==='scientific'} onClick={()=>chooseAudience('scientific')}>Scientifique</button></div>
      <button className="presentation-button" aria-pressed={presentation} onClick={()=>void togglePresentation()}>{presentation?<Minimize size={16}/>:<Maximize size={16}/>} {presentation?'Quitter le grand écran':'Grand écran'}</button>
    </div>
    {fullscreenNote && presentation && <p className="fullscreen-note" role="status">{fullscreenNote}</p>}
    {error && <p className="error-banner" role="alert">{error}{result?' · L’exécution précédente reste affichée.':''}</p>}
    {(status==='Validation'||status==='Exécution') && <p className="notice" role="status">Calcul en cours dans Irritator… {result?'Les données affichées sont celles de l’exécution précédente.':''}</p>}
    {stale && result && <p className="stale-banner" role="status">Modèle modifié : les résultats affichés proviennent de l’exécution précédente.</p>}
    {!result ? <div className="workshop-empty"><Waves size={42}/><h2>Aucune simulation pour le moment</h2><p>Ouvrez votre modèle dans Modélisation, sélectionnez ses observations, puis lancez la simulation.</p><p>Aucune donnée de démonstration n’est substituée aux sorties du moteur.</p></div> : run ? <Playback key={`${result.runId}:${run.id}`} run={run} active={active && status!=='Exécution' && status!=='Validation'} fisher={audience==='fisher'} scientific={<ResultsPanel result={result} request={request} stale={false} status={status}/>} /> : <><p hidden={audience!=='fisher'} className="workshop-empty">Cette exécution ne contient aucune observation de trajectoire. Activez les observateurs dans le constructeur, ou consultez les décisions et événements dans la lecture Scientifique.</p><div className="scientific-workspace" hidden={audience!=='scientific'}><ResultsPanel result={result} request={request} stale={false} status={status}/></div></>}
  </section>;
}

function Playback({ run: original, active, fisher, scientific }: { run: Trajectory; active: boolean; fisher: boolean; scientific: React.ReactNode }) {
  const [mapping,setMapping]=useState<Mapping>();
  const run=useMemo(()=>applyMapping(original,mapping),[original,mapping]);
  const [config,setConfig]=useState<AlertConfig>(defaultConfig);
  const biomass=run.series.find(s=>s.kind==='biomass_total');
  const capture=run.series.find(s=>s.kind==='catch_cumulative')??run.series.find(s=>s.kind.startsWith('catch_'));
  const timeline=biomass?.points??capture?.points??run.series[0]?.points??[];
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const [systemReduced,setSystemReduced]=useState(false),[manualReduced,setManualReduced]=useState(false);
  const reduced=systemReduced||manualReduced;
  const [sound,setSound]=useState(false),[volume,setVolume]=useState(.25),[yellowSound,setYellowSound]=useState(false);
  const [audioError,setAudioError]=useState(''),[configError,setConfigError]=useState('');
  const audio=useRef<AlertAudio|null>(null),mounted=useRef(true),previousStatus=useRef('unknown'),activation=useRef(0),wasAudible=useRef(false);
  const selectedIndex=Math.min(index,Math.max(0,timeline.length-1));
  const time=timeline[selectedIndex]?.time;
  const rawValue=biomass?.points[selectedIndex]?.value;
  const value=rawValue!==undefined&&Number.isFinite(rawValue)?rawValue:undefined;
  const trend=biomass?trendAt(biomass.points,selectedIndex):undefined;
  const statuses=useMemo(()=>biomass?.points.map((p,i)=>classifyBiomassStatus(p.value,trendAt(biomass.points,i),config))??[],[biomass,config]);
  const state=statuses[selectedIndex]??'unknown',info=statusInfo[state];
  const caught=capture?observationAt(capture.points,time):undefined;
  const cumulative=capture?.kind==='catch_cumulative'?caught?.point.value:undefined;
  const rolling=capture?.kind==='catch_cumulative' && time!==undefined ? rollingCatch(capture.points,time,run.units?.time):{ value:undefined,reason:'Observateur de capture cumulée requis' };
  const unit=biomass?.unit??modelUnit;
  const massUnit=capture?.kind==='catch_cumulative'?capture.unit:modelUnit;
  const maximum=useMemo(()=>Math.ceil(biomass?.points.reduce((n,p)=>Number.isFinite(p.value)?Math.max(n,p.value):n,0)??0),[biomass]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setSystemReduced(media.matches);
    change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);
  },[]);
  useEffect(()=>{ mounted.current=true;return()=>{mounted.current=false;activation.current++;void audio.current?.close();}; },[]);
  useEffect(()=>{ if(!active){audio.current?.stop();setPlaying(false);} },[active]);
  useEffect(()=>{ const hidden=()=>{if(document.hidden){audio.current?.stop();setPlaying(false);}};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden); },[]);
  useEffect(()=>{
    if(!playing||!active||selectedIndex>=timeline.length-1)return;
    const duration=(timeline.at(-1)?.time??0)-(timeline[0]?.time??0),delta=timeline[selectedIndex+1]!.time-timeline[selectedIndex]!.time;
    const timer=setTimeout(()=>{setIndex(i=>i+1);if(selectedIndex+1===timeline.length-1)setPlaying(false);},Math.max(24,duration>0?delta/duration*20000/speed:250/speed));
    return()=>clearTimeout(timer);
  },[playing,active,selectedIndex,timeline,speed]);
  useEffect(()=>{
    const entered=state!==previousStatus.current;previousStatus.current=state;
    const eligible=sound&&playing&&active&&!document.hidden,started=eligible&&!wasAudible.current;wasAudible.current=eligible;
    audio.current?.stop();
    if(!eligible)return;
    if(state==='critical_crossed'||((entered||started)&&state==='near_threshold')||(entered&&state==='declining'&&yellowSound)) {
      try { audio.current?.start(state,volume); } catch { setAudioError('Audio indisponible ; les alertes visuelles restent actives.');setSound(false); }
    }
    return()=>audio.current?.stop();
    // Gain changes are applied separately, without restarting the alarm.
  },[state,playing,active,sound,yellowSound]);
  useEffect(()=>audio.current?.volume(volume),[volume]);
  const enableAudio=async(enabled:boolean)=>{
    const token=++activation.current;
    if(!enabled){audio.current?.stop();setSound(false);return;}
    try { const player=audio.current??new AlertAudio(new AudioContext());audio.current=player;await player.context.resume();if(player.context.state!=='running')throw new Error();if(mounted.current&&activation.current===token){setSound(true);setAudioError('');} }
    catch { if(mounted.current&&activation.current===token){setAudioError('Le navigateur ne permet pas le son. Les alertes visuelles restent actives.');setSound(false);} }
  };
  const move=(next:number)=>{audio.current?.stop();setPlaying(false);setIndex(next);};
  const changeConfig=(patch:Partial<AlertConfig>)=>{
    const next={...config,...patch};
    if(!Number.isFinite(next.proximityRatio)||!Number.isFinite(next.slopeTolerance)||(next.bCrit!==undefined&&!Number.isFinite(next.bCrit*(1+next.proximityRatio)))){setConfigError('Saisir des réglages finis et compatibles avec l’échelle des observations.');return;}
    setConfigError('');setConfig(next);
  };
  const accessible=run.parameters.a!==undefined&&run.parameters.a>=0&&run.parameters.a<=1&&value!==undefined?run.parameters.a*value:undefined;
  return <>
    {run.status!=='completed'&&<p className="stale-banner" role="status">Résultats partiels ou indisponibles ({run.status}). La lecture s’arrête au dernier point effectivement fourni.</p>}
    {run.warnings.map(w=><p key={w} className="stale-banner" role="status">{w}</p>)}
    {configError&&<p className="error-banner" role="alert">{configError}</p>}
    <div className="fisher-dashboard" hidden={!fisher}>
      <div className={`qualitative-banner status-${state}`}><span className="status-symbol" aria-hidden="true">{info.icon}</span><div role="status" aria-live="polite" aria-atomic="true"><h2>{info.title}</h2><p>{info.explanation}</p></div><span className="banner-time">t = {fmt(time)} {run.timeUnit}</span></div>
      <div className="workshop-metrics"><Metric label="Poissons dans tout le lac" value={fmt(value)} unit={unit} note="Biomasse totale"/><Metric label="Poissons pêchés depuis le début" value={fmt(cumulative)} unit={massUnit} note="Capture cumulée observée"/><Metric label="Pêche sur les 12 derniers mois" value={fmt(rolling.value)} unit={massUnit} note={rolling.reason}/></div>
      <div className="workshop-main-grid"><article className="workshop-card biomass-card"><h2>Biomasse dans tout le lac</h2>{biomass?.points.length?<Chart series={biomass} timeUnit={run.timeUnit} index={selectedIndex} time={time} statuses={statuses} config={config} biomass/>:<p className="unavailable">Biomasse non disponible pour cette exécution. Vérifiez les observateurs et leur correspondance ci-dessous.</p>}<div className="status-legend" aria-label="Légende des états">{Object.entries(statusInfo).map(([key,s])=><span key={key}><i style={{background:s.color}}/>{s.title.toLocaleLowerCase('fr-FR')}</span>)}</div></article>
        <article className="workshop-card lake-card"><h2>Le lac en mouvement</h2><BiomassLake value={value} unit={unit} maximum={maximum} playing={playing&&active&&fisher} reduced={reduced} state={state}/><p className="illustration-note">{unit==='t'?'1 symbole de poisson représente 1 tonne de biomasse simulée.':'Échelle non définie : aucune conversion implicite en tonnes.'}</p><p>Arrondi à la tonne la plus proche. Pictogrammes, pas poissons réels ni répartition spatiale.</p>{accessible!==undefined&&<p className="accessibility-note">Accessibilité {fmt(run.parameters.a!*100)} % : {fmt(accessible)} {unit} accessibles · fraction du stock global, aucun stock autonome de zone.</p>}</article></div>
      <div className="workshop-secondary-grid"><article className="workshop-card capture-card"><h2>{capture?.kind==='catch_rate'?'Débit de capture observé':capture?.kind==='catch_interval'?'Capture par intervalle':'Poissons pêchés depuis le début'}</h2>{capture?.points.length?<Chart series={capture} timeUnit={run.timeUnit} index={selectedIndex} time={time} statuses={statuses} config={config}/>:<p className="unavailable">Capture non disponible : activez l’observation C dans le modèle ou le wrapper, puis relancez.</p>}</article><ResourceGauge value={value} unit={unit} capacity={run.parameters.K} config={config} trend={trend} state={state}/></div>
    </div>
    <div className="scientific-workspace" hidden={fisher}>{scientific}<p className="scientific-cursor">Curseur commun : t = {fmt(time)} ({run.timeUnit}) · observation {selectedIndex+1}/{timeline.length} · B = {fmt(value)} {unit} · ΔB/Δt = {fmt(trend)} {unit}/{run.timeUnit} · C/débit = {fmt(caught?.point.value)} {capture?.unit}. Les graphiques scientifiques complets conservent toutes les sorties.</p></div>
    <div className="timeline-player" aria-label="Lecture des observations"><div className="timeline-buttons"><button className="primary" disabled={timeline.length<2} onClick={()=>{if(playing){audio.current?.stop();setPlaying(false);}else{if(selectedIndex===timeline.length-1)setIndex(0);setPlaying(true);}}}>{playing&&active?<Pause size={16}/>:<Play size={16}/>} {playing&&active?'Pause':selectedIndex>0&&selectedIndex<timeline.length-1?'Reprendre':'Lancer l’animation'}</button><button disabled={!timeline.length} onClick={()=>move(0)}><RotateCcw size={16}/>Recommencer</button><label>Vitesse<select aria-label="Vitesse de lecture" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.5,1,2,4].map(v=><option key={v} value={v}>{String(v).replace('.',',')}×</option>)}</select></label><output aria-label="Temps courant" aria-live="off">t = {fmt(time)} / {fmt(timeline.at(-1)?.time)} ({run.timeUnit})</output></div>
      <label className="timeline-slider">Parcourir le temps simulé<input aria-label="Position temporelle" type="range" min={0} max={Math.max(0,timeline.length-1)} value={selectedIndex} disabled={!timeline.length} aria-valuetext={`Observation ${selectedIndex+1}, temps ${fmt(time)} ${run.timeUnit}, biomasse ${fmt(value)} ${unit}`} onChange={e=>move(Number(e.target.value))}/></label>
      <div className="timeline-settings"><label><input type="checkbox" checked={sound} onChange={e=>void enableAudio(e.target.checked)}/> Son des alertes</label><label>Volume<input aria-label="Volume des alertes" type="range" min="0" max="1" step=".01" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><button disabled={!sound} onClick={()=>void enableAudio(false)}><VolumeX size={15}/>Arrêter l’alarme</button><label><input type="checkbox" checked={reduced} disabled={systemReduced} onChange={e=>setManualReduced(e.target.checked)}/> Mouvement réduit</label><label>Seuil choisi pour l’atelier<input aria-label="Seuil choisi pour l’atelier" type="number" min="0" step="any" placeholder="Non défini" value={config.bCrit??''} onChange={e=>{const n=e.target.value===''?undefined:Number(e.target.value);changeConfig({bCrit:n!==undefined&&n>0&&Number.isFinite(n)?n:undefined});}}/><span>{unit}</span></label></div>
      {audioError&&<p role="status">{audioError}</p>}
    </div>
    <details className="workshop-hypotheses"><summary>Comprendre les hypothèses, les unités et les observateurs</summary><p>Exécution réelle : <code>{run.runId}</code> · modèle {run.model} · {run.label} · moteur/adaptateur {run.provenance}.</p>
      <p>{run.units?`Unités physiques déclarées : temps en ${run.timeUnit}, biomasse en ${unit}. ${run.units.provenance.note}`:'Unités physiques non déclarées : aucune tonne ou mois attribué à ce modèle historique.'} Aucun calendrier réel n’est inféré.</p>
      <p>Équations Schaefer reconnues : dB/dt = rB(1 − B/K) − qaEB ; dC/dt = qaEB. q, a et E sont déjà pris en compte dans les captures du moteur.</p>
      <p>Paramètres complets : {Object.entries(run.parameters).map(([k,v])=>`${k} = ${fmt(v)} ${run.parameterUnits?.[k]??'(unité non déclarée)'}`).join(' ; ')||'non disponibles'}. Niveaux d’effort et variantes relatifs au jeu de scénarios de cette campagne ; aucun seuil empirique de gestion.</p>
      <p>Fenêtre de 12 mois : C(t) − C(t−12 mois), uniquement avec observations aux bornes (tolérance d’arrondi machine). Ni interpolation, ni intégration du débit. Fenêtre complète requise ; pas de cumul partiel étiqueté annuel. Les marches graphiques sont des guides visuels.</p>
      <p>Seuil choisi pour l’atelier : hypothèse pédagogique, sans validation écologique. Le jaune dépend de la tendance, pas uniquement de la jauge.</p>
      <div className="hypothesis-settings"><label>Marge (%)<input aria-label="Marge de proximité (%)" type="number" min="0" step="any" value={config.proximityRatio*100} onChange={e=>changeConfig({proximityRatio:Math.max(0,Number(e.target.value)||0)/100})}/></label><label>Tolérance de pente<input aria-label="Tolérance de pente" type="number" min="0" step="any" value={config.slopeTolerance} onChange={e=>changeConfig({slopeTolerance:Math.max(0,Number(e.target.value)||0)})}/></label><label><input type="checkbox" checked={yellowSound} onChange={e=>setYellowSound(e.target.checked)}/> Signal discret en baisse (jaune)</label></div>
      <p>Son facultatif : avertissement orange de 2,4 s ; sirène rouge modulée pendant la lecture critique. Pause, déplacement du curseur, scénario, sortie et onglet inactif arrêtent le son. Aucun recalcul moteur.</p>
      <div className="mapping-fields"><label>Biomasse totale du lac<select aria-label="Observateur de biomasse totale" value={biomass?.id??''} onChange={e=>{move(0);setMapping({biomass:e.target.value||undefined,capture:capture?.id,captureKind:capture?.kind as Mapping['captureKind']});}}><option value="">Non disponible</option>{run.series.map(s=><option key={s.id}>{s.id}</option>)}</select></label><label>Capture<select aria-label="Observateur de capture" value={capture?.id??''} onChange={e=>{move(0);setMapping({biomass:biomass?.id,capture:e.target.value||undefined,captureKind:capture?.kind as Mapping['captureKind']});}}><option value="">Non disponible</option>{run.series.filter(s=>s.id!==biomass?.id).map(s=><option key={s.id}>{s.id}</option>)}</select></label><label>Nature de la capture<select aria-label="Nature de la capture" value={capture?.kind??'catch_cumulative'} onChange={e=>{move(0);setMapping({biomass:biomass?.id,capture:capture?.id,captureKind:e.target.value as Mapping['captureKind']});}}><option value="catch_cumulative">Cumul depuis le début</option><option value="catch_rate">Débit de capture</option><option value="catch_interval">Capture par intervalle</option></select></label></div>
    </details>
  </>;
}
function Metric({label,value,unit,note}:{label:string;value:string;unit:string;note:string}){return <article className="metric-card"><h2>{label}</h2><p><strong>{value}</strong>{value!=='Non disponible'&&<span> {unit}</span>}</p><small>{note}</small></article>;}
