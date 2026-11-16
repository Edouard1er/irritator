import { scenarioChoices, type ScenarioId, type InfoSource, type Confidence } from '../../../../packages/contracts/workshop-session';
export const sourceLabels: Record<InfoSource, string> = { 'own-experience': 'Expérience personnelle', 'direct-observation': 'Observation directe', 'other-fisher': 'Autre pêcheur', 'clpa-service': 'CLPA ou service', other: 'Autre source', unknown: 'Je ne sais pas' };
export const confidenceLabels: Record<Confidence, string> = { low: 'Peu', medium: 'Moyennement', high: 'Très', unanswered: 'Non renseigné' };
const labels: Record<string, string> = {
  maintain: 'Continuer comme d’habitude', 'reduce-trips': 'Réduire les sorties', 'change-place': 'Changer de lieu',
  'change-gear': 'Changer d’engin', 'seek-information': 'Rechercher plus d’informations', other: 'Autre',
  'ask-boundaries': 'Demander où passent les limites', discuss: 'Discuter avec les pêcheurs ou le CLPA',
  'wait-information': 'Attendre une information fiable', 'increase-trips': 'Augmenter les sorties',
  'share-costs': 'Partager les dépenses ou organiser des sorties communes', 'wait-prices': 'Attendre des informations sur les prix',
};
export const scenarios = {
  'S1-captures': { id: 'S1-captures', version: 1, title: 'Les prises semblent diminuer', status: 'hypothetical', question: 'Plusieurs pêcheurs disent trouver moins de poissons. D’autres ne sont pas d’accord. Que feriez-vous d’abord ?', note: 'Situation de discussion hypothétique. Les témoignages peuvent se contredire.', supports: ['discussion-card', 'discussion-map', 'native-simulation'] },
  'S2-reserve': { id: 'S2-reserve', version: 1, title: 'Les limites d’une réserve sont discutées', status: 'proposed', question: 'On parle de mieux délimiter et surveiller une zone protégée. Les informations ne sont pas les mêmes pour tous. Que feriez-vous ?', note: 'Action prévue dans le plan du CLPA de Dagana 2026. Aucune limite officielle ni réalisation n’est certifiée ici. La surveillance n’a pas d’effet biologique calculé.', supports: ['discussion-map'] },
  'S3-couts': { id: 'S3-couts', version: 1, title: 'Une sortie coûte plus cher', status: 'hypothetical', question: 'Le prix de vente du poisson augmente, mais le carburant et le temps de recherche augmentent aussi. Que feriez-vous ?', note: 'Hypothèse de discussion : quels coûts et quelles informations vérifier ? Aucun bénéfice n’est calculé.', supports: ['discussion-card'] },
} as const;
export function choices(id: ScenarioId) { return scenarioChoices[id].map(value => ({ id: value, label: labels[value] })); }
export function choiceLabel(id: ScenarioId, choice?: string) { return choices(id).find(c => c.id === choice)?.label ?? 'Je ne sais pas'; }
