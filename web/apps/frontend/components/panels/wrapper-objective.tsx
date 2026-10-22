'use client';
import type { ConstraintOperation, OptimizationType, WrapperExperiment, WrapperObjective } from '@contracts';
import { NumberField } from './number-field';

export function WrapperObjectiveFields({ experiment: e, onChange }: { experiment: WrapperExperiment; onChange: (o: WrapperObjective) => void }) {
  const o=e.objective;
  const choose=(method: WrapperObjective['method'])=>{
    const primary=e.selections.some(s=>s.id===o.primary)?o.primary!:e.selections[0]?.id??'selection';
    if(method==='simple') onChange({method,type:o.type,primary});
    else if(method==='weighted-sum') onChange({method,type:o.type,weights:e.selections.map(()=>1),types:e.selections.map(()=>'maximize'),norm:'min-max'});
    else onChange({method,type:o.type,primary,epsilons:e.selections.map(()=>0),operations:e.selections.map(()=>'greater-equal')});
  };
  return <>
    <label className="field"><span>Méthode</span><select aria-label="Méthode" value={o.method} onChange={event=>choose(event.target.value as WrapperObjective['method'])}>{['simple','weighted-sum','epsilon-constrained'].map(m=><option key={m}>{m}</option>)}</select></label>
    <label className="field"><span>Sens de l’objectif</span><select aria-label="Sens de l’objectif" value={o.type} onChange={event=>onChange({...o,type:event.target.value as OptimizationType})}><option>maximize</option><option>minimize</option></select></label>
    {o.method!=='weighted-sum' && <label className="field"><span>Sélection primaire</span><select aria-label="Sélection primaire" value={e.selections.some(s=>s.id===o.primary)?o.primary:''} onChange={event=>onChange({...o,primary:event.target.value})}><option value="">Choisir…</option>{e.selections.map(s=><option key={s.id} value={s.id}>{s.name||s.id} ({s.id})</option>)}</select></label>}
    {o.method==='weighted-sum' && <>
      <label className="field"><span>Normalisation</span><select aria-label="Normalisation" value={o.norm} onChange={event=>onChange({...o,norm:event.target.value as typeof o.norm})}><option>min-max</option><option>z-score</option></select></label>
      <p className="small">Les critères émis sont normalisés par le moteur. Z-score utilise l’écart-type de population. Les poids ne sont pas renormalisés ; le sens global compare la somme pondérée.</p>
      {e.selections.map((s,i)=><fieldset className="experiment-card" key={s.id} data-testid={`objective-${s.id}`}><legend>{s.name||s.id}</legend>
        <NumberField label={`Poids ${s.id}`} value={o.weights[i]??1} onChange={v=>onChange({...o,weights:e.selections.map((_,j)=>j===i?v:o.weights[j]??1)})}/>
        <label className="field"><span>Sens du critère {s.id}</span><select aria-label={`Sens du critère ${s.id}`} value={o.types[i]??'maximize'} onChange={event=>onChange({...o,types:e.selections.map((_,j)=>j===i?event.target.value as OptimizationType:o.types[j]??'maximize')})}><option>maximize</option><option>minimize</option></select></label>
      </fieldset>)}
    </>}
    {o.method==='epsilon-constrained' && <>
      <p className="small">Toutes les sélections sont contraintes, y compris la primaire. Les égalités sont exactes. Sans candidat admissible, le moteur n’émet aucune décision. Les critères émis restent bruts.</p>
      {e.selections.map((s,i)=><fieldset className="experiment-card" key={s.id} data-testid={`objective-${s.id}`}><legend>{s.name||s.id}{s.id===o.primary?' · primaire':''}</legend>
        <label className="field"><span>Opération {s.id}</span><select aria-label={`Opération ${s.id}`} value={o.operations[i]??'greater-equal'} onChange={event=>onChange({...o,operations:e.selections.map((_,j)=>j===i?event.target.value as ConstraintOperation:o.operations[j]??'greater-equal')})}>{['equal','not-equal','greater-equal','less-equal'].map(v=><option key={v}>{v}</option>)}</select></label>
        <NumberField label={`Epsilon ${s.id}`} value={o.epsilons[i]??0} onChange={v=>onChange({...o,epsilons:e.selections.map((_,j)=>j===i?v:o.epsilons[j]??0)})}/>
      </fieldset>)}
    </>}
    {o.method==='simple' && <p className="small">Le moteur compare le critère primaire et émet les critères bruts.</p>}
  </>;
}
