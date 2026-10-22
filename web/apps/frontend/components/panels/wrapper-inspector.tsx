'use client';
import { useEffect, useState } from 'react';
import { validateRequest, type Component, type FactorPlan, type RunRequest, type WrapperExperiment } from '@contracts';
import { errorText } from '@/lib/api/client';
import type { ComponentSpec } from '@/lib/modeling/model';
import { prospectiveAtoms, scenarioCount, type IdentityRename } from '@/lib/modeling/wrapper';
import { NumberField } from './number-field';

export function CommitText({ label, value, onCommit, maxLength = 64 }: { label: string; value: string; onCommit: (v: string) => string | undefined; maxLength?: number }) {
  const [raw, setRaw] = useState(value), [error, setError] = useState<string>();
  useEffect(() => { setRaw(value); setError(undefined); }, [value]);
  return <label className="field"><span>{label}</span><input aria-label={label} value={raw} maxLength={maxLength} aria-invalid={!!error} onChange={e => setRaw(e.target.value)} onBlur={() => { if (raw !== value) setError(onCommit(raw)); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{error && <small role="alert">{error}</small>}</label>;
}
export function FactorPlanFields({ plan, onChange }: { plan: FactorPlan; onChange: (plan: FactorPlan) => void }) {
  return <>
    <label className="field"><span>Type du facteur</span><select aria-label="Type du facteur" value={plan.type} onChange={e => onChange(e.target.value === 'single' ? { id: plan.id, type: 'single', value: plan.type === 'fixed' ? plan.values[0] ?? 0 : plan.value } : { id: plan.id, type: 'fixed', values: plan.type === 'single' ? [plan.value] : plan.values })}><option value="single">single</option><option value="fixed">fixed</option></select></label>
    {plan.type === 'single' ? <NumberField label="Valeur unique" value={plan.value} onChange={value => onChange({ ...plan, value })} /> : <FixedValues key={plan.id} values={plan.values} onChange={values => onChange({ ...plan, values })} />}
  </>;
}
function FixedValues({ values, onChange }: { values: number[]; onChange: (values: number[]) => void }) {
  const [raw, setRaw] = useState(values.join(', '));
  useEffect(() => { setRaw(previous => {
    const parsed = previous.trim() ? previous.trim().split(/[,;\s]+/).map(token => token === '' ? NaN : Number(token)) : [];
    return JSON.stringify(parsed) === JSON.stringify(values) ? previous : values.join(', ');
  }); }, [values]);
  const invalid = !values.length || values.length > 128 || values.some(v => !Number.isFinite(v) || Math.abs(v) > 1e12);
  return <label className="field"><span>Valeurs fixes</span><textarea aria-label="Valeurs fixes" value={raw} rows={2} aria-invalid={invalid} onChange={e => { const text = e.target.value; setRaw(text); onChange(text.trim() ? text.trim().split(/[,;\s]+/).map(token => token === '' ? NaN : Number(token)) : []); }} /><small>{invalid ? 'Une à 128 valeurs numériques finies sont requises.' : 'Séparer les nombres par des virgules ou des espaces (point décimal).'} </small></label>;
}
const nextId = (base: string, items: { id: string }[]) => { let n = 1; while (items.some(i => i.id === `${base}${n}`)) n++; return `${base}${n}`; };
const move = <T,>(items: T[], i: number, delta: number): T[] => { const next = [...items]; [next[i], next[i + delta]] = [next[i + delta]!, next[i]!]; return next; };

export function WrapperInspector({ component, request, spec, onExperiment, onRename, onDelete, onOpen }: {
  component: Component; request: RunRequest; spec: ComponentSpec;
  onExperiment: (e: WrapperExperiment, identity?: IdentityRename) => string | undefined;
  onRename: (id: string) => string | undefined; onDelete: () => void; onOpen: (definition: string) => void;
}) {
  const e = component.experiment!;
  const [error, setError] = useState<string>();
  const edit = (next: WrapperExperiment, identity?: IdentityRename) => { const message = onExperiment(next, identity); setError(message); return message; };
  const atoms = prospectiveAtoms(request, e.definition), targets = atoms.filter(a => a.parameter);
  const definition = request.model.definitions?.find(d => d.id === e.definition);
  let validation: string | undefined;
  try { validateRequest(request); } catch (err) { validation = errorText(err); }
  const idError = (id: string, items: { id: string }[], previous: string) => !/^[A-Za-z0-9_-]{1,31}$/.test(id) ? 'Identifiant : 1 à 31 lettres, chiffres, tirets ou soulignés.' : items.some(x => x.id === id && x.id !== previous) ? 'Cet identifiant existe déjà.' : undefined;
  return <aside className="inspector panel wrapper-inspector" aria-label="Inspecteur expérimental">
    <div className="panel-heading"><span>SIMULATION PROSPECTIVE</span></div>
    <div className="inspector-title"><span className="eyebrow">EXPÉRIMENTAL · JSON v3</span><h2>{component.id}</h2><code>simulation_wrapper</code></div>
    <CommitText label="Identifiant du composant" value={component.id} onCommit={onRename} />
    {error && <p className="inline-error" role="alert">{error}</p>}
    <section className="inspector-section"><h3>Modèle prospectif</h3>
      <label className="field"><span>Définition prospective</span><select aria-label="Définition prospective" value={definition ? e.definition : ''} onChange={event => edit({ ...e, definition: event.target.value })}><option value="">Choisir une définition du document…</option>{request.model.definitions?.map(d => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}</select></label>
      <p className="small">{definition?.name ?? `Définition absente : ${e.definition}`}</p><button disabled={!definition} onClick={() => onOpen(e.definition)}>Ouvrir le prospectif</button>
      <NumberField label="Début prospectif" value={e.simulation.start} minimum={-1e9} maximum={1e9} onChange={start => edit({ ...e, simulation: { ...e.simulation, start } })} />
      <NumberField label="Fin prospective" value={e.simulation.end} minimum={-1e9} maximum={1e9} onChange={end => edit({ ...e, simulation: { ...e.simulation, end } })} />
      <details><summary>Modèles atomiques du prospectif ({atoms.length})</summary><ul className="small">{atoms.map(a => <li key={a.path}><code>{a.path}</code> · {a.component.type}</li>)}</ul></details>
    </section>
    <section className="inspector-section"><h3>Facteurs expérimentaux ({e.factors.length})</h3>
      {e.factors.map((f, i) => <fieldset className="experiment-card" key={f.id} data-testid={`factor-${f.id}`}><legend>{f.name || f.id}</legend>
        <CommitText label="Id du facteur" value={f.id} maxLength={31} onCommit={id => idError(id, e.factors, f.id) ?? edit({ ...e, factors: e.factors.map((x, j) => j === i ? { ...x, id } : x) }, { factor: [f.id, id] })} />
        <CommitText label="Nom du facteur (facultatif)" value={f.name ?? ''} onCommit={name => edit({ ...e, factors: e.factors.map((x, j) => { if (j !== i) return x; const { name: old, ...rest } = x; return name ? { ...rest, name } : rest; }) })} />
        <label className="field"><span>Cible du facteur</span><select aria-label="Cible du facteur" value={f.target} aria-invalid={!targets.some(a => a.path === f.target && a.parameter === f.parameter)} onChange={event => { const a = targets.find(a => a.path === event.target.value)!; edit({ ...e, factors: e.factors.map((x, j) => j === i ? { ...x, target: a.path, parameter: a.parameter! } : x) }); }}>
          {!targets.some(a => a.path === f.target) && <option value={f.target}>Cible absente : {f.target}</option>}
          {targets.map(a => <option key={a.path} value={a.path}>{a.path}.{a.parameter} · {a.component.type}</option>)}
        </select></label><p className="small">Paramètre : <code>{f.parameter}</code></p>
        <FactorPlanFields plan={f} onChange={plan => edit({ ...e, factors: e.factors.map((x, j) => j === i ? { ...(x.name ? { name: x.name } : {}), target: x.target, parameter: x.parameter, ...plan } : x) })} />
        <div className="experiment-actions"><button disabled={i === 0} aria-label={`Monter facteur ${f.id}`} onClick={() => edit({ ...e, factors: move(e.factors, i, -1) })}>↑</button><button disabled={i === e.factors.length - 1} aria-label={`Descendre facteur ${f.id}`} onClick={() => edit({ ...e, factors: move(e.factors, i, 1) })}>↓</button><button aria-label={`Supprimer facteur ${f.id}`} onClick={() => edit({ ...e, factors: e.factors.filter((_, j) => j !== i) })}>Supprimer</button></div>
      </fieldset>)}
      <button disabled={e.factors.length >= 10 || e.factors.length + e.selections.length >= 12 || !targets.some(a => !e.factors.some(f => f.target === a.path))} onClick={() => { const a = targets.find(a => !e.factors.some(f => f.target === a.path))!; edit({ ...e, factors: [...e.factors, { id: nextId('factor', e.factors), target: a.path, parameter: a.parameter!, type: 'single', value: a.component.parameters[a.parameter!] ?? 0 }] }); }}>Ajouter un facteur</button>
      <p className="small scenario-count" role="status">{scenarioCount(e)} scénario(s) configuré(s) · produit des cardinalités</p>
    </section>
    <section className="inspector-section"><h3>Sélections et critères ({e.selections.length})</h3>
      {e.selections.map((s, i) => <fieldset className="experiment-card" key={s.id} data-testid={`selection-${s.id}`}><legend>{s.name || s.id}{s.id === e.objective.primary ? ' · primaire' : ''}</legend>
        <CommitText label="Id de la sélection" value={s.id} maxLength={31} onCommit={id => idError(id, e.selections, s.id) ?? edit({ ...e, selections: e.selections.map((x, j) => j === i ? { ...x, id } : x), objective: { ...e.objective, primary: e.objective.primary === s.id ? id : e.objective.primary } }, { selection: [s.id, id] })} />
        <CommitText label="Nom de la sélection (facultatif)" value={s.name ?? ''} onCommit={name => edit({ ...e, selections: e.selections.map((x, j) => { if (j !== i) return x; const { name: old, ...rest } = x; return name ? { ...rest, name } : rest; }) })} />
        <label className="field"><span>Cible observable</span><select aria-label="Cible observable" value={s.target} aria-invalid={!atoms.some(a => a.path === s.target)} onChange={event => edit({ ...e, selections: e.selections.map((x, j) => j === i ? { ...x, target: event.target.value } : x) })}>{!atoms.some(a => a.path === s.target) && <option value={s.target}>Cible absente : {s.target}</option>}{atoms.map(a => <option key={a.path} value={a.path}>{a.path} · {a.component.type}</option>)}</select></label>
        <label className="field"><span>Critère</span><select aria-label="Critère" value={s.criteria} onChange={event => edit({ ...e, selections: e.selections.map((x, j) => j === i ? { ...x, criteria: event.target.value as typeof s.criteria } : x) })}>{['min', 'max', 'min-last', 'max-last'].map(c => <option key={c}>{c}</option>)}</select></label>
        <div className="experiment-actions"><button disabled={i === 0} aria-label={`Monter sélection ${s.id}`} onClick={() => edit({ ...e, selections: move(e.selections, i, -1) })}>↑</button><button disabled={i === e.selections.length - 1} aria-label={`Descendre sélection ${s.id}`} onClick={() => edit({ ...e, selections: move(e.selections, i, 1) })}>↓</button><button aria-label={`Supprimer sélection ${s.id}`} onClick={() => edit({ ...e, selections: e.selections.filter((_, j) => j !== i), objective: { ...e.objective, primary: e.objective.primary === s.id ? e.selections.find(x => x.id !== s.id)?.id ?? 'selection' : e.objective.primary } })}>Supprimer</button></div>
      </fieldset>)}
      <button disabled={!atoms.length || e.factors.length + e.selections.length >= 12} onClick={() => { const id = nextId('selection', e.selections); edit({ ...e, selections: [...e.selections, { id, target: atoms.find(a => a.component.type.includes('integrator'))?.path ?? atoms[0]!.path, criteria: 'max-last' }], objective: { ...e.objective, primary: e.selections.length ? e.objective.primary : id } }); }}>Ajouter une sélection</button>
    </section>
    <section className="inspector-section"><h3>Objectif</h3><label className="field"><span>Méthode</span><select aria-label="Méthode" value="simple" disabled><option>simple</option></select></label>
      <label className="field"><span>Sens de l’objectif</span><select aria-label="Sens de l’objectif" value={e.objective.type} onChange={event => edit({ ...e, objective: { ...e.objective, type: event.target.value as 'maximize' | 'minimize' } })}><option>maximize</option><option>minimize</option></select></label>
      <label className="field"><span>Sélection primaire</span><select aria-label="Sélection primaire" value={e.selections.some(s => s.id === e.objective.primary) ? e.objective.primary : ''} onChange={event => edit({ ...e, objective: { ...e.objective, primary: event.target.value } })}><option value="">Choisir…</option>{e.selections.map(s => <option key={s.id} value={s.id}>{s.name || s.id} ({s.id})</option>)}</select></label>
    </section>
    <section className="inspector-section"><h3>Exécution</h3><label className="field"><span>Mode d’exécution</span><select aria-label="Mode d’exécution" value="complete" disabled><option>complete</option></select></label><p className="small muted">Connectez une source DEVS à run (entrée 1). init (entrée 0) réinitialise l’expérience. Les événements sont produits par le moteur C++.</p></section>
    <section className="inspector-section"><h3>Ports dynamiques</h3><p className="small">F={e.factors.length}, S={e.selections.length} · {spec.inputs.length} entrées · {spec.outputs.length} sorties</p><div className="port-list">{spec.inputs.map(p => <p key={`x${p.port}`}><span>x[{p.port}]</span><code>{p.name}</code></p>)}{spec.outputs.map(p => <p key={`y${p.port}`}><span>y[{p.port}]</span><code>{p.name}</code></p>)}</div><p className="small muted">1 ≤ F ≤ 10 ; S ≥ 1 ; 3 ≤ F+S ≤ 12. Retirez les connexions d’un port avant sa suppression.</p></section>
    {validation && <p className="inline-error" role="alert">Document à compléter avant export ou exécution : {validation}</p>}
    <button className="danger-button" onClick={onDelete}>Supprimer le composant</button>
  </aside>;
}
