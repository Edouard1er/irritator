# Effort calculé à partir des pratiques — compte rendu et recette

> Ce document conserve le compte rendu V1. L’implémentation courante intègre maintenant la motorisation, les mailles, Ligne et Senne : voir [EFFORT_DECLARE_V2.md](EFFORT_DECLARE_V2.md) pour les formules, les facteurs, les tests et les limites à jour.

Travail sur `two-modes`, à partir du SHA `a51584816c4998df895f175ede86b1a1dcc3bc49`.
Arbre initial propre. Aucune branche créée, aucun commit, push ou merge.
Les quatre documents du kit, ses exemples JSON, les deux captures et la vidéo
`Test_Chat.mp4` (106,29 s) ont été examinés. La vidéo montre notamment les repères
3,8 et 10,3 et la reprise de biomasse après réduction de l’effort.

## Comportement livré

Dans le formulaire existant « Modifier les conditions » de la Simulation, les
champs « Effort souhaité » et la composition visible 50/30/20 sont remplacés par
les pirogues, leur motorisation, les sorties, leur périmètre, la durée, l’engin,
sa quantité et ses caractéristiques conditionnelles. Les réponses aux champs
masqués restent disponibles pendant l’édition. Les mailles et la motorisation
sont descriptives. Une immersion supérieure à la durée de sortie est autorisée.

Les sorties mensuelles, heures mensuelles, effort nominal avec unité et effort
du modèle sont calculés immédiatement. L’effort du modèle est un `output`, sans
champ numérique modifiable, avec son rapport à la référence. Un champ invalide,
une référence incompatible ou un effort hors contrat désactivent l’application.
La validation est aussi exécutée dans l’adaptateur avant tout événement.

Annuler ne modifie ni le scénario, ni les courbes, ni l’historique. Une application
réussie conserve la pratique dans la session de lecture ; une nouvelle ouverture
à cet instant ou après retrouve cette pratique. Un échec du moteur conserve le
scénario précédent, la pratique appliquée précédente et la lecture en pause.
Les interventions futures gardent leur valeur absolue ; une modification au même
instant remplace le précédent choix.

Pluie, salinité, accessibilité, réglages scientifiques, vues pêcheur/scientifique,
alertes, son, graphiques, comparaison initiale, commandes temporelles et rendu du
lac gardent leur chaîne existante. Le résumé contextuel identifie l’effort calculé
et présente d’abord la pratique en lecture pêcheur.

## Formule et référence explicite

Pour les filets :

```text
S = sorties/semaine × (nombre de pirogues si « Chaque pirogue », sinon 1) × 52/12
H = S × durée de sortie
G = S × nombre de filets par sortie × longueur en mètres × immersion en heures
E = E_ref × G/G_ref
```

`E_ref` provient exclusivement de `temporal.parameters.E`, la valeur initiale du
scénario. La conversion ne contient aucune constante 150. `G_ref` est recalculé
à partir de la pratique de référence fixe, jamais à partir de l’intervention
précédente. L’unité native reste `effort` et `q` est inchangé.

Le dépôt ne possède pas de pratique métier de référence dans son schéma natif.
`initializePracticeHistory` initialise explicitement une convention front issue
du kit : 1 pirogue non motorisée, 4 sorties totales/semaine, 6 h/sortie, 2 filets
de 50 m, immersion de 4 h, mailles de 46 mm. Cette convention donne
`G_ref = 6933,333333333333 m·h/mois`. Elle est décrite dans les détails du formulaire
comme une convention, sans prétendre mesurer une pratique réelle ou calibrer q.
La référence et sa pratique complète figurent aussi dans le fichier annexe.

Les bornes réelles sont réutilisées par `validateConditions` : `0 ≤ E ≤ 10000`.
L’effort nul est accepté par ce contrat. Une référence d’effort nul est refusée,
car elle ne permet pas de normalisation relative positive. Aucun plafonnement
silencieux n’est effectué.

Pour une ligne, le nominal est `sorties × lignes × hameçons/ligne × heures`, en
`hameçon·h/mois`. Pour la senne, `sorties × sennes × opérations/sortie`, en
`traits/mois`. Ces quantités ne sont pas additionnées entre engins. Avec la
référence filet initialisée, la conversion des autres engins est bloquée ; aucun
coefficient entre engins n’a été fabriqué. Un autre engin reste descriptible,
mais aucun effort nominal ni scalaire ne lui est attribué sans règle validée.

L’avertissement sur les mailles hors de 5–200 mm est une simple vérification de
saisie/unité, sans valeur réglementaire ou coefficient biologique. Même 46 cm
ne modifie pas E ; la valeur et l’unité restent dans la déclaration.

## Allocation technique et chaîne native

`applyFishingPractice` appelle le contrat existant `intervene`, avec les mêmes
conditions et la seule source de E remplacée par le calcul métier. Les capacités
50/30/20 et les proportions existantes restent utilisées en interne. Une
allocation compatible est conservée ; sinon l’allocation automatique équilibrée
ou minimale existante est produite. Une ancienne allocation manuelle compatible
est conservée ; si E change, sa représentation devient automatiquement équilibrée.
Cette allocation ne représente pas les embarcations déclarées et ne remultiplie
jamais l’activité par leur nombre.

La chaîne HTTP, le compilateur temporel, le moteur C++/DEVS/QSS3, les équations,
les modèles et les paramètres biologiques n’ont pas été modifiés. Le moteur
recalcule depuis t=0 avec l’historique horodaté. Aucun checkpoint DEVS et aucun
solveur biologique JavaScript n’ont été ajoutés.

Les dates sont transmises avec leur précision native. Dans la preuve navigateur,
les observations sélectionnées correspondent à `3.800000000000002` puis
`10.29999999999998`. Ces valeurs exactes se retrouvent dans les événements et
l’annexe. L’affichage est arrondi pour la lecture uniquement. Les tests du
contrat couvrent aussi exactement `3.8` et `10.3`.

## Import/export compatible, sans modification du schéma v3

Le schéma existant refuse les clés supplémentaires. Aucun champ `practice` ou
`effortDerivation` n’a donc été ajouté au JSON natif, ni encodé dans ses chaînes
de provenance. L’export et l’import scientifiques habituels restent inchangés.

Les détails du formulaire proposent un fichier annexe `*-pratiques.json` :

```text
format: irritator-fishing-practices
version: 1
request: copie exacte du JSON scientifique associé
history.reference: id, version, source, unité, E_ref et pratique de référence
history.records[]: temps, pratique et effortDerivation (G, unités, ratio, E)
```

Exporter l’expérience habituelle et exporter les pratiques appliquées. Après
import du JSON scientifique et exécution, ouvrir le formulaire et importer
l’annexe associée. Elle est acceptée uniquement pour le même document JSON
(comparaison de la sérialisation, ordre des clés compris), avec des dates
ordonnées, une référence compatible et des dérivations recalculées cohérentes
avec les efforts de l’historique. Un autre scénario ou des valeurs altérées
sont refusés. Les saisies non appliquées ne sont pas exportées.

Les pratiques restent en mémoire dans la session de lecture. Un rechargement,
une nouvelle exécution ou un import du JSON seul ne les restaure pas. Le
formulaire signale une pratique manquante lorsque E courant diffère de la
référence : aucune pratique réelle n’est inventée à partir d’un effort scalaire.
L’import de l’annexe restaure les paramètres dans l’éditeur ; Annuler abandonne
les changements de l’édition. Cette solution évite une rupture du contrat natif.

## Fichiers

- `components/simulation/conditions-editor.tsx` : formulaire, validation et annexe.
- `components/simulation/simulation-workspace.tsx` : application par l’adaptateur,
  conservation transactionnelle des pratiques et résumé contextuel.
- `lib/simulation/fishing-effort.ts` : validation, nominal, normalisation,
  initialisation et import/export d’annexe, fonctions pures.
- `app/workshop.css` : styles du formulaire, grilles adaptatives et encart calculé.
- `tests/fishing-effort.test.ts` : calculs, contrat d’intervention et annexe.
- `tests/fishing-practice-form.test.tsx` : formulaire et annulation.
- `tests/e2e/fishing-practice.spec.ts` : parcours vidéo, oracle natif indépendant,
  comparaison initiale, export/import, clavier et mobile.
- `tests/e2e/interventions.spec.ts` et `tests/e2e/workshop-v31.spec.ts` : adaptation
  des anciens parcours aux nouveaux champs. L’activation d’un scénario existant
  utilise Entrée pour éviter l’indicateur de développement Next.js devant le bouton.
- `EFFORT_DECLARE.md` : ce compte rendu et la recette.

## Recette et preuves

État avant modification : **296 tests front / 27 fichiers passent**, et
**101 tests API passent** sur le moteur natif, en exécution séquentielle.
La compilation TypeScript API passe. Les anciennes sorties compilées orphelines
ne sont pas utilisées comme liste de tests : la liste provient des fichiers
`apps/api/tests/*.test.ts` réellement présents dans ce checkout.

Après modification, les **332 tests front / 29 fichiers passent**, ainsi que les
**6 parcours navigateur natifs**. Le build de production final réussit.
La vérification TypeScript front passe. Les parcours navigateur font appel au
serveur Fastify et au vrai exécutable Irritator déjà disponibles en local.
L’environnement de vérification est Node v26.13.0 ; les package.json du dépôt
annoncent Node 24. Les dépendances n’ont pas été modifiées.

Couverture des exigences de la recette du kit :

| Cas | Vérification |
| --- | --- |
| EF-01–04 | 17,3333 sorties, 104 h, G=6933,3333, E=150 puis 300 ; référence 3 filets / intervention 2 : E=100 |
| EF-05–07 | Groupe vs pirogue, absence de double compte, 20 sorties : 86,6667/mois et 520 h |
| EF-08 | Mailles mm/cm et motorisation sans effet sur E, avertissement descriptif |
| EF-09–11 | Engins incompatibles, unités invalides, référence nulle/absente, champs manquants, NaN/infini, bornes et débordement |
| EF-12 | Référence initiale fixe, décisions successives et reprogrammation dans le passé |
| UI-01–04 | Conditions du lac, recalcul immédiat, output en lecture seule, sous-champs gardés et conversion bloquée |
| UI-05–07 | Annulation, échec moteur, temps décimal exact et dernières pratiques appliquées |
| UI-08 | Bureau, 390 px, clavier, vues scientifique/pêcheur, plein écran, absence de débordement horizontal |
| UI-09 | JSON natif inchangé, annexe restaurée, incompatibilité/altération refusée, dégradation explicite sans annexe |

Les fonctions pures comparent les valeurs flottantes avec une précision de
10 à 12 décimales pour les calculs nominaux, et une égalité exacte quand le
résultat attendu est représentable (150, 300, 100). L’affichage utilise deux
décimales au maximum, sans arrondir les données envoyées au moteur.

Le parcours vidéo construit deux interventions par le formulaire. Un processus
Node indépendant emploie ensuite **l’ancien contrat `intervene` et `composeFleet`**
avec E=300 puis E=100 aux mêmes temps. Les demandes natives, événements et toutes
les observations sont égales **sans tolérance (0)**. Cela comprend 241 points de
biomasse N, 241 de capture cumulée C et les signaux r/q/a/E. Les captures mensuelles
sont également comparées. Le préfixe avant la première intervention est comparé
à la simulation initiale avec une tolérance absolue de `1e-7`, déjà utilisée par
la recette historique. La courbe de comparaison est comparée point par point à
la trajectoire initiale, et ses marqueurs restent aux deux dates exactes.

Dans le scénario vérifié : N minimal = 78,80896479199315 t ; à t=24 mois,
N=180,87483607840508 t et C=523,8929504207526 t. Le seuil de 140 t déclenche le
même état critique visible ; les tests existants couvrent aussi l’activation,
l’arrêt et l’unicité de l’alarme sonore après intervention.

Commandes reproductibles depuis `web/apps/frontend` :

```powershell
npm test -- --reporter=dot
npm run typecheck -- --incremental false
npm run build
npx playwright test tests/e2e/fishing-practice.spec.ts tests/e2e/interventions.spec.ts tests/e2e/workshop-v31.spec.ts --reporter=list
```

Pour la référence API, depuis `web` :

```powershell
npm run build
$apiTestFiles = @(Get-ChildItem apps/api/tests/*.test.ts | ForEach-Object { 'dist/apps/api/tests/' + $_.BaseName + '.js' })
node --test --test-concurrency=1 @apiTestFiles
```

Les journaux et preuves locaux sont dans `reports/` (répertoire ignoré par Git) :
`effort-baseline-frontend.log`, `effort-baseline-api-clean.log`,
`effort-frontend-after.log`, `effort-browser-final.log`,
`effort-frontend-build-final.log` et `effort-evidence/native-equivalence.json`.
Les captures de livraison sont `effort-evidence/01-formulaire-bureau.png`,
`02-resultats-sequence.png`, `03-formulaire-mobile-pirogues.png` et
`04-formulaire-mobile-effort.png`.

Le premier build de production a compilé et passé TypeScript, puis Next.js a
interrompu la commande avec un avis de sécurité sur sa version installée et
une recommandation de mise à jour. Le second passage du build réussit, tout en conservant la recommandation de
mise à jour de sécurité. Les dépendances et les fichiers de verrouillage restent
hors de cet incrément. L’avis original est conservé dans `reports/effort-frontend-build.log`.
