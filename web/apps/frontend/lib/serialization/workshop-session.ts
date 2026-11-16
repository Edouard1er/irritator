import { validateWorkshopSession, type WorkshopSessionV1 } from '../../../../packages/contracts/workshop-session';
export const decisionsStorageKey = 'irritator.level2.decisions.v1';
export const maxSessionBytes = 8 * 1024 * 1024;
export function serializeSession(session: WorkshopSessionV1): string { validateWorkshopSession(session); const text = JSON.stringify(session, null, 2) + '\n'; if (new TextEncoder().encode(text).length > maxSessionBytes) throw new Error('Séance trop volumineuse (8 Mio maximum).'); return text; }
export function parseSession(text: string): WorkshopSessionV1 {
  if (new TextEncoder().encode(text).length > maxSessionBytes) throw new Error('Séance trop volumineuse (8 Mio maximum).');
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error('Fichier de séance illisible. La séance précédente est conservée.'); }
  validateWorkshopSession(value); return value;
}
export function saveSession(storage: Pick<Storage, 'setItem'>, session: WorkshopSessionV1, authorized: boolean) {
  if (!authorized) throw new Error('Collecte désactivée : aucune réponse sauvegardée.');
  const text = serializeSession(session);
  try { storage.setItem(decisionsStorageKey, text); } catch { throw new Error('Sauvegarde locale impossible. La dernière sauvegarde est conservée ; exportez la séance.'); }
}
