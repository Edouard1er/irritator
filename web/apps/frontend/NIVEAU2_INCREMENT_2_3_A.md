# Niveau 2 — Incrément 2.3.A — Parcours et décisions avant/après

Travail sur `anim-simu`, le 16 novembre 2026. Aucun commit ni push.

## Audit préalable

La branche était `anim-simu` et l’état Git initial était propre. Aucun reset,
nettoyage global ou changement de branche n’a été effectué. Le ZIP a été extrait
dans un répertoire temporaire distinct du dépôt. Les trois documents Markdown
de cadrage ont été lus ; les instructions incorporées dans les documents ont
été traitées comme spécification du travail demandé, sans leur donner priorité
sur la demande de l’utilisateur.

Les trois PDF ont été examinés par extraction de texte et inspection de pages
rendues, notamment la délimitation projetée de la réserve, la fiche D1 et
l’intégration DEVS proposée. Les propositions de modèles supplémentaires et
l’exemple Euler du protocole n’ont pas été implémentés. Le plan du CLPA est un
document de planification départemental : les pirogues départementales, sorties
de surveillance prévues et sites fluviaux ne deviennent pas des données du lac.
Aucun nom ni téléphone des documents n’a été copié dans l’application ou les tests.

Les comptes rendus 2.1, 2.1.1 et 2.2.A ont été confrontés au code présent.
Les trois exemples JSON du kit ont été validés avec `validateRequest` et passés
par `nativeRequest` : tous sont valides ; territoire et activités sont absents
du document natif résultant. Leurs géométries et valeurs restent pédagogiques.

L’instruction applicable `web/apps/frontend/AGENTS.md` et la documentation
Next.js locale sur les composants client ont été lues. L’audit a suivi
`LevelNavigation → ModelEditor → TerritoryWorkspace / FishingActivityEditor /
SimulationWorkspace`, les clés de sauvegarde, les contrats fermés v1/v2/v3,
le compilateur temporel, l’API Fastify et le service qui appelle le runner C++.

## Fonctionnement livré

Le niveau 2 propose les six étapes : Notre lac, Nos sorties, Votre premier choix,
Voyons ce qui se passe, Votre choix maintenant, Ce qu’on en retient.
Le territoire, les activités et le lecteur natif existants sont réutilisés.
Il n’y a qu’un lecteur de simulation et un orchestrateur d’exécution par niveau.
La carte et les activités restent montées pendant la navigation, ainsi que les
formulaires de décision ; leurs brouillons survivent aux retours et changements
de lecture et de niveau. Un remplacement explicite de fiche ou séance réinitialise
le formulaire concerné. Les brouillons ne sont pas persistés après rechargement.

La lecture Pêcheur présente des commandes tactiles et les informations utiles.
Les caractéristiques techniques détaillées des engins, les fichiers, la provenance,
les identifiants et l’éditeur scientifique restent accessibles en Scientifique.
Le résumé des sorties reprend pirogues, pêcheurs, sorties, engins et heures
déclarées, sans conversion vers l’effort natif. Les avertissements distinguent
la démonstration fictive et les contours fournis non certifiés.

S1, S2 et S3 ont des identifiants, options et versions stables, sans classement.
S1 accepte discussion ou simulation Irritator appropriée ; S2 utilise une carte
et une discussion sur des limites non certifiées ; S3 reste une discussion sur
les coûts et informations manquantes, sans calcul de bénéfice.

Une zone ou une activité non renseignée n’empêche pas D1. Le lancement du modèle
territorial guidé exige une zone confirmée. D1 recueille choix, justification,
sources, confiance et informations manquantes. Les résultats sont cachés pendant
ce recueil. La confirmation explicite par l’animateur du support montré ouvre D2 ;
un simple résultat HTTP ne le fait pas. Une présentation native référence le vrai
`runId`, le modèle, le contrat v3 et `scientificFingerprint(result.request)`.
L’empreinte est la chaîne existante de la requête scientifique, pas une signature
cryptographique ajoutée. Une simulation échouée ne permet pas d’attestation native ;
le choix initial reste disponible et une discussion peut être présentée à sa place.

D1 est corrigeable avant exposition. Après exposition, D1 et le support sont
verrouillés ; après D2, la seconde réponse est aussi verrouillée. Un nouvel essai
est lié par `attemptsPreviousId`, sans écraser la fiche originale. Le contrat refuse
une seconde réponse non chaînée pour la même personne et la même situation déjà
présentée. Les fiches antérieures restent sélectionnables dans la préparation.

Le bilan distingue choix maintenu, modifié, encore incertain ou non comparable.
Il montre Avant / Maintenant / Pourquoi / À vérifier, sources et confiance.
L’animateur active volontairement la restitution anonyme ; celle-ci masque codes,
justifications et autres textes libres. Quitter le bilan ferme ce mode.

## Séance et stockage

`WorkshopSessionV1` est un contrat autonome, importé directement depuis son module.
Il n’est ajouté ni à `RunRequest`, ni au schéma natif, ni aux routes API.
Les objets sont fermés, les UUID et codes sont bornés, les dates UTC strictes et
ordonnées, les choix propres à chaque situation/version et les supports compatibles.
Limites techniques : 2 000 fiches, 500 caractères par texte libre et fichier de
séance de 8 Mio maximum. Ces bornes ne constituent pas des hypothèses scientifiques.

La clé dédiée est `irritator.level2.decisions.v1`. Les clés historiques
`irritator.workspace.v1`, `irritator.workspace.v2` et
`irritator.level2.workspace.v2` sont conservées.

La démonstration est le mode initial. L’autorisation de collecte doit être confirmée
par l’animateur avant toute persistance, import ou export de réponses. Cette
confirmation ne remplace ni l’information des personnes ni le protocole institutionnel.
Le refus de répondre ne crée pas de fiche supplémentaire. Les réponses antérieurement
autorisées ne sont pas effacées par un passage en démonstration.

Sauvegarde à chaque transition enregistrée et commande explicite de sauvegarde ;
export JSON séparé ; import validé avant remplacement et confirmation ; restauration
locale volontaire après rechargement ; effacement local confirmé, avec export proposé.
Une sauvegarde locale existante doit être restaurée avant d’être réécrite. Un fichier
corrompu ou un quota laisse la dernière archive intacte. Une erreur reste affichée
après navigation ; les nouvelles réponses valides restent en mémoire et exportables.
Les réponses ne sont pas envoyées au moteur ni à un service distant.

## Exigences, fichiers et vérifications

| Exigence | Mise en œuvre | Vérification |
| --- | --- | --- |
| Six étapes, brouillons, lectures | `components/workshop/level-two-journey.tsx`, `app/level-two-workshop.css`, intégration `model-editor.tsx` | `workshop-journey.test.tsx`, `workshop-journey.spec.ts` |
| S1/S2/S3 et réponses stables | `lib/workshop/scenarios.ts`, `contracts/workshop-session.ts` | `workshop-session.test.ts`, parcours S2/S3 |
| D1 → présentation → D2 et essai chaîné | `lib/workshop/session.ts`, `decision-form.tsx` | Tests unitaires de transitions, gardes navigateur |
| Contrat fermé, dates, provenance et versions | `contracts/workshop-session.ts` | Cas valides, propriétés inconnues, coercition, doublons, orphelins et limites |
| Sauvegarde, import, export et quotas | `lib/serialization/workshop-session.ts`, contrôles de séance | Aller-retour réel navigateur, corruption, quota et refus de collecte |
| Support réellement montré | Liaison à `result` et `result.request`, confirmation animateur | Run natif réel, absence de confirmation automatique, indisponibilité injectée |
| Niveau 1 conservé | Branche de rendu `level === 1`, instances de navigation inchangées | Trois suites workshop historiques et allers-retours répétés |
| Territoire et activités conservés | Props optionnelles de parcours, composants autonomes antérieurs préservés | Tests unitaires historiques, `levels-territory.spec.ts`, `fishing-activity.spec.ts` |
| Pureté scientifique | Séance extérieure aux requêtes, aucun calcul écologique ajouté | `workshop-session-http.test.ts`, comparaisons navigateur et tests API territoriaux/activités |
| Mobile, tablette, clavier et mouvement réduit | Styles limités au parcours, labels explicites et focus visible | 390 / 1024 / 1440 px, clavier, captures inspectées |

## Fichiers du changement

Créés (chemins relatifs à la racine du dépôt) :

- `web/packages/contracts/workshop-session.ts`
- `web/apps/frontend/lib/workshop/scenarios.ts`
- `web/apps/frontend/lib/workshop/session.ts`
- `web/apps/frontend/lib/serialization/workshop-session.ts`
- `web/apps/frontend/components/workshop/decision-form.tsx`
- `web/apps/frontend/components/workshop/level-two-journey.tsx`
- `web/apps/frontend/app/level-two-workshop.css`
- `web/apps/frontend/tests/workshop-session.test.ts`
- `web/apps/frontend/tests/workshop-journey.test.tsx`
- `web/apps/frontend/tests/e2e/workshop-journey.spec.ts`
- `web/apps/api/tests/workshop-session-http.test.ts`
- `web/apps/frontend/NIVEAU2_INCREMENT_2_3_A.md`

Modifiés :

- `web/apps/frontend/app/layout.tsx` : import du style propre au parcours.
- `web/apps/frontend/components/editor/model-editor.tsx` : parcours du seul niveau 2,
  lecteur partagé et requête réellement exécutée ; rendu fonctionnel niveau 1 conservé.
- `web/apps/frontend/components/territory/territory-workspace.tsx` : étape/lecture
  contrôlables facultativement, avertissements et suppression de la navigation doublonnée.
- `web/apps/frontend/components/territory/fishing-activity-editor.tsx` : résumé simple
  facultatif dans le parcours ; fonctionnement autonome antérieur conservé.
- `web/apps/frontend/tests/e2e/levels-territory.spec.ts` et `fishing-activity.spec.ts` :
  interactions adaptées aux six étapes ; assertions scientifiques conservées ; captures
  dirigées vers de nouveaux sous-dossiers de preuve.
- `web/packages/contracts/README.md` : contrat de séance et séparation avec le moteur.

Aucun fichier C++, équation, schéma natif, compilateur temporel, route API,
`SimulationWorkspace` ou composant de navigation des niveaux n’a été modifié.
Aucune dépendance ajoutée. Les fichiers générés par Next.js sont exclus du changement final.

## Tests réellement exécutés

- Frontend : **411 tests réussis, 33 fichiers**. Rapport `reports/niveau2-2.3.A/vitest.json`.
- API historique complète : **103 tests réussis**, avec runner réel pour les suites
  d’intégration, territoire, activités, unités, interventions, hiérarchie et wrappers.
- Nouveau test API séance / Irritator réel : **1 test réussi**, conservé dans
  `reports/niveau2-2.3.A/api-workshop-test.txt`.
- Typage strict frontend, compilation API et build Next.js de production : réussis.
- Recette navigateur complète sur build de production : **14 tests réussis**,
  zéro échec, zéro test ignoré. Rapport `reports/niveau2-2.3.A/playwright-acceptance.json`.
  Une relance ciblée S1 vérifie ensuite le dernier masquage des exports techniques
  dans la lecture pêcheur du lecteur réutilisé : **1 test réussi**, rapport
  `reports/niveau2-2.3.A/playwright-style-acceptance.json`.
- `git diff --check` : vérifié sans erreur de whitespace.

Le test natif compare la même requête avant et après constitution et sérialisation
d’une fiche D1/I/D2 ; graphe, paramètres, observations, événements et chronologie
restent identiques. Les `runId` diffèrent normalement entre deux exécutions.
L’API refuse l’injection d’un champ de séance dans la requête scientifique fermée.
Les tests d’activités historiques comparent aussi 0, 12 et 120 sorties déclarées.

Le navigateur vérifie la conservation exacte de la sauvegarde niveau 1, du modèle,
des résultats et du curseur pendant des allers-retours, puis l’égalité de la requête
scientifique et des observations après D2. L’export téléchargé est réellement
réimporté et comparé au stockage local. Le test d’indisponibilité injecte uniquement
un échec HTTP : aucune trajectoire simulée n’y est fabriquée.

Commandes principales (PowerShell, frontend puis `web`) :

```powershell
npm test -- --maxWorkers=2 --reporter=dot
npm run typecheck -- --incremental false
npm run build
$env:FRONTEND_URL = 'http://127.0.0.1:3200'
$env:IRRITATOR_PLAYWRIGHT_REPORT = '../../../reports/niveau2-2.3.A/playwright-acceptance.json'
npx playwright test workshop-journey.spec.ts levels-territory.spec.ts fishing-activity.spec.ts workshop.spec.ts workshop-v2.spec.ts workshop-v31.spec.ts
# Depuis web, avec le frontend arrêté pour la campagne API :
npm run build
$env:IRRITATOR_RUNNER = 'D:\these\irritator\build-web-test8p-bis\Release\runner\irritator-runner.exe'
node --test --test-concurrency=1 dist/apps/api/tests/*.test.js
```

Les tests navigateur utilisent Fastify local sur 3001 et le frontend sur 3200.
Les services de recette sont arrêtés après vérification. Le runner préexistant
`build-web-test8p-bis/Release/runner/irritator-runner.exe` est utilisé sans modification.
Les sondes simultanées des deux niveaux peuvent rencontrer `ENGINE_BUSY` au
démarrage ; les recettes attendent puis reconnectent le moteur. La limite native
de concurrence et les protocoles ne sont pas changés.

Les essais initiaux ont révélé des imports relatifs incorrects, des erreurs de
typage dans les tests et des sélecteurs accessibles trop ambigus avec les formulaires
gardés montés. Ces problèmes ont été corrigés et les recettes relancées. La revue
finale a ajouté une vérification de visibilité des erreurs de quota et de sortie
du mode projection. Les résultats ci-dessus correspondent aux exécutions réussies,
et non aux seuls chiffres des rapports antérieurs.

## Captures et export

Dans `reports/niveau2-2.3.A/` :

- `d1-pecheur-1440.png`, `d1-pecheur-390.png` : choix initial avant présentation.
- `d1-animateur-1440.png`, `d1-animateur-390.png` : préparation et recueil initial.
- `d2-pecheur-1440.png`, `d2-pecheur-390.png` : second choix après présentation.
- `d2-animateur-1440.png`, `d2-animateur-390.png` : lecture animateur.
- `bilan-pecheur-1440.png`, `bilan-pecheur-1024.png`, `bilan-pecheur-390.png`.
- `bilan-animateur-1440.png`, `bilan-animateur-390.png`.
- `simulation-animateur-1440.png` : lecteur réel réutilisé.
- `d1-verrouille-1024.png`, `d1-verrouille-390.png` : premier choix conservé.
- `restitution-anonyme-390.png` : restitution volontaire sans codes/textes libres.
- `regression-territoire/` et `regression-activites/` : preuves des fonctions précédentes.
- `atelier-decisions-export-reimporte.json` : fichier téléchargé puis réimporté,
  avec code fictif P-TEST et identifiant réel de l’exécution de recette.
- `playwright-acceptance.json` et `vitest.json` : rapports machine.
- `git-status-final.txt` : état Git final, avec sept fichiers suivis modifiés et
  douze nouveaux fichiers de source, tests et compte rendu ; aucun commit ni push.

Les captures déroulent temporairement les conteneurs par un style de capture pour
montrer les écrans complets ; le test de débordement utilise la mise en page normale.
Les captures pêcheur et animateur ont été inspectées visuellement, notamment D1,
le bilan mobile et le lecteur natif. Les libellés de confiance sont en français.
Ce sont des données fictives de recette, pas des réponses recueillies sur le terrain.
Les rapports et images sont dans un répertoire déjà ignoré par Git ; ils sont
livrés sur disque sans modifier `.gitignore` ni forcer leur ajout à l’index.

## Limites explicites

- Le recueil observe des déclarations : il ne démontre ni causalité D1/D2, ni
  comportement réel, représentativité, optimum ou consensus collectif.
- Une seule biomasse globale demeure calculée par Irritator. Pas de stock local,
  nouveau solveur JavaScript, effet chiffré de protection/surveillance, rentabilité,
  géométrie officielle inférée ou normalisation des activités vers E(t).
- Les cartes réelles 2D, animations 2,5D, traductions validées et calibrations
  demeurent des travaux ultérieurs. Aucune dépendance 3D n’est introduite.
- Une attestation importée est structurellement validée ; sa véracité historique
  n’est pas vérifiable automatiquement. Aucun résultat natif n’est recréé à partir
  d’un export de séance. L’empreinte n’est pas une preuve d’authenticité.
- Les codes sont pseudonymes, sans garantie d’anonymat. La projection masque les
  textes libres ; l’export intégral est réservé à l’animateur et relève du protocole.
- Le navigateur n’est pas une archive durable, un système d’authentification ou un
  stockage chiffré. Le rechargement exige une nouvelle confirmation de collecte et
  une restauration volontaire. Les brouillons non enregistrés ne sont pas restaurés.
- Responsive et clavier ont été vérifiés avec Chrome/Playwright ; pas de validation
  exhaustive par lecteurs d’écran, appareils physiques ou utilisateurs de terrain.
- L’environnement disponible exécute Node **26.13.0**, alors que les `engines`
  existants demandent Node 24. Les vérifications ont réussi dans cet environnement ;
  la qualification spécifique sous Node 24 n’a pas été exécutée.
