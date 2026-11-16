'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { activityIndicators, canoeCategories, fishingActivityUnits, gearCategories, validateFishingActivities, validateRequest, type FishingActivity, type FishingGroup, type RunRequest } from '@contracts';
import { errorText } from '@/lib/api/client';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n);
const id = () => crypto.randomUUID();
const emptyGroup = (): FishingGroup => ({ id: id(), canoe: { category: 'small', count: 0 }, fishers: 0, tripsPerBoatPerMonth: 0, tripDurationHours: 0, gear: { category: 'net' } });
const optionalNumber = (value: string) => value.trim() ? Number(value) : undefined;
const requiredNumber = (value: string) => value.trim() ? Number(value) : NaN;
const shown = (n?: number) => n !== undefined && Number.isFinite(n) ? n : '';

/** Kept mounted by TerritoryWorkspace while navigating; only explicit saves enter the project. */
export function FishingActivityEditor({ request, scientific, summary, busy, onApply, onSummary, onEdit, onSimulation }: {
  request: RunRequest; scientific: boolean; summary: boolean; busy: boolean;
  onApply: (request: RunRequest) => void; onSummary: () => void; onEdit: () => void; onSimulation: () => void;
}) {
  const territory = request.territory!;
  const zone = territory.geography.features.find(f => f.properties.id === territory.zoneId)!.properties;
  const scenario = request.temporal!.scenario;
  const activities = request.fishingActivities?.activities ?? [];
  const matching = activities.filter(a => a.zone.geographyId === territory.geography.id && a.zone.zoneId === zone.id && a.scenario === scenario);
  const [selectedId, setSelectedId] = useState<string | undefined>(matching[0]?.id);
  const selected = matching.find(a => a.id === selectedId);
  const [period, setPeriod] = useState(selected?.period ?? { start: 0, end: request.simulation.end, unit: 'month' as const });
  const [provenance, setProvenance] = useState(selected?.provenance.note ?? 'Déclaration des pratiques prévues par les participants à l’atelier.');
  const [draft, setDraft] = useState<FishingGroup | undefined>();
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [deletion, setDeletion] = useState<string>();
  const formHeading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const deleteConfirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { setPeriod(selected?.period ?? { start: 0, end: request.simulation.end, unit: 'month' }); setProvenance(selected?.provenance.note ?? 'Déclaration des pratiques prévues par les participants à l’atelier.'); }, [selectedId]); // Keep unsaved fields across readings/steps.
  useEffect(() => { if (draft && !summary) formHeading.current?.focus(); }, [draft?.id, summary]);
  useEffect(() => { if (deletion) deleteConfirm.current?.focus(); }, [deletion]);
  const save = (groups: FishingGroup[]) => {
    const activity: FishingActivity = { id: selected?.id ?? id(), zone: { geographyId: territory.geography.id, zoneId: zone.id, name: zone.name }, scenario, period, provenance: { basis: 'declared', note: provenance }, groups };
    const next: RunRequest = { ...request, fishingActivities: { version: 1, units: { ...fishingActivityUnits }, activities: [...activities.filter(a => a.id !== activity.id), activity] } };
    validateFishingActivities(next); validateRequest(next);
    onApply(next); setSelectedId(activity.id); setError(''); setNotice('Activité enregistrée. Elle décrit la pêche prévue et ne modifie pas encore les résultats de simulation.');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    try { const groups = selected?.groups ?? []; save(draft ? groups.some(g => g.id === draft.id) ? groups.map(g => g.id === draft.id ? draft : g) : [...groups, draft] : groups); setDraft(undefined); addButton.current?.focus(); }
    catch (e) { const message = errorText(e); setError(!scientific && /JSON schema/i.test(message) ? 'Vérifiez les nombres et les descriptions saisis avant d’enregistrer.' : message); }
  };
  const totals = activityIndicators(selected?.groups ?? []);
  const update = (field: 'fishers' | 'tripsPerBoatPerMonth' | 'tripDurationHours', value: string) => setDraft(g => g && { ...g, [field]: requiredNumber(value) });
  const otherActivities = activities.filter(a => !matching.includes(a));
  return <div className="fishing-activity" aria-label="Activité de pêche">
    <div className="activity-context"><span className="activity-zone">✓ {zone.name}</span><p>Décrivez la pêche prévue pour cette période.</p></div>
    {notice && <p className="activity-notice" role="status">{notice}</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    <div className="activity-layout"><div>
      {!summary && <form onSubmit={submit} noValidate className="activity-card">
        <fieldset disabled={busy}><legend>Période de l’activité</legend>
          {matching.length > 0 && <label>Activité enregistrée<select aria-label="Activité enregistrée" value={selectedId ?? ''} onChange={e => { if (draft && !window.confirm('Abandonner la saisie du groupe en cours ?')) return; setSelectedId(e.target.value || undefined); setDraft(undefined); setError(''); setNotice(''); }}><option value="">Nouvelle période</option>{matching.map(a => <option key={a.id} value={a.id}>Du mois {fmt(a.period.start)} au mois {fmt(a.period.end)} (exclu)</option>)}</select></label>}
          <div className="activity-fields"><label>Début (mois)<input type="number" min="0" step="any" required value={shown(period.start)} onChange={e => setPeriod(p => ({ ...p, start: requiredNumber(e.target.value) }))}/></label><label>Fin (mois, exclue)<input type="number" min="0" step="any" required value={shown(period.end)} onChange={e => setPeriod(p => ({ ...p, end: requiredNumber(e.target.value) }))}/></label></div>
          <p className="activity-hint">Même activité chaque mois de cette période. Le mois 0 est le début de l’expérience.</p>
          {scientific && <label>Provenance de la déclaration<textarea maxLength={500} value={provenance} onChange={e => setProvenance(e.target.value)}/></label>}
        </fieldset>
        {draft && <fieldset disabled={busy} className="activity-group-form"><legend>Groupe de pêche</legend><h2 ref={formHeading} tabIndex={-1}>{selected?.groups.some(g => g.id === draft.id) ? 'Modifier le groupe' : 'Nouveau groupe'}</h2>
          <div className="activity-fields">
            <label>Catégorie de pirogue<select aria-label="Catégorie de pirogue" value={draft.canoe.category} onChange={e => setDraft(g => g && { ...g, canoe: { ...g.canoe, category: e.target.value as FishingGroup['canoe']['category'] } })}>{Object.entries(canoeCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            {draft.canoe.category === 'other' && <label>Précisez la pirogue<input maxLength={500} value={draft.canoe.description ?? ''} onChange={e => setDraft(g => g && { ...g, canoe: { ...g.canoe, description: e.target.value } })}/></label>}
            <label>Nombre de pirogues<input type="number" min="0" step="1" required value={shown(draft.canoe.count)} onChange={e => setDraft(g => g && { ...g, canoe: { ...g.canoe, count: requiredNumber(e.target.value) } })}/></label>
            <label>Pêcheurs mobilisés<input type="number" min="0" step="1" required value={shown(draft.fishers)} onChange={e => update('fishers', e.target.value)}/></label>
            <label>Sorties par pirogue et par mois<input type="number" min="0" step="1" required value={shown(draft.tripsPerBoatPerMonth)} onChange={e => update('tripsPerBoatPerMonth', e.target.value)}/></label>
            <label>Durée moyenne d’une sortie (h)<input type="number" min="0" step="any" required value={shown(draft.tripDurationHours)} onChange={e => update('tripDurationHours', e.target.value)}/></label>
            <label>Engin principal<select aria-label="Engin principal" value={draft.gear.category} onChange={e => setDraft(g => { if (!g) return g; const { netLengthM, meshSizeMm, ...gear } = g.gear; return { ...g, gear: { ...gear, category: e.target.value as FishingGroup['gear']['category'], ...(e.target.value === 'net' ? { netLengthM, meshSizeMm } : {}) } }; })}>{Object.entries(gearCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            {draft.gear.category === 'other' && <label>Précisez l’engin<input maxLength={500} value={draft.gear.description ?? ''} onChange={e => setDraft(g => g && { ...g, gear: { ...g.gear, description: e.target.value } })}/></label>}
          </div>
          <details className="activity-gear-details"><summary>Caractéristiques des engins (facultatif)</summary><div className="activity-fields">
            {(['count', ...(draft.gear.category === 'net' ? ['netLengthM', 'meshSizeMm'] as const : []), 'effectiveFishingHours', 'soakHours'] as const).map(key => <label key={key}>{{ count: 'Nombre d’engins', netLengthM: 'Longueur du filet (m)', meshSizeMm: 'Taille des mailles (mm)', effectiveFishingHours: 'Pêche effective par sortie (h)', soakHours: 'Durée de pose (h)' }[key]}<input type="number" min="0" step={key === 'count' ? '1' : 'any'} value={shown(draft.gear[key])} onChange={e => setDraft(g => { if (!g) return g; const gear = { ...g.gear }; const value = optionalNumber(e.target.value); if (value === undefined) delete gear[key]; else gear[key] = value; return { ...g, gear }; })}/></label>)}
          </div><label>Notes descriptives<textarea maxLength={500} value={draft.gear.notes ?? ''} onChange={e => setDraft(g => { if (!g) return g; const gear = { ...g.gear }; if (e.target.value.trim()) gear.notes = e.target.value; else delete gear.notes; return { ...g, gear }; })}/></label><p className="activity-hint">La pêche effective et la pose sont distinctes de la durée de sortie. Une pose peut se prolonger entre deux sorties.</p></details>
          {scientific && <p>Identifiant stable du groupe : <code>{draft.id}</code></p>}
        </fieldset>}
        <div className="activity-actions"><button className="primary" type="submit" disabled={busy}>{draft ? 'Enregistrer le groupe' : 'Enregistrer la période'}</button>{draft && <button type="button" onClick={() => { if (window.confirm('Abandonner la saisie du groupe en cours ?')) { setDraft(undefined); setError(''); addButton.current?.focus(); } }}>Annuler la saisie</button>}</div>
      </form>}
      <section className="activity-card" aria-label="Groupes enregistrés"><h2>Groupes de pêche</h2>
        {!selected?.groups.length && <p>Aucun groupe pour cette période. Une période sans sortie peut être enregistrée.</p>}
        {selected?.groups.map((g, i) => <article className="activity-group" key={g.id} aria-label={`Groupe ${i + 1}`}>
          <h3>Groupe {i + 1} · {canoeCategories[g.canoe.category]}{g.canoe.description ? ` · ${g.canoe.description}` : ''}</h3>
          <dl className="activity-group-values"><div><dt>Pirogues</dt><dd>{fmt(g.canoe.count)}</dd></div><div><dt>Pêcheurs</dt><dd>{fmt(g.fishers)}</dd></div><div><dt>Sorties / pirogue / mois</dt><dd>{fmt(g.tripsPerBoatPerMonth)}</dd></div><div><dt>Heures / sortie</dt><dd>{fmt(g.tripDurationHours)}</dd></div></dl>
          <p>Engin : {gearCategories[g.gear.category]}{g.gear.description ? ` · ${g.gear.description}` : ''}</p>
          <details><summary>Détails de l’engin</summary><dl>{(['count', 'netLengthM', 'meshSizeMm', 'effectiveFishingHours', 'soakHours'] as const).filter(key => g.gear[key] !== undefined).map(key => <div key={key}><dt>{{ count: 'Nombre d’engins', netLengthM: 'Longueur (m)', meshSizeMm: 'Mailles (mm)', effectiveFishingHours: 'Pêche effective (h / sortie)', soakHours: 'Pose (h)' }[key]}</dt><dd>{fmt(g.gear[key]!)}</dd></div>)}</dl><p>{g.gear.notes ?? 'Aucune note.'}</p></details>
          {scientific && <p>Identifiant : <code>{g.id}</code></p>}
          <div className="activity-actions"><button disabled={busy || !!draft} onClick={() => { setDraft(structuredClone(g)); setError(''); onEdit(); }}>Modifier le groupe {i + 1}</button><button disabled={busy || !!draft} onClick={() => setDeletion(g.id)}>Supprimer le groupe {i + 1}</button></div>
          {deletion === g.id && <div className="activity-delete" role="group" aria-label="Confirmer la suppression"><p>Supprimer ce groupe ? Cette action retire ses sorties du résumé.</p><button ref={deleteConfirm} onClick={() => { setDeletion(undefined); addButton.current?.focus(); }}>Conserver le groupe</button><button disabled={busy} onClick={() => { try { save(selected.groups.filter(row => row.id !== g.id)); setDeletion(undefined); addButton.current?.focus(); } catch (e) { setError(errorText(e)); } }}>Confirmer la suppression</button></div>}
        </article>)}
        <button ref={addButton} disabled={busy || !!draft} onClick={() => { setDraft(emptyGroup()); setError(''); onEdit(); }}>+ Ajouter un groupe</button>
      </section>
    </div><aside className="activity-card activity-summary" aria-label="Résumé de l’activité"><span className="workshop-eyebrow">ACTIVITÉ ENREGISTRÉE</span><h2>Votre pêche prévue</h2>
      <p>{selected ? `Du mois ${fmt(selected.period.start)} au mois ${fmt(selected.period.end)} (exclu)` : 'Aucune période enregistrée'}</p>
      <dl className="activity-totals"><div><dt>Sorties-pirogue/mois</dt><dd>{fmt(totals.canoeTripsPerMonth)}</dd></div><div><dt>Heures-pirogue/mois de sortie</dt><dd>{fmt(totals.canoeTripHoursPerMonth)}</dd></div></dl>
      <p>Ces données décrivent l’activité prévue. Elles ne modifient pas encore les résultats de simulation.</p>
      {draft && <p role="status">Un groupe est en cours de saisie. Le résumé présente les groupes enregistrés.</p>}
      <div className="activity-actions">{summary ? <button onClick={onEdit}>Modifier l’activité</button> : <button onClick={onSummary}>Consulter le résumé</button>}<button className="primary" disabled={busy} onClick={onSimulation}>Préparer la simulation existante</button></div>
      {scientific && <div className="territory-science"><h3>Conventions descriptives</h3><p>T_m = Σ P_i S_i,m · sorties-pirogue/mois.<br/>H_m sortie = Σ P_i S_i,m D_i,m · heures-pirogue/mois.</p><p>P_i : pirogues ; S_i,m : sorties par pirogue et par mois ; D_i,m : durée totale d’une sortie (h). Les pêcheurs sont un effectif mobilisé, sans facteur multiplicatif.</p><dl><dt>Activité</dt><dd>{selected?.id ?? 'Non enregistrée'}</dd><dt>Zone / carte</dt><dd>{zone.id} / {territory.geography.id}</dd><dt>Scénario</dt><dd>{selected?.scenario ?? scenario}</dd><dt>Provenance</dt><dd>{selected?.provenance.note ?? provenance}</dd></dl><p>Hypothèse : pratiques constantes sur [début, fin[ en mois relatifs, sans calendrier civil implicite. Les unités sont déclarées dans l’extension v1.</p><p>Données absentes : {selected?.groups.length ? selected.groups.map((g, i) => `groupe ${i + 1} : ${(['count', ...(g.gear.category === 'net' ? ['netLengthM', 'meshSizeMm'] as const : []), 'effectiveFishingHours', 'soakHours', 'notes'] as const).filter(k => g.gear[k] === undefined).map(k => ({ count: 'nombre d’engins', netLengthM: 'longueur', meshSizeMm: 'maillage', effectiveFishingHours: 'pêche effective', soakHours: 'pose', notes: 'notes' })[k]).join(', ') || 'aucune caractéristique applicable'}`).join(' ; ') : 'aucun groupe déclaré'}.</p><p>Limites : déclarations non calibrées ; aucune conversion vers E(t), q(t) ou a(t). E = 50 G u_G + 30 M u_M + 20 P u_P demeure inchangé. Ni Schaefer, ni les interventions, ni l’animation ne consomment cette extension. Pêche effective et pose restent séparées ; aucun total de pêche effective n’est déduit des données manquantes.</p></div>}
    </aside></div>
    {otherActivities.length > 0 && <details className="activity-card"><summary>Autres activités conservées dans ce projet ({otherActivities.length})</summary>{otherActivities.map(a => <p key={a.id}>{a.zone.name} · mois {fmt(a.period.start)} à {fmt(a.period.end)} (exclu) · {a.groups.length} groupe(s){scientific ? ` · scénario ${a.scenario} · carte ${a.zone.geographyId} · ${a.id}` : ''}</p>)}</details>}
  </div>;
}
