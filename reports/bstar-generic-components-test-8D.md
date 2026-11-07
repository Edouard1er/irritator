# Test 8D — Boucle DEVS observation–simulation–décision–action

7 novembre 2026 — Windows x64, MSVC, C++20, WITH_GUI=OFF.
Aucun commit ni push. Les modifications 8A–8C présentes avant ce travail sont conservées.

## Audit avant assemblage

Les rapports 8A, 8B, 8C, les interfaces natives de `core.hpp`, `event.hpp`,
`simulation.cpp`, `parameter.cpp`, les adaptateurs hiérarchiques, le catalogue
v3 et les contrôles React Flow ont été examinés.

Le test C++ direct `feedback-audit` est exécuté avant la création du
démonstrateur. Pour X(0)=10 et u=2, la mémoire de la dernière **émission** de
l'intégrateur contient 10,01 à t=1 ; `qss3_integrator::observation(1,1-tl)`
retourne **12**. La première émission est 10 puis un événement de quantification
à t=0,005 émet 10,01 et une pente 2. Une mémoire scalaire ne fait pas évoluer
cette valeur entre les événements. Le journal initial est
`build-web-test8c/logs/feedback-audit.log`.

`qss3_sample_hold` existe : il échantillonne périodiquement le polynôme du
signal reçu, sans port de lecture externe. Ce polynôme QSS3 est quadratique,
alors que l'état continu interne peut être cubique. Il ne garantit donc ni une
lecture à un instant demandé ni l'accès à X courant. `value_memory` est une
mémoire identifiée de messages, pas un accès à l'état d'un autre atome.

Le maintien `zero_order_hold` existe déjà. Le test natif reçoit une commande
identifiée `[-1,17,8]`, émet `[-1,0,0]`, et vérifie effectivement `u=-1`,
`mu=pu=0` dans l'intégrateur principal. X(2)=11 après u=2 jusqu'à t=1 puis
u=-1. Il suffit d'exposer cet atome au catalogue web.

| Besoin | Mécanisme retenu |
|---|---|
| État courant à la demande | Nouvelle primitive générique `state_observer`, manque démontré ci-dessus |
| Mémorisation | `value_memory`, emitOnWrite=1 |
| Configuration de X prospectif | Facteur natif ciblant `qss3_integrator.X` |
| Commandes ordonnées | Chaîne d'`event_operator` à sigma=0 |
| Prospections et résultats individuels | `simulation_wrapper`, mode complete, scenarioResults=true |
| Score, clôture, choix externe | `event_operator`, `candidate_filter`, `candidate_select` dans une définition couplée |
| Application et maintien | `zero_order_hold` natif connecté à l'entrée dérivée du QSS3 principal |
| Réutilisation et édition | Définitions couplées et ports React Flow existants |

## Lecture native générique

`state_observer` possède source/read/reset en entrée et value/missing en sortie.
Une connexion ordinaire de l'intégrateur vers source lie cet intégrateur
**dans le graphe natif aplati**, y compris à travers une interface couplée.
Une source QSS1, QSS2 ou QSS3 est acceptée. Plusieurs connexions source ou une
source d'un autre type produisent une erreur de protocole à initialize.
Une source absente produit missing lors d'une lecture, sans inventer X.

Les messages reçus sur source sont ignorés : ils ne servent qu'à matérialiser
la liaison. read porte une commande `[quelconque,candidat,campagne]`. Après le
sac qui contient read, une transition interne à sigma=0 appelle la fonction
native `observation(t,t-source.tl)` de l'intégrateur lié. Une autre transition
émet `[X(t),candidat,campagne]`. Les transitions de la source dans le sac de
lecture ont ainsi terminé, même si reset et read sont simultanés et quel que
soit l'ordre des modèles. Des commandes provenant d'une chaîne plus longue
restent des sacs ultérieurs : l'utilisateur doit connecter les acquittements
causaux pour demander une lecture après une telle chaîne.

Ce mécanisme ne lit ni un observer de graphique, ni un buffer rééchantillonné,
ni une courbe Plotly, ni une réponse HTTP. Il ne modifie ni X ni les algorithmes
QSS. Il n'extrapole pas le dernier message de sortie. Il utilise l'évaluation
native de l'état continu, y compris son terme cubique, à la précision du
modèle QSS lui-même ; il ne prétend pas donner la solution analytique exacte
d'une équation non linéaire arbitraire.

Le stockage appartient à `simulation::event_states` : liaison par model_id,
lectures et FIFO possédées, sans pointeur vers une autre simulation. Copies et
snapshots gardent les mêmes IDs dans leur propre stockage. Reset annule les
lectures et réponses restantes puis traite les lectures du même sac. La
capacité configurable 1–4096 borne lectures et réponses en attente. Sans read,
aucune émission spontanée et aucune boucle instantanée n'est créée.

`zero_order_hold` utilise la sémantique native inchangée : dernière commande
entre deux sacs, et valeur maximale si plusieurs commandes arrivent dans le
**même** sac (`get_qss_message<1>`). Les identités ne sont jamais émises comme
des dérivées. Sa valeur initiale est zéro ; le démonstrateur lui transmet une
commande explicite à t=0.

## Démonstrateur livré

`web/examples/decision-feedback-minimal-v3.json`, reproductible par
`node web/engine/runner/decision-8d-fixture.mjs --write`.
Ce script construit le document ; il ne calcule aucune décision.

Trois définitions réutilisables :

- `Plant` : entrées read/action, sortie observation ; intégrateur QSS3 X,
  maintien hold, lecture sample. action → hold → X.x-dot ; X.out → sample.source ;
  read → sample.read ; sample.value → observation.
- `Prospect` : la même équation dX/dt=u, sur une horloge locale [0,2] ;
  constante u → intégrateur X. X=-777 est une sentinelle initiale remplacée
  par l'observation à chaque campagne ; dQ=0,01 reste inchangé.
- `ChooseAction` : entrées terminal/action/end. Distance = terminal−10,5,
  valeur absolue, multiplication par −1, filtre avec score et action requis,
  sélection maximale. Tous les calculs sont des atomes C++ paramétrés par le
  graphe. Le seuil 10,5 appartient à l'exemple, à aucune primitive.

Dans le parent : X(0)=10, commande initiale 2, lectures à t=1 et t=3, fin t=5.
L'observation traverse `value_memory(emitOnWrite=1)`, alimente le facteur X et
le calcul `initValue=observation×0`. Sa sortie commande init puis
`runValue=initValue+delay` commande run au sac suivant. delay=0 par défaut.

Le wrapper a F=2 facteurs et S=1 critère :

| Ports | Contenu |
|---|---|
| x0/x1/x2/x3 | init, run, état initial X, commande prospective u |
| y0/y1/y2 | Résultats historiques du gagnant interne : terminal, X initial, u |
| y3 | Statut individuel `[valide,scénario,campagne]` |
| y4 | État initial effectivement appliqué à chaque enfant |
| y5 | Commande individuelle u, reliée à ChooseAction.action |
| y6 | État terminal individuel, relié à ChooseAction.terminal |
| y7 | Clôture `[valides,total,campagne]`, reliée à ChooseAction.end |

L'objectif interne maximise terminal, donc retient u=+1. Le décideur externe
emploie les trois résultats bruts et choisit autrement ; la sortie interne
n'intervient pas dans l'action. La sortie scalaire du décideur rejoint le
maintien du système principal. Les ports identifiés ne vont pas directement
dans une entrée de dérivée QSS3.

## Chronologie causale et valeurs numériques

À chaque tk, les étapes suivantes sont des sacs successifs à la **même date
logique**, sans epsilon temporel ajouté :

1. La constante de lecture déclenche sample.read.
2. sample lit l'état natif après ce sac, puis émet l'observation.
3. La mémoire écrit et émet cette observation.
4. Le wrapper reçoit le facteur X ; initValue prépare la commande init.
5. Le wrapper reçoit init ; runValue prépare run.
6. Le wrapper reçoit run, exécute les trois enfants natifs jusqu'à leur fin.
7. À tk+delay, la FIFO restitue statuts, facteurs, critères puis clôture.
8. Les opérateurs évaluent les scores par `(scénario,campagne)` ; les barrières
   attendent toutes les lignes requises, même si end précède une branche.
9. Le sélecteur émet l'action scalaire ; hold la transmet à X.x-dot.
10. L'intégrateur continue jusqu'au prochain événement de décision.

| Campagne | tk | X observé et appliqué aux 3 enfants | u prospectifs | X terminaux | Scores | u appliqué |
|---|---:|---:|---|---|---|---:|
| 1 | 1 | 12 | −1, 0, +1 | 10, 12, 14 | −0,5 ; −1,5 ; −3,5 | −1 |
| 2 | 3 | 10 | −1, 0, +1 | 8, 10, 12 | −2,5 ; −0,5 ; −1,5 | 0 |

La trajectoire attendue est X=10+2t avant t=1, X=13−t sur [1,3], puis X=10.
Le second état initial vaut 10 à cause de l'action précédente. Sans retour
d'action, il vaudrait 16 et X(5)=20. Les campagnes sont numérotées 1 et 2,
les scénarios 0,1,2 ; une commande init ne remet pas le compteur de campagne
à zéro. La mémoire d'observation se remplace sous la clé scalaire (0,0).

Ces dates sont vérifiées sur les ports actifs du moteur par le test C++
`native-wrapper-feedback-loop`, qui relève directement les lectures et les
émissions du maintien. Les sorties HTTP `observations` sont rééchantillonnées
et dédupliquées par le moteur. Pour les atomes discrets, la politique native
`interpolate_type::none` utilise la valeur du point droit ; les dates visibles
dans ces historiques ne constituent donc pas une trace des sacs DEVS. Les
tests JSON vérifient leurs valeurs et utilisent `resultEvents` pour les dates
des campagnes. Les courbes ne participent jamais à la boucle de décision.

## Sémantique réelle de configuration et de reset du wrapper

Les facteurs sont appliqués à `parameters.reals[0]` des enfants, seule cible
autorisée par le contrat natif actuel. Une valeur externe **single** remplace
sa valeur configurée. Avec **fixed**, une valeur externe remplace chaque
valeur du plan : la cardinalité reste inchangée et peut donc créer des
scénarios équivalents. Le facteur u et les autres paramètres restent distincts.
Il n'existe aucune copie automatique de l'état complet du système principal.

Dans un même sac, le wrapper traite facteurs → init → run. En mode complete,
une mise à jour de facteur suivie de run réinitialise automatiquement les
enfants, même sans commande init explicite. Une nouvelle commande run sans
changement de facteur ne constitue pas à elle seule un reset général.
Les autres modes conservent leur sémantique d'avancement native ; le
démonstrateur utilise volontairement complete.

Une commande init explicite efface les réponses différées en attente.
Deux campagnes qui se chevauchent avec init à chaque fois annulent donc la
première réponse non encore émise. Sans init explicite, le reset automatique
de complete après changement de facteur conserve les réponses déjà capturées,
dont les facteurs et résultats restent indépendants. Un init tardif entre
run et restitution annule la réponse ; le test le constate sans fabriquer
une décision. Aucun arbitrage d'obsolescence métier n'est ajouté : si des
réponses chevauchantes sont autorisées, le maintien applique leur ordre réel
d'arrivée. Une remise à zéro de simulation efface les états événementiels et
réinitialise le compteur de campagnes.

Les enfants sont calculés synchroniquement dans la transition run native.
Le chevauchement testé concerne leurs réponses différées dans le temps du
parent ; il ne représente pas deux calculs prospectifs exécutés en parallèle.

## Construction dans React Flow

Les deux atomes sont dans « Contrôle et décision » ; l'inspecteur standard
expose la capacité de lecture et les descriptions des ports. Les interfaces
des définitions couplées se créent et se nomment dans l'éditeur existant.
Les connexions de source sont des connexions React Flow ordinaires, conservées
par export scientifique v3 et sauvegarde workspace.

Le parcours Playwright 8D crée une nouvelle définition `NativePlant`, nomme ses
ports read/action/observation, ajoute et configure QSS3/hold/sample, connecte
les cinq liens internes, remplace l'instance du système, rétablit les liens
de la boucle, ajoute les observations hiérarchiques, exécute puis exporte et
réimporte. Un autre parcours change l'instant de seconde lecture et le délai
de réponse depuis les inspecteurs. Aucun comportement décisionnel n'est ajouté
à React ou TypeScript.

## Vérification et limites

Les vérifications natives 8D sont séparées en quatre CTest : audit préalable,
lecture d'état, initialisation des enfants et boucle complète. Elles couvrent
les lectures identifiées, l'état cubique distinct du signal quadratique,
les ordres de modèles inversés pour reset/read simultanés, les copies et
snapshots, la réinitialisation complète, la capacité et les sources absentes.
Les enfants sont inspectés directement pour X initial, dQ, u, offset et
stockage indépendant ; single et fixed sont vérifiés sur deux campagnes.

Les treize tests JSON/HTTP 8D couvrent le modèle livré et son réimport,
une/deux décisions, un autre état initial principal, init absent, init et run
dans un même sac que le facteur, fixed, un délai de 0,5, les chevauchements
avec/sans init, une lecture ou un résultat absent, init tardif, la réutilisation
d'une définition Plant, une liaison ambiguë et une boucle instantanée bornée.
Les dix-sept requêtes incluent deux erreurs attendues HTTP 422. Seules ces
erreurs produisent un court diagnostic stderr ; toutes les exécutions valides
doivent conserver stderr vide.

Les premières vérifications ont corrigé trois attentes du banc de test :
le second intégrateur de la liaison ambiguë nécessitait dQ>0 ; les erreurs
attendues doivent conserver leur diagnostic stderr ; et le clic au centre
d'un nœud couplé ouvre son contenu. Le parcours manuel sélectionne maintenant
l'en-tête. Le premier Playwright ciblé donne 2/3 ; après correction, le parcours
manuel passe, puis la suite complète donne 60/60. Aucun calcul de décision
ni algorithme QSS n'a été modifié pour satisfaire ces attentes.

### Résultats exécutés

| Vérification | Release | Debug |
|---|---:|---:|
| Reconstruction propre du moteur, du runner et des clients historiques | Réussie | Réussie |
| Quatre nouveaux groupes C++ 8D | 4/4 | 4/4 |
| CTest runner / JSON / wrappers / 8A–8D | 34/37 | 34/37 |
| Tests officiels moteur | 10/10 | 10/10 |
| Stabilisation et historique 7A–7C | 40/40 | 40/40 |
| API / processus / HTTP historiques | 94/94 | 94/94 |
| HTTP scientifique 8B | 12/12 | 12/12 |
| HTTP scientifique 8C | 13/13 | 13/13 |
| JSON et HTTP scientifique 8D | 13/13, 17 réponses comparées | 13/13, 17 réponses comparées |
| Diagnostic scientifique séparé et diagnostic d'erreur borné | 2/2 | 2/2 |

Les trois échecs CTest sont exclusivement `runner-wrapper-7g`,
`native-wrapper-schaefer-trajectories` et `native-wrapper-schaefer-pair`.
Ils demandent le véritable `web/model-test/modelhalieutiquetest-points.csv`,
toujours absent. Les objectifs Schaefer passent. Les scripts complets retournent
donc **1**, avec `runner-tests=8` et toutes les autres étapes à zéro ; ces
échecs ne sont ni ignorés ni transformés en succès.

Frontend : **138/138 Vitest**, contrôle TypeScript final et build Next.js de
production réussis ; **60/60 Playwright**, zéro retry, zéro flaky et zéro test
ignoré. Les trois parcours 8D passent dans cette suite complète. La capture
`build-web-test8d/browser/native-plant-definition.png` a été inspectée.
Les cinq captures historiques suivies dans reports n'ont pas été remplacées :
les captures de non-régression sont dirigées vers le répertoire de build.
Les seuls serveurs démarrés pour ce travail, 3030/3031, ont été arrêtés.

Les preuves sont conservées dans :

- `build-web-test8d/{Release,Debug}/logs/` : codes des quinze étapes, JUnit
  runner/officiel/historique, API, HTTP 8B/8C/8D, diagnostics ;
- `logs/http-8d/*.json` dans chaque configuration : requête, résultat natif,
  égalité HTTP et nombre d'octets stderr pour les dix-sept cas ;
- `logs/native-feedback-events.log` : trace complète non tronquée de la boucle
  native, notamment en Debug où les tableaux scientifiques dépassent le seuil
  d'affichage JUnit ;
- `build-web-test8d/playwright-final.{log,json}`, `browser/` et
  `browser-regression/` : parcours et exports ;
- `build-web-test8d/frontend-{vitest,build,typecheck-final}.log` : frontend ;
- `build-web-test8d/cross-configuration.json` : comparaison stricte des dix-sept
  résultats, empreintes SHA-256 des exécutables et archives, mêmes trois échecs
  CSV et même chronologie native.

`node build-web-test8d/verify-proof.mjs` réussit : **17/17** résultats identiques
entre Release et Debug, chacun égal à son résultat HTTP ; stderr=0 pour les
cas valides. Il vérifie `IRRITATOR_ENABLE_DEBUG` présent et `NDEBUG` absent
dans les compilations Debug du moteur et du runner. Les corrections 8C ne
sont donc pas contournées en exécutant une bibliothèque Release dans un
client Debug. `git diff --check` réussit également.

### Reproduction

Depuis la racine du dépôt, sous PowerShell :

```powershell
./web/engine/runner/tests-wrapper/run-8d.ps1 -Configuration Release
./web/engine/runner/tests-wrapper/run-8d.ps1 -Configuration Debug
```

`-BuildOnly` et `-TestsOnly` permettent de séparer reconstruction et tests ;
les codes de construction sont conservés lors de TestsOnly. Le retour global
reste non nul tant que la référence 7G manque.

Pour le navigateur, construire le frontend avec
`IRRITATOR_API_URL=http://127.0.0.1:3031`, lancer l'API sur 3031 avec
`IRRITATOR_RUNNER` pointant vers le runner 8D choisi et Next sur 3030, puis
lancer `npm run test:e2e` dans `web/apps/frontend` avec
`FRONTEND_URL=http://127.0.0.1:3030` et le même runner.
`IRRITATOR_BROWSER_SCREENSHOTS` permet de diriger les captures vers le build.
Le test 8D seul s'exécute avec `npm run test:e2e -- decision-8d.spec.ts`.

Les limites existantes de scénarios, modèles, mémoire, processus, durée,
sortie et nombre d'appels restent actives. Une rétroaction événementielle
mal connectée peut encore créer une boucle sigma=0 ; le budget maxRunCalls
est vérifié par un test qui attend une erreur bornée. Le démonstrateur ne
relie pas action à read.

Les correctifs Debug 8C et `heap::remove` sont conservés. Le CSV historique
`modelhalieutiquetest-points.csv` de 7G n'est ni synthétisé ni remplacé par
la sortie actuelle du moteur. Les tests qui exigent cette référence restent
des échecs documentés si elle manque.

Cette validation porte sur un état scalaire observé depuis un intégrateur
QSS1/2/3 et sur le mode complete pour la boucle entière. Elle ne transfère
aucun état caché d'un autre modèle, et ne constitue pas une validation de
toutes les boucles possibles en modes bag/time/until/during. L'application
graphique native, Linux/macOS et les sanitizers ne sont pas couverts.
