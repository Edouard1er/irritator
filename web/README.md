# Irritator : modèles DEVS atomiques et hiérarchiques

Le Test 8C fournit les exemples v3 `decision-8c-aggregation-v3.json`,
`decision-8c-normalization-v3.json`, `decision-8c-fallback-v3.json` et
`decision-8c-schaefer-v3.json` dans `examples/`. La bibliothèque « Contrôle et
décision » permet de construire leurs réductions, diffusions et sélections
prioritaires dans React Flow. Voir `../reports/bstar-generic-components-test-8C.md`.
En Debug, les tables scientifiques sont désactivées dans le runner par défaut ;
`IRRITATOR_TRACE_FILE` les dirige vers un journal séparé, ou
`IRRITATOR_TRACE=stderr` réactive la verbosité détaillée. Les assertions et les
plafonds HTTP restent actifs.

Backend local Fastify/TypeScript et runner C++20 utilisant **libirritator**.
Le modèle est un graphe JSON dynamique. Le backend lance un nouveau processus
natif par simulation avec `spawn`, transmet la requête sur stdin et contrôle
stdout, stderr, le code de sortie et la réponse. Aucun calcul DEVS n'est effectué
dans TypeScript. L’éditeur graphique Next.js est maintenant disponible dans
[`apps/frontend`](apps/frontend/README.md), sur le port 3000. Le Test 6 ajoute
les définitions couplées partagées, leurs interfaces, la navigation hiérarchique
et l’exécution native via `project::set`. Le Test 7D accepte aussi les simulations
imbriquées JSON v3 sur la même route HTTP et publie leurs événements natifs.
Le contrat plat v1 reste accepté.

Dans un second terminal, après le démarrage du backend décrit ci-dessous :

```powershell
Set-Location D:\these\irritator\web\apps\frontend
npm.cmd ci
npm.cmd run dev
```

Ouvrir `http://127.0.0.1:3000`. Le frontend transmet `/api/v1/*` à Fastify ;
les commandes backend du Test 4 restent identiques. Les deux packages npm ont
des fichiers de verrouillage distincts ; aucun workspace n’est nécessaire.

## Installation et compilation (PowerShell)

Depuis `D:\these\irritator`, avec Node.js 24 LTS, npm, CMake, Ninja et un
compilateur C++20. Le script charge le Developer PowerShell de l'installation
Visual Studio existante si nécessaire. Sur une autre installation, le lancer
depuis son Developer PowerShell x64.

```powershell
Set-Location D:\these\irritator
# Compilation complète du moteur actuel et du runner, puis tests natifs :
powershell -NoProfile -ExecutionPolicy Bypass -File web/build-runner.ps1

# Sur ce poste, réutilisation explicite de l'archive stabilisée du Test 3 :
powershell -NoProfile -ExecutionPolicy Bypass -File web/build-runner.ps1 -SkipEngineBuild -EngineBuildDir build-wrapper-test3

Set-Location web
npm.cmd ci
npm.cmd run build
$env:IRRITATOR_RUNNER=(Resolve-Path ../build-web-test4/runner/irritator-runner.exe).Path
npm.cmd start
```

Ne choisir `-SkipEngineBuild` que si l'archive correspond aux en-têtes actuels,
à la configuration et au runtime du runner. Le script normal reconstruit le
moteur dans `build-web-test4/engine-release` pour éviter les objets périmés
avec `/showIncludes` sur cette installation MSVC localisée. Il ne modifie pas les
sources. Les binaires Release sont dans `build-web-test4/runner`.

Le backend écoute `http://127.0.0.1:3001`. Ctrl+C l'arrête et nettoie ses processus.
Les chemins relatifs de configuration se résolvent depuis `web`, le dossier
d'exécution des commandes npm. `npm ci` utilise les versions de `package-lock.json`.
Les packages API et frontend ont leurs propres installations npm et verrous.

## API et expérience reproductible

Dans un **second** PowerShell, depuis la racine du dépôt :

```powershell
Set-Location D:\these\irritator
$api='http://127.0.0.1:3001/api/v1'
Invoke-RestMethod "$api/health"
Invoke-RestMethod "$api/components" | ConvertTo-Json -Depth 12
$body=Get-Content web/examples/sum3.json -Raw
$result=Invoke-RestMethod "$api/simulations/run" -Method Post -ContentType 'application/json' -Body $body
$result.observations[0].samples | Format-Table
$result.simulation
```

Résultat : `(0,10),(1,110),(2,1110)`, finalTime=3, runCalls=10.
L'intervalle d'événements est `[0,3[`. Un appel à run ne correspond pas à un
événement physique distinct. Les trajectoires sont rééchantillonnées par le
moteur et les valeurs constantes sont dédupliquées.

Modifier les paramètres sans recompiler :

```powershell
$model=Get-Content web/examples/sum3.json -Raw | ConvertFrom-Json
$model.model.components[0].parameters.value=-2
$model.model.components[1].parameters.value=7
$model.model.components[2].parameters.value=40
$body=$model | ConvertTo-Json -Depth 20
$result=Invoke-RestMethod "$api/simulations/run" -Method Post -ContentType 'application/json' -Body $body
$result.observations[0].samples | Format-Table
# Valeurs -2, 5, 45 aux dates 0, 1, 2.

foreach($example in @('sum2','qss1_integrator','qss3_integrator')) {
  $body=Get-Content "web/examples/$example.json" -Raw
  $result=Invoke-RestMethod "$api/simulations/run" -Method Post -ContentType 'application/json' -Body $body
  $result.observations[0].samples | Format-Table
}
```

`sum2` donne -2 puis 5. Les deux intégrateurs d'exemple suivent X(t)=5+2t sur
`[0,3[` et publient l'état terminal 11 à 3 lors de la fermeture de l'observation.
Cela n'exécute aucun événement à la borne. Sur une trajectoire constante,
la déduplication peut supprimer cette date terminale. Le runner ne fabrique
aucun échantillon pour compléter une grille.

Les trois routes :

| Route | Comportement |
|---|---|
| GET `/api/v1/health` | Vérifie `--describe` et `--capabilities` ; expose les capacités vérifiées, ou available=false en cas d'erreur. |
| GET `/api/v1/components` | Catalogue embarqué dans le runner, comparé au contrat serveur. |
| POST `/api/v1/simulations/run` | Requêtes v1/v2 → résultat v1 ; requête v3 → résultat v2 avec observations parent, resultEvents, wrappers et runId. |

## Contrats

Voir `packages/contracts/request.schema.json`, `catalog.json` et `index.ts`.
Le schéma utilise le sous-ensemble commun draft 4/draft 7 : RapidJSON embarqué
et Ajv/Fastify le valident sans conversion de types ni suppression de propriétés.
Les règles de graphe sont vérifiées à chaque frontière : unicité, références,
ports, paramètres, temps, observations et budgets. Le catalogue et le schéma
sont embarqués dans le runner par CMake ; recompiler les deux côtés après
modification des contrats. Aucun schéma utilisateur n'est compilé.

| Type supporté | Paramètres obligatoires | Entrées | Sortie |
|---|---|---|---|
| constant | value, offset | aucune | 0 : valeur |
| qss1_sum_2 | objet vide | 0,1 | 0 : somme |
| qss1_sum_3 | objet vide | 0,1,2 | 0 : somme |
| qss1_integrator | X, dQ | 0 : dérivée, 1 : reset | 0 : X |
| qss3_integrator | X, dQ | 0 : dérivée, 1 : reset | 0 : X |
| qss2_integrator | X, dQ | 0 : dérivée, 1 : reset | 0 : X |
| qss1_multiplier | aucun | 0 et 1 : facteurs | 0 : produit |
| qss3_multiplier | aucun | 0 et 1 : facteurs | 0 : produit |
| qss3_wsum_2 | coeff-0, coeff-1 | 0 et 1 : termes | 0 : somme pondérée |
| qss3_power | n | 0 : signal | 0 : puissance |
| qss3_inverse | aucun | 0 : signal non nul | 0 : inverse |
| qss3_square | aucun | 0 : signal | 0 : carré |
| qss3_sqrt | aucun | 0 : signal strictement positif | 0 : racine carrée |

`offset` est un délai non négatif depuis le début de simulation. `X` est la
condition initiale, `dQ` le quantum strictement positif. Les valeurs numériques
sont finies et bornées (voir le catalogue). Les sommes utilisent les valeurs
initiales nulles du moteur. Il est possible d'alimenter plusieurs fois un port,
conformément aux sacs DEVS ; une connexion identique répétée est rejetée.
Les cycles entre composants sont admis ; une auto-connexion est rejetée par
l'API native. La version 1 représente uniquement un graphe atomique plat.

Les réponses réussies ont schemaVersion, status=completed, modelId, simulation
(start/end/finalTime/runCalls), observations (component/samplingInterval/samples)
et diagnostics. Les erreurs ont status=failed et error.code/message ; une erreur
native ajoute engineCategory/engineCode, sans résultat partiel réussi.

| HTTP | Erreurs principales |
|---|---|
| 400 | INVALID_JSON, INVALID_MODEL, UNKNOWN_COMPONENT, INVALID_PARAMETER, INVALID_REFERENCE, INVALID_TIME, INVALID_CONNECTION, OBSERVATION_ERROR, LIMIT_EXCEEDED détecté avant lancement |
| 413 | BODY_TOO_LARGE |
| 422 | Erreur native de connexion/initialisation/exécution/observation ou budget atteint par le runner |
| 502 | RUNNER_PROTOCOL_ERROR, RUNNER_INCOMPATIBLE, OUTPUT_LIMIT, erreur interne native |
| 503 | ENGINE_UNAVAILABLE, ENGINE_BUSY |
| 504 | ENGINE_TIMEOUT |

L'annulation utilise le code interne CANCELLED (499 si une réponse reste possible).
Pas de file d'attente : au-delà de la concurrence autorisée, le serveur répond 503.
runId identifie la réponse, sans persistance ni route de récupération asynchrone.

## Configuration et limites

Variables décrites dans `.env.example`, à définir dans PowerShell avec
`$env:ENGINE_TIMEOUT_MS='10000'`, etc. Ce fichier n'est pas chargé automatiquement.
Seul le serveur peut définir le chemin de l'exécutable ; il ne vient jamais du JSON.

| Variable | Défaut et plafond |
|---|---|
| IRRITATOR_RUNNER | ../build-web-test7f/Release/runner/irritator-runner.exe sur Windows ; ../build-web-test7f/runner/irritator-runner sur Unix |
| HOST / PORT | 127.0.0.1 / 3001 ; HOST restreint à la boucle locale |
| API_BODY_LIMIT | 1 MiB maximum |
| ENGINE_TIMEOUT_MS | 10 s, maximum 60 s |
| ENGINE_MAX_CONCURRENT | 2, maximum 8 |
| ENGINE_MAX_STDOUT_BYTES / ENGINE_MAX_STDERR_BYTES | 4 MiB / 64 KiB, plafonds identiques |
| ENGINE_MAX_COMPONENTS / ENGINE_MAX_CONNECTIONS | 128 / 512 |
| ENGINE_MAX_RUN_CALLS / ENGINE_MAX_POINTS | 100000 / 20000 |
| ENGINE_MAX_DEPTH / ENGINE_MAX_INSTANCES | 8 / 512 (v2/v3) |
| ENGINE_MAX_WRAPPERS / ENGINE_MAX_SCENARIOS | 8 / 128 |
| ENGINE_MAX_TOTAL_SCENARIOS / ENGINE_MAX_TOTAL_MODELS | 256 / 8192 |
| ENGINE_MAX_TOTAL_CONNECTIONS / ENGINE_MAX_INTERNAL_POINTS | 32768 / 200000 |
| ENGINE_MAX_RESULT_EVENTS | 20000 |

Le JSON peut seulement **réduire** les budgets de calcul via `limits`.
Maximum 32 observations, identifiants ASCII de 64 caractères, horizon <=1e9,
bornes absolues <=1e9, pas >=1e-6. La somme de `ceil(horizon/pas)+2` par observation
doit tenir dans maxPoints **avant** lancement : c'est volontairement conservateur,
même pour une constante dédupliquée. Cela borne les boucles du rééchantillonneur
et détecte les pas qui ne font pas avancer l'horloge flottante.

Timeout, annulation, sortie trop grande et arrêt du serveur tuent puis attendent
la fermeture du processus ; le créneau de concurrence est libéré seulement
ensuite. Pas de shell, de code utilisateur, de commande ou de fichier de modèle
externe. Cette version n'a pas de quota mémoire OS, d'authentification, de service
public, de persistance ou de distribution des calculs.

## Runner seul et tests

Depuis la racine :

```powershell
Get-Content web/examples/sum3.json -Raw | & .\build-web-test4\runner\irritator-runner.exe
& .\build-web-test4\runner\irritator-runner.exe --describe
ctest --test-dir build-web-test4/runner --output-on-failure
```

Runner : un document JSON sur stdin ; un document JSON sur stdout ; diagnostics
techniques sur stderr ; code 0 si succès, 2 pour erreur contrôlée, 3 pour exception
interne. Un appel direct a des budgets internes mais pas le timeout mural du backend.
En Debug, le runner dirige la trace détaillée des allocations vers le périphérique
nul ; les assertions et les erreurs stderr restent actives. Cela conserve le
plafond stderr de 64 Kio, également pour les copies de scénarios v3.
Le moteur ouvre toujours un fichier irt-mem.txt, normalement vide après cette
redirection et ignoré par Git ; le dossier courant doit être accessible en écriture.

Depuis `web` :

```powershell
npm.cmd test                 # Routes avec moteur mocké et contrôle des processus
npm.cmd run test:runner      # Tests boîte noire du véritable binaire C++ (sans dépendance npm)
npm.cmd run test:integration # Véritable TCP HTTP + véritable runner/libirritator
npm.cmd run test:all         # Ensemble des tests
```

Les fixtures de processus servent uniquement à tester erreurs, stdout/stderr,
timeout, annulation et nettoyage. Elles ne produisent aucun résultat scientifique
dans les tests d'intégration. L'expérience TCP sauvegarde les requêtes et réponses
dans `build-web-test4/logs/http-results.json`.

Version Debug :

```powershell
# Depuis la racine, avec l'archive Debug stabilisée existante :
powershell -NoProfile -ExecutionPolicy Bypass -File web/build-runner.ps1 -Configuration Debug -SkipEngineBuild -EngineBuildDir build-wrapper-test3-debug
Set-Location web
$env:IRRITATOR_RUNNER=(Resolve-Path ../build-web-test4/runner-debug/irritator-runner.exe).Path
npm.cmd run test:integration
Remove-Item Env:IRRITATOR_RUNNER
```

Les commandes CMake Linux sont analogues (`cmake -S . -B build-engine -G Ninja
-DWITH_GUI=OFF -DWITH_NATIVE_ARCH=OFF -DCMAKE_BUILD_TYPE=Release`, construction
libirritator puis configuration du runner avec `-DIRRITATOR_BUILD_DIR=...`).
Seule Windows/MSVC est validée dans cette campagne.

## Modèles hiérarchiques (Test 6)

Le [contrat v2](packages/contracts/README.md) décrit définitions, occurrences,
ports stables et observations par chemin. Les définitions sont dans le document,
distinctes du catalogue atomique global. La conversion est native ; Fastify ne
déplie aucun graphe exécutable et ne calcule aucune trajectoire.

```powershell
# Depuis la racine, après construction du runner :
$runner=(Resolve-Path build-web-test4/runner/irritator-runner.exe).Path
foreach($name in @('hierarchy-sum','hierarchy-nested','hierarchy-independent')) {
  Get-Content "web/examples/$name.json" -Raw | & $runner
  $body=Get-Content "web/examples/$name.json" -Raw
  $result=Invoke-RestMethod 'http://127.0.0.1:3001/api/v1/simulations/run' -Method Post -ContentType 'application/json' -Body $body
  $result.observations | ConvertTo-Json -Depth 12
}
```

Les deux modèles de sommes donnent `(0,10),(1,110),(2,1110)` avec 14 appels
`run`, contre 10 pour la référence plate. Le modèle indépendant utilise deux
occurrences de la même définition QSS2, avec X=5 et dérivées 2/−3 ; états finaux
11/−4 et trajectoires exactement identiques aux références plates natives.
Le rééchantillonnage Hermite QSS2 produit un écart initial .008 à t=.1 pour
la dérivée 2. Tolérance analytique de cette expérience : .01 ; aucun point
n’est corrigé. Le [rapport](../reports/hierarchy-test-6.md) explique cette limite.

Dans l’interface : **Mes composants** → identifiant et nom → **Créer le composant
couplé** → ajouter entrées/sorties → ajouter les enfants → relier `$input`,
les enfants et `$output` → **Enregistrer la définition** → insérer plusieurs
instances. **Ouvrir le contenu** et le fil d’Ariane changent de portée.
**Observations hiérarchiques** sélectionne un atome par chemin d’instance.
Enregistrer/Ouvrir exporte et importe la requête scientifique v2 ; la disposition
de chaque définition et la navigation restent dans le workspace navigateur v2.
Les workspaces v1 sont lus sans réécrire leur clé d’origine.

Pour reproduire les tests dans un répertoire de construction séparé, utiliser
Developer PowerShell x64 :

```powershell
cmake -S web/engine/runner -B build-web-test6/runner -G Ninja -DCMAKE_BUILD_TYPE=Release -DIRRITATOR_BUILD_DIR=D:/these/irritator/build-wrapper-test3
cmake --build build-web-test6/runner --parallel 2
$env:IRRITATOR_RUNNER=(Resolve-Path build-web-test6/runner/irritator-runner.exe).Path
Set-Location web
npm.cmd run test:all
Set-Location apps/frontend
npm.cmd run typecheck
npm.cmd test
# Avec Fastify et Next.js démarrés sur les ports voulus :
$env:FRONTEND_URL='http://127.0.0.1:3003'
$env:IRRITATOR_BROWSER_EVIDENCE='../../../build-web-test6/logs/browser-regression'
$env:IRRITATOR_BROWSER_SCREENSHOTS='../../../build-web-test6/logs/screenshots-regression'
npm.cmd run test:e2e
```

`npm run test:all` inclut les tests historiques et les nouveaux tests v2,
dont le runner direct, HTTP réel, les rejets avant lancement, budgets après
fanout/fanin, timeout et feedback. Les tests navigateur scientifiques utilisent
le runner natif. Les variables de destinations des preuves évitent d’écraser
les captures historiques du Test 5.

## Prochaines étapes

La décision entre format natif et format intermédiaire et la préparation du
wrapper sont dans `architecture.md`. Le contrat constitue les données nécessaires
à l’éditeur React Flow : types, paramètres, contraintes et ports. Les imports
.irt/.pirt et l'édition graphique des plans d'expérience restent à intégrer.
`simulation_wrapper`, son architecture et le moteur restent inchangés.

## Extension QSS3 (Test 6.1)

Le catalogue comporte **13 types atomiques**. Les six nouveaux opérateurs
fonctionnent en v1 et dans les définitions couplées v2, via les mêmes API natives.
`coeff-0`, `coeff-1` et `n` sont explicites et obligatoires dans une requête ;
l’éditeur les initialise à 1, conformément aux défauts natifs. Les bornes web
sont ±1e12 et les valeurs doivent être finies. Aucun entier n’est imposé à `n`.

Exemples : `examples/qss3-operators.json` (six opérateurs et entrées mises à jour)
et `examples/qss3-operators-coupled.json` (deux instances, deux niveaux couplés).
L’inverse refuse zéro ; la racine native refuse aussi zéro. Une puissance
fractionnaire d’une base négative peut arrêter le processus natif ; le serveur
l’isole et répond `502 RUNNER_PROTOCOL_ERROR`, sans résultat réussi.
Les observations gardent les dates du rééchantillonneur natif QSS3, qui peuvent
différer des dates de changements des messages. Voir le
[compte rendu](../reports/qss-catalog-test-6-1.md) et ses commandes de reproduction.

## Simulations imbriquées HTTP (Test 7D)

Le backend réutilise le compilateur JSON v3 du Test 7C et le véritable wrapper
natif. `experiment`, définitions couplées et overrides transitent sur stdin
sans transformation scientifique. `parseWrapperResult` contrôle le résultat v2 ;
les requêtes v1/v2 conservent `parseResult` et leur enveloppe v1 exacte.
L'éditeur React Flow ne propose pas encore la configuration du wrapper (Test 7E).

Le catalogue atomique historique reste identique. `--capabilities` expose
séparément `packages/contracts/runner-capabilities.json` : versions de requêtes
et résultats, modes, facteurs, méthodes, journal et plafonds v3. Pour chaque
requête v3, le backend compare exactement cette description et le catalogue aux
contrats embarqués. Un ancien binaire peut encore exécuter v1/v2, mais une
requête v3 ou son contrôle de santé renvoie `RUNNER_INCOMPATIBLE` (502), sans
annoncer de capacités v3. Recompiler le runner avec les contrats actuels.

Campagne complète sur ce poste (moteur/historiques 7B déjà construits dans les
deux configurations, Node installé dans `web/`) :

```powershell
Set-Location D:\these\irritator
powershell -NoProfile -ExecutionPolicy Bypass -File web/test-wrapper-http.ps1 -Configuration Release
powershell -NoProfile -ExecutionPolicy Bypass -File web/test-wrapper-http.ps1 -Configuration Debug
Set-Location web
$env:IRRITATOR_RUNNER=(Resolve-Path ../build-web-test7f/Release/runner/irritator-runner.exe).Path
npm.cmd start
```

Sur une machine neuve, créer les builds moteur/historiques avec
`engine/runner/tests-wrapper/run.ps1` en Release et Debug. Le test de rejet
d'un ancien binaire exige aussi un runner historique 4–6 : configurer
`IRRITATOR_LEGACY_RUNNER` si les binaires 6.1 locaux sont absents. Le script
utilise par défaut `build-web-test6-1/runner` (Release) ou `runner-debug` (Debug).
Les preuves sont dans `build-web-test7d/<Configuration>/logs/` ; `-SkipBuild`
réexécute les tests sans compilation native. Pour seulement les essais HTTP,
depuis `web/`, utiliser `npm.cmd run test:wrapper-http` avec le runner configuré.
Le port 3001 doit être libre pour l'oracle affine ; les autres essais utilisent
des ports TCP attribués par le système.

Appel reproductible depuis un second PowerShell à la racine du dépôt :

```powershell
$body=Get-Content -LiteralPath web/examples/wrapper-affine-v3.json -Raw
$result=Invoke-RestMethod 'http://127.0.0.1:3001/api/v1/simulations/run' -Method Post -ContentType 'application/json' -Body $body
$result.resultEvents | Format-Table component,time,port,bag,@{Name='value';Expression={$_.value -join ','}}
$result.wrappers | ConvertTo-Json -Depth 12
```

Résultat : `schemaVersion:2`, `status:completed`, trois scénarios et trois ports ;
à t=1 les triplets sont `[3,0,0]`, `[1,0,0]`, `[1,0,0]`. Les observations parent
sont conservées. Le journal garde le chemin d'occurrence, le temps parent, le
port, le sac local et l'ordre des émissions, y compris plusieurs sacs à la même
date. Sans commande run, il reste vide. Il ne représente pas des trajectoires
enfant et n'invente aucun identifiant de gagnant ni score global.

Chaque limite effective est le minimum entre budget client et configuration
serveur, sans dépasser le plafond partagé. Les validations communes vérifient
aussi les occurrences des définitions et leurs plans effectifs. `maxRunCalls`
borne le parent ; une boucle enfant est arrêtée par le timeout du processus.
Déconnexion, timeout et arrêt du serveur tuent puis attendent le processus natif.
Il n'y a pas d'annulation coopérative des scénarios enfants. Voir le
[rapport 7D](../reports/simulation-wrapper-test-7D.md) pour les résultats et limites.

## Extension native complète — Test 7F

Le runner courant est construit par `web/engine/runner/tests-wrapper/run-7f.ps1`
(Release et Debug). Il expose trois objectifs, neuf types de facteurs, les
17 distributions natives et les cinq modes, dans le même contrat v3/résultat v2.
Voir `packages/contracts/README.md` pour le contrat scientifique et
`apps/frontend/README.md` pour l’inspecteur, les horloges et les tests réels.
Le catalogue atomique et les protections de ressources restent inchangés.

## Observation et décision génériques — Test 8A

Le catalogue possède désormais 19 atomes, dont un groupe « Contrôle et décision ».
Ouvrir `examples/decision-memory.json`, `decision-selection.json`,
`decision-constraint.json`, `decision-fallback.json`, `decision-reuse.json` ou
`decision-prospective.json` dans React Flow. Ces modèles sont des assemblages
configurables ; les calculs et les choix sont exécutés par le moteur C++.

Le wrapper propose la case « Transmettre tous les scénarios au modèle parent ».
Elle ajoute des ports de résultats identifiés et de fin de campagne, en conservant
les sorties du gagnant historique. Relier les facteurs aux actions, les critères
aux calculs, puis les scores/actions/fins aux filtres et sélecteurs.

Pour utiliser la construction 8A présente sur ce poste, depuis `web` :

```powershell
$env:IRRITATOR_RUNNER='D:\these\irritator\build-web-test8a\runner\irritator-runner.exe'
npm.cmd run test:decision
npm.cmd start
```

Le binaire et les contrats doivent être reconstruits ensemble : la négociation
refuse un ancien catalogue. La construction native standard reste
`web/build-runner.ps1` ; les suites supplémentaires sont inscrites dans CTest.
Voir [le rapport 8A](../reports/bstar-generic-components-test-8A.md) pour les ports,
les interfaces DEVS, les commandes de validation et les limites, dont le CSV
historique 7G manquant.

## Décision externe Schaefer — Test 8B

Importer `examples/decision-schaefer-external-v3.json`. Le wrapper évalue six
scénarios et maximise CH : E=260, q=0.0008. Le couplé `DecisionFiltrage`
compare Nmin à 140, filtre les lignes identifiées puis maximise CH parmi les
admissibles : E=150, identité native 4 (e5), q=0.001.

Ouvrir la définition, sélectionner `admissible` et changer `right` dans
l'inspecteur : 120 donne E=260 ; 160 donne selected=0 sans émission d'action.
Le sélecteur est configuré avec `emitFallback=0`. Pour un repli explicite,
choisir `emitFallback=1` et régler `fallback`. Les anciens documents sans
ce paramètre gardent le comportement 8A (repli activé).

Cet exemple nécessite le runner 8B reconstruit avec le catalogue courant.
Pour lancer l'API depuis `web`, définir
`$env:IRRITATOR_RUNNER='D:\these\irritator\build-web-test8b\Release\runner\irritator-runner.exe'`
puis exécuter `npm.cmd start` ; lancer le frontend selon les instructions de
`apps/frontend/README.md`.

Reconstruction et campagnes :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File web/engine/runner/tests-wrapper/run-8b.ps1 -Configuration Release
powershell -NoProfile -ExecutionPolicy Bypass -File web/engine/runner/tests-wrapper/run-8b.ps1 -Configuration Debug
```

Les commandes ci-dessus partent de la racine du dépôt. Voir le
[rapport 8B](../reports/bstar-generic-components-test-8B.md) pour le protocole,
les mesures, les parcours React Flow et les incidents historiques conservés.

## Boucle de rétroaction générique (8D)

Ouvrir `examples/decision-feedback-minimal-v3.json` dans l'éditeur. Le système
QSS3 évolue avec dX/dt=u, lit son état natif à t=1 et t=3, initialise trois
prospectives, choisit une action dans `ChooseAction` puis l'applique à sa
dérivée via `zero_order_hold`. X passe par 12 puis 10 ; les commandes retenues
sont −1 puis 0. Exporter et réimporter conserve les définitions et connexions.

Dans la bibliothèque « Contrôle et décision », `state_observer` lie une seule
sortie d'intégrateur à `source` et lit l'état courant sur commande `read`.
La connexion ne mémorise pas le dernier message quantifié. Le maintien natif
émet un scalaire sans identités utilisable par QSS3. Tous les calculs de
décision s'exécutent dans le moteur C++.

La commande init explicite du wrapper annule les réponses différées en attente.
En mode complete, un changement de facteur suivi de run réinitialise aussi
les enfants sans init explicite. Voir `../reports/bstar-generic-components-test-8D.md`
pour la chronologie, les campagnes chevauchantes et les limites.

Tests : `npm run test:decision-8d` avec `IRRITATOR_RUNNER` configuré ;
`engine/runner/tests-wrapper/run-8d.ps1 -Configuration Release` ou `Debug`
reconstruit les bibliothèques et leurs clients avant les non-régressions.

## Test 8O

Après compilation, démarrer l'API avec le runner 8O de même configuration et
reconstruire le frontend pour négocier les nouvelles capacités. Importer
`web/examples/test-8o-schaefer-six-trajectories-v3.json`, sélectionner le wrapper
`prospectives`, puis les composants dans « Observations prospectives ». Exécuter :
la vue « Trajectoires prospectives » affiche N pour les six scénarios sur le temps
enfant [0,20]. Cocher C et relancer donne douze séries / 2412 points. Les filtres
wrapper/campagne/variable/scénario et le CSV de cette vue sont indépendants des
trajectoires du parent. Pas fixé à 0,1 ; mode complete requis. Voir le contrat
`packages/contracts/README.md` pour les statuts et les plafonds.

Reproduction Windows (Node 24 et MSVC configurables via les scripts existants) :

```powershell
./web/engine/runner/tests-wrapper/run-8o.ps1 -Configuration Release
./web/engine/runner/tests-wrapper/run-8o.ps1 -Configuration Debug
# depuis web, IRRITATOR_RUNNER pointant vers le binaire voulu :
npm run test:trajectory-8o
# depuis web/apps/frontend, serveurs réels déjà lancés :
npm run typecheck
npm test
npm run test:e2e -- trajectory-8o.spec.ts
```

Les captures et mesures de cette campagne sont sous `build-web-test8o/` ; le
rapport détaillé est `reports/bstar-generic-components-test-8O.md`.
