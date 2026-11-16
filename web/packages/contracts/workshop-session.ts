/** Research observations only: never part of RunRequest or a native engine schema. */
export const scenarioChoices = {
  'S1-captures': ['maintain', 'reduce-trips', 'change-place', 'change-gear', 'seek-information', 'other'],
  'S2-reserve': ['ask-boundaries', 'discuss', 'change-place', 'wait-information', 'other'],
  'S3-couts': ['maintain', 'increase-trips', 'reduce-trips', 'share-costs', 'wait-prices', 'other'],
} as const;
export type ScenarioId = keyof typeof scenarioChoices;
export const informationSources = ['own-experience', 'direct-observation', 'other-fisher', 'clpa-service', 'other', 'unknown'] as const;
export type InfoSource = typeof informationSources[number];
export type Confidence = 'low' | 'medium' | 'high' | 'unanswered';
export interface DecisionSnapshot {
  status: 'answered' | 'unsure'; choiceId?: string; otherChoice?: string; reasons?: string;
  sources: InfoSource[]; confidence: Confidence; missingInformation?: string; recordedAt: string;
}
export type Presentation =
  | { kind: 'native-simulation'; presentedAt: string; runId: string; modelId: string; modelFingerprint: string; requestSchemaVersion: 3; assumptionsNote: string }
  | { kind: 'discussion-map' | 'discussion-card'; presentedAt: string; supportId: string; note?: string };
export interface WorkshopDecisionRecord {
  id: string; participantCode: string; groupCode?: string; scenarioId: ScenarioId; scenarioVersion: 1;
  territory?: { geographyId: string; zoneId?: string; label?: string; origin: 'demonstration' | 'supplied' | 'unspecified' };
  activityIds: string[]; before: DecisionSnapshot; presentation?: Presentation; after?: DecisionSnapshot; attemptsPreviousId?: string;
}
export interface WorkshopSessionV1 {
  kind: 'irritator.level2.workshop-session'; version: 1; id: string; title: string; createdAt: string; updatedAt: string;
  locale: 'fr'; protocolId: 'mbane-decision-before-after-v1'; records: WorkshopDecisionRecord[];
}
const fail = (message: string): never => { throw new Error(`Séance : ${message}`); };
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('objet attendu.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(k => !allowed.includes(k))) fail('propriété inconnue.');
  return data;
}
function text(value: unknown, required = false, max = 500): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('texte absent ou trop long.');
}
function optionalText(value: unknown) { if (value !== undefined) text(value); }
function identifier(value: unknown) { text(value, true, 128); if (!/^[A-Za-z0-9_:.-]+$/.test(value)) fail('identifiant invalide.'); }
function uuid(value: unknown) { text(value, true, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail('UUID invalide.'); }
function date(value: unknown): asserts value is string {
  text(value, true, 24);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('date UTC invalide.');
}
function decision(value: unknown, scenario: ScenarioId) {
  const d = object(value, ['status', 'choiceId', 'otherChoice', 'reasons', 'sources', 'confidence', 'missingInformation', 'recordedAt']);
  if (d.status !== 'answered' && d.status !== 'unsure') fail('réponse invalide.');
  if (d.status === 'answered' ? !(scenarioChoices[scenario] as readonly unknown[]).includes(d.choiceId) : d.choiceId !== undefined || d.otherChoice !== undefined) fail('choix hors catalogue.');
  if (d.choiceId === 'other') text(d.otherChoice, true); else if (d.otherChoice !== undefined) fail('précision réservée au choix autre.');
  optionalText(d.reasons); optionalText(d.missingInformation);
  if (!Array.isArray(d.sources) || d.sources.length > informationSources.length || new Set(d.sources).size !== d.sources.length || d.sources.some(s => !(informationSources as readonly unknown[]).includes(s))) fail('sources invalides.');
  if (typeof d.confidence !== 'string' || !['low', 'medium', 'high', 'unanswered'].includes(d.confidence)) fail('confiance invalide.');
  date(d.recordedAt);
}
/** An import validates provenance fields, not the truth of an external attestation. */
export function validateWorkshopSession(input: unknown): asserts input is WorkshopSessionV1 {
  const s = object(input, ['kind', 'version', 'id', 'title', 'createdAt', 'updatedAt', 'locale', 'protocolId', 'records']);
  if (s.kind !== 'irritator.level2.workshop-session' || s.version !== 1 || s.locale !== 'fr' || s.protocolId !== 'mbane-decision-before-after-v1') fail('format ou version inconnus.');
  uuid(s.id); text(s.title, true); date(s.createdAt); date(s.updatedAt);
  if (s.updatedAt < s.createdAt) fail('chronologie invalide.');
  if (!Array.isArray(s.records) || s.records.length > 2000) fail('2000 fiches maximum.');
  const previous = new Map<string, WorkshopDecisionRecord>();
  for (const value of s.records as unknown[]) {
    const r = object(value, ['id', 'participantCode', 'groupCode', 'scenarioId', 'scenarioVersion', 'territory', 'activityIds', 'before', 'presentation', 'after', 'attemptsPreviousId']);
    uuid(r.id); identifier(r.participantCode);
    if ((r.participantCode as string).length > 32) fail('code participant trop long.');
    if (r.groupCode !== undefined) identifier(r.groupCode);
    if (previous.has(r.id as string)) fail('identifiant dupliqué.');
    if (typeof r.scenarioId !== 'string' || !Object.hasOwn(scenarioChoices, r.scenarioId) || r.scenarioVersion !== 1) fail('situation ou version inconnue.');
    const scenario = r.scenarioId as ScenarioId;
    if (!Array.isArray(r.activityIds) || r.activityIds.length > 120 || new Set(r.activityIds).size !== r.activityIds.length) fail('références d’activité invalides.');
    (r.activityIds as unknown[]).forEach(identifier);
    if (r.territory !== undefined) {
      const t = object(r.territory, ['geographyId', 'zoneId', 'label', 'origin']);
      identifier(t.geographyId); if (t.zoneId !== undefined) identifier(t.zoneId); optionalText(t.label);
      if (typeof t.origin !== 'string' || !['demonstration', 'supplied', 'unspecified'].includes(t.origin)) fail('origine du lieu invalide.');
    }
    decision(r.before, scenario);
    const before = r.before as DecisionSnapshot;
    if (before.recordedAt < s.createdAt || before.recordedAt > s.updatedAt) fail('date du premier choix hors séance.');
    if (r.presentation !== undefined) {
      const kind = (r.presentation as Presentation)?.kind;
      const p = object(r.presentation, kind === 'native-simulation' ? ['kind', 'presentedAt', 'runId', 'modelId', 'modelFingerprint', 'requestSchemaVersion', 'assumptionsNote'] : ['kind', 'presentedAt', 'supportId', 'note']);
      date(p.presentedAt);
      if (p.presentedAt < before.recordedAt || p.presentedAt > s.updatedAt) fail('présentation hors chronologie.');
      if (kind === 'native-simulation') {
        if (scenario !== 'S1-captures' || p.requestSchemaVersion !== 3) fail('simulation non autorisée pour cette situation.');
        identifier(p.runId); identifier(p.modelId); text(p.modelFingerprint, true, 1048576); text(p.assumptionsNote, true);
      } else {
        if (kind !== 'discussion-map' && kind !== 'discussion-card') fail('support inconnu.');
        if (scenario === 'S2-reserve' && kind !== 'discussion-map' || scenario === 'S3-couts' && kind !== 'discussion-card') fail('support incompatible avec la situation.');
        if (p.supportId !== `${scenario}-${kind}-v1`) fail('version du support inconnue.');
        optionalText(p.note);
      }
    }
    if (r.after !== undefined) {
      if (!r.presentation) fail('présentation requise avant le second choix.');
      decision(r.after, scenario);
      const at = (r.after as DecisionSnapshot).recordedAt;
      if (at < (r.presentation as Presentation).presentedAt || at > s.updatedAt) fail('second choix hors chronologie.');
    }
    if (r.attemptsPreviousId !== undefined) {
      uuid(r.attemptsPreviousId);
      const old = previous.get(r.attemptsPreviousId as string) ?? fail('essai précédent absent.');
      if (old.participantCode !== r.participantCode || old.scenarioId !== scenario) fail('essai précédent incompatible.');
      if (before.recordedAt < (old.after?.recordedAt ?? old.presentation?.presentedAt ?? old.before.recordedAt)) fail('nouvel essai antérieur à son origine.');
    }
    if (r.attemptsPreviousId === undefined && [...previous.values()].some(old => old.participantCode === r.participantCode && old.scenarioId === scenario && old.presentation)) fail('nouvelle réponse après présentation : essai chaîné requis.');
    previous.set(r.id as string, r as unknown as WorkshopDecisionRecord);
  }
}
