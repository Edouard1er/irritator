import { validateWorkshopSession, type DecisionSnapshot, type Presentation, type WorkshopDecisionRecord, type WorkshopSessionV1 } from '../../../../packages/contracts/workshop-session';
export function createSession(now = new Date().toISOString()): WorkshopSessionV1 {
  return { kind: 'irritator.level2.workshop-session', version: 1, id: crypto.randomUUID(), title: 'Atelier de discussion', createdAt: now, updatedAt: now, locale: 'fr', protocolId: 'mbane-decision-before-after-v1', records: [] };
}
export function addRecord(session: WorkshopSessionV1, record: WorkshopDecisionRecord, authorized: boolean): WorkshopSessionV1 {
  if (!authorized) throw new Error('La collecte doit être autorisée avant tout enregistrement.');
  const next = { ...session, updatedAt: record.before.recordedAt, records: [...session.records, structuredClone(record)] };
  validateWorkshopSession(next); return next;
}
export function updateRecord(session: WorkshopSessionV1, id: string, change: { before?: DecisionSnapshot; presentation?: Presentation; after?: DecisionSnapshot }, authorized: boolean): WorkshopSessionV1 {
  if (!authorized) throw new Error('La collecte est désactivée.');
  if (Object.keys(change).some(key => !['before', 'presentation', 'after'].includes(key))) throw new Error('Identité de fiche immuable.');
  if (Object.values(change).some(value => value === undefined)) throw new Error('Une étape enregistrée ne peut pas être effacée.');
  const record = session.records.find(r => r.id === id);
  if (!record) throw new Error('Fiche introuvable.');
  if (change.before && record.presentation || change.presentation && record.presentation || change.after && record.after) throw new Error('Cette étape est verrouillée. Créez un nouvel essai pour corriger.');
  const now = change.after?.recordedAt ?? change.presentation?.presentedAt ?? change.before?.recordedAt ?? session.updatedAt;
  const next = { ...session, updatedAt: now, records: session.records.map(r => r.id === id ? { ...r, ...structuredClone(change) } : r) };
  validateWorkshopSession(next); return next;
}
export function compareDecisions(record?: WorkshopDecisionRecord): 'maintained' | 'changed' | 'uncertain' | 'not-comparable' {
  if (!record?.after) return 'not-comparable';
  if (record.before.status === 'unsure' || record.after.status === 'unsure') return 'uncertain';
  return record.before.choiceId === record.after.choiceId && record.before.otherChoice === record.after.otherChoice ? 'maintained' : 'changed';
}
