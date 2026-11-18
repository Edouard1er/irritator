'use client';
import {useEffect,useMemo,useState,type MouseEvent} from 'react';
import type {Conditions} from '@contracts';
import {normalizeFishingEffort,type FishingPractice,type PracticeHistory} from '@/lib/simulation/fishing-effort';

const fmt=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(n);
type Props={
  time:number;practice?:FishingPractice;history:PracticeHistory;conditions:Conditions;
  disabled:boolean;busy:boolean;editing:boolean;hidden?:boolean;
  onPrepare:()=>void;
  onCustomize:(event:MouseEvent<HTMLButtonElement>)=>void;
  onApply:(time:number,conditions:Conditions,practice:FishingPractice,history:PracticeHistory)=>Promise<boolean>;
};

export function QuickFishingTrips({time,practice,history,conditions,disabled,busy,editing,hidden,onPrepare,onCustomize,onApply}:Props){
  const [draft,setDraft]=useState<{time:number;trips:number}>();
  const [notice,setNotice]=useState('');
  const habitual=history.habitualPractice??history.reference.practice;
  const usual=habitual.tripsPerWeek,max=2*usual;
  const trips=draft?.time===time?draft.trips:practice?.tripsPerWeek??usual;
  const changed=!!practice&&trips!==practice.tripsPerWeek;
  useEffect(()=>{
    if(draft&&draft.time!==time){setDraft(undefined);setNotice('Le temps consulté a changé : l’aperçu a été abandonné.');}
  },[time,draft]);
  useEffect(()=>{
    if(editing&&draft){setDraft(undefined);setNotice('Le formulaire complet a été ouvert : l’aperçu rapide a été abandonné.');}
  },[editing,draft]);
  const preview=useMemo(()=>{
    if(!practice)return {error:'Pratique applicable non enregistrée. Renseignez-la avec Personnaliser.'};
    try{
      const proposed={...practice,tripsPerWeek:trips};
      return {practice:proposed,effort:normalizeFishingEffort(proposed,history.reference,conditions,history.configuration),error:''};
    }catch(e){return {error:(e as Error).message};}
  },[practice,trips,history,conditions]);
  const unavailable=disabled||editing||!practice||!Number.isFinite(usual)||usual<=0;
  const choose=(value:number)=>{onPrepare();setDraft({time,trips:value});setNotice('');};
  // Whole-trip offsets from the exact habitual frequency; fractional endpoints stay exact.
  const snap=(value:number)=>value<=0?0:value>=max?max:Math.max(0,Math.min(max,usual+Math.round(value-usual)));
  const variation=usual>0?(trips-usual)/usual*100:undefined;
  const submit=async()=>{
    if(unavailable||busy||!changed||!preview.practice||!preview.effort)return;
    if(await onApply(time,conditions,preview.practice,history)){
      setDraft(undefined);setNotice('Décision appliquée. La pratique habituelle reste inchangée.');
    }
  };
  return <section className="quick-fishing-trips" aria-label="Ajuster mes sorties de pêche" hidden={hidden}>
    <div className="quick-trips-heading"><h2>Ajuster mes sorties de pêche</h2><span className="quick-trips-badge">Aperçu · avant application</span></div>
    <div className="quick-trips-layout">
      <div className="quick-trips-choice">
        <output aria-label="Sorties choisies"><strong>{fmt(trips)}</strong> sorties par semaine{!Number.isInteger(usual)&&' en moyenne'}</output>
        <p>{history.habitualPractice?`Au lieu de ${fmt(usual)} habituellement`:`Repère proposé : ${fmt(usual)} sorties/semaine`}</p>
        <p className="quick-trips-variation">{variation===undefined?'Écart indisponible':`${variation>0?'+':''}${fmt(variation)} % ${history.habitualPractice?'par rapport à l’habitude':'par rapport au repère proposé'}`}</p>
      </div>
      <div className="quick-trips-gauge">
        <div className="quick-trips-center">{history.habitualPractice?'Habituel':'Repère proposé'} : {fmt(usual)} sorties/semaine</div>
        <div className="quick-trips-track"><input aria-label="Fréquence des sorties de pêche" aria-valuetext={`${fmt(trips)} sorties par semaine`} type="range" min={0} max={usual>0?max:1} step="any" value={Math.min(Math.max(0,trips),usual>0?max:1)} disabled={unavailable||busy} onPointerDown={onPrepare} onChange={e=>choose(snap(Number(e.target.value)))} onKeyDown={e=>{
          let next:number|undefined;
          if(['ArrowLeft','ArrowDown'].includes(e.key))next=Math.max(0,usual+Math.ceil(trips-usual)-1);
          if(['ArrowRight','ArrowUp'].includes(e.key))next=Math.min(max,usual+Math.floor(trips-usual)+1);
          if(e.key==='Home')next=0;if(e.key==='End')next=max;
          if(next!==undefined){e.preventDefault();choose(next);}
        }}/><i aria-hidden="true"/></div>
        <div className="quick-trips-scale"><span>Moins · 0</span><button type="button" disabled={unavailable||busy} onClick={()=>choose(usual)}>{history.habitualPractice?'Habitude':'Repère proposé'}</button><span>Plus · {fmt(max)}</span></div>
      </div>
      <div className="quick-trips-effort"><span>Effort qui sera transmis</span><output aria-label="Aperçu de l’effort"><strong>E = {preview.effort?fmt(preview.effort.modelEffort):'—'}</strong></output><small>Le panneau gauche indique l’état appliqué.</small></div>
    </div>
    <div className="quick-trips-footer">
      <p>{changed?'Animation en pause. Appliquer valide ce choix et reprend l’animation.':!history.habitualPractice?'Pratique habituelle à confirmer avec Personnaliser.':'La jauge indique la pratique actuellement appliquée.'}</p>
      <button type="button" onClick={onCustomize} disabled={disabled} aria-controls="simulation-conditions-editor" aria-expanded={editing}>Personnaliser</button>
      <button type="button" className="primary" disabled={unavailable||busy||!changed||!!preview.error} onClick={()=>void submit()}>{busy?'Recalcul dans Irritator…':`Appliquer à partir du mois ${Number(time.toFixed(8))}`}</button>
    </div>
    {usual===0&&<p role="status">Une pratique habituelle positive est nécessaire pour la jauge. Utilisez Personnaliser.</p>}
    {trips>max&&usual>0&&<p role="status">La pratique courante dépasse la plage rapide. Personnaliser conserve sa valeur exacte.</p>}
    {preview.error&&<p role="alert">{preview.error}</p>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
