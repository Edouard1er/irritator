'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { ChartNoAxesCombined, CheckCircle2, Download, Table2, Terminal, Waves } from 'lucide-react';
import type { RunRequest } from '@contracts';
import type { HttpResult } from '@/lib/api/client';
import { resultCsv } from '@/lib/serialization/csv';
import { downloadFile } from '@/lib/serialization/workspace';
import { WrapperResults } from './wrapper-results';

const TrajectoryPlot = dynamic(() => import('@/components/charts/trajectory-plot'), { ssr: false, loading: () => <p className="muted small">Chargement de Plotly…</p> });
export function ResultsPanel({ result, request, stale, status, error }: { result?: HttpResult; request?: RunRequest; stale: boolean; status: string; error?: string }) {
  const [tab, setTab] = useState('graph');
  const [hidden, setHidden] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  useEffect(() => { setHidden([]); setPage(0); if (result) setTab(result.schemaVersion === 2 ? 'wrappers' : 'graph'); }, [result]);
  const observations = useMemo(() => result?.observations.filter(o => !hidden.includes(o.component)) ?? [], [result, hidden]);
  const points = useMemo(() => observations.flatMap(o => o.samples.map(s => ({ ...s, component: o.component }))), [observations]);
  const total = result?.observations.reduce((n, o) => n + o.samples.length, 0) ?? 0;
  return <section className="results" aria-label="Résultats de simulation">
    <div className="results-toolbar"><div className="tabs" role="tablist" aria-label="Vues des résultats">{[
      ['graph', 'Trajectoires', ChartNoAxesCombined], ['table', 'Données', Table2], ...(result?.schemaVersion === 2 ? [['wrappers', 'Décisions natives', Table2]] : []), ...(result?.modelEvents ? [['events', 'Évaluations natives', Table2]] : []), ['details', 'Exécution', Terminal],
    ].map(([id, label, Icon]) => { const Symbol = Icon as typeof Table2; return <button key={String(id)} role="tab" aria-selected={tab === id} onClick={() => setTab(String(id))}><Symbol size={14} />{String(label)}</button>; })}</div>
      <div className="results-actions">{result && <span className="small muted">{total} points · {result.observations.length} observation{result.observations.length > 1 ? 's' : ''}</span>}<button className="text-button" disabled={!result} onClick={() => result && downloadFile(resultCsv(result), `${result.modelId}-points.csv`, 'text/csv;charset=utf-8')}><Download size={14} /> CSV</button></div>
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {stale && result && <div className="stale-banner" role="status">Modèle modifié : ces résultats proviennent d’une version précédente. Relancez la simulation.</div>}
    {!result ? <div className="results-empty"><span className="empty-icon"><Waves size={25} /></span><div><h3>{status === 'Exécution' ? 'Calcul dans libirritator…' : 'Résultats de simulation'}</h3><p>{status === 'Exécution' ? 'Le moteur C++ exécute le graphe. En attente de la réponse complète.' : 'Observez un composant, puis exécutez la simulation pour explorer ses trajectoires.'}</p></div></div> : <>
      {tab === 'events' && <div className="data-area"><button disabled={!request} onClick={() => downloadFile(JSON.stringify({ request, result }, null, 2), `${result.modelId}-evaluations.json`, 'application/json')}>Exporter les évaluations</button><p className="small">Messages DEVS natifs. Valeur, identité et campagne appartiennent à cette exécution. Les statuts sont décrits dans le catalogue du composant ; les indicateurs sont calculés par le graphe.</p><table><thead><tr><th>Composant</th><th>Temps</th><th>Sac</th><th>Port</th><th>Valeur</th><th>Identité</th><th>Campagne</th></tr></thead><tbody>{result.modelEvents?.slice(page * 100, (page + 1) * 100).map(e => <tr key={`${e.component}-${e.port}-${e.bag}`}><td>{e.component}</td><td>{e.time}</td><td>{e.bag}</td><td>{e.port}</td>{e.value.map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody></table><div className="pagination"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Précédent</button><span>{page + 1} / {Math.max(1, Math.ceil((result.modelEvents?.length ?? 0) / 100))}</span><button disabled={(page + 1) * 100 >= (result.modelEvents?.length ?? 0)} onClick={() => setPage(p => p + 1)}>Suivant</button></div></div>}
      {tab === 'wrappers' && result.schemaVersion === 2 && <WrapperResults result={result} />}
      {(tab === 'graph' || tab === 'table') && <div className="series-selector" aria-label="Séries affichées">{result.observations.map(o => <label className="checkbox" key={o.component}><input type="checkbox" checked={!hidden.includes(o.component)} onChange={e => { setHidden(current => e.target.checked ? current.filter(c => c !== o.component) : [...current, o.component]); setPage(0); }} />{o.component}<span className="muted">{o.samples.length} pts</span></label>)}{!result.observations.length && <span className="muted small">Aucune observation demandée dans cette exécution.</span>}</div>}
      {tab === 'graph' && <div className="chart-area">{observations.length ? <TrajectoryPlot observations={observations} /> : <p className="muted small">Sélectionnez une série à afficher.</p>}<p className="chart-note">Points renvoyés par le moteur · Les segments servent uniquement de guide visuel.</p></div>}
      {tab === 'table' && <div className="data-area"><table><thead><tr><th>Composant</th><th>Temps</th><th>Valeur</th></tr></thead><tbody>{points.slice(page * 100, (page + 1) * 100).map(p => <tr key={`${p.component}-${p.time}`}><td>{p.component}</td><td>{String(p.time)}</td><td>{String(p.value)}</td></tr>)}</tbody></table>{points.length > 100 && <div className="pagination"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Précédent</button><span>{page + 1} / {Math.ceil(points.length / 100)}</span><button disabled={(page + 1) * 100 >= points.length} onClick={() => setPage(p => p + 1)}>Suivant</button></div>}</div>}
      {tab === 'details' && <div className="execution-details"><div className="success-label"><CheckCircle2 size={16} /> Exécution terminée</div><dl><dt>Modèle</dt><dd>{result.modelId}</dd><dt>Identifiant d’exécution</dt><dd className="mono">{result.runId}</dd><dt>Statut moteur</dt><dd>{result.status}</dd><dt>Intervalle d’événements</dt><dd>[{result.simulation.start}, {result.simulation.end}[</dd><dt>Temps effectivement atteint</dt><dd>{result.simulation.finalTime}</dd><dt>Appels à run()</dt><dd>{result.simulation.runCalls} (appels à l’ordonnanceur)</dd><dt>Moteur / adaptateur</dt><dd>{result.diagnostics.engineVersion} / {result.diagnostics.adapterVersion}</dd>{result.observations.map(o => <div className="observation-detail" key={o.component}><dt>Observation {o.component}</dt><dd>{o.samples.length} points · pas {o.samplingInterval}</dd></div>)}</dl><p className="muted small">Les appels à run() ne dénombrent pas des événements physiques. L’observation est rééchantillonnée, fermée et dédupliquée par Irritator.</p></div>}
    </>}
  </section>;
}
