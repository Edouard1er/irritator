'use client';
import { useState } from 'react';
import { Plus, Search, Box, Sigma, Activity } from 'lucide-react';
import type { Catalog, ComponentSpec } from '@/lib/modeling/model';

export function category(spec: ComponentSpec): string {
  return spec.inputs.length === 0 ? 'Sources' : spec.type.includes('integrator') ? 'Intégrateurs' : 'Opérateurs';
}
export function ComponentLibrary({ catalog, error, onAdd, onRetry }: { catalog?: Catalog; error?: string; onAdd: (spec: ComponentSpec) => void; onRetry: () => void }) {
  const [query, setQuery] = useState('');
  return <aside className="library panel" aria-label="Bibliothèque de composants">
    <div className="panel-heading"><span>COMPOSANTS</span><span className="count">{catalog?.components.length ?? '—'}</span></div>
    <label className="search"><Search size={15} /><input aria-label="Rechercher un composant" placeholder="Rechercher un composant…" value={query} onChange={e => setQuery(e.target.value)} /><kbd>⌕</kbd></label>
    {error ? <div className="inline-error" role="alert">{error}<button onClick={onRetry}>Réessayer</button></div> : !catalog ? <p className="muted small">Chargement du catalogue…</p> : <>
      {['Sources', 'Opérateurs', 'Intégrateurs'].map(group => {
        const specs = catalog.components.filter(s => category(s) === group && `${s.name} ${s.type}`.toLowerCase().includes(query.toLowerCase()));
        if (!specs.length) return null;
        return <section className="library-group" key={group}><h3>{group}</h3>{specs.map(spec => <button key={spec.type} className={`library-item ${category(spec).toLowerCase()}`} aria-label={`Ajouter ${spec.type}`}
          draggable onDragStart={e => { e.dataTransfer.setData('application/irritator-component', spec.type); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => onAdd(spec)}>
          <span className="component-icon">{spec.inputs.length === 0 ? <Box size={18} /> : spec.type.includes('sum') ? <Sigma size={19} /> : <Activity size={18} />}</span>
          <span><strong>{spec.name}</strong><small>{spec.inputs.length} entrée{spec.inputs.length > 1 ? 's' : ''} · {spec.outputs.length} sortie</small></span><Plus size={14} className="add-icon" />
        </button>)}</section>;
      })}
      {!catalog.components.some(s => `${s.name} ${s.type}`.toLowerCase().includes(query.toLowerCase())) && <p className="muted small">Aucun composant correspondant.</p>}
    </>}
    <div className="library-note"><span className="eyebrow">CATALOGUE DU MOTEUR</span><p>Ajoutez un composant par clic ou glissez-le sur le canevas.</p><span className="mono">Contrat v1 · DEVS / QSS</span></div>
  </aside>;
}
