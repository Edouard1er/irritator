'use client';
import { useState } from 'react';
import { ModelEditor } from '@/components/editor/model-editor';
import { LevelTwoWorkspace } from '@/components/territory/level-two-workspace';

export function LevelNavigation() {
  const [level, setLevel] = useState<1 | 2>(1);
  const [visited, setVisited] = useState(false);
  return <div className="level-application">
    <nav className="level-navigation" aria-label="Niveaux de l’atelier"><button aria-current={level === 1 ? 'page' : undefined} aria-controls="level-one" onClick={() => setLevel(1)}>Niveau 1 — Atelier actuel</button><button aria-current={level === 2 ? 'page' : undefined} aria-controls="level-two" onClick={() => { setVisited(true); setLevel(2); }}>Niveau 2 — Lac de Guiers</button></nav>
    <div id="level-one" className="level-workspace" hidden={level !== 1} inert={level !== 1} aria-label="Niveau 1 — Atelier actuel"><ModelEditor active={level === 1}/></div>
    {visited && <div id="level-two" className="level-workspace" hidden={level !== 2} inert={level !== 2} aria-label="Niveau 2 — Lac de Guiers"><LevelTwoWorkspace active={level === 2}/></div>}
  </div>;
}
