'use client';
import { useState } from 'react';
import { informationSources, type DecisionSnapshot, type InfoSource, type ScenarioId } from '../../../../packages/contracts/workshop-session';
import { choices, sourceLabels } from '@/lib/workshop/scenarios';
export function DecisionForm({ scenarioId, after, initial, disabled, onSave }: { scenarioId: ScenarioId; after?: boolean; initial?: DecisionSnapshot; disabled: boolean; onSave: (d: DecisionSnapshot) => void }) {
  const [choice, setChoice] = useState(initial?.status === 'unsure' ? 'unsure' : initial?.choiceId ?? '');
  const [other, setOther] = useState(initial?.otherChoice ?? ''), [reasons, setReasons] = useState(initial?.reasons ?? ''), [missing, setMissing] = useState(initial?.missingInformation ?? '');
  const [sources, setSources] = useState<InfoSource[]>(initial?.sources ?? []), [confidence, setConfidence] = useState<DecisionSnapshot['confidence']>(initial?.confidence ?? 'unanswered');
  return <form className="decision-form" onSubmit={e => { e.preventDefault(); onSave({ status: choice === 'unsure' ? 'unsure' : 'answered', ...(choice !== 'unsure' ? { choiceId: choice, ...(choice === 'other' ? { otherChoice: other } : {}) } : {}), reasons, missingInformation: missing, sources, confidence, recordedAt: new Date().toISOString() }); }}>
    <fieldset disabled={disabled}><legend>Que feriez-vous ?</legend><div className="decision-choices">{[...choices(scenarioId), { id: 'unsure', label: 'Je ne sais pas' }].map(c => <label key={c.id} className={choice === c.id ? 'chosen' : ''}><input required type="radio" name={after ? 'after-choice' : 'before-choice'} value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)}/>{c.label}</label>)}</div>
    {choice === 'other' && <label>Précisez votre choix<input aria-label="Précisez votre choix" required maxLength={500} value={other} onChange={e => setOther(e.target.value)}/></label>}
    <label>Pourquoi ce choix ? (facultatif)<textarea aria-label="Pourquoi ce choix ? (facultatif)" maxLength={500} value={reasons} onChange={e => setReasons(e.target.value)}/></label>
    <fieldset><legend>Sur quoi vous appuyez-vous ? (facultatif)</legend><div className="decision-sources">{informationSources.map(s => <label key={s}><input type="checkbox" checked={sources.includes(s)} onChange={e => setSources(e.target.checked ? [...sources, s] : sources.filter(v => v !== s))}/>{sourceLabels[s]}</label>)}</div></fieldset>
    <label>Êtes-vous sûr de votre choix ?<select aria-label="Êtes-vous sûr de votre choix ?" value={confidence} onChange={e => setConfidence(e.target.value as typeof confidence)}><option value="unanswered">Préfère ne pas répondre</option><option value="low">Peu</option><option value="medium">Moyennement</option><option value="high">Très</option></select></label>
    <label>{after ? 'Qu’avez-vous appris ou mis en doute ? Quelle information faudrait-il vérifier ?' : 'Qu’aimeriez-vous savoir ? (facultatif)'}<textarea aria-label={after ? "Qu’avez-vous appris ou mis en doute ? Quelle information faudrait-il vérifier ?" : "Qu’aimeriez-vous savoir ? (facultatif)"} maxLength={500} value={missing} onChange={e => setMissing(e.target.value)}/></label>
    <button type="submit" className="primary" disabled={!choice}>{after ? 'Enregistrer mon choix maintenant' : 'Enregistrer mon premier choix'}</button></fieldset>
  </form>;
}
