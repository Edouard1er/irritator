# Test 6.1 — Extension du catalogue QSS3

22 octobre 2026 — Windows/MSVC, branche `for-web-ui`.

## Résultat et vérification native

Le catalogue passe de **7 à 13 types atomiques**. Les sept entrées historiques
sont identiques, paramètres et ports compris. Les six ajouts sont utilisables
dans les modèles plats v1, les définitions couplées v2 et l’éditeur React Flow.

Lecture préalable de `lib/include/irritator/core.hpp`, `lib/src/parameter.cpp`
et des noms de paramètres dans `lib/src/json.cpp` :

| Type natif exact | Entrées → sortie | Paramètres explicites web | Défauts natifs |
|---|---|---|---|
| `qss3_multiplier = abstract_multiplier<3>` | 0,1 → 0 | aucun | aucun paramètre |
| `qss3_wsum_2 = abstract_wsum<3,2>` | 0,1 → 0 | `coeff-0`, `coeff-1` | 1, 1 |
| `qss3_power = abstract_power<3>` | 0 → 0 | `n` | 1 |
| `qss3_inverse = abstract_inverse<3>` | 0 → 0 | aucun | aucun paramètre |
| `qss3_square = abstract_square<3>` | 0 → 0 | aucun | aucun paramètre |
| `qss3_sqrt = abstract_sqrt<3>` | 0 → 0 | aucun | aucun paramètre |

Les valeurs de signal sont initialisées à zéro et les opérateurs attendent les
messages d’entrée. `parameter::set_wsum2` alimente `input_coeffs[0/1]` ;
`set_power` alimente `dyn.n`. Les coefficients et l’exposant doivent être finis.
Les setters natifs remplacent les valeurs non finies par 1 ; le contrat web les
**rejette avant allocation**, sans substitution. La borne ±1e12 est une limite
du contrat web, pas une restriction scientifique native. `n` peut être réel,
négatif ou nul, sous réserve du domaine du calcul.

L’inverse refuse ±0 (`is_zero` natif). La racine native exige **x > 0**, même
si la racine mathématique de zéro existe. Ces deux erreurs remontent du moteur
avec ses catégorie/code ; aucune approximation ni valeur de remplacement.

## Adaptation

- `catalog.json` expose types, ports, bornes et `default: 1` pour les trois
  nouveaux paramètres. La validation sémantique commune accepte les six types
  en v1/v2. Les schémas JSON étaient déjà génériques : leur structure et leur
  version restent inchangées ; les paramètres obligatoires restent explicites.
- Le runner possède un registre unique associant allocation native et
  `dynamics_typeof<T>()`. Les chemins plat et couplé partagent les mêmes setters
  `irt::parameter`. Les couplés utilisent toujours `generic_component` puis
  `project::set`, avec résolution des observations par chemins d’instances.
- Fastify conserve ses trois routes : le catalogue compilé et celui de
  `--describe` sont comparés ; les requêtes sont validées puis exécutées par
  processus natif. Les handlers génériques n’exigent aucun nouveau cas spécial.
- React Flow utilise directement ces métadonnées pour la bibliothèque, les
  handles et l’inspecteur. La création lit les nouveaux défauts à 1 ; les anciens
  défauts sont conservés. Les nouveaux opérateurs unaires ont des identifiants
  lisibles (`power`, `inverse`, `square`, `sqrt`). Import/export et navigation
  hiérarchique utilisent les contrats existants.

Deux fichiers de démonstration des opérateurs sont ajoutés :
`web/examples/qss3-operators.json` et `qss3-operators-coupled.json`.
Ils servent de bancs de vérification, sans nouveau modèle scientifique métier.

## Résultats numériques et limites conservées

Pour x=4, y=3, coefficients 2/−0.5 et n=3, les six sorties sont respectivement
**12, 6.5, 64, 0.25, 16, 2**. Avec x=9, y=2 :
**18, 17, 729, 1/9, 81, 3**. Ces valeurs sont vérifiées en C++ direct, HTTP réel
et navigateur. Les tests couvrent aussi exposants fractionnaire/négatif/nul,
entrées négatives admissibles, coefficients nuls/négatifs et transmission des
sorties à des composants consommateurs. Une entrée affine native vérifie la
transmission d’une pente non nulle pour multiplier et wsum à 1e−9.

Le cas couplé contient deux niveaux et deux occurrences de la même définition :
16 atomes distincts, ou 28 avec les douze consommateurs observés du test natif.
Modifier l’entrée de l’occurrence A laisse les six trajectoires de B identiques.
Les paramètres partagés modifiés sont appliqués aux deux occurrences ; les
trajectoires restent identiques après sérialisation/réimport.

Deux comportements natifs sont conservés et testés :

1. Le rééchantillonneur QSS3 peut dater une variation après son événement.
   Dans le test de multiplication, la mise à jour reçue à t=1 est transmise au
   consommateur QSS1 à t=1, tandis que l’observation QSS3 publie 27 à t=2.
   Le runner conserve les échantillons natifs sans changer leurs dates.
2. `power(-4,0.5)` produit un résultat hors domaine réel et arrête le processus
   natif sans JSON. L’API renvoie `502 RUNNER_PROTOCOL_ERROR`, sans succès
   partiel, puis accepte une nouvelle simulation valide. Le premier essai Debug
   attendait le dialogue d’arrêt du runtime et donnait un timeout. Le démarrage
   du runner configure désormais le CRT MSVC en mode non interactif
   (`_set_error_mode`, `_set_abort_behavior`) : l’arrêt termine le seul processus
   enfant, en Release comme en Debug. Aucun opérateur natif n’a été modifié.

## Validation et reproduction

Node 24.11.1, npm 11.6.2, MSVC 19.51.36260, CMake/Ninja.
Les constructions réutilisent les archives stabilisées correspondantes
`build-wrapper-test3` (Release) et `build-wrapper-test3-debug` (Debug).

Dans Developer PowerShell x64, depuis `D:\these\irritator` :

```powershell
cmake -S web/engine/runner -B build-web-test6-1/runner -G Ninja -DCMAKE_BUILD_TYPE=Release -DIRRITATOR_BUILD_DIR=D:/these/irritator/build-wrapper-test3
cmake --build build-web-test6-1/runner --parallel 2
cmake -S web/engine/runner -B build-web-test6-1/runner-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug -DIRRITATOR_BUILD_DIR=D:/these/irritator/build-wrapper-test3-debug
cmake --build build-web-test6-1/runner-debug --parallel 2
Set-Location web
$env:IRRITATOR_RUNNER='D:\these\irritator\build-web-test6-1\runner\irritator-runner.exe'
npm.cmd run test:all
# Refaire test:all avec runner-debug pour la campagne Debug.
Set-Location apps/frontend
npm.cmd run typecheck
npm.cmd test
$env:IRRITATOR_API_URL='http://127.0.0.1:3101'
npm.cmd run build
```

Lancement de l’API, dans un premier terminal :

```powershell
Set-Location D:\these\irritator\web
$env:IRRITATOR_RUNNER='D:\these\irritator\build-web-test6-1\runner\irritator-runner.exe'
$env:PORT='3101'
npm.cmd run build
npm.cmd start
```

Interface et tests navigateur, dans deux autres terminaux :

```powershell
Set-Location D:\these\irritator\web\apps\frontend
$env:IRRITATOR_API_URL='http://127.0.0.1:3101'
npm.cmd start -- --port 3100
```

```powershell
Set-Location D:\these\irritator\web\apps\frontend
$env:FRONTEND_URL='http://127.0.0.1:3100'
$env:IRRITATOR_BROWSER_EVIDENCE='../../../build-web-test6-1/logs/browser-regression'
$env:IRRITATOR_BROWSER_SCREENSHOTS='../../../build-web-test6-1/logs/screenshots-regression'
npm.cmd run test:e2e
```

Les preuves sont dans `build-web-test6-1/logs` : compilations, campagnes Release/
Debug, `qss3-http.json`, `native-qss3.json`, exports et requêtes navigateur.
Les destinations configurables évitent d’écraser les captures des Tests 5/6.
Les essais intermédiaires et le diagnostic du domaine de puissance sont conservés.

| Vérification | Résultat final |
|---|---|
| Compilation native C++20 Release / Debug | OK / OK |
| Runner + contrats + API Release | 171/171 : 111 historiques + 60 nouveaux |
| Runner + contrats + API Debug | 171/171 : 111 historiques + 60 nouveaux |
| TypeScript et build production Next.js | OK |
| Vitest, dont 10 nouveaux cas | 80/80 |
| Playwright Chrome réel, dont 7 nouveaux scénarios | 23/23 |
| Sept entrées historiques du catalogue | Identiques intégralement |
| Sources natives et wrapper contrôlés par SHA-256 | 59/59 identiques |
| Contrats v1/v2, anciens exemples et rapports | Préservés ; 8/8 rapports/captures suivis identiques |
| Commit / push | Aucun |
