'use client';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { accessibleBiomass, applyTerritorialZone, conditionUnits, initialTerritorialBiomass, validateGeography, validateRequest, type RunRequest, type TerritoryGeography } from '@contracts';
import { territoryDemo } from '@/lib/modeling/territory-demo';
import { scientificFingerprint } from '@/lib/modeling/model';
import { errorText, type HttpResult } from '@/lib/api/client';
import { normalizeRun } from '@/lib/simulation/trajectory';
import { TerritoryMap } from './territory-map';
import { FishingActivityEditor } from './fishing-activity-editor';

const fmt = (value?: number) => value !== undefined && Number.isFinite(value) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value) : 'Non disponible';
const exactRatio = (value?: number) => value === undefined ? 'Non disponible' : String(value).replace('.', ',');
export function TerritoryWorkspace({ request, result, resultRequest, busy, onApply, onSimulation, documentError, journeyStep, journeyScientific }: { journeyStep?: 'zone' | 'activity'; journeyScientific?: boolean; request: RunRequest; result?: HttpResult; resultRequest?: RunRequest; busy: boolean; onApply: (request: RunRequest) => void; onSimulation: () => void; documentError?: string }) {
  const [geography, setGeography] = useState<TerritoryGeography | undefined>(request.territory?.geography);
  const [selection, setSelection] = useState(request.territory?.zoneId);
  const [localScientific, setScientific] = useState(false), [error, setError] = useState('');
  const [localStep, setStep] = useState<'zone' | 'activity' | 'summary'>('zone');
  const scientific = journeyScientific ?? localScientific;
  const step = journeyStep === 'zone' ? 'zone' : journeyStep === 'activity' ? (localStep === 'summary' ? 'summary' : 'activity') : localStep;
  useEffect(() => { setGeography(request.territory?.geography); setSelection(request.territory?.zoneId); setError(''); }, [request.territory]);
  const zone = geography?.features.find(f => f.properties.id === selection && f.properties.role === 'zone')?.properties;
  const prepared = useMemo(() => {
    if (!geography || !selection) return undefined;
    try { const next = applyTerritorialZone(request, geography, selection); validateRequest(next); return { next }; }
    catch (e) { return { error: errorText(e) }; }
  }, [request, geography, selection]);
  const applied = !!zone && !!prepared?.next && JSON.stringify(request.territory) === JSON.stringify(prepared.next.territory);
  const observation = useMemo(() => result && resultRequest ? normalizeRun(result, resultRequest).flatMap(r => r.series.filter(s => s.kind === 'biomass_total' && s.unit === 't').map(s => s.points.at(-1))).find(Boolean) : undefined, [result, resultRequest]);
  const biomass = result ? observation?.value : initialTerritorialBiomass(request);
  const available = accessibleBiomass(biomass, zone?.accessibility);
  const illustrative = geography?.demonstration || /pédagog|non calibr/i.test((result ? resultRequest : request)?.temporal?.provenance ?? '');
  const pendingResult = !!result && !!zone && (!applied || !resultRequest || scientificFingerprint(request) !== scientificFingerprint(resultRequest));
  const load = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try { if (file.size > 750000) throw new Error('GeoJSON trop volumineux (750 ko maximum).'); const data: unknown = JSON.parse(await file.text()); validateGeography(data); setGeography(data); setSelection(undefined); setError(''); }
    catch (e) { setError(`Chargement impossible · ${errorText(e)} La sélection précédente est conservée.`); }
  };
  return <section className="territory-workspace" aria-label="Territoire — Lac de Guiers">
    {!journeyStep && <div className="territory-heading"><div><span className="workshop-eyebrow">NIVEAU 2 · LAC DE GUIERS</span><h1>{step === 'zone' ? 'Choisir une zone de pêche' : step === 'activity' ? 'Comment allez-vous pêcher ?' : 'Résumé de l’activité'}</h1></div><div className="audience-toggle" role="group" aria-label="Lecture du territoire"><button aria-pressed={!scientific} onClick={() => setScientific(false)}>Pêcheur</button><button aria-pressed={scientific} onClick={() => setScientific(true)}>Scientifique</button></div></div>}
    {documentError && <p className="error-banner" role="alert">{scientific ? documentError : documentError.startsWith('Import impossible') ? 'Import impossible. Votre document précédent est conservé.' : 'L’opération n’a pas abouti. Vos données sont conservées.'}</p>}
    {!journeyStep && <nav className="activity-steps" aria-label="Préparation de la pêche"><button aria-current={step === 'zone' ? 'step' : undefined} onClick={() => setStep('zone')}>1 · Sélection de zone</button><button disabled={!applied} aria-current={step === 'activity' ? 'step' : undefined} onClick={() => setStep('activity')}>2 · Décrire l’activité</button><button disabled={!applied} aria-current={step === 'summary' ? 'step' : undefined} onClick={() => setStep('summary')}>3 · Résumé</button></nav>}
    <div hidden={step !== 'zone'}>
    {scientific && <div className="territory-files"><label className="geography-upload">Charger un GeoJSON local<input type="file" accept=".geojson,.json,application/geo+json,application/json" aria-label="Charger un GeoJSON local" onChange={e => void load(e)} disabled={busy}/></label><button disabled={busy} onClick={() => { setGeography(structuredClone(territoryDemo)); setSelection(undefined); setError(''); }}>Essayer la démonstration fictive</button></div>}
    {geography?.demonstration && <p className="territory-demo" role="status">Carte de démonstration — zones fictives.{journeyStep && <> Exemple fictif — ce ne sont pas les limites du lac.</>}</p>}
    {geography && !geography.demonstration && <p className="territory-source">Contours fournis par l’animateur — limites non certifiées.{scientific && <> Source déclarée : {geography.source}.</>}</p>}
    {error && <p className="error-banner" role="alert">{scientific ? error : 'La carte n’a pas pu être mise à jour. Votre choix précédent est conservé.'}</p>}
    <div className="territory-layout"><article className="territory-map-card">
      {geography?.features.length ? <TerritoryMap key={geography.id} geography={geography} selected={selection} onSelect={setSelection} scientific={scientific}/> : <div className="territory-empty"><h2>Les zones restent à renseigner</h2>{scientific ? <><p>Aucun contour ni zone validés ne sont fournis pour le lac.</p><p>Chargez vos données locales ou ouvrez la démonstration fictive.</p></> : <p>La carte sera préparée pour l’atelier.</p>}</div>}
      <div className="territory-zone-list" role="group" aria-label="Zones de pêche">{geography?.features.filter(f => f.properties.role === 'zone').map(f => <button key={f.properties.id} aria-pressed={selection === f.properties.id} onClick={() => setSelection(f.properties.id)}>{selection === f.properties.id ? '✓ ' : ''}{f.properties.name}</button>)}</div>
      {geography && !geography.features.some(f => f.properties.role === 'zone') && <p className="unavailable">{scientific ? 'Aucune zone de pêche dans ce fichier.' : 'Aucune zone de pêche disponible pour le moment.'}</p>}
    </article><aside className="territory-details" aria-live="polite">
      <span className="workshop-eyebrow">ZONE CHOISIE</span><h2>{zone?.name ?? 'Sélectionnez une zone'}</h2>
      <p className={`territory-config ${applied ? 'applied' : ''}`}>{scientific ? applied ? '✓ Configuration appliquée' : 'Configuration en préparation' : applied ? '✓ Zone confirmée' : 'Zone à confirmer'}</p>
<dl className="territory-metrics"><div><dt>{scientific ? 'N(t) · biomasse globale' : 'Poissons dans tout le lac'}</dt><dd>{fmt(biomass)}{biomass !== undefined ? ' t' : ''}</dd></div><div><dt>{scientific ? 'a_z · sans dimension' : 'Accès aux poissons'}</dt><dd>{scientific ? exactRatio(zone?.accessibility) : zone?.accessibility !== undefined ? `${fmt(zone.accessibility * 100)} %` : 'Non disponible'}</dd></div><div className="accessible-metric"><dt>{scientific ? 'a_z × N(t)' : 'Poissons accessibles dans cette zone'}</dt><dd>{fmt(available)}{available !== undefined ? ' t' : ''}</dd></div></dl>
      <p className="territory-biomass-source">{scientific ? result ? `Dernière observation native${observation ? ` · t = ${fmt(observation.time)} mois` : ' indisponible'}. Résultat de la configuration calculée, indépendant du choix en préparation.` : 'État initial du modèle reconnu · tonnes. Paramètres pédagogiques, non calibrés pour le lac.' : <>{result ? observation ? `Dernier résultat · mois ${fmt(observation.time)}.` : 'Résultat indisponible.' : 'Valeurs au début de la simulation.'}{illustrative && ' Valeurs illustratives.'}{pendingResult && ' Le choix en préparation n’a pas encore été simulé.'}</>}</p>
      {prepared?.error && <p role="status">{scientific ? prepared.error : 'Cette zone n’est pas encore prête pour la simulation. L’animateur peut compléter ses informations.'}</p>}
      <button className="primary territory-apply" disabled={busy || !prepared?.next || applied} onClick={() => { try { if (prepared?.next) { validateRequest(prepared.next); onApply(prepared.next); setError(''); } } catch (e) { setError(errorText(e)); } }}>Confirmer cette zone</button>
      <button disabled={busy || !applied} onClick={onSimulation}>Préparer la simulation</button>
      {applied && !journeyStep && <button className="primary" disabled={busy} onClick={() => setStep('activity')}>Comment allez-vous pêcher ?</button>}
      {request.territory && !applied && <p>{scientific ? 'Configuration appliquée' : 'Zone confirmée'} : {request.territory.geography.features.find(f => f.properties.id === request.territory!.zoneId)?.properties.name}.{scientific && ' Les résultats restent associés à la configuration calculée.'}</p>}
      {scientific && <div className="territory-science"><h3>Traçabilité scientifique</h3><dl><dt>Identifiant de zone</dt><dd>{zone?.id ?? 'Non disponible'}</dd><dt>Référence géographique</dt><dd>{geography?.id ?? 'Non disponible'}</dd><dt>Source géographique</dt><dd>{geography?.source ?? 'Non disponible'}</dd><dt>Provenance de a_z</dt><dd>{zone?.provenance ?? 'Non disponible'}</dd><dt>Paramètre transmis</dt><dd>a(t) = a_z = {exactRatio(zone?.accessibility)} · initialisation du graphe et compilateur temporel communs.</dd><dt>Configuration calculée</dt><dd>{resultRequest?.territory ? `${resultRequest.territory.zoneId} · a = ${exactRatio(resultRequest.territory.accessibility)}` : 'Aucune sélection territoriale calculée'}</dd></dl><p>Une biomasse globale unique N(t). Aucun stock local, aucune déduction par la surface. a_z × N(t) est une lecture algébrique, sans intégration biologique côté navigateur.</p><p>Une seule zone et un accès constant pour cet incrément. Les changements temporels de a et les simulations multi-zones sont réservés à la suite.</p></div>}
      {scientific && <details className="territory-science"><summary>Paramètres transmis au modèle</summary><dl>{Object.entries((prepared?.next ?? request).temporal?.parameters ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value).replace('.', ',')} {conditionUnits[key as keyof typeof conditionUnits]}</dd></div>)}</dl><p>Scénario : {(prepared?.next ?? request).temporal?.scenario ?? 'Non disponible'}. Le compilateur temporel existant produit les signaux DEVS ; les états N et C restent intégrés par Irritator.</p></details>}
    </aside></div>
    </div>
    {journeyStep === 'activity' && (!request.territory || !request.temporal) && <p>Les sorties ne sont pas encore renseignées. L’animateur peut préparer une zone ; vous pouvez aussi continuer vers votre premier choix.</p>}
    {request.territory && request.temporal && <div hidden={step === 'zone'}><FishingActivityEditor guided={!!journeyStep} key={`${request.territory.geography.id}/${request.territory.zoneId}/${request.temporal.scenario}`} request={request} scientific={scientific} summary={step === 'summary'} busy={busy} onApply={onApply} onSummary={() => setStep('summary')} onEdit={() => setStep('activity')} onSimulation={onSimulation}/></div>}
  </section>;
}
