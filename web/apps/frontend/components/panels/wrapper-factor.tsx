'use client';
import { useEffect, useState } from 'react';
import { distributionParameters, randomDistributions, type FactorPlan, type RandomDistribution, type RandomPlan } from '@contracts';
import { NumberField } from './number-field';

const types=['single','single-add','single-mult','fixed','fixed-add','fixed-mult','random','random-add','random-mult'] as const;
function convert(plan:FactorPlan,type:FactorPlan['type']):FactorPlan {
  const values='value' in plan?[plan.value]:'values' in plan?plan.values:[0];
  if(type==='single'||type==='single-add'||type==='single-mult')return {id:plan.id,type,value:values[0]??0};
  if(type==='fixed'||type==='fixed-add'||type==='fixed-mult')return {id:plan.id,type,values};
  return 'count' in plan?{...plan,type}:{id:plan.id,type,count:3,distribution:'uniform-real',reals:[0,1],ints:[0,1]};
}
export function FactorPlanFields({ plan, onChange }: { plan: FactorPlan; onChange: (plan: FactorPlan) => void }) {
  return <>
    <label className="field"><span>Type du facteur</span><select aria-label="Type du facteur" value={plan.type} onChange={e=>onChange(convert(plan,e.target.value as FactorPlan['type']))}>{types.map(t=><option key={t}>{t}</option>)}</select></label>
    {'value' in plan?<NumberField label="Valeur unique" value={plan.value} onChange={value=>onChange({...plan,value})}/>:'values' in plan?<FixedValues key={plan.id} values={plan.values} onChange={values=>onChange({...plan,values})}/>:<RandomFields plan={plan} onChange={p=>onChange({...p,id:plan.id})}/>}
    <p className="small">{plan.type.endsWith('-add')?'Valeur du plan + entrée externe (0 par défaut).':plan.type.endsWith('-mult')?'Valeur du plan × entrée externe (1 par défaut).':'L’entrée externe remplace la valeur du plan lorsqu’elle est reçue.'} Seul reals[0] du modèle cible est modifié.</p>
  </>;
}
function RandomFields({plan,onChange}:{plan:RandomPlan;onChange:(p:RandomPlan)=>void}) {
  const parameters=distributionParameters[plan.distribution];
  return <>
    <NumberField label="Nombre de tirages" value={plan.count} minimum={1} maximum={128} hint="Entier ; chaque tirage contribue au produit cartésien." onChange={count=>onChange({...plan,count})}/>
    <label className="field"><span>Distribution</span><select aria-label="Distribution" value={plan.distribution} onChange={e=>{const distribution=e.target.value as RandomDistribution;onChange({...plan,distribution,reals:distribution==='uniform-real'?[0,1]:['bernoulli','binomial','negative-binomial','geometric'].includes(distribution)?[.5,1]:['normal','lognormal','cauchy','extreme-value'].includes(distribution)?[0,1]:[1,1],ints:[1,10]});}}>{randomDistributions.map(d=><option key={d}>{d}</option>)}</select></label>
    {parameters.reals.map((name,i)=><NumberField key={`${plan.distribution}-r${i}`} label={`reals[${i}] · ${name}`} value={plan.reals[i]!} onChange={v=>{const reals:[number,number]=[...plan.reals];reals[i]=v;onChange({...plan,reals});}}/>)}
    {parameters.ints.map((name,i)=><NumberField key={`${plan.distribution}-i${i}`} label={`ints[${i}] · ${name}`} minimum={-2147483648} maximum={2147483647} hint="Entier natif signé sur 32 bits." value={plan.ints[i]!} onChange={v=>{const ints:[number,number]=[...plan.ints];ints[i]=v;onChange({...plan,ints});}}/>)}
    <details><summary>Tableaux natifs complets</summary><p className="small">reals = [{plan.reals.join(', ')}] ; ints = [{plan.ints.join(', ')}]. Les cases inutilisées par cette distribution sont conservées.</p></details>
  </>;
}
function FixedValues({ values, onChange }: { values: number[]; onChange: (values: number[]) => void }) {
  const [raw,setRaw]=useState(values.join(', '));
  useEffect(()=>{setRaw(previous=>{
    const parsed=previous.trim()?previous.trim().split(/[,;\s]+/).map(token=>token===''?NaN:Number(token)):[];
    return JSON.stringify(parsed)===JSON.stringify(values)?previous:values.join(', ');
  });},[values]);
  const invalid=!values.length||values.length>128||values.some(v=>!Number.isFinite(v)||Math.abs(v)>1e12);
  return <label className="field"><span>Valeurs fixes</span><textarea aria-label="Valeurs fixes" value={raw} rows={2} aria-invalid={invalid} onChange={e=>{const text=e.target.value;setRaw(text);onChange(text.trim()?text.trim().split(/[,;\s]+/).map(token=>token===''?NaN:Number(token)):[]);}}/><small>{invalid?'Une à 128 valeurs numériques finies sont requises.':'Séparer les nombres par des virgules ou des espaces (point décimal).'}</small></label>;
}
