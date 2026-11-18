'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Maximize, Minimize, Pause, Play, RotateCcw, VolumeX, Waves } from 'lucide-react';
import {calendarTime,conditionsAt,fleetAt,nativeRequest,ratesAt,seasonAt,validateRequest,type RunRequest,type Conditions} from '@contracts';
import {applyFishingPractice,initializePracticeHistory,practiceAt,type FishingPractice,type PracticeHistory} from '@/lib/simulation/fishing-effort';
import {errorText,runSimulation,type HttpResult} from '@/lib/api/client';
import {downloadFile} from '@/lib/serialization/workspace';
import {ConditionsEditor} from './conditions-editor';
import {FishingPracticeSidebar} from './fishing-practice-sidebar';
import {QuickFishingTrips} from './quick-fishing-trips';
import {MonthlyCatchChart} from './monthly-catch-chart';
import {interactiveRequest} from '@/lib/simulation/interactive';
import { ResultsPanel } from '@/components/panels/results-panel';
import { applyMapping, classifyBiomassStatus, modelUnit, normalizeRun, observationAt, statusInfo, trendAt, type AlertConfig, type Mapping, type Trajectory } from '@/lib/simulation/trajectory';
import { rollingCatch, scenarioLabel } from '@/lib/simulation/indicators';
import { AlertAudio } from '@/lib/simulation/alert-audio';
import { BiomassLake } from './biomass-lake';

const Chart = dynamic(() => import('./workshop-chart'), { ssr: false, loading: () => <p>Chargement du graphique…</p> });
const fmt = (value?: number) => value !== undefined && Number.isFinite(value) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) : 'Non disponible';
const defaultConfig: AlertConfig = { proximityRatio: .2, slopeTolerance: 0 };

export function SimulationWorkspace({ result, request, stale, status, error, active,sessionId,onIntervention }: { result?: HttpResult; request?: RunRequest; stale: boolean; status: string; error?: string; active: boolean;sessionId?:string;onIntervention?:(request:RunRequest,result:HttpResult)=>void }) {
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
    {!result ? <div className="workshop-empty"><Waves size={42}/><h2>Aucune simulation pour le moment</h2><p>Ouvrez votre modèle dans Modélisation, sélectionnez ses observations, puis lancez la simulation.</p><p>Aucune donnée de démonstration n’est substituée aux sorties du moteur.</p></div> : run ? <Playback key={`${sessionId??result.runId}:${run.id}`} request={request} onIntervention={onIntervention} run={run} active={active && status!=='Exécution' && status!=='Validation'} fisher={audience==='fisher'} scientific={<ResultsPanel result={result} request={request} stale={false} status={status}/>} /> : <><p hidden={audience!=='fisher'} className="workshop-empty">Cette exécution ne contient aucune observation de trajectoire. Activez les observateurs dans le constructeur, ou consultez les décisions et événements dans la lecture Scientifique.</p><div className="scientific-workspace" hidden={audience!=='scientific'}><ResultsPanel result={result} request={request} stale={false} status={status}/></div></>}
  </section>;
}

function Playback({ run: original, active, fisher, scientific,request,onIntervention }: { run: Trajectory; active: boolean; fisher: boolean; scientific: React.ReactNode;request?:RunRequest;onIntervention?:(request:RunRequest,result:HttpResult)=>void }) {
  const initial=useRef(original);
  const [comparisonInitial,setComparisonInitial]=useState(original);
  const activity=useRef(active);activity.current=active;
  const [editing,setEditing]=useState<number>(),[recalculating,setRecalculating]=useState(false),[interventionError,setInterventionError]=useState(''),[resumedAt,setResumedAt]=useState<number>();
  const [compare,setCompare]=useState(true),[monthly,setMonthly]=useState(!!request?.temporal);
  const experiment=request?.temporal&&original.id===`root:${request.temporal.target}`?request.temporal:undefined;
  const [practiceHistory,setPracticeHistory]=useState<PracticeHistory>();
  const interventionPending=useRef(false);
  const editorRegion=useRef<HTMLDivElement>(null),editorTrigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(editing!==undefined)editorRegion.current?.focus();else if(!recalculating)editorTrigger.current?.focus();},[editing,recalculating]);
  const fishingHistory=experiment?(practiceHistory??initializePracticeHistory(experiment)):undefined;
  const [mapping,setMapping]=useState<Mapping>();
  const run=useMemo(()=>applyMapping(original,mapping),[original,mapping]);
  const [config,setConfig]=useState<AlertConfig>(defaultConfig);
  const biomass=run.series.find(s=>s.kind==='biomass_total');
  const capture=run.series.find(s=>s.kind==='catch_cumulative')??run.series.find(s=>s.kind.startsWith('catch_'));
  const timeline=biomass?.points??capture?.points??run.series[0]?.points??[];
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1);
  const [systemReduced,setSystemReduced]=useState(false),[manualReduced,setManualReduced]=useState(false);
  const reduced=systemReduced||manualReduced;
  const [sound,setSound]=useState(()=>{try{return localStorage.getItem('irritator-alert-sound')!=='off';}catch{return true;}}),[volume,setVolume]=useState(.25),[audioReady,setAudioReady]=useState(false);
  const [audioError,setAudioError]=useState(''),[configError,setConfigError]=useState('');
  const audio=useRef<AlertAudio|null>(null),mounted=useRef(true),activation=useRef(0);
  const selectedIndex=Math.min(index,Math.max(0,timeline.length-1));
  const time=timeline[selectedIndex]?.time;
  const environment=experiment&&time!==undefined?conditionsAt(experiment,calendarTime(time)):undefined;
  const season=time!==undefined?seasonAt(calendarTime(time)):undefined;
  // Share the editor's default practice and its time-aware applied history.
  const currentPractice=experiment&&fishingHistory&&time!==undefined?practiceAt(fishingHistory,experiment,calendarTime(time)):undefined;
  const fleet=experiment&&time!==undefined?fleetAt(experiment,calendarTime(time)):undefined;
  const interventionTimes=useMemo(()=>experiment?.interventions.map(r=>r.time)??[],[experiment]);
  const baseline=compare&&comparisonInitial!==original?comparisonInitial.series.find(s=>s.kind==='biomass_total'):undefined;
  const initialCapture=compare&&comparisonInitial!==original?comparisonInitial.series.find(s=>s.kind==='catch_cumulative'):undefined;
  useEffect(()=>{
    if(!request?.temporal?.interventions.length)return;
    let disposed=false;const base=structuredClone(request);base.temporal!.interventions=[];base.temporal!.fleetHistory=[];
    void runSimulation(base).then(data=>{if(!disposed){const run=normalizeRun(data,base).find(r=>r.id===initial.current.id);if(run)setComparisonInitial(run);}}).catch(()=>{if(!disposed)setInterventionError('Comparaison initiale indisponible : le moteur n’a pas répondu au calcul sans interventions.');});
    return()=>{disposed=true;};
    // Only a newly loaded session with an existing history needs this extra baseline run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
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
    const eligible=sound&&audioReady&&playing&&active&&fisher&&!document.hidden;
    audio.current?.stop();
    if(!eligible)return;
    if(state==='critical_crossed') {
      try { audio.current?.start(state,volume); } catch { audio.current?.stop();setAudioError('Audio indisponible ; les alertes visuelles restent actives.'); }
    }
    return()=>audio.current?.stop();
    // Gain changes are applied separately, without restarting the alarm.
  },[state,playing,active,fisher,sound,audioReady]);
  useEffect(()=>audio.current?.volume(volume),[volume]);
  const prepareAudio=async()=>{
    const token=++activation.current;
    try { const player=audio.current??new AlertAudio(new AudioContext());audio.current=player;await player.context.resume();if(player.context.state!=='running')throw new Error();if(mounted.current&&activation.current===token){setAudioReady(true);setAudioError('');} }
    catch { if(mounted.current&&activation.current===token){audio.current?.stop();setAudioReady(false);setAudioError('Le navigateur ne permet pas le son. Réactivez le son pour réessayer ; les alertes visuelles restent actives.');} }
  };
  const enableAudio=(enabled:boolean)=>{
    setSound(enabled);try{localStorage.setItem('irritator-alert-sound',enabled?'on':'off');}catch{/* Optional preference. */}
    if(!enabled){activation.current++;audio.current?.stop();return;}
    void prepareAudio();
  };
  const move=(next:number)=>{audio.current?.stop();setPlaying(false);setIndex(next);};
  const pauseForQuickDecision=()=>{audio.current?.stop();setPlaying(false);};
  const editDisabled=recalculating||time===undefined||!experiment||calendarTime(time)>=request!.simulation.end||!onIntervention;
  const openConditions=(event:MouseEvent<HTMLButtonElement>)=>{
    if(editDisabled)return;
    if(editing!==undefined){editorRegion.current?.focus();return;}
    editorTrigger.current=event.currentTarget;
    audio.current?.stop();setPlaying(false);setEditing(calendarTime(time!));setInterventionError('');
  };
  const closeConditions=()=>setEditing(undefined);
  const applyIntervention=async(at:number,p:Conditions,practice:FishingPractice,history:PracticeHistory):Promise<boolean>=>{
    if(!request||interventionPending.current||editDisabled||!onIntervention||at!==calendarTime(time!))return false;
    interventionPending.current=true;
    if(sound)void prepareAudio();setRecalculating(true);setInterventionError('');audio.current?.stop();setPlaying(false);
    try {const applied=applyFishingPractice(request,at,p,practice,history),next=applied.request;validateRequest(next);const data=await runSimulation(next);
      if(!mounted.current)return false;
      const points=normalizeRun(data,next).find(r=>r.id===original.id)?.series.find(s=>s.kind==='biomass_total')?.points;
      const position=points?.findIndex(p=>Math.abs(p.time-at)<=32*Number.EPSILON*Math.max(1,Math.abs(at)));
      if(position===undefined||position<0)throw new Error('Le moteur ne fournit pas le point de reprise ; les résultats précédents sont conservés.');
      onIntervention(next,data);setPracticeHistory(applied.history);setIndex(position);closeConditions();setResumedAt(at);setPlaying(activity.current&&!document.hidden);
      return true;
    }catch(e){if(mounted.current)setInterventionError(errorText(e));return false;}finally{interventionPending.current=false;if(mounted.current)setRecalculating(false);}
  };
  const activateInteractive=async()=>{
    if(!request||!onIntervention||recalculating)return;audio.current?.stop();setPlaying(false);setRecalculating(true);setInterventionError('');
    try{const next=interactiveRequest(request,run),data=await runSimulation(next);if(mounted.current)onIntervention(next,data);}catch(e){if(mounted.current)setInterventionError(errorText(e));}finally{if(mounted.current)setRecalculating(false);}
  };
  const changeConfig=(patch:Partial<AlertConfig>)=>{
    const next={...config,...patch};
    if(!Number.isFinite(next.proximityRatio)||!Number.isFinite(next.slopeTolerance)||(next.bCrit!==undefined&&!Number.isFinite(next.bCrit*(1+next.proximityRatio)))){setConfigError('Saisir des réglages finis et compatibles avec l’échelle des observations.');return;}
    setConfigError('');setConfig(next);
  };
  const accessibility=environment?.a??run.parameters.a;
  return <div className={`simulation-practice-layout${experiment?' has-fishing-practice':''}`}>
    {experiment&&<FishingPracticeSidebar practice={currentPractice} effort={environment?.E} referenceEffort={practiceHistory?.reference.modelEffort} onEdit={openConditions} disabled={editDisabled} editing={editing!==undefined}/>}
    <div className="simulation-playback-main">
    {run.status!=='completed'&&<p className="stale-banner" role="status">Résultats partiels ou indisponibles ({run.status}). La lecture s’arrête au dernier point effectivement fourni.</p>}
    {run.warnings.map(w=><p key={w} className="stale-banner" role="status">{w}</p>)}
    {configError&&<p className="error-banner" role="alert">{configError}</p>}
    {experiment&&<div className="environment-strip"><strong>{season?.name} · mois {season?.month}/12</strong><span>Pluie {fmt(environment?.P)}/10</span><span>Salinité {fmt(environment?.S)}/10</span><span>Accessibilité {fmt((environment?.a??0)*100)} %</span>{fisher&&currentPractice&&<span>Ma pratique : {currentPractice.boats} pirogue(s), {fmt(currentPractice.tripsPerWeek)} sorties/semaine {currentPractice.tripScope==='total'?'pour le groupe':'par pirogue'}</span>}<span>Effort du modèle : {fmt(environment?.E)}{currentPractice?' (calculé à partir des pratiques)':''}</span><button disabled={editDisabled} onClick={openConditions} aria-controls="simulation-conditions-editor" aria-expanded={editing!==undefined}>Personnaliser</button>{experiment.interventions.length>0&&<label><input type="checkbox" checked={compare} onChange={e=>setCompare(e.target.checked)}/> Comparer à la trajectoire initiale (bleu)</label>}</div>}
    {experiment&&environment&&fishingHistory&&time!==undefined&&<QuickFishingTrips time={calendarTime(time)} practice={currentPractice} history={fishingHistory} conditions={environment} disabled={editDisabled} busy={recalculating} editing={editing!==undefined} hidden={!fisher||editing!==undefined} onPrepare={pauseForQuickDecision} onCustomize={openConditions} onApply={applyIntervention}/>}
    {editing!==undefined&&experiment&&request&&fishingHistory&&<div id="simulation-conditions-editor" ref={editorRegion} tabIndex={-1} role="region" aria-label={`Modifier les conditions au mois ${Number(editing.toFixed(8))}`}><ConditionsEditor key={editing} experiment={experiment} request={request} history={fishingHistory} time={editing} scientific={!fisher} busy={recalculating} onApply={(p,practice,history)=>void applyIntervention(editing,p,practice,history)} onCancel={closeConditions}/></div>}
    {interventionError&&<p role="alert" className="error-banner">{interventionError} · La trajectoire précédente reste affichée ; aucune intervention n’est enregistrée.</p>}
    {resumedAt!==undefined&&<p className="intervention-confirmation" role="status" data-resume-time={resumedAt}>Recalcul terminé — reprise au mois {fmt(resumedAt)} sans réinitialiser N ni C.</p>}
    <div className="fisher-dashboard" hidden={!fisher}>
      <div className={`qualitative-banner status-${state}`}><span className="status-symbol" aria-hidden="true">{info.icon}</span><div role="status" aria-live="polite" aria-atomic="true"><h2>{info.title}</h2><p>{info.explanation}</p></div><span className="banner-time">t = {fmt(time)} {run.timeUnit}</span></div>
      <div className="workshop-metrics"><Metric label="Poissons dans tout le lac" value={fmt(value)} unit={unit} note="Biomasse totale"/><Metric label="Poissons pêchés depuis le début" value={fmt(cumulative)} unit={massUnit} note="Capture cumulée observée"/><Metric label="Pêche sur les 12 derniers mois" value={fmt(rolling.value)} unit={massUnit} note={rolling.reason}/></div>
      <div className="workshop-visuals"><article className="workshop-card biomass-card"><h2>Biomasse dans tout le lac</h2>{biomass?.points.length?<Chart series={biomass} timeUnit={run.timeUnit} index={selectedIndex} time={time} statuses={statuses} config={config} biomass baseline={baseline} interventions={interventionTimes}/>:<p className="unavailable">Biomasse non disponible pour cette exécution. Vérifiez les observateurs et leur correspondance ci-dessous.</p>}<div className="status-legend" aria-label="Légende des états">{Object.entries(statusInfo).map(([key,s])=><span key={key}><i style={{background:s.color}}/>{s.title.toLocaleLowerCase('fr-FR')}</span>)}</div></article>
        <article className="workshop-card lake-card"><h2>Le lac en mouvement</h2><BiomassLake value={value} unit={unit} maximum={maximum} playing={playing&&active&&fisher} reduced={reduced} state={state} environment={environment} season={experiment?season?.index:undefined} fleet={fleet} accessibility={accessibility}/></article>
        <article className="workshop-card capture-card"><h2>{monthly?'Poissons pêchés chaque mois':capture?.kind==='catch_rate'?'Débit de capture observé':capture?.kind==='catch_interval'?'Capture par intervalle':'Poissons pêchés depuis le début'}</h2>{experiment&&<label className="monthly-toggle"><input type="checkbox" checked={monthly} onChange={e=>setMonthly(e.target.checked)}/> Captures par mois</label>}{capture?.points.length&&monthly&&time!==undefined?<MonthlyCatchChart series={capture} time={time} end={timeline.at(-1)?.time??0} baseline={initialCapture} onSelect={at=>{const position=timeline.findIndex(p=>Math.abs(p.time-at)<=32*Number.EPSILON*Math.max(1,Math.abs(at)));if(position>=0)move(position);}}/>:capture?.points.length?<Chart series={capture} timeUnit={run.timeUnit} index={selectedIndex} time={time} statuses={statuses} config={config}/>:<p className="unavailable">Capture non disponible : activez l’observation C dans le modèle ou le wrapper, puis relancez.</p>}</article></div>
    </div>
    <div className="scientific-workspace" hidden={fisher}>{scientific}<p className="scientific-cursor">Curseur commun : t = {fmt(time)} ({run.timeUnit}) · observation {selectedIndex+1}/{timeline.length} · B = {fmt(value)} {unit} · ΔB/Δt = {fmt(trend)} {unit}/{run.timeUnit} · C/débit = {fmt(caught?.point.value)} {capture?.unit}. Les graphiques scientifiques complets conservent toutes les sorties.</p></div>
    <div className="timeline-player" aria-label="Lecture des observations"><div className="timeline-buttons"><button className="primary" disabled={timeline.length<2||editing!==undefined||recalculating} onClick={()=>{if(playing){audio.current?.stop();setPlaying(false);}else{if(sound)void prepareAudio();if(selectedIndex===timeline.length-1)setIndex(0);setPlaying(true);}}}>{playing&&active?<Pause size={16}/>:<Play size={16}/>} {playing&&active?'Pause':selectedIndex>0&&selectedIndex<timeline.length-1?'Reprendre':'Lancer la simulation'}</button><button disabled={!timeline.length||editing!==undefined||recalculating} onClick={()=>move(0)}><RotateCcw size={16}/>Recommencer</button><label>Vitesse<select aria-label="Vitesse de lecture" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.25,.5,1,2,4].map(v=><option key={v} value={v}>{v}×</option>)}</select></label><output aria-label="Temps courant" aria-live="off">t = {fmt(time)} / {fmt(timeline.at(-1)?.time)} ({run.timeUnit})</output></div>
      <label className="timeline-slider">Parcourir le temps simulé<input aria-label="Position temporelle" type="range" min={0} max={Math.max(0,timeline.length-1)} value={selectedIndex} disabled={!timeline.length||editing!==undefined||recalculating} aria-valuetext={`Observation ${selectedIndex+1}, temps ${fmt(time)} ${run.timeUnit}, biomasse ${fmt(value)} ${unit}`} onChange={e=>move(Number(e.target.value))}/></label>
      <div className="timeline-settings">{!experiment&&run.units?.time==='month'&&run.units.biomass==='t'&&biomass&&onIntervention&&<button disabled={recalculating} title="Nouvelle expérience à t=0 avec calendrier pédagogique ; paramètres de cette situation conservés." onClick={()=>void activateInteractive()}>{recalculating?'Préparation…':'Activer les interventions · nouveau départ'}</button>}<label><input type="checkbox" checked={sound} onChange={e=>void enableAudio(e.target.checked)}/> Son des alertes</label><label>Volume<input aria-label="Volume des alertes" type="range" min="0" max="1" step=".01" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><button disabled={!sound} onClick={()=>void enableAudio(false)}><VolumeX size={15}/>Arrêter l’alarme</button><label><input type="checkbox" checked={reduced} disabled={systemReduced} onChange={e=>setManualReduced(e.target.checked)}/> Mouvement réduit</label><label>Seuil choisi pour l’atelier<input aria-label="Seuil choisi pour l’atelier" type="number" min="0" step="any" placeholder="Non défini" value={config.bCrit??''} onChange={e=>{const n=e.target.value===''?undefined:Number(e.target.value);changeConfig({bCrit:n!==undefined&&n>0&&Number.isFinite(n)?n:undefined});}}/><span>{unit}</span></label></div>
      {audioError&&<p role="status">{audioError}</p>}
    </div>
    {experiment&&<details className="intervention-history"><summary>Historique des interventions ({experiment.interventions.length}) et expérience JSON</summary><p hidden={fisher}>{experiment.provenance}</p><p hidden={fisher}>r(t) = r₀ f saison exp(−ks(S−Sopt)²) ; q(t) = q₀ exp(βp P/10). À l’instant courant : r = {fmt(environment&&time!==undefined?ratesAt(environment,time).r:undefined)} mois⁻¹ ; q = {environment&&time!==undefined?ratesAt(environment,time).q.toPrecision(6):'—'} (effort·mois)⁻¹.</p><button onClick={()=>request&&downloadFile(JSON.stringify(request,null,2),`${request.model.id}-interventions.json`)}>Exporter l’expérience avec historique</button><button onClick={()=>request&&downloadFile(JSON.stringify(nativeRequest(request),null,2),`${request.model.id}-devs.json`)}>Exporter le graphe DEVS compilé</button><table><thead><tr><th>Mois</th><th>Paramètre</th><th>Ancienne valeur</th><th>Nouvelle valeur</th><th>Unité</th><th>Cible / provenance</th></tr></thead><tbody>{experiment.interventions.map(row=><tr key={`${row.time}:${row.parameter}`}><td>{fmt(row.time)}</td><td>{row.parameter}</td><td>{fmt(row.oldValue)}</td><td>{fmt(row.newValue)}</td><td>{row.unit}</td><td>{row.scenario} · {row.provenance}</td></tr>)}</tbody></table></details>}<details className="workshop-hypotheses" hidden={fisher}><summary>Comprendre les hypothèses, les unités et les observateurs</summary><p>Exécution réelle : <code>{run.runId}</code> · modèle {run.model} · {run.label} · moteur/adaptateur {run.provenance}.</p>
      <p>{run.units?`Unités physiques déclarées : temps en ${run.timeUnit}, biomasse en ${unit}. ${run.units.provenance.note}`:'Unités physiques non déclarées : aucune tonne ou mois attribué à ce modèle historique.'} {experiment?'Calendrier pédagogique configurable : printemps mois 1–3, été 4–6, automne 7–9, hiver 10–12, puis répétition. Aucune description climatique validée du lac.':'Aucun calendrier réel n’est inféré.'}</p>
      <p>Équations Schaefer reconnues : dB/dt = rB(1 − B/K) − qaEB ; dC/dt = qaEB. q, a et E sont déjà pris en compte dans les captures du moteur.</p>
      <p>Paramètres complets : {Object.entries(run.parameters).map(([k,v])=>`${k} = ${fmt(v)} ${run.parameterUnits?.[k]??'(unité non déclarée)'}`).join(' ; ')||'non disponibles'}. Niveaux d’effort et variantes relatifs au jeu de scénarios de cette campagne ; aucun seuil empirique de gestion.</p>
      <p>Fenêtre de 12 mois : C(t) − C(t−12 mois), uniquement avec observations aux bornes (tolérance d’arrondi machine). Ni interpolation, ni intégration du débit. Fenêtre complète requise ; pas de cumul partiel étiqueté annuel. Les marches graphiques sont des guides visuels.</p>
      <p>Seuil choisi pour l’atelier : hypothèse pédagogique, sans validation écologique. Le jaune dépend de la tendance, pas uniquement de la jauge.</p>
      <div className="hypothesis-settings"><label>Marge (%)<input aria-label="Marge de proximité (%)" type="number" min="0" step="any" value={config.proximityRatio*100} onChange={e=>changeConfig({proximityRatio:Math.max(0,Number(e.target.value)||0)/100})}/></label><label>Tolérance de pente<input aria-label="Tolérance de pente" type="number" min="0" step="any" value={config.slopeTolerance} onChange={e=>changeConfig({slopeTolerance:Math.max(0,Number(e.target.value)||0)})}/></label></div>
      <p>Son activé par défaut, sauf préférence désactivée conservée. Initialisation au premier geste de lecture ou de son ; sirène rouge uniquement pendant la lecture à B ≤ seuil configuré. Pause, déplacement du curseur, scénario, sortie et onglet inactif arrêtent le son. Aucun recalcul moteur.</p>
      <div className="mapping-fields"><label>Biomasse totale du lac<select aria-label="Observateur de biomasse totale" value={biomass?.id??''} onChange={e=>{move(0);setMapping({biomass:e.target.value||undefined,capture:capture?.id,captureKind:capture?.kind as Mapping['captureKind']});}}><option value="">Non disponible</option>{run.series.map(s=><option key={s.id}>{s.id}</option>)}</select></label><label>Capture<select aria-label="Observateur de capture" value={capture?.id??''} onChange={e=>{move(0);setMapping({biomass:biomass?.id,capture:e.target.value||undefined,captureKind:capture?.kind as Mapping['captureKind']});}}><option value="">Non disponible</option>{run.series.filter(s=>s.id!==biomass?.id).map(s=><option key={s.id}>{s.id}</option>)}</select></label><label>Nature de la capture<select aria-label="Nature de la capture" value={capture?.kind??'catch_cumulative'} onChange={e=>{move(0);setMapping({biomass:biomass?.id,capture:capture?.id,captureKind:e.target.value as Mapping['captureKind']});}}><option value="catch_cumulative">Cumul depuis le début</option><option value="catch_rate">Débit de capture</option><option value="catch_interval">Capture par intervalle</option></select></label></div>
    </details>
    </div>
  </div>;
}
function Metric({label,value,unit,note}:{label:string;value:string;unit:string;note:string}){return <article className="metric-card"><h2>{label}</h2><p><strong>{value}</strong>{value!=='Non disponible'&&<span> {unit}</span>}</p><small>{note}</small></article>;}
