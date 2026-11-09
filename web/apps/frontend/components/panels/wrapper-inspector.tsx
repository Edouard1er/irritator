'use client';
import { useEffect, useState } from 'react';
import { validU64, validateRequest, wrapperCaps, type Component, type RunRequest, type WrapperExperiment, type WrapperSeed } from '@contracts';
import { errorText } from '@/lib/api/client';
import type { ComponentSpec } from '@/lib/modeling/model';
import { prospectiveAtoms, scenarioCount, type IdentityRename } from '@/lib/modeling/wrapper';
import { NumberField } from './number-field';
import { FactorPlanFields } from './wrapper-factor';
import { WrapperObjectiveFields } from './wrapper-objective';
export { FactorPlanFields } from './wrapper-factor';

export function CommitText({ label, value, onCommit, maxLength = 64 }: { label: string; value: string; onCommit: (v: string) => string | undefined; maxLength?: number }) {
  const [raw, setRaw] = useState(value), [error, setError] = useState<string>();
  useEffect(() => { setRaw(value); setError(undefined); }, [value]);
  return <label className="field"><span>{label}</span><input aria-label={label} value={raw} maxLength={maxLength} aria-invalid={!!error} onChange={e => setRaw(e.target.value)} onBlur={() => { if (raw !== value) setError(onCommit(raw)); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{error && <small role="alert">{error}</small>}</label>;
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
    <div className="panel-heading"><span>SIMULATION IMBRIQUEE</span></div>
    <div className="inspector-title"><span className="eyebrow">EXPÉRIMENTAL · JSON v3</span><h2>{component.id}</h2><code>simulation_wrapper</code></div>
    <CommitText label="Identifiant du composant" value={component.id} onCommit={onRename} />
    {error && <p className="inline-error" role="alert">{error}</p>}
    <section className="inspector-section"><h3>Résultats individuels</h3><label className="checkbox"><input aria-label="Transmettre tous les scénarios au modèle parent" type="checkbox" checked={e.scenarioResults ?? false} onChange={event => edit({ ...e, scenarioResults: event.target.checked })} />Transmettre tous les scénarios au modèle parent</label><p className="small">Ports supplémentaires : validité, facteurs, critères bruts et fin de campagne. Trames [valeur, candidat, campagne] à la date de réponse, dans des sacs DEVS successifs. Connectez ces ports aux calculs, filtres et sélecteurs.</p></section>
    <section className="inspector-section"><h3>Plan par campagne</h3><label className="checkbox"><input aria-label="Recevoir un plan dynamique par campagne" type="checkbox" checked={e.dynamicPlan ?? false} onChange={event => edit({ ...e, dynamicPlan: event.target.checked, ...(event.target.checked ? { run: 'complete', scenarioResults: true, requiredInputs: e.factors.filter(f => f.type === 'single').map(f => f.id) } : {}) })} />Recevoir un plan dynamique par campagne</label>
      <p className="small">Le modèle DEVS construit les domaines et l’horizon. La définition prospective, les cibles et les critères restent déclarés dans le document.</p>
      {e.dynamicPlan && <><p className="small">Entrée plan x[{e.factors.length + 2}] : [valeur, champ, campagne]. Champs : 0 = identifiant du plan (entier positif), 1 = version (entier positif), 2 = horizon H, 3 = clôture (valeur 0), 4 = annulation (valeur 0), 5+i = cardinalité du facteur fixe i, dans l’ordre des facteurs.</p><p className="small">Les domaines fixes arrivent sur x[2+i] : [valeur, indice dans le domaine, campagne]. Chaque facteur single doit être obligatoire et reçu pour cette campagne. Envoyez tous les champs, observations et domaines, puis clôturez ; un plan incomplet à la clôture est rejeté. Plan prêt émet [nombre réel de scénarios, identifiant du plan, campagne] ; reliez cette validation à une commande run de la même campagne.</p><p className="small">Mode complete, résultats individuels et F ≤ 9 requis. Facteurs directs single ou fixed uniquement. H doit être positif et inférieur ou égal à la durée prospective déclarée. Le produit des domaines reçus ne doit pas dépasser les {scenarioCount(e)} scénarios configurés. Les clôtures annoncent le nombre réellement exécuté.</p></>}
    </section>
    <section className="inspector-section"><h3>Modèle prospectif</h3>
      <label className="field"><span>Définition prospective</span><select aria-label="Définition prospective" value={definition ? e.definition : ''} onChange={event => edit({ ...e, definition: event.target.value })}><option value="">Choisir une définition du document…</option>{request.model.definitions?.map(d => <option key={d.id} value={d.id}>{d.name} ({d.id})</option>)}</select></label>
      <p className="small">{definition?.name ?? `Définition absente : ${e.definition}`}</p><button disabled={!definition} onClick={() => onOpen(e.definition)}>Ouvrir le prospectif</button>
      <NumberField label="Début prospectif" value={e.simulation.start} minimum={-1e9} maximum={1e9} onChange={start => edit({ ...e, simulation: { ...e.simulation, start } })} />
      <NumberField label="Fin prospective" value={e.simulation.end} minimum={-1e9} maximum={1e9} onChange={end => edit({ ...e, simulation: { ...e.simulation, end } })} />
      <details><summary>Modèles atomiques du prospectif ({atoms.length})</summary><ul className="small">{atoms.map(a => <li key={a.path}><code>{a.path}</code> · {a.component.type}</li>)}</ul></details>
    </section>
    <section className="inspector-section"><h3>Facteurs expérimentaux ({e.factors.length})</h3>
      {e.factors.map((f, i) => <fieldset className="experiment-card" key={f.id} data-testid={`factor-${f.id}`}><legend>{f.name || f.id}</legend>
        <label className="checkbox"><input aria-label={`Entrée obligatoire ${f.id}`} type="checkbox" checked={e.requiredInputs?.includes(f.id) ?? false} onChange={event => edit({ ...e, requiredInputs: event.target.checked ? [...(e.requiredInputs ?? []), f.id] : e.requiredInputs?.filter(id => id !== f.id) })} />Recevoir ce facteur à chaque campagne</label>
        <CommitText label="Id du facteur" value={f.id} maxLength={31} onCommit={id => idError(id, e.factors, f.id) ?? edit({ ...e, factors: e.factors.map((x, j) => j === i ? { ...x, id } : x) }, { factor: [f.id, id] })} />
        <CommitText label="Nom du facteur (facultatif)" value={f.name ?? ''} onCommit={name => edit({ ...e, factors: e.factors.map((x, j) => { if (j !== i) return x; const { name: old, ...rest } = x; return name ? { ...rest, name } : rest; }) })} />
        <label className="field"><span>Cible du facteur</span><select aria-label="Cible du facteur" value={f.target} aria-invalid={!targets.some(a => a.path === f.target && a.parameter === f.parameter)} onChange={event => { const a = targets.find(a => a.path === event.target.value)!; edit({ ...e, factors: e.factors.map((x, j) => j === i ? { ...x, target: a.path, parameter: a.parameter! } : x) }); }}>
          {!targets.some(a => a.path === f.target) && <option value={f.target}>Cible absente : {f.target}</option>}
          {targets.map(a => <option key={a.path} value={a.path}>{a.path}.{a.parameter} · {a.component.type}</option>)}
        </select></label><p className="small">Paramètre : <code>{f.parameter}</code></p>
        <FactorPlanFields plan={f} onChange={plan => edit({ ...e, factors: e.factors.map((x, j) => j === i ? { ...(x.name ? { name: x.name } : {}), target: x.target, parameter: x.parameter, ...plan } : x) })} />
        <div className="experiment-actions"><button disabled={i === 0} aria-label={`Monter facteur ${f.id}`} onClick={() => edit({ ...e, factors: move(e.factors, i, -1) })}>↑</button><button disabled={i === e.factors.length - 1} aria-label={`Descendre facteur ${f.id}`} onClick={() => edit({ ...e, factors: move(e.factors, i, 1) })}>↓</button><button aria-label={`Supprimer facteur ${f.id}`} onClick={() => edit({ ...e, factors: e.factors.filter((_, j) => j !== i) })}>Supprimer</button></div>
      </fieldset>)}
      <button disabled={e.factors.length >= (e.dynamicPlan ? 9 : 10) || e.factors.length + e.selections.length >= 12 || !targets.some(a => !e.factors.some(f => f.target === a.path))} onClick={() => { const a = targets.find(a => !e.factors.some(f => f.target === a.path))!; edit({ ...e, factors: [...e.factors, { id: nextId('factor', e.factors), target: a.path, parameter: a.parameter!, type: 'single', value: a.component.parameters[a.parameter!] ?? 0 }] }); }}>Ajouter un facteur</button>
      <p className="small scenario-count" role="status">{scenarioCount(e)} scénario(s) configuré(s) · produit des cardinalités</p>
      {!!e.requiredInputs?.length && <p className="small">Les observations single et commandes utilisent [valeur, 0, campagne]. Chaque campagne doit fournir toutes ses entrées obligatoires avant init ou run. Le numéro de campagne est conservé dans les résultats ; les commandes s’exécutent dans l’ordre croissant des campagnes, en mode complete.</p>}
      <p className="small">Plafonds : {request.limits?.maxScenarios ?? wrapperCaps.maxScenarios} scénarios par wrapper ; {request.limits?.maxTotalScenarios ?? wrapperCaps.maxTotalScenarios} scénarios cumulés ; {request.limits?.maxInternalPoints ?? wrapperCaps.maxInternalPoints} points internes. Une cible ne peut avoir qu’un facteur.</p>
    </section>
    <section className="inspector-section"><h3>Sélections et critères ({e.selections.length})</h3>
      {e.selections.map((s, i) => <fieldset className="experiment-card" key={s.id} data-testid={`selection-${s.id}`}><legend>{s.name || s.id}{e.objective.method !== 'weighted-sum' && s.id === e.objective.primary ? ' · primaire' : ''}</legend>
        <CommitText label="Id de la sélection" value={s.id} maxLength={31} onCommit={id => idError(id, e.selections, s.id) ?? edit({ ...e, selections: e.selections.map((x, j) => j === i ? { ...x, id } : x), objective: { ...e.objective, primary: e.objective.primary === s.id ? id : e.objective.primary ?? e.selections[0]?.id ?? 'selection' } }, { selection: [s.id, id] })} />
        <CommitText label="Nom de la sélection (facultatif)" value={s.name ?? ''} onCommit={name => edit({ ...e, selections: e.selections.map((x, j) => { if (j !== i) return x; const { name: old, ...rest } = x; return name ? { ...rest, name } : rest; }) })} />
        <label className="field"><span>Cible observable</span><select aria-label="Cible observable" value={s.target} aria-invalid={!atoms.some(a => a.path === s.target)} onChange={event => edit({ ...e, selections: e.selections.map((x, j) => j === i ? { ...x, target: event.target.value } : x) })}>{!atoms.some(a => a.path === s.target) && <option value={s.target}>Cible absente : {s.target}</option>}{atoms.map(a => <option key={a.path} value={a.path}>{a.path} · {a.component.type}</option>)}</select></label>
        <label className="field"><span>Critère</span><select aria-label="Critère" value={s.criteria} onChange={event => edit({ ...e, selections: e.selections.map((x, j) => j === i ? { ...x, criteria: event.target.value as typeof s.criteria } : x) })}>{['min', 'max', 'min-last', 'max-last'].map(c => <option key={c}>{c}</option>)}</select></label>
        <div className="experiment-actions"><button disabled={i === 0} aria-label={`Monter sélection ${s.id}`} onClick={() => edit({ ...e, selections: move(e.selections, i, -1) })}>↑</button><button disabled={i === e.selections.length - 1} aria-label={`Descendre sélection ${s.id}`} onClick={() => edit({ ...e, selections: move(e.selections, i, 1) })}>↓</button><button aria-label={`Supprimer sélection ${s.id}`} onClick={() => edit({ ...e, selections: e.selections.filter((_, j) => j !== i), objective: { ...e.objective, primary: e.objective.primary === s.id ? e.selections.find(x => x.id !== s.id)?.id ?? 'selection' : e.objective.primary ?? e.selections[0]?.id ?? 'selection' } })}>Supprimer</button></div>
      </fieldset>)}
      <button disabled={!atoms.length || e.factors.length + e.selections.length >= 12} onClick={() => { const id = nextId('selection', e.selections); edit({ ...e, selections: [...e.selections, { id, target: atoms.find(a => a.component.type.includes('integrator'))?.path ?? atoms[0]!.path, criteria: 'max-last' }], objective: { ...e.objective, primary: e.selections.length ? e.objective.primary ?? e.selections[0]?.id ?? id : id } }); }}>Ajouter une sélection</button>
    </section>
    <section className="inspector-section"><h3>Objectif</h3><WrapperObjectiveFields experiment={e} onChange={objective => edit({ ...e, objective })} /></section>
    <section className="inspector-section"><h3>Exécution</h3>
      <label className="field"><span>Mode d’exécution</span><select aria-label="Mode d’exécution" value={e.run} onChange={event => edit({ ...e, run: event.target.value as WrapperExperiment['run'] })}>{['complete','bag','time','until','during'].map(mode => <option key={mode}>{mode}</option>)}</select></label>
      <p className="small">{e.run === 'complete' ? 'Exécute chaque enfant jusqu’à son horizon.' : e.run === 'bag' ? 'Exécute exactement un appel natif run() par enfant.' : e.run === 'time' ? 'Avance tant que le temps enfant reste égal au temps initial de la commande ; le premier sac à la date suivante peut être traité.' : e.run === 'until' ? 'Le scalaire run est une cible temporelle enfant absolue.' : 'Le scalaire run est une durée relative au temps enfant courant au début de la commande.'}</p>
      <p className="small">Les horloges parent et enfant sont indépendantes. Le scalaire run est aussi le délai d’émission parent (0 : même date). Une cible entre deux sacs peut être dépassée. Prévoyez un horizon parent qui inclut la réponse.</p>
      <p className="small muted">Sources DEVS : init sur x[0], run sur x[1], facteurs sur x[2+i]. Dans complete, un facteur changé est appliqué au prochain run ; les modes partiels nécessitent init pour l’appliquer en redémarrant l’enfant. init annule les réponses en attente, après l’éventuelle sortie déjà due à cette date.</p>
    </section>
    {e.factors.some(f => 'count' in f) && <section className="inspector-section"><h3>État aléatoire natif</h3>
      <label className="checkbox"><input aria-label="Configurer la graine native" type="checkbox" checked={!!e.seed} onChange={event => { if (event.target.checked) edit({ ...e, seed: ['1393618426636810568','0','0','0','0','0'] }); else { const { seed, ...rest } = e; edit(rest); } }} />Configurer la graine native</label>
      {e.seed?.map((value,i) => <CommitText key={i} label={'seed[' + i + ']'} value={value} maxLength={20} onCommit={v => { if (!validU64(v)) return 'Entier décimal entre 0 et 18446744073709551615.'; const seed = [...e.seed!] as WrapperSeed; seed[i] = v; return edit({ ...e, seed }); }} />)}
      <p className="small">Six entiers u64 encodés en chaînes : clé, flux, compteur, position, deux cases de tampon. Le moteur fait évoluer cet état ; init ne restaure pas la graine initiale. Reproductibilité pour une nouvelle exécution avec le même moteur et le même état.</p>
    </section>}
    <section className="inspector-section"><h3>Ports dynamiques</h3><p className="small">F={e.factors.length}, S={e.selections.length} · {spec.inputs.length} entrées · {spec.outputs.length} sorties</p><div className="port-list">{spec.inputs.map(p => <p key={`x${p.port}`}><span>x[{p.port}]</span><code>{p.name}</code></p>)}{spec.outputs.map(p => <p key={`y${p.port}`}><span>y[{p.port}]</span><code>{p.name}</code></p>)}</div><p className="small muted">1 ≤ F ≤ {e.dynamicPlan ? 9 : 10} ; S ≥ 1 ; 3 ≤ F+S ≤ 12. Retirez les connexions d’un port avant sa suppression.</p>{e.dynamicPlan && <p className="small muted">Les connexions suivent les identifiants lors du déplacement des facteurs. Les champs de cardinalité 5+i produits par votre graphe doivent suivre leur nouvel ordre.</p>}</section>
    {validation && <p className="inline-error" role="alert">Document à compléter avant export ou exécution : {validation}</p>}
    <button className="danger-button" onClick={onDelete}>Supprimer le composant</button>
  </aside>;
}
