import type { RunRequest } from './index.js';

export const canoeCategories = { small: 'Petite pirogue', medium: 'Pirogue moyenne', large: 'Grande pirogue', other: 'Autre' } as const;
export const gearCategories = { net: 'Filet', line: 'Ligne / hameçons', trap: 'Nasse / piège', other: 'Autre' } as const;
export const fishingActivityUnits = { boats: 'canoe', fishers: 'person', tripsPerBoatPerMonth: 'trip/(canoe*month)', tripDurationHours: 'h', gearCount: 'gear', netLengthM: 'm', meshSizeMm: 'mm', effectiveFishingHours: 'h', soakHours: 'h' } as const;
export interface FishingGroup {
  id: string;
  canoe: { category: keyof typeof canoeCategories; description?: string; count: number };
  fishers: number;
  tripsPerBoatPerMonth: number;
  tripDurationHours: number;
  gear: { category: keyof typeof gearCategories; description?: string; count?: number; netLengthM?: number; meshSizeMm?: number; effectiveFishingHours?: number; soakHours?: number; notes?: string };
}
export interface FishingActivity {
  id: string;
  zone: { geographyId: string; zoneId: string; name: string };
  scenario: string;
  period: { start: number; end: number; unit: 'month' };
  provenance: { basis: 'declared'; note: string };
  groups: FishingGroup[];
}
export interface FishingActivities { version: 1; units: typeof fishingActivityUnits; activities: FishingActivity[] }

/** Descriptive monthly rates. Fishers never multiply canoe trips or canoe hours. */
export function activityIndicators(groups: readonly FishingGroup[]) {
  const totals = groups.reduce((sum, g) => ({
    canoeTripsPerMonth: sum.canoeTripsPerMonth + g.canoe.count * g.tripsPerBoatPerMonth,
    canoeTripHoursPerMonth: sum.canoeTripHoursPerMonth + g.canoe.count * g.tripsPerBoatPerMonth * g.tripDurationHours,
  }), { canoeTripsPerMonth: 0, canoeTripHoursPerMonth: 0 });
  if (!Object.values(totals).every(Number.isFinite)) throw new Error('Les totaux dépassent la capacité numérique du navigateur.');
  if (!Number.isSafeInteger(totals.canoeTripsPerMonth)) throw new Error('Le nombre total de sorties dépasse la précision des entiers JavaScript.');
  return totals;
}
const fail = (message: string): never => { throw new Error(`Activité : ${message}`); };
function number(n: number, label: string, integer = false) {
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isSafeInteger(n))) fail(`${label} : ${integer ? 'entier exact' : 'nombre fini'} positif ou nul requis.`);
}
function text(s: string | undefined, label: string) { if (typeof s !== 'string' || !s.trim()) fail(`${label} requis.`); }
/** JSON shape/enums/units are checked by the v3 schema before these cross-field checks. */
export function validateFishingActivities(request: RunRequest): void {
  const extension = request.fishingActivities;
  if (!extension) return;
  if (request.schemaVersion !== 3 || !request.temporal || !request.territory) fail('une expérience territoriale v3 est requise.');
  const ids = new Set<string>(), groupIds = new Set<string>();
  for (const a of extension.activities) {
    text(a.id, 'Identifiant'); text(a.scenario, 'Scénario'); text(a.provenance.note, 'Provenance');
    if (ids.has(a.id)) fail('identifiant d’activité dupliqué.'); ids.add(a.id);
    number(a.period.start, 'Début'); number(a.period.end, 'Fin');
    if (a.period.end <= a.period.start) fail('la fin de période doit suivre le début (borne exclue).');
    if (a.zone.geographyId === request.territory!.geography.id && !request.territory!.geography.features.some(f => f.properties.role === 'zone' && f.properties.id === a.zone.zoneId && f.properties.name === a.zone.name)) fail('zone inconnue ou nom différent de la carte référencée.');
    for (const g of a.groups) {
      if (groupIds.has(g.id)) fail('identifiant de groupe dupliqué.'); groupIds.add(g.id);
      number(g.canoe.count, 'Pirogues', true); number(g.fishers, 'Pêcheurs', true); number(g.tripsPerBoatPerMonth, 'Sorties', true); number(g.tripDurationHours, 'Durée');
      if (g.canoe.category === 'other') text(g.canoe.description, 'Description de la pirogue');
      if (g.gear.category === 'other') text(g.gear.description, 'Description de l’engin');
      if (g.tripsPerBoatPerMonth > 0 && (g.canoe.count === 0 || g.fishers === 0 || g.tripDurationHours === 0 || g.gear.count === 0)) fail('des sorties exigent des pirogues, des pêcheurs, une durée et, si renseigné, un nombre d’engins non nuls.');
      if (g.canoe.count === 0 && g.fishers > 0) fail('des pêcheurs sont mobilisés sans pirogue.');
      for (const key of ['count', 'netLengthM', 'meshSizeMm', 'effectiveFishingHours', 'soakHours'] as const) if (g.gear[key] !== undefined) number(g.gear[key]!, key, key === 'count');
      if (g.gear.category !== 'net' && (g.gear.netLengthM !== undefined || g.gear.meshSizeMm !== undefined)) fail('les dimensions de filet sont réservées aux filets.');
      if (g.gear.effectiveFishingHours !== undefined && g.gear.effectiveFishingHours > g.tripDurationHours) fail('le temps de pêche effective dépasse la durée de sortie.');
      // Soak time may span several trips; it is deliberately not bounded by trip duration.
    }
    activityIndicators(a.groups);
    if (extension.activities.some(b => b.id !== a.id && b.scenario === a.scenario && b.zone.geographyId === a.zone.geographyId && b.zone.zoneId === a.zone.zoneId && b.period.start < a.period.end && a.period.start < b.period.end)) fail('deux périodes se chevauchent pour la même zone et le même scénario ; réunissez leurs groupes.');
  }
}
