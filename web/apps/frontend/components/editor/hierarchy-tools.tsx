'use client';
import { useState } from 'react';
import type { RunRequest } from '@contracts';
import { atomicPaths, definitions, deletePort, rootScope } from '@/lib/modeling/hierarchy';
import { NumberField } from '@/components/panels/number-field';

export function HierarchyTools({ request, active, trail, onNavigate, onRequest, onNotice }: { request: RunRequest; active: string; trail: string[]; onNavigate: (id: string, trail: string[]) => void; onRequest: (r: RunRequest) => void; onNotice: (s: string) => void }) {
  const d = definitions(request).find(d => d.id === active);
  const [portName, setPortName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string>();
  return <div className="hierarchy-tools">
    <nav aria-label="Navigation hiérarchique"><button onClick={() => onNavigate(rootScope, [])}>Modèle principal</button>{trail.map((id, i) => <span key={`${id}-${i}`}> › <button aria-current={id === active ? 'location' : undefined} onClick={() => onNavigate(id, trail.slice(0, i + 1))}>{definitions(request).find(d => d.id === id)?.name ?? id}</button></span>)}</nav>
    {d && <details open className="external-ports"><summary>Interface de {d.name} · définition partagée</summary><div className="port-editor">
      <label>Nom du port<input aria-label="Nom du port externe" value={portName} onChange={e => setPortName(e.target.value)} placeholder="Identifiant du port" /></label>
      {(['inputs', 'outputs'] as const).map(direction => <button key={direction} onClick={() => {
        const port = Math.max(-1, ...d[direction].map(p => p.port)) + 1;
        const name = portName || (direction === 'inputs' ? 'in' : 'out') + port;
        if (port > 31 || !/^[A-Za-z0-9_-]{1,64}$/.test(name) || d[direction].some(p => p.name === name)) { setError('Nom unique attendu (lettres, chiffres, tirets), indices de 0 à 31.'); return; }
        onRequest({ ...request, model: { ...request.model, definitions: definitions(request).map(def => def.id === d.id ? { ...def, [direction]: [...def[direction], { port, name }] } : def) } }); setPortName(''); setError(undefined);
      }}>{direction === 'inputs' ? 'Ajouter une entrée' : 'Ajouter une sortie'}</button>)}
      {(['inputs', 'outputs'] as const).flatMap(direction => d[direction].map(p => <label className="port-chip" key={`${direction}-${p.port}`}><span>{direction === 'inputs' ? 'Entrée' : 'Sortie'} [{p.port}]</span><input aria-label={`Nom ${direction} ${p.port}`} value={p.name} onChange={e => onRequest({ ...request, model: { ...request.model, definitions: definitions(request).map(def => def.id === d.id ? { ...def, [direction]: def[direction].map(old => old.port === p.port ? { ...old, name: e.target.value } : old) } : def) } })} /><button title="Retire les connexions internes et les connexions de toutes les instances utilisant ce port, sans réindexation." aria-label={`Supprimer ${direction} ${p.port} et ses connexions`} onClick={() => { const result = deletePort(request, d.id, direction, p.port); onRequest(result.request); onNotice(`Port ${p.port} supprimé : ${result.removed} connexion(s) retirée(s) explicitement. Les autres indices sont conservés.`); }}>×</button></label>))}
    </div><p className="small muted">Reliez le nœud $input aux enfants et les enfants au nœud $output. Supprimer un port retire ses connexions dans toutes les instances ; aucun autre indice ne change.</p><button onClick={() => { onNavigate(rootScope, []); onNotice('Définition partagée enregistrée dans le modèle. La sauvegarde locale conserve aussi sa disposition.'); }}>Enregistrer la définition</button>{error && <p role="alert">{error}</p>}</details>}
    <details className="hierarchy-observations"><summary>Observations hiérarchiques ({request.model.observations.length})</summary><div className="port-editor"><label>Chemin d’instance<select aria-label="Chemin d’observation" value={path} onChange={e => setPath(e.target.value)}><option value="">Choisir un modèle atomique…</option>{atomicPaths(request).map(p => <option key={p} value={p}>{p}</option>)}</select></label><button disabled={!path || request.model.observations.some(o => o.component === path)} onClick={() => onRequest({ ...request, model: { ...request.model, observations: [...request.model.observations, { component: path, samplingInterval: 1 }] } })}>Observer ce chemin</button>
      {request.model.observations.map(o => <div className="port-chip" key={o.component}><code>{o.component}</code><NumberField label={`Pas ${o.component}`} value={o.samplingInterval} minimum={1e-6} maximum={1e9} onChange={samplingInterval => onRequest({ ...request, model: { ...request.model, observations: request.model.observations.map(old => old.component === o.component ? { ...old, samplingInterval } : old) } })} /><button aria-label={`Retirer observation ${o.component}`} onClick={() => onRequest({ ...request, model: { ...request.model, observations: request.model.observations.filter(old => old.component !== o.component) } })}>×</button></div>)}
    </div></details>
  </div>;
}
