'use client';
import {ArrowRight, Pencil, Ship, Waves} from 'lucide-react';
import {useEffect,useRef} from 'react';
import type {MouseEventHandler, ReactNode} from 'react';
import type {FishingPractice} from '@/lib/simulation/fishing-effort';

const fmt=(value?:number)=>value!==undefined&&Number.isFinite(value)?new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(value):'Non disponible';
function Row({label,children}:{label:string;children:ReactNode}) {
  return <div className="fishing-practice-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function FishingPracticeSidebar({practice,effort,referenceEffort,onEdit,disabled,editing}:{
  practice?:FishingPractice;effort?:number;referenceEffort?:number;onEdit:MouseEventHandler<HTMLButtonElement>;disabled:boolean;editing:boolean;
}) {
  const sidebar=useRef<HTMLElement>(null);
  useEffect(()=>{
    const panel=sidebar.current,workspace=panel?.closest<HTMLElement>('.simulation-workspace'),viewport=panel?.closest<HTMLElement>('.simulation-container');
    if(!panel||!workspace)return;
    let frame=0;
    const measure=()=>{
      const visible=workspace.classList.contains('presentation-mode')?workspace:viewport;
      const bottom=Math.min(window.innerHeight,visible?.getBoundingClientRect().bottom??window.innerHeight);
      panel.style.setProperty('--fishing-practice-height',`${Math.max(0,bottom-panel.getBoundingClientRect().top)}px`);
    };
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(update);
    observer?.observe(workspace);if(viewport)observer?.observe(viewport);
    window.addEventListener('resize',update);document.addEventListener('fullscreenchange',update);document.addEventListener('scroll',update,true);
    update();
    return()=>{cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',update);document.removeEventListener('fullscreenchange',update);document.removeEventListener('scroll',update,true);};
  },[]);
  return <aside ref={sidebar} className="fishing-practice-sidebar" aria-labelledby="fishing-practice-title">
    <h2 id="fishing-practice-title">Ma façon<br/><em>de pêcher.</em></h2>
    <p className="fishing-practice-intro">Décrivez vos sorties, vos pirogues et vos engins. L’effort est calculé automatiquement.</p>
    {practice?<>
      <section className="fishing-practice-card" aria-labelledby="fishing-boat-title">
        <h3 id="fishing-boat-title"><span className="fishing-practice-icon"><Ship size={17} aria-hidden="true"/></span>Mon embarcation</h3>
        <dl>
          <Row label="Pirogues">{fmt(practice.boats)}</Row>
          <Row label="Motorisation">{practice.motor==='yes'?'Motorisée':'Non motorisée'}</Row>
          <Row label="Sorties">{fmt(practice.tripsPerWeek)} / semaine</Row>
          <Row label="Durée par sortie">{fmt(practice.tripHours)} h</Row>
          <Row label="Déclaration"><span className="fishing-practice-scope">{practice.tripScope==='total'?'Toutes les pirogues':'Par pirogue'}</span></Row>
        </dl>
      </section>
      <section className="fishing-practice-card" aria-labelledby="fishing-gear-title">
        <h3 id="fishing-gear-title"><span className="fishing-practice-icon"><Waves size={17} aria-hidden="true"/></span>Mes engins de pêche</h3>
        <p className="fishing-practice-gear">{practice.gearType==='gillnet'?'Filets maillants':practice.gearType==='longline'?'Lignes':practice.gearType==='seine'?'Sennes':practice.otherGearName}</p>
        <dl>
          {practice.gearType==='gillnet'&&<>
            <Row label="Quantité">{fmt(practice.gearCountPerTrip)} {practice.gearCountPerTrip===1?'filet':'filets'}</Row>
            <Row label="Longueur">{fmt(practice.netLengthM)} m / filet</Row>
            <Row label="Maillage">{fmt(practice.meshValue)} {practice.meshUnit}</Row>
            <Row label="Temps dans l’eau">{fmt(practice.effectiveGearHours)} h / sortie</Row>
          </>}
          {practice.gearType==='longline'&&<>
            <Row label="Nombre de lignes">{fmt(practice.gearCountPerTrip)}</Row>
            <Row label="Hameçons / ligne">{fmt(practice.hooksPerLine)}</Row>
            <Row label="Durée effective">{fmt(practice.lineEffectiveHours)} h / sortie</Row>
          </>}
          {practice.gearType==='seine'&&<>
            <Row label="Nombre de sennes">{fmt(practice.gearCountPerTrip)}</Row>
            <Row label="Opérations / senne / sortie">{fmt(practice.haulsPerTrip)}</Row>
          </>}
        </dl>
      </section>
    </>:<p className="fishing-practice-missing">Pratique à renseigner<span>Aucune pratique associée à cet instant.</span></p>}
    <button type="button" className="fishing-practice-edit" onClick={onEdit} disabled={disabled} aria-controls="simulation-conditions-editor" aria-expanded={editing}><Pencil size={15} aria-hidden="true"/>Modifier mes pratiques<ArrowRight size={19} aria-hidden="true"/></button>
    <div className="fishing-practice-effort">
      <h3>Effort calculé</h3>
      <p>Le nombre de sorties, la durée et les caractéristiques des engins déterminent l’effort mensuel.</p>
      {!practice&&<p>Pratique indisponible · effort issu du modèle.</p>}
      <output aria-label="Effort du modèle appliqué">Effort du modèle : E = <strong>{fmt(effort)}</strong> effort</output>
      {practice&&effort!==undefined&&referenceEffort!==undefined&&referenceEffort>0&&<p>× {fmt(effort/referenceEffort)} par rapport à la référence initiale</p>}
    </div>
  </aside>;
}
