'use client';
import { useEffect, useState } from 'react';
import type { RunResultV2 } from '@contracts';

export function WrapperResults({ result }: { result: RunResultV2 }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [result]);
  return <div className="data-area wrapper-results" aria-label="Événements natifs du wrapper">
    <div className="wrapper-summaries">{result.wrappers.map(w => <p key={w.component} data-testid={`wrapper-summary-${w.component}`}><strong>{w.component}</strong> · {w.scenarioCount} scénarios configurés · {w.inputs} entrées · {w.outputs.length} sorties · critères {w.criteriaScale === 'normalized' ? 'normalisés (weighted-sum)' : 'bruts'}</p>)}</div>
    <p className="small muted">Émissions natives, dans l’ordre reçu. Le temps est celui du parent ; bag est un numéro local de sac. Les observations parent rééchantillonnées sont dans Trajectoires. Plan prêt : [nombre réel, identifiant du plan, campagne]. Fin de campagne : [nombre valide, nombre réel, campagne].</p>
    {!result.resultEvents.length ? <p className="wrapper-empty" role="status">Aucune décision émise par le moteur. Sans commande DEVS sur run, sans candidat admissible ou si la réponse est hors de l’horizon parent, aucun résultat de wrapper n’est produit.</p> : <>
      <table data-testid="wrapper-events"><thead><tr><th>Wrapper</th><th>Temps parent</th><th>Port</th><th>Critère / facteur</th><th>Valeur émise</th><th>Triplet complet</th><th>bag</th><th>Capacité configurée</th></tr></thead><tbody>
        {result.resultEvents.slice(page * 100, (page + 1) * 100).map((event, index) => {
          const layout = result.wrappers.find(w => w.component === event.component)!;
          const output = layout.outputs.find(p => p.port === event.port)!;
          return <tr key={`${page}-${index}`}><td>{event.component}</td><td>{String(event.time)}</td><td>y[{event.port}]</td><td>{output.id} · {output.kind === 'selection' ? 'critère' : output.kind === 'factor' ? 'facteur' : output.kind}</td><td>{String(event.value[0])}</td><td>[{event.value.join(', ')}]</td><td>{event.bag}</td><td>{layout.scenarioCount}</td></tr>;
        })}
      </tbody></table>
      {result.resultEvents.length > 100 && <div className="pagination"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Précédent</button><span>{page + 1} / {Math.ceil(result.resultEvents.length / 100)}</span><button disabled={(page + 1) * 100 >= result.resultEvents.length} onClick={() => setPage(p => p + 1)}>Suivant</button></div>}
    </>}
  </div>;
}
