'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { wrapperOccurrences, type RunRequest, type ScenarioTrajectory } from '@contracts';
import { scenarioTrajectoryCsv } from '@/lib/serialization/csv';
import { downloadFile } from '@/lib/serialization/workspace';

const Plot = dynamic(() => import('@/components/charts/trajectory-plot'), { ssr: false });
export function WrapperTrajectories({ rows, request }: { rows: ScenarioTrajectory[]; request?: RunRequest }) {
  const wrappers = [...new Set(rows.map(r => r.wrapperId))];
  const [wrapper, setWrapper] = useState(wrappers[0] ?? '');
  const labels = Object.fromEntries((request ? wrapperOccurrences(request).find(o => o.component === wrapper)?.experiment.factors ?? [] : []).map(f => [f.id, f.target]));
  const campaigns = [...new Set(rows.filter(r => r.wrapperId === wrapper).map(r => r.campaignId))];
  const [campaign, setCampaign] = useState(campaigns[0] ?? 1);
  const [hiddenScenarios, setHiddenScenarios] = useState<number[]>([]);
  const [hiddenVariables, setHiddenVariables] = useState<string[]>([]);
  const selected = rows.filter(r => r.wrapperId === wrapper && r.campaignId === campaign);
  const variables = [...new Set(selected.flatMap(r => r.observations.map(o => o.component)))];
  const visible = selected.filter(r => !hiddenScenarios.includes(r.scenarioId)).map(r => ({ ...r, observations: r.observations.filter(o => !hiddenVariables.includes(o.component)) }));
  const observations = visible.flatMap(r => r.observations.map(o => ({ ...o, component: `${o.component}:${r.scenarioId}`, label: `${o.component} · e${r.scenarioId + 1} — ${Object.entries(r.factors).map(([k,v]) => `${labels[k] ?? k}=${v}`).join(', ')}${r.status === 'completed' ? '' : ' · partielle'}`, hoverLabel: `${o.component} · wrapper=${r.wrapperId}<br>campagne=${r.campaignId} · scenarioId=${r.scenarioId}<br>${JSON.stringify(r.factors)}<br>${r.status}` })));
  const points = observations.reduce((n,o) => n + o.samples.length, 0);
  return <div className="data-area prospective-trajectories" aria-label="Trajectoires prospectives">
    <h3>Trajectoires prospectives</h3>
    <p className="small">Observations natives · temps local enfant · {observations.length} séries · {points} points</p>
    {!rows.length ? <p>Aucune campagne enfant exécutée.</p> : <>
      <label>Wrapper <select aria-label="Wrapper des trajectoires" value={wrapper} onChange={e => { const id = e.target.value; setWrapper(id); setCampaign(rows.find(r => r.wrapperId === id)!.campaignId); setHiddenScenarios([]); setHiddenVariables([]); }}>{wrappers.map(id => <option key={id}>{id}</option>)}</select></label>
      <label>Campagne <select aria-label="Campagne des trajectoires" value={campaign} onChange={e => { setCampaign(Number(e.target.value)); setHiddenScenarios([]); }}>{campaigns.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      <div className="series-selector" aria-label="Variables prospectives">{variables.map(id => <label className="checkbox" key={id}><input type="checkbox" aria-label={`Afficher variable ${id}`} checked={!hiddenVariables.includes(id)} onChange={e => setHiddenVariables(old => e.target.checked ? old.filter(v => v !== id) : [...old, id])} />{id}</label>)}</div>
      <div className="series-selector" aria-label="Scénarios prospectifs">{selected.map(r => <label className="checkbox" key={r.scenarioId}><input type="checkbox" aria-label={`Afficher scénario ${r.scenarioId}`} checked={!hiddenScenarios.includes(r.scenarioId)} onChange={e => setHiddenScenarios(old => e.target.checked ? old.filter(v => v !== r.scenarioId) : [...old, r.scenarioId])} />e{r.scenarioId + 1} — {Object.entries(r.factors).map(([k,v]) => `${labels[k] ?? k}=${v}`).join(', ')}{r.status !== 'completed' && <strong> · {r.observations.some(o => o.samples.length) ? 'partielle' : 'indisponible'} ({r.status}, temps atteint {r.start + r.horizonApplied})</strong>}</label>)}</div>
      <button onClick={() => downloadFile(scenarioTrajectoryCsv(visible), 'trajectoires-prospectives.csv', 'text/csv;charset=utf-8')}>CSV des trajectoires prospectives</button>
      <div className="chart-area">{observations.some(o => o.samples.length) ? <Plot observations={observations} childClock /> : <p>Aucun point disponible pour cette sélection.</p>}</div>
      <p className="small muted">Les segments relient les points collectés. Aucun point supplémentaire n’est calculé par le navigateur.</p>
    </>}
  </div>;
}
