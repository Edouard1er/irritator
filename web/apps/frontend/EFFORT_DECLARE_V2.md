# Effort de pêche V2 — implémentation et vérifications

Extension ciblée de l’implémentation décrite dans `EFFORT_DECLARE.md`. Les trois fichiers du kit V2, le compte rendu V1, le module de calcul, le formulaire, l’espace Simulation et les tests existants ont été lus avant modification. Les tests frontend existants ont été exécutés avant modification : **332 tests passent dans 29 fichiers**.

## Comportement livré

Le formulaire existant conserve les conditions du lac et sa grille ordinateur. Il calcule maintenant l’effort effectif pour Filet maillant, Ligne et Senne. Le champ final reste un `output` non modifiable. Les sorties mensuelles, heures de sortie et activité nominale avec unité sont distinctes des facteurs de puissance et de l’effort du modèle.

La durée d’utilisation des lignes est un nouveau champ dédié : elle doit être renseignée explicitement au premier choix de cet engin. Aucune durée d’immersion de filet ou de déplacement ne lui est attribuée par défaut. La senne utilise explicitement les opérations **par senne et par sortie**, sans durée d’immersion. Les réponses aux champs masqués sont conservées durant l’édition. Le formulaire propose 4 sorties par semaine par défaut, y compris lorsqu’aucune pratique n’accompagne un JSON importé ; cette proposition est signalée comme valeur par défaut, et les pratiques déjà appliquées ou restaurées restent prioritaires.

Les valeurs numériques des facteurs sont accessibles dans les détails du calcul et dans le résumé scientifique. La lecture pêcheur garde un résumé simple signalant des hypothèses non calibrées. Les détails affichent la configuration, sa source, les références propres aux trois engins, les deux motorisations, la table des mailles et la décomposition numérique de l’effort courant.

Une configuration JSON peut être chargée depuis les détails du formulaire. Elle reste en cours d’édition jusqu’au succès du calcul natif. Annuler ou un échec du moteur ne modifie pas les pratiques, les facteurs appliqués, les courbes ou l’historique précédents. Les valeurs hebdomadaires sont affichées avec au plus six décimales ; les valeurs internes, les dates natives et l’effort transmis restent sans arrondi.

Aucune modification de CSS ni adaptation mobile/tablette dans cet incrément. Les parcours de régression existants ont été conservés.

## Formules effectivement utilisées

```text
S_m = sorties/semaine × 52/12 × (pirogues si périmètre « Chaque pirogue », sinon 1)
H_m = S_m × durée de sortie                         [information seulement]

Filet : X_f = S_m × filets/sortie × longueur(m) × immersion(h)       [m·h/mois]
Ligne : X_l = S_m × lignes/sortie × hameçons/ligne × utilisation(h)  [hameçon·h/mois]
Senne : X_s = S_m × sennes/sortie × opérations/senne/sortie          [traits/mois]

E = E_ref × (X_g / X_ref,g) × α_g × μ_g,motorisation × σ_g(maille)
```

`E_ref` est exclusivement la valeur initiale `temporal.parameters.E`. Il ne provient jamais de l’intervention précédente. Les trois unités nominales ne sont ni additionnées ni assimilées. La motorisation est appliquée une seule fois, après la déclaration des sorties et durées. Le nombre de pirogues est appliqué une seule fois, uniquement au périmètre par pirogue. L’allocation technique 50/30/20 du modèle ne remultiplie pas les pirogues déclarées.

La maille est convertie en mm avant consultation de la table (`cm × 10`). L’interpolation est linéaire entre points déclarés seulement. Aucune extrapolation et aucune loi automatique proportionnelle à la maille ou à son inverse. Ligne et Senne utilisent explicitement `σ = 1`.

Référence initiale conservée : 1 pirogue non motorisée, 4 sorties totales/semaine, 6 h/sortie, 2 filets de 50 m immergés 4 h, maille de 46 mm. Elle produit 17,333333… sorties/mois, 104 h de sortie/mois et 6933,333333333333 m·h/mois. Pour un scénario initial à E=150, elle produit exactement E=150 ; 8 sorties donnent exactement E=300 ; 8/3 sorties donnent exactement E=100.

## Configuration et provenance des coefficients

Source : `IRRITATOR_EFFORT_V2_ENGINS_MOTORISATION_MAILLES.zip`, fichier `effort-v2/02_PARAMETRES_EXEMPLE.json` fourni par l’utilisateur. Tous ses champs et valeurs sont identiques dans `lib/simulation/fishing-effort-config.v2.json`. Seuls les champs d’identification `id` et `source` sont ajoutés.

Identifiant : `effort-demo-kit-v2`, version de format : `2`, statut : `hypotheses_de_scenario_a_valider`.

| Engin | Référence nominale | α engin | μ non motorisée | μ motorisée |
| --- | ---: | ---: | ---: | ---: |
| Filet maillant | 6933,333333333333 m·h/mois | 1 | 1 | 1,20 |
| Ligne | 2773,333333333333 hameçon·h/mois | 0,80 | 1 | 1,15 |
| Senne | 34,666666666666664 traits/mois | 1,20 | 1 | 1,30 |

| Maille du filet | σ |
| --- | ---: |
| 35 mm | 0,90 |
| 46 mm | 1 |
| 60 mm | 0,85 |

Ces nombres sont des **hypothèses expérimentales de démonstration fournies dans le kit**, sans calibration du lac de Guiers ni validité biologique revendiquée. La table α/μ/σ doit être validée par le chercheur avant utilisation pour interpréter une situation réelle. Le code ne requiert pas cette validation pour les tests de scénarios explicitement demandés.

Pour créer une autre configuration, copier le JSON frontend, renseigner un identifiant distinct et sa provenance, modifier les paramètres nécessaires puis charger le fichier dans les détails du formulaire. Le fichier importé doit contenir ses champs `id` et `source`, en plus du schéma du kit ; aucun coefficient absent n’est complété silencieusement. Une version de format autre que 2 est refusée. Chaque intervention stocke une copie complète de la configuration effectivement utilisée ; modifier la configuration active ne réécrit pas les anciennes décisions.

Le validateur impose des références nominales et facteurs finis strictement positifs, les unités propres aux trois engins, une table ordonnée sans doublons et la normalisation du filet initial : α=1, μ non motorisée=1, σ(46 mm)=1. Il vérifie aussi l’accord entre la pratique de référence et sa valeur nominale. Une référence personnalisée incompatible exige une configuration normalisée correspondante.

## Validation et chaîne native

Zéro engin, quantité non entière, durée négative, valeurs manquantes ou non finies, maille hors domaine, coefficient absent et E hors `[0,10000]` interdisent l’application et produisent une erreur. L’effort nul reste accepté lorsque les sorties ou les heures effectives sont nulles, conformément au contrat natif. Il n’y a aucun plafonnement silencieux. La durée d’immersion peut dépasser la durée de sortie.

Le frontend appelle toujours `intervene` et l’API existante. Le moteur C++/DEVS, les équations biologiques, q, les unités natives, les bibliothèques de contrat et le schéma JSON scientifique v3 n’ont pas été modifiés. Les dates gardent leur précision native. Les interventions futures restent absolues et les décisions au même instant sont remplacées par la chaîne existante.

La provenance des nouvelles interventions E est maintenant `atelier: effort calculé depuis les pratiques de pêche ; <id> v<version>`. Les conditions environnementales directement réglées gardent leur provenance de saisie. Cette correction de texte est la seule différence volontaire entre les demandes de la séquence historique et l’ancien oracle ; les paramètres, événements numériques, allocations, graphes compilés et résultats sont identiques. Les archives V1 importées conservent leur JSON historique original.

## Annexe de pratiques V2 et migration V1

L’export scientifique habituel reste inchangé. L’annexe séparée utilise désormais :

```text
format: irritator-fishing-practices
version: 2
request: JSON scientifique associé, inchangé
history.reference: référence initiale fixe, dont E_ref et pratique
history.configuration: configuration active complète et identifiée
history.records[]:
  time, practice
  configuration: copie complète des facteurs réellement appliqués
  effortDerivation:
    activité, unité, sorties et heures mensuelles
    référence nominale, rapport nominal
    facteurs engin / motorisation / mailles, maille convertie si applicable
    rapport effectif, E final, identifiant/version de configuration
```

L’import V2 recalcule chaque dérivation depuis sa propre configuration puis vérifie l’égalité avec l’effort natif à sa date. Une configuration absente/altérée, une dérivation incohérente, un mauvais scénario ou des dates invalides sont refusés. Le fichier doit accompagner exactement le même JSON scientifique ; la comparaison de sérialisation, ordre des clés compris, reste celle de V1. Il s’agit d’un contrôle de cohérence, pas d’une signature d’authenticité.

L’import des annexes V1 est maintenu. Le calcul V1 est d’abord revérifié, puis chaque ancien enregistrement reçoit une configuration explicitement nommée `legacy-practices-v1` avec les facteurs neutres historiques. Motorisation et mailles continuent donc d’être descriptives pour **ces anciennes décisions**, même lorsqu’une maille historique sort de la nouvelle plage. Les résultats et le JSON natif historiques restent inchangés. Les nouvelles décisions utilisent la configuration V2 active et ses validations. Le formulaire signale cette migration. Une réexportation V2 suivie d’un nouvel import conserve également les enregistrements migrés.

Pour restaurer après rechargement : importer l’expérience scientifique, exécuter, ouvrir « Modifier les conditions » puis importer l’annexe associée. Les pratiques restent en mémoire de la session entre interventions ; le JSON scientifique seul ne contient pas ces métadonnées. Annuler abandonne une annexe ou une configuration chargée durant l’édition. Les saisies non appliquées ne sont pas exportées.

## Tests et preuves

Avant modification : **332 tests frontend / 29 fichiers** passent.

Après modification : **337 tests frontend / 29 fichiers**, **101 tests API** et **8 parcours navigateur Chrome avec Fastify et le vrai moteur natif** passent. Vérification TypeScript et compilation de production réussies. Le premier build s’est arrêté après compilation et TypeScript sur un avis de sécurité de la version Next.js installée. Sa relance réussit en conservant cet avis ; aucune dépendance n’a été modifiée. Les deux journaux sont conservés (`reports/effort-v2-build.log` et `reports/effort-v2-build-final.log`).

| Cas du kit | Vérification |
| --- | --- |
| 1–2 | Référence E=150 et doublement des sorties E=300 ; E_ref initial alternatif 260 donne 520 |
| 3 | Filet motorisé E=180 ; doublement d’activité motorisée E=360 ; μ appliqué une seule fois |
| 4 | 35 mm donne E=135 ; 46 mm E=150 ; 60 mm E=127,5 ; interpolation à 40,5 mm |
| 5 | 2 lignes × 20 hameçons × 4 h : X=2773,3333 et E=120 ; motorisée E=138 |
| 6 | 1 senne × 2 traits : X=34,6667 et E=180 ; motorisée E=234 |
| 7 | 4,6 cm et 46 mm donnent exactement le même calcul ; 46 cm est hors domaine |
| 8 | Doublement séparé des quantités, hameçons, heures de ligne ou opérations ; périmètres groupe/par pirogue sans double comptage |
| 9 | Invalides, zéros d’engins, NaN/infini, durée absente/négative, référence nulle, unités, facteurs/configuration absents, table incohérente, E>10000 |
| 10 | Référence fixe, décisions successives et au même instant, conservation des décisions futures, copies des facteurs, annulation, sauvegarde/restauration V2, migration V1 puis réexport/import |
| 11 | Historique natif 150→300→100, compilateur natif inchangé, q inchangé, observations et captures mensuelles égales à l’ancien oracle |
| 12 | Provenance calculée des nouvelles interventions E ; conditions directement réglées distinguées |

Les parcours régressifs existants couvrent pluie/salinité/accessibilité, comparaison initiale et marqueurs, historique/export, vues pêcheur/scientifique, seuil critique et alarmes sonores, pause/reprise, échec API et maintien de la trajectoire. Aucun solveur biologique JavaScript n’a été ajouté.

Dans la preuve historique, les dates réelles sont `3.800000000000002` et `10.29999999999998`, sans arrondi dans les interventions. Les **495 observations** sont identiques à l’oracle natif antérieur avec **tolérance zéro** : N 241, C 241, r 8, q 1, a 1, E 3. Les captures mensuelles sont aussi identiques. Le préfixe antérieur à la première intervention reste comparé à l’état initial avec la tolérance préexistante `1e-7`. Les tests unitaires couvrent également exactement 3,8 et 10,3 mois.

Commandes depuis `web/apps/frontend` :

```powershell
npm test -- --reporter=dot
npm run typecheck -- --incremental false
npm run build
npx playwright test tests/e2e/fishing-practice.spec.ts tests/e2e/interventions.spec.ts tests/e2e/workshop-v31.spec.ts --reporter=list
```

API, depuis `web` :

```powershell
npm run build
$apiTestFiles = @(Get-ChildItem apps/api/tests/*.test.ts | ForEach-Object { 'dist/apps/api/tests/' + $_.BaseName + '.js' })
node --test --test-concurrency=1 @apiTestFiles
```

Journaux locaux : `reports/effort-v2-baseline.log`, `effort-v2-unit-final.log`, `effort-v2-types.log`, `effort-v2-build.log`, `effort-v2-build-final.log`, `effort-v2-api-build.log`, `effort-v2-api.log`, `effort-v2-browser-final.log`.

Preuves dans `reports/effort-v2-evidence/` : `native-equivalence.json`, `three-gears-native-requests.json`, `v2-configuration-roundtrip.json`, et captures ordinateur `01-formulaire-bureau.png`, `02-resultats-sequence.png`, `03-restauration-bureau.png`, `04-senne-bureau.png`, `05-ligne-configuration-restauree.png`. Les captures du formulaire initial et de la senne montrent l’éditeur et l’effort sans ouvrir les détails ; celle de la ligne illustre la restauration d’une configuration de scénario personnalisée.

## Fichiers de cet incrément

- `lib/simulation/fishing-effort.ts` : calcul V2, validation, adaptation native, provenance et annexes V1/V2.
- `lib/simulation/fishing-effort-config.v2.json` : coefficients du kit, identifiant et provenance.
- `components/simulation/conditions-editor.tsx` : champs conditionnels, rendu décimal, décomposition et chargement de configuration.
- `tests/fishing-effort.test.ts` : calculs, normalisation, contrats, annexes et migration.
- `tests/fishing-practice-form.test.tsx` : formulaire, lecture seule, erreurs, conservation et précision.
- `tests/e2e/fishing-practice.spec.ts` : oracle historique, parcours ordinateur des trois engins et import/export des facteurs.
- `EFFORT_DECLARE.md` : lien vers l’état courant V2, en conservant le compte rendu historique V1.
- `EFFORT_DECLARE_V2.md` : ce compte rendu.

Aucune nouvelle branche, aucun commit, push ou merge créé par cet incrément. Les changements restent disponibles pour revue.

## Limites scientifiques et techniques

La biomasse reste agrégée, sans classes de tailles, espèces cibles ni courbes de sélectivité de terrain. Le facteur de mailles ne prédit pas la mortalité distincte des juvéniles et adultes. La table fournie doit être discutée et validée avant toute interprétation empirique. Le modèle n’est pas recalibré par cette extension.

Une seule pratique principale est normalisée par décision ; les engins multiples ne sont pas agrégés. « Autre engin » reste bloqué faute de règle déclarée. Les facteurs de référence sont fixes et explicites. Un ancien fichier avec une autre référence reste consultable/importable, mais une nouvelle conversion V2 incompatible est refusée jusqu’à fourniture d’une configuration cohérente.

Les dépendances et le fichier de verrouillage n’ont pas été modifiés. L’environnement de vérification utilise Node 26.13.0 tandis que les fichiers package.json ciblent Node 24. Toute recommandation de sécurité de la version Next.js installée reste hors du périmètre de cet incrément.
