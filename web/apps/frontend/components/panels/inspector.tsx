'use client';
import { useEffect, useState } from 'react';
import { Eye, MousePointer2, Trash2 } from 'lucide-react';
import type { Component, RunRequest } from '@contracts';
import type { ComponentSpec } from '@/lib/modeling/model';
import { NumberField } from './number-field';

export function Inspector({ component, spec, observation, onParameter, onRename, onObserve, onDelete, selectedEdge, onDeleteEdge }: {
  component?: Component; spec?: ComponentSpec; observation?: RunRequest['model']['observations'][number];
  onParameter: (key: string, value: number) => void; onRename: (id: string) => string | undefined;
  onObserve: (enabled: boolean, interval: number) => void; onDelete: () => void; selectedEdge?: string; onDeleteEdge: () => void;
}) {
  const [id, setId] = useState(component?.id ?? '');
  const [idError, setIdError] = useState<string>();
  useEffect(() => { setId(component?.id ?? ''); setIdError(undefined); }, [component?.id]);
  return <aside className="inspector panel" aria-label="Inspecteur">
    <div className="panel-heading"><span>INSPECTEUR</span><MousePointer2 size={14} /></div>
    {component ? <>
      <div className="inspector-title"><span className="eyebrow">COMPOSANT ATOMIQUE</span><h2>{spec?.name ?? component.type}</h2><code>{component.type}</code></div>
      <section className="inspector-section"><h3>Identité</h3><label className="field"><span>Identifiant du composant</span><input value={id} aria-invalid={!!idError} onChange={e => setId(e.target.value)} onBlur={() => setIdError(onRename(id))} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{idError && <small role="alert">{idError}</small>}</label></section>
      <section className="inspector-section"><h3>Paramètres</h3>{spec ? Object.keys(spec.parameters).length ? Object.entries(spec.parameters).map(([key, bounds]) => <NumberField key={`${component.id}-${key}`} label={key} value={component.parameters[key] ?? NaN} minimum={bounds.minimum} maximum={bounds.maximum} onChange={value => onParameter(key, value)} hint={key === 'offset' ? 'Délai depuis le début de simulation.' : key === 'X' ? 'Condition initiale.' : key === 'dQ' ? 'Quantum strictement positif.' : undefined} />) : <p className="muted small">Aucun paramètre pour ce composant.</p> : <p className="inline-error">Métadonnées indisponibles. Reconnectez le catalogue pour éditer les paramètres.</p>}</section>
      <section className="inspector-section"><h3><Eye size={14} /> Observation</h3><label className="checkbox"><input type="checkbox" checked={!!observation} onChange={e => onObserve(e.target.checked, observation?.samplingInterval ?? 1)} /> Observer ce composant</label>
        {observation && <NumberField key={`${component.id}-sampling`} label="Pas d’observation" value={observation.samplingInterval} minimum={1e-6} maximum={1e9} onChange={value => onObserve(true, value)} hint="Rééchantillonnage effectué par le moteur." />}
      </section>
      <section className="inspector-section"><h3>Ports Irritator</h3><div className="port-list">{spec?.inputs.map(p => <p key={`i${p.port}`}><span>Entrée {p.port}</span><code>{p.name}</code></p>)}{spec?.outputs.map(p => <p key={`o${p.port}`}><span>Sortie {p.port}</span><code>{p.name}</code></p>)}</div></section>
      <button className="danger-button" onClick={onDelete}><Trash2 size={14} /> Supprimer le composant</button>
    </> : selectedEdge ? <div className="inspector-section"><h3>Connexion sélectionnée</h3><p className="mono small break">{selectedEdge}</p><button className="danger-button" onClick={onDeleteEdge}><Trash2 size={14} /> Supprimer la connexion</button></div> : <div className="inspector-empty"><MousePointer2 size={26} /><h3>Explorez votre modèle</h3><p>Sélectionnez un composant pour modifier ses paramètres et observer sa trajectoire.</p></div>}
  </aside>;
}
