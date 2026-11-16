'use client';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { RunRequest } from '@contracts';
import type { DecisionSnapshot, Presentation, ScenarioId, WorkshopDecisionRecord, WorkshopSessionV1 } from '../../../../packages/contracts/workshop-session';
import { addRecord, compareDecisions, createSession, updateRecord } from '@/lib/workshop/session';
import { choiceLabel, scenarios, sourceLabels, confidenceLabels } from '@/lib/workshop/scenarios';
import { decisionsStorageKey, maxSessionBytes, parseSession, saveSession, serializeSession } from '@/lib/serialization/workshop-session';
import { downloadFile } from '@/lib/serialization/workspace';
import { scientificFingerprint } from '@/lib/modeling/model';
import { normalizeRun } from '@/lib/simulation/trajectory';
import { errorText, type HttpResult } from '@/lib/api/client';
import { DecisionForm } from './decision-form';
import { GeoAtlasMap } from '@/components/territory/geo-atlas-map';
import { geoSupportVersion, visibleGeoFeatures } from '@/components/territory/geo-atlas-workspace';
import { useGeoAtlas, type AtlasController } from '@/lib/workshop/geo-atlas';

const steps = ['Notre lac', 'Nos sorties', 'Votre premier choix', 'Voyons ce qui se passe', 'Votre choix maintenant', "Ce qu'on en retient"];
type Props = {
  request: RunRequest; resultRequest?: RunRequest; result?: HttpResult; busy: boolean; error?: string;
  territory: (step: 'zone' | 'activity', scientific: boolean, next: () => void, showResults: boolean, atlas: AtlasController) => ReactNode;
  simulation: (active: boolean) => ReactNode; onRun: () => void; onAudience: (scientific: boolean) => void;
};
export function LevelTwoJourney({ request, result, resultRequest, busy, error: engineError, territory, simulation, onRun, onAudience }: Props) {
  const atlasController = useGeoAtlas();
  const [step, setStep] = useState(0), [scientific, setScientific] = useState(false), [authorized, setAuthorized] = useState(false);
  const [session, setSession] = useState<WorkshopSessionV1>(() => createSession());
  const [recordId, setRecordId] = useState<string>(), [scenarioId, setScenarioId] = useState<ScenarioId>('S1-captures');
  const [participant, setParticipant] = useState(''), [group, setGroup] = useState('');
  const [previousId, setPreviousId] = useState<string>(), [revision, setRevision] = useState(0), [project, setProject] = useState(false);
  const [support, setSupport] = useState<Presentation['kind']>('discussion-card'), [note, setNote] = useState('');
  const [message, setMessage] = useState('Démonstration sans collecte : aucune réponse personnelle enregistrée.'), [error, setError] = useState('');
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const mapSource = atlasController.atlas.sources.find(s => s.id === atlasController.atlas.features.find(f => f.properties.kind === 'water-outline' && f.properties.evidence === 'reference-outline')?.properties.sourceId);
  const storageBlocked = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const record = session.records.find(r => r.id === recordId), scenario = scenarios[record?.scenarioId ?? scenarioId];
  const permitted = !authorized || !!record?.before;
  const presented = !authorized || !!record?.presentation;
  const actualNative = !!result && !engineError && !!resultRequest && resultRequest.schemaVersion === 3 && !!resultRequest.temporal && normalizeRun(result, resultRequest).some(r => r.series.some(s => s.kind === 'biomass_total' && s.points.length));
  useEffect(() => { try { const exists = !!localStorage.getItem(decisionsStorageKey); setRestoreAvailable(exists); storageBlocked.current = exists; if (exists) setMessage('Une séance locale est disponible. Restaurez-la avant de sauvegarder de nouvelles réponses.'); } catch { storageBlocked.current = true; setError('Le stockage de ce navigateur est indisponible.'); } }, []);
  const go = (next: number, saved = false) => {
    if (!saved && authorized && (next >= 3 && !record || next >= 4 && !record?.presentation)) { setError('Enregistrez le premier choix, puis faites confirmer le support présenté.'); return; }
    if (next !== 5) setProject(false);
    setStep(next); setTimeout(() => heading.current?.focus(), 0);
  };
  const audience = (value: boolean) => { setScientific(value); onAudience(value); };
  const commit = (next: WorkshopSessionV1) => {
    // Keep valid in-memory work even when a quota fails, but do not overwrite a corrupt archive.
    setSession(next); setError('');
    if (storageBlocked.current) { setError('La sauvegarde illisible est conservée. Exportez la séance ou importez une séance valide.'); return; }
    try { saveSession(localStorage, next, authorized); setRestoreAvailable(true); setMessage('Choix enregistré et sauvegardé dans ce navigateur.'); }
    catch (e) { setError(errorText(e)); }
  };
  const first = (before: DecisionSnapshot) => {
    try {
      if (record) commit(updateRecord(session, record.id, { before }, authorized));
      else {
        const t = request.territory;
        const next: WorkshopDecisionRecord = { id: crypto.randomUUID(), participantCode: participant, ...(group ? { groupCode: group } : {}), scenarioId, scenarioVersion: 1, activityIds: request.fishingActivities?.activities.map(a => a.id) ?? [], before,
          ...(t ? { territory: { geographyId: t.geography.id, zoneId: t.zoneId, label: t.geography.features.find(f => f.properties.id === t.zoneId)?.properties.name, origin: t.geography.demonstration ? 'demonstration' as const : 'supplied' as const } } : {}), ...(previousId ? { attemptsPreviousId: previousId } : {}) };
        const nextSession = addRecord(session, next, authorized); commit(nextSession); setRecordId(next.id);
      }
      go(3, true);
    } catch (e) { setError(errorText(e)); }
  };
  const acknowledge = () => {
    try {
      if (!record || !authorized) throw new Error('Enregistrez d’abord le premier choix avec une collecte autorisée.');
      const presentedAt = new Date().toISOString();
      let presentation: Presentation;
      if (support === 'native-simulation') {
        if (scenario.id !== 'S1-captures' || !actualNative || !result || !resultRequest) throw new Error('Aucun résultat du moteur ne peut être attesté. Choisissez une discussion.');
        presentation = { kind: support, presentedAt, runId: result.runId, modelId: resultRequest.model.id, requestSchemaVersion: 3, modelFingerprint: scientificFingerprint(resultRequest), assumptionsNote: note || 'Modèle pédagogique non calibré pour le lac. Biomasse globale unique ; activités déclarées non converties en effort.' };
      } else presentation = { kind: support, presentedAt, supportId: `${scenario.id}-${support}-v1`, note: support === 'discussion-map' && atlasController ? `${geoSupportVersion}; atlas=${atlasController.atlas.id}; revision=${atlasController.atlas.revision}; vue=${atlasController.privateView ? 'privee' : 'publique-protegee'}; ${note}`.slice(0,500) : note };
      commit(updateRecord(session, record.id, { presentation }, authorized)); go(4, true);
    } catch (e) { setError(errorText(e)); }
  };
  const fresh = (id: ScenarioId, previous?: WorkshopDecisionRecord) => {
    setScenarioId(id); setRecordId(undefined); setPreviousId(previous?.id); setRevision(n => n + 1); setProject(false); setSupport(id === 'S2-reserve' ? 'discussion-map' : 'discussion-card'); setNote('');
    if (previous) { setParticipant(previous.participantCode); setGroup(previous.groupCode ?? ''); }
    go(2);
  };
  const restore = () => {
    try { const stored = localStorage.getItem(decisionsStorageKey); if (stored) { const next = parseSession(stored); setSession(next); setRecordId(undefined); setPreviousId(undefined); setProject(false); setRevision(n => n + 1); setMessage('Séance restaurée. Choisissez une fiche dans la préparation.'); storageBlocked.current = false; } }
    catch (e) { storageBlocked.current = true; setError(`${errorText(e)} La sauvegarde existante est conservée.`); }
  };
  const importSession = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !authorized) return;
    try {
      if (file.size > maxSessionBytes) throw new Error('Séance trop volumineuse (8 Mio maximum).');
      const next = parseSession(await file.text());
      if (!window.confirm('Remplacer la séance de décisions courante par ce fichier ? Exportez auparavant les réponses à conserver. Le modèle scientifique reste séparé.')) return;
      saveSession(localStorage, next, authorized); storageBlocked.current = false; setSession(next); setRecordId(undefined); setPreviousId(undefined); setRevision(n => n + 1); setRestoreAvailable(true); setError(''); setMessage('Séance importée et sauvegardée.');
    } catch (e) { setError(`${errorText(e)} La séance précédente est conservée.`); }
  };
  const exportSession = () => { try { if (!authorized) throw new Error('Collecte désactivée.'); downloadFile(serializeSession(session), 'atelier-decisions.json'); setMessage('Séance exportée. Le navigateur n’est pas une archive durable.'); } catch (e) { setError(errorText(e)); } };
  const completed = [!!request.territory, !!request.fishingActivities?.activities.length, !!record?.before, !!record?.presentation, !!record?.after, !!record?.after];
  const reviewLabels = { maintained: 'Choix maintenu', changed: 'Choix modifié', uncertain: 'Encore incertain', 'not-comparable': 'Non comparable' };
  return <section className={`level-two-journey${project ? ' anonymous-review' : ''}`} aria-label="Parcours de l’atelier">
    <div className="journey-heading"><div><span className="workshop-eyebrow">ENSEMBLE AUTOUR DU LAC</span><h1>Observer, choisir, en parler</h1><p>Votre avis compte. Il n’y a pas de bonne réponse attendue.</p></div><div className="audience-toggle" role="group" aria-label="Lecture de l’atelier"><button aria-pressed={!scientific} onClick={() => audience(false)}>Pêcheur</button><button aria-pressed={scientific} onClick={() => audience(true)}>Scientifique</button></div></div>
    <nav className="journey-steps" aria-label="Étapes de l’atelier">{steps.map((label, i) => <button key={label} aria-current={step === i ? 'step' : undefined} disabled={i === 3 && !permitted || i >= 4 && !presented} onClick={() => go(i)}><span>{i + 1}</span>{label}<small>{completed[i] ? 'Renseigné' : 'Non renseigné'}</small></button>)}</nav>
    <div className="journey-status" role="status">{authorized ? `${record?.before ? 'Premier choix enregistré' : 'Premier choix non renseigné'} · ${record?.presentation ? 'Support présenté' : 'Présentation non confirmée'} · ${record?.after ? 'Second choix enregistré' : 'Second choix non renseigné'}` : 'Démonstration sans collecte'}</div>
    {scientific && <details className="session-controls" open><summary>Préparation de l’animateur et séance</summary>
      <p>Codes pseudonymes uniquement, sans nom ni téléphone, y compris dans les textes libres. L’information des personnes et l’autorisation de collecte relèvent du protocole institutionnel ; cette confirmation ne suffit pas à elle seule.</p>
      <label><input type="checkbox" checked={authorized} onChange={e => { setAuthorized(e.target.checked); setProject(false); setMessage(e.target.checked ? 'Collecte activée par l’animateur pour cette utilisation.' : 'Démonstration sans collecte. Les fiches déjà autorisées restent conservées localement.'); }}/>Je confirme que la collecte est autorisée dans le cadre du protocole de recherche</label>
      <div className="session-fields"><label>Situation de discussion<select aria-label="Situation de discussion" disabled={!!record} value={scenarioId} onChange={e => fresh(e.target.value as ScenarioId)}>{Object.values(scenarios).map(s => <option key={s.id} value={s.id}>{s.id.slice(0, 2)} · {s.title}</option>)}</select></label>
      <label>Code participant (pseudonyme)<input aria-label="Code participant (pseudonyme)" maxLength={32} placeholder="P-01" disabled={!!record} value={participant} onChange={e => setParticipant(e.target.value)}/></label><label>Code groupe (facultatif)<input aria-label="Code groupe (facultatif)" maxLength={128} disabled={!!record} value={group} onChange={e => setGroup(e.target.value)}/></label></div>
      {authorized && <><label>Fiches de cette séance<select aria-label="Fiches de cette séance" value={recordId ?? ''} onChange={e => { const r = session.records.find(v => v.id === e.target.value); setPreviousId(undefined); setProject(false); setRecordId(r?.id); if (r) { setScenarioId(r.scenarioId); setParticipant(r.participantCode); setGroup(r.groupCode ?? ''); setSupport(r.presentation?.kind ?? (r.scenarioId === 'S2-reserve' ? 'discussion-map' : 'discussion-card')); } setRevision(n => n + 1); go(2); }}><option value="">Nouvelle fiche</option>{session.records.map((r, i) => <option key={r.id} value={r.id}>{i + 1} · {r.participantCode} · {r.scenarioId} · {r.after ? 'complète' : 'en cours'}</option>)}</select></label>
      <div className="journey-actions"><button onClick={exportSession}>Exporter les réponses de l’atelier</button><label className="session-import">Importer une séance<input type="file" aria-label="Importer une séance" accept=".json,application/json" onChange={e => void importSession(e)}/></label><button disabled={!restoreAvailable} onClick={restore}>Restaurer la séance locale</button><button onClick={() => { if (window.confirm('Effacer uniquement les décisions de ce navigateur ? Exportez d’abord les réponses à conserver. Les fichiers exportés et les modèles ne seront pas effacés.')) { try { localStorage.removeItem(decisionsStorageKey); setSession(createSession()); setRecordId(undefined); setPreviousId(undefined); setRevision(n => n + 1); storageBlocked.current = false; setRestoreAvailable(false); setMessage('Décisions locales effacées.'); } catch { setError('Effacement local impossible.'); } } }}>Effacer les décisions locales</button><button onClick={() => { try { if (storageBlocked.current) throw new Error('Restaurez ou importez la séance avant de la sauvegarder.'); saveSession(localStorage, session, authorized); setMessage('Séance sauvegardée dans ce navigateur.'); } catch (e) { setError(errorText(e)); } }}>Sauvegarder la séance</button></div></>}
      <div className="journey-actions"><button disabled={!record} onClick={() => fresh(scenarioId, record)}>Nouvel essai chaîné</button><button onClick={() => { fresh(scenarioId); setParticipant(''); setGroup(''); }}>Nouveau participant</button></div>
      <p>Protocole mbane-decision-before-after-v1 · {session.records.length} fiche(s). La collecte décrit des déclarations ; aucun lien causal ni comportement réel n’est démontré. Les calculs Irritator restent indépendants.</p>
    </details>}
    {message && scientific && <p role="status">{message}</p>}{error && <p role="alert" className="error-banner">{scientific ? error : 'L’enregistrement n’a pas abouti. L’animateur peut vérifier ; vos choix sont conservés.'}</p>}
    <h2 className="journey-step-title" ref={heading} tabIndex={-1}>{steps[step]}</h2>
    <div hidden={step > 1}>{territory(step === 1 ? 'activity' : 'zone', scientific, () => go(3), !authorized || !!record?.presentation, atlasController)}</div>
    <div hidden={step !== 2} className="journey-card"><span className="workshop-eyebrow">{scenario.id.slice(0, 2)} · SITUATION DE DISCUSSION · VERSION {scenario.version}</span><h3>{scenario.title}</h3><p className="scenario-question">{scenario.question}</p><p>{scenario.note}</p>
      {authorized ? <><p>Vous pouvez répondre avec l’aide de l’animateur.</p>{!participant && <p role="status">L’animateur doit renseigner un code participant dans la préparation.</p>}
      <DecisionForm key={`before-${revision}-${recordId ?? 'new'}-${scenario.id}`} scenarioId={scenario.id} initial={record?.before} disabled={!participant || !!record?.presentation} onSave={first}/>
      {record?.presentation && <p>Le premier choix est conservé. Pour le corriger, l’animateur crée un nouvel essai chaîné.</p>}</> : <p>Vous pouvez regarder et discuter sans enregistrer de réponse.</p>}
      <button onClick={() => { setAuthorized(false); setProject(false); go(3, true); }}>Je ne souhaite pas répondre</button>
    </div>
    <div hidden={step !== 3} className="journey-presentation">
      {permitted && <><div className="journey-card"><h3>{scenario.title}</h3><p>{scenario.question}</p><p>{scenario.note}</p><label>Support à présenter<select aria-label="Support à présenter" disabled={!!record?.presentation && authorized} value={support} onChange={e => setSupport(e.target.value as Presentation['kind'])}>{scenario.supports.map(kind => <option key={kind} value={kind}>{{ 'native-simulation': 'Simulation calculée par Irritator', 'discussion-map': 'Carte et discussion — limites non certifiées', 'discussion-card': 'Carte de discussion — aucun calcul' }[kind]}</option>)}</select></label>
      {support === 'discussion-map' && <><p>Le plan CLPA demande une étude et un balisage près de Témeye-Toucouleur. Leur réalisation et la limite sud restent à vérifier. Aucun contour de réserve n’est tracé.</p>{atlasController ? <><p>{mapSource ? `Contour de référence : ${mapSource.title} · ${mapSource.geometryValidAt}` : 'Fond géographique réel manquant.'}</p><GeoAtlasMap features={visibleGeoFeatures(atlasController.atlas, atlasController.privateView)} onSelect={() => {}}/>{mapSource && <p className="geo-attribution">{mapSource.attribution} · {mapSource.license}</p>}<p>{atlasController.privateView ? 'Travail privé : ne pas projeter les lieux sensibles.' : 'Projection protégée : lieux privés masqués.'} Support {geoSupportVersion} · atlas {atlasController.atlas.id} · révision {atlasController.atlas.revision}</p></> : <p>Carte non fournie : discussion sur les lieux, sans tracer de limites inconnues.</p>}</>}
      {support !== 'native-simulation' && <article className="discussion-support"><h3>Support de discussion</h3><p>{scenario.id === 'S2-reserve' ? 'Où pensez-vous que passent les limites ? Quelles informations faudrait-il demander au CLPA ? Aucun contour officiel de réserve n’est fourni.' : scenario.id === 'S3-couts' ? 'Quelles dépenses augmentent ? Que faudrait-il connaître sur les prix, le carburant et le temps de recherche avant de choisir ?' : 'Quelles observations permettraient de discuter les témoignages contradictoires sur les prises ?'}</p><p>Ce support ne représente ni une prévision ni une règle applicable.</p><small>Support versionné : {scenario.id}-{support}-v1</small></article>}
      {support === 'native-simulation' && <><p>Modèle illustratif : les valeurs ne sont pas une estimation du lac. Les sorties déclarées ne sont pas utilisées pour calculer les prises.</p><button className="primary" disabled={busy || !request.temporal || !request.territory} onClick={onRun}>{busy ? 'Calcul en cours…' : 'Lancer la simulation Irritator'}</button>{!request.territory && <p>Confirmez une zone pour calculer ce modèle territorial. La discussion reste possible.</p>}{engineError && <p role="alert">La simulation n’a pas abouti. Le premier choix est conservé ; choisissez un support de discussion.</p>}</>}
      {scientific && authorized && <><label>Notes sur le support et les hypothèses (facultatif)<textarea aria-label="Notes sur le support et les hypothèses (facultatif)" maxLength={500} value={note} disabled={!!record?.presentation} onChange={e => setNote(e.target.value)}/></label><p>Un calcul terminé ne signifie pas que le résultat a été présenté.</p><button className="primary" disabled={busy || !record || !!record.presentation || support === 'native-simulation' && !actualNative} onClick={acknowledge}>Confirmer que ce support a été présenté</button>{record?.presentation?.kind === 'native-simulation' && <p>Exécution présentée : {record.presentation.runId}</p>}</>}
      {!scientific && authorized && !record?.presentation && <p>L’animateur confirme la présentation avant votre second choix.</p>}</div>
      </>}
      {simulation(step === 3 && support === 'native-simulation' && permitted)}
    </div>
    <div hidden={step !== 4} className="journey-card">{authorized && record?.presentation ? <><h3>{record.presentation.kind === 'native-simulation' ? 'Après la simulation' : 'Après la discussion'}</h3><p>Avant : {choiceLabel(record.scenarioId, record.before.choiceId)}{record.before.otherChoice ? ` — ${record.before.otherChoice}` : ''}</p><DecisionForm key={`after-${revision}-${recordId}`} after scenarioId={record.scenarioId} initial={record.after} disabled={!!record.after} onSave={after => { try { commit(updateRecord(session, record.id, { after }, authorized)); go(5); } catch (e) { setError(errorText(e)); } }}/></> : <p>{authorized ? 'Enregistrez le premier choix, puis faites confirmer le support présenté.' : 'Démonstration : discutez de ce que vous maintiendriez ou changeriez, sans conservation de réponse.'}</p>}</div>
    <div hidden={step !== 5} className="journey-card">
      {authorized && record?.after ? <>{scientific && <button aria-pressed={project} onClick={() => setProject(v => !v)}>{project ? 'Masquer la restitution projetable' : 'Afficher la restitution anonyme'}</button>}
      {project ? <p>Restitution anonyme choisie par l’animateur. Vérifier aussi les textes libres avec les participants avant projection.</p> : <p>Restitution individuelle. Activez explicitement l’affichage anonyme pour projeter.</p>}
      {(!scientific || project) && <div className="decision-review"><p className="review-badge">{reviewLabels[compareDecisions(record)]}</p><div className="review-pair"><article><h3>Avant</h3><p>{choiceLabel(record.scenarioId, record.before.choiceId)}</p>{!project && <p>{record.before.otherChoice}</p>}<h4>Pourquoi</h4><p>{project ? 'Justification masquée pour la projection.' : record.before.reasons || 'Non renseigné'}</p>{!project && <><p>Sources : {record.before.sources.map(s => sourceLabels[s]).join(', ') || 'Non renseigné'}</p><p>Confiance : {confidenceLabels[record.before.confidence]}</p><p>À vérifier : {record.before.missingInformation || 'Non renseigné'}</p></>}</article><article><h3>Maintenant</h3><p>{choiceLabel(record.scenarioId, record.after.choiceId)}</p>{!project && <p>{record.after.otherChoice}</p>}<h4>Pourquoi</h4><p>{project ? 'Justification masquée pour la projection.' : record.after.reasons || 'Non renseigné'}</p>{!project && <><p>Sources : {record.after.sources.map(s => sourceLabels[s]).join(', ') || 'Non renseigné'}</p><p>Confiance : {confidenceLabels[record.after.confidence]}</p></>}</article></div><h3>À vérifier</h3><p>{project ? 'Questions individuelles masquées pour la projection.' : record.after.missingInformation || record.before.missingInformation || 'Non renseigné'}</p><p>{record.presentation?.kind === 'native-simulation' ? 'Modèle illustratif — hypothèses non calibrées.' : 'Support de discussion — aucun effet biologique ou économique calculé.'}</p></div>}
      {scientific && !project && <p>Les réponses restent privées. Passez en lecture Pêcheur pour la restitution individuelle ou choisissez explicitement la restitution anonyme.</p>}</> : <p>Aucune paire de choix à comparer. Il n’y a ni note ni classement.</p>}
      <div className="journey-actions"><button onClick={() => go(0)}>Revenir à la carte</button><button onClick={() => { fresh(scenarioId); audience(true); }}>Essayer une autre situation</button></div>
    </div>
    <div className="journey-actions journey-bottom">{step > 0 && <button onClick={() => go(step - 1)}>Retour</button>}{step < 5 && <button disabled={step === 2 && !permitted || step === 3 && !presented} onClick={() => go(step + 1)}>Continuer</button>}</div>
  </section>;
}
