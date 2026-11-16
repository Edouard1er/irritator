'use client';
import type { ReactNode } from 'react';
import { nativeReadingAt } from '@/lib/simulation/native-reading';
import type { Trajectory } from '@/lib/simulation/trajectory';

export type GuidedBriefing = { scientific: boolean; reference: ReactNode; onScientific?: () => void };
const number = (n:number) => new Intl.NumberFormat('fr-FR',{maximumFractionDigits:6}).format(n);

export function SymbolicLake25D({moving}:{moving:boolean}) {
  return <svg className={`symbolic-lake${moving?' symbolic-moving':''}`} viewBox="0 0 420 230" aria-hidden="true" focusable="false">
    <ellipse cx="210" cy="161" rx="175" ry="53" fill="#c7dfdf"/>
    <ellipse cx="210" cy="143" rx="175" ry="53" fill="#95c7ce"/>
    <ellipse cx="210" cy="125" rx="175" ry="53" fill="#397b92"/>
    <g className="symbolic-waves" fill="none" stroke="#d6f2ef" strokeWidth="2"><path d="M80 108 Q110 96 140 108 T200 108 T260 108 T320 108"/><path d="M90 143 Q120 131 150 143 T210 143 T270 143 T330 143"/></g>
    <g fill="#f5dfac">{[[110,119],[177,101],[245,122],[303,112],[153,147],[258,151]].map(([x,y],i)=><g key={i} data-symbolic-fish="true" transform={`translate(${x} ${y})`}><ellipse rx="11" ry="5"/><path d="M9 0 L19 -7 L19 7 Z"/></g>)}</g>
  </svg>;
}

export function FisherAnimatedBriefing({run,index,moving,reduced,guided,controls}: {run:Trajectory;index:number;moving:boolean;reduced:boolean;guided:GuidedBriefing;controls:ReactNode}) {
  const projection=nativeReadingAt(run,index),series=run.series.find(s=>s.kind==='biomass_total');
  const reading=projection.kind==='ready'?projection.reading:undefined;
  const relative=reading?.relativeToStart;
  // Display scale is explicit and grows above 100%; no ecological capacity is inferred.
  const gaugeMax=relative?Math.max(1,relative.ratio):1;
  return <article className="native-briefing" aria-label="Présentation animée native" data-run-id={guided.scientific?run.runId:undefined} data-observation-index={index}>
    <header><span className="workshop-eyebrow">MODÈLE D’EXEMPLE · CALCUL IRRITATOR</span><h2>Que devient la ressource au fil du temps ?</h2><p className="briefing-warning">Exemple calculé, non mesuré au lac de Guiers</p></header>
    <p>La quantité représente tout le lac dans le modèle. Aucun stock ni déplacement local n’est déduit.</p>
    {reading ? <>
      <p className="briefing-time">{run.units?.time==='month'?'Mois simulé':'Temps simulé t ='} <strong>{number(reading.time)}</strong> / {number(series!.points.at(-1)!.time)} ({reading.timeUnit})</p>
      <div className="briefing-visuals"><section className="briefing-map"><h3>La carte du lac · référence 2D</h3>{guided.reference}<p>Contour historique inchangé ; aucune répartition de poissons.</p></section>
        <section className="briefing-symbol"><h3>L’illustration symbolique · 2,5D</h3><SymbolicLake25D moving={moving&&!reduced}/><p>Illustration symbolique — aucun comptage de poissons</p><p>Les couches ne représentent ni profondeur ni qualité de l’eau.</p></section></div>
      <div className="briefing-numbers" aria-live="off"><section><h3>Quantité totale de poissons dans le modèle</h3><output aria-label="Quantité totale observée" data-value={reading.biomass.value}>{number(reading.biomass.value)} <span>{reading.biomass.unit}</span></output></section>
        <section><h3>Captures cumulées</h3><p>{reading.cumulativeCatch?`${number(reading.cumulativeCatch.value)} ${reading.cumulativeCatch.unit}`:'Non observées à cet instant dans ce calcul'}</p></section>
        <section><h3>Variation depuis le début du calcul</h3><p>{relative?`${number(relative.delta)} ${reading.biomass.unit} · ${number(relative.ratio*100)} % du premier échantillon valide`:'Lecture relative indisponible'}</p><small>Calcul dérivé : N(t) − N₀ et N(t) / N₀ ; aucune limite écologique définie.</small>
          {relative&&<><meter aria-label="Rapport au premier échantillon valide" min={0} max={gaugeMax} value={relative.ratio}/><small>Échelle relative affichée : 0 à {number(gaugeMax*100)} %.</small></>}</section></div>
    </> : <p role="status">{projection.kind==='unavailable'?projection.reason:''}</p>}
    {reading?.warnings.map(w=><p key={w} className="stale-banner">{w}</p>)}
    {series&&<NativeObservationGraph run={run} index={index}/>}
    {controls}
    <p className="briefing-question">Que remarquez-vous ? Qu’est-ce qui vous ferait changer, ou maintenir, votre choix ?</p>
    {!guided.scientific&&guided.onScientific&&<button onClick={guided.onScientific}>Afficher les hypothèses — animateur</button>}
    {guided.scientific&&<details className="briefing-trace" open><summary>Hypothèses et provenance scientifique</summary><p>runId : {run.runId} · trajectoire : {run.id} · modèle : {run.model} · statut : {run.status} · {run.provenance}</p><p>Observation exacte : index {index} · t = {reading?.time} {reading?.timeUnit} · N = {reading?.biomass.value} {reading?.biomass.unit} · observateur {reading?.biomass.sourceSeriesId} · C : {reading?.cumulativeCatch?.sourceSeriesId??'non observé à cet instant'}.</p><p>Effort normalisé et accès a_z : hypothèses explicites, indépendantes des sorties déclarées et des surfaces. Biomasse globale unique.</p><p>{Object.entries(run.parameters).map(([k,v])=>`${k} = ${v} ${run.parameterUnits?.[k]??'(unité non déclarée)'}`).join(' ; ')}</p><p>Aucune interpolation ni extrapolation. Le trait en marches guide la lecture entre observations. Aucune pluie, salinité ou saison réelle n’est inférée.</p></details>}
  </article>;
}

function NativeObservationGraph({run,index}:{run:Trajectory;index:number}) {
  const series=run.series.find(s=>s.kind==='biomass_total')!;
  const finite=series.points.filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value));
  if(!finite.length)return null;
  const minT=finite[0]!.time,maxT=finite.at(-1)!.time;
  const minN=Math.min(0,...finite.map(p=>p.value)),maxN=Math.max(1,...finite.map(p=>p.value));
  const x=(t:number)=>45+(t-minT)/(maxT-minT||1)*610,y=(n:number)=>160-(n-minN)/(maxN-minN||1)*130;
  let path='',previous: {time:number;value:number}|undefined;
  for(const p of series.points){if(!Number.isFinite(p.time)||!Number.isFinite(p.value)){previous=undefined;continue;}path+=`${previous?'H'+x(p.time)+' V':'M'+x(p.time)+' '}${y(p.value)} `;previous=p;}
  const point=series.points[index],valid=point&&Number.isFinite(point.value)&&Number.isFinite(point.time);
  return <figure className="briefing-graph"><figcaption>Quantité totale dans le modèle · N(t) ({series.unit}) · temps ({run.timeUnit})</figcaption><svg viewBox="0 0 700 190" role="img" aria-label={valid?`Observation ${index+1} : temps ${point.time} ${run.timeUnit}, quantité ${point.value} ${series.unit}`:'Observation indisponible'}><path d="M45 25 V160 H660" fill="none" stroke="#9cabad"/><path d={path} fill="none" stroke="#287b83" strokeWidth="2"/>{valid&&<g><path d={`M${x(point.time)} 25 V160`} stroke="#705728" strokeDasharray="4 4"/><circle data-native-cursor="true" data-time={point.time} data-value={point.value} cx={x(point.time)} cy={y(point.value)} r="5" fill="#705728"/></g>}<text x="45" y="180">{number(minT)}</text><text x="610" y="180">{number(maxT)}</text></svg></figure>;
}
