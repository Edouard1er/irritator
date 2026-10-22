'use client';
import type { Component, ExperimentOverride, RunRequest } from '@contracts';
import { containedWrappers, planOnly, scenarioCount } from '@/lib/modeling/wrapper';
import { FactorPlanFields } from './wrapper-inspector';

export function ExperimentOverridesEditor({ component, request, onChange }: { component: Component; request: RunRequest; onChange: (overrides: ExperimentOverride[]) => void }) {
  const wrappers = containedWrappers(request, component.definition ?? component.type.slice(8));
  const overrides = component.experimentOverrides ?? [];
  if (!wrappers.length && !overrides.length) return null;
  return <section className="inspector-section" aria-label="Plans de cette occurrence"><h3>Plans de cette occurrence</h3><p className="small muted">Seuls les types single/fixed et leurs valeurs changent. Dimensions, cibles et critères restent dans la définition partagée.</p>
    {wrappers.map(w => { const override = overrides.find(o => o.target === w.path); const factors = override?.factors ?? w.experiment.factors;
      return <fieldset key={w.path} className="experiment-card" data-testid={`override-${w.path}`}><legend>{w.path}</legend>
        <label className="checkbox"><input type="checkbox" aria-label={`Personnaliser ${w.path}`} checked={!!override} onChange={event => onChange(event.target.checked ? [...overrides, { target: w.path, factors: factors.map(planOnly) }] : overrides.filter(o => o.target !== w.path))} />Personnaliser ce plan</label>
        <p className="small">{scenarioCount({ factors })} scénario(s) · {factors.length} facteur(s)</p>
        {override && factors.map((f, i) => <div key={f.id}><strong>{f.id}</strong><FactorPlanFields plan={f} onChange={plan => onChange(overrides.map(o => o.target !== w.path ? o : { ...o, factors: o.factors.map((old, j) => i === j ? planOnly(plan) : old) }))} /></div>)}
      </fieldset>;
    })}
    {overrides.filter(o => !wrappers.some(w => w.path === o.target)).map(o => <p className="inline-error" role="alert" key={o.target}>Wrapper absent : {o.target}<button onClick={() => onChange(overrides.filter(old => old.target !== o.target))}>Retirer ce plan invalide</button></p>)}
  </section>;
}
