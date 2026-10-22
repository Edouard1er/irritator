# Irritator Web : modèles DEVS atomiques et hiérarchiques

Backend local Fastify/TypeScript et runner C++20 utilisant **libirritator**.
Le modèle est un graphe JSON dynamique. Le backend lance un nouveau processus
natif par simulation avec `spawn`, transmet la requête sur stdin et contrôle
stdout, stderr, le code de sortie et la réponse. Aucun calcul DEVS n'est effectué
dans TypeScript. L’éditeur graphique Next.js est maintenant disponible dans
[`apps/frontend`](apps/frontend/README.md), sur le port 3000. Le Test 6 ajoute
les définitions couplées partagées, leurs interfaces, la navigation hiérarchique
et l’exécution native via `project::set`. Le contrat plat v1 reste accepté.

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
| GET `/api/v1/health` | Lance `--describe` et vérifie version/catalogue ; 200 si vérifié, erreur avec available=false sinon. Ce n'est pas un test numérique complet du moteur. |
| GET `/api/v1/components` | Catalogue embarqué dans le runner, comparé au contrat serveur. |
| POST `/api/v1/simulations/run` | Validation, processus natif isolé, résultat avec runId et trajectoires. |

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
| 502 | RUNNER_PROTOCOL_ERROR, OUTPUT_LIMIT, erreur interne native |
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
| IRRITATOR_RUNNER | ../build-web-test4/runner/irritator-runner.exe (sans .exe sur Unix) |
| HOST / PORT | 127.0.0.1 / 3001 ; HOST restreint à la boucle locale |
| API_BODY_LIMIT | 1 MiB maximum |
| ENGINE_TIMEOUT_MS | 10 s, maximum 60 s |
| ENGINE_MAX_CONCURRENT | 2, maximum 8 |
| ENGINE_MAX_STDOUT_BYTES / ENGINE_MAX_STDERR_BYTES | 4 MiB / 64 KiB, plafonds identiques |
| ENGINE_MAX_COMPONENTS / ENGINE_MAX_CONNECTIONS | 128 / 512 |
| ENGINE_MAX_RUN_CALLS / ENGINE_MAX_POINTS | 100000 / 20000 |
| ENGINE_MAX_DEPTH / ENGINE_MAX_INSTANCES | 8 / 512 (v2) |

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
En Debug, la trace mémoire native est redirigée vers stderr par le runner.
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
.irt/.pirt, plans d’expérience et simulation_wrapper web restent à intégrer.
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
