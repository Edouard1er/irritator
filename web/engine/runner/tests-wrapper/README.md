# Test 7B : liaison native de simulation_wrapper

Depuis la racine du dépôt, dans PowerShell x64 :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File web/engine/runner/tests-wrapper/run.ps1 -Configuration Release
powershell -NoProfile -ExecutionPolicy Bypass -File web/engine/runner/tests-wrapper/run.ps1 -Configuration Debug
```

Le script charge Visual Studio si nécessaire (installation locale indiquée dans
le script ; sinon utiliser Developer PowerShell). Il construit le vrai moteur
sans GUI, les quatre tests officiels, le runner, les tests natifs et la suite
historique de stabilisation. Aucun sous-module n'est modifié. `-SkipBuild`
réexécute les binaires construits. Les journaux et rapports JUnit se trouvent
dans `build-web-test7b/<Configuration>/logs/`.

Compilation manuelle, avec compilateur C++20, CMake, Ninja et Node disponibles :

```sh
cmake -S . -B build-web-test7b/Release/engine -G Ninja -DCMAKE_BUILD_TYPE=Release -DWITH_GUI=OFF -DWITH_NATIVE_ARCH=OFF -DCMAKE_CXX_STANDARD=20
cmake --build build-web-test7b/Release/engine --target libirritator test-api test-qss test-simulations test-mod-to-sim --parallel 2
cmake -S web/engine/runner -B build-web-test7b/Release/runner -G Ninja -DCMAKE_BUILD_TYPE=Release -DIRRITATOR_BUILD_DIR=<absolute-path>/build-web-test7b/Release/engine
cmake --build build-web-test7b/Release/runner --parallel 2
ctest --test-dir build-web-test7b/Release/runner --output-on-failure
```

Pour Debug, remplacer les deux chemins et `CMAKE_BUILD_TYPE`. La macro
`IRRITATOR_ENABLE_DEBUG` et le runtime doivent correspondre à la bibliothèque.
La portabilité Linux est préparée, son exécution n'est pas revendiquée.

`native_graph.hpp` construit les projets et la table des cibles en parcourant
les enfants de l'arbre natif. Il est partagé avec l'adaptateur JSON v2.
`native_wrapper.hpp/.cpp` expose la configuration C++ et la liaison par occurrence.
Les exemples scientifiques sont dans `fixtures.cpp`, les assertions dans
`main.cpp`. Les scénarios, observations, critères et décisions sont exécutés
exclusivement par le wrapper de libirritator.

Les 11 cas natifs sont `flat`, `coupled`, `creation`, `pair`, `reset`,
`criteria`, `single`, `atomic`, `ports`, `invalid` et `resources`.
`pair` reproduit d'abord le partage natif d'un descripteur par deux occurrences,
puis vérifie leur liaison privée. `reset` envoie facteur/init/run uniquement
à gauche. Les réponses initiales des deux occurrences sont émises à t=2.
`ports` vérifie F=2/S=10, donc 4 entrées et 12 sorties connectées.
`resources` contrôle le solde de l'allocateur Irritator après six destructions.
Les assertions restent actives en Release ; CTest borne chaque cas à 30 s.

L'espace `component_access` est obtenu du `modeling` natif puis possédé
directement pendant la construction. Cela évite les copies implicites lors
des publications successives de `modeling.ids` alors que les descripteurs
possèdent des projets avec des liens d'arbre intrusifs. Le runner v2 utilise
également un espace directement possédé. Aucun cache de projets vivants ni
répétition de `project::set` sur le même parent n'est introduit.

L'API initiale du Test 7B acceptait `single`, `fixed`, les quatre critères natifs,
`simple` et `complete`. Le Test 7F étend cette même API comme décrit ci-dessous. Les
paramètres des facteurs désignent uniquement `reals[0]` des constantes et des
intégrateurs QSS. Les horizons sont finis et les cardinalités bornées avant
l'initialisation native. Les projets se construisent une seule fois ; le reset
utilise les commandes natives ou `initialize`, sans répéter `project::set`.

Cette API est l'entrée C++ réutilisable du Test 7B. Le Test 7C ajoute le
compilateur JSON v3 (`json_wrapper.hpp`) et `run-v3.ps1` pour ses tests.
Le Test 7D ajoute le transport HTTP, la description CLI `--capabilities` et
`web/test-wrapper-http.ps1` pour la campagne Release/Debug complète.
Le catalogue atomique `--describe` conserve exactement son format historique.
Voir [le README web](../../../README.md) pour l'appel HTTP reproductible et
les prérequis des tests, dont le runner historique de compatibilité.

## Validation complète 7F

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File web/engine/runner/tests-wrapper/run-7f.ps1 -Configuration Release
powershell -NoProfile -ExecutionPolicy Bypass -File web/engine/runner/tests-wrapper/run-7f.ps1 -Configuration Debug
```

Les builds moteur/historiques 7B doivent exister dans la même configuration.
Le script les vérifie, construit l’adaptateur et ses clients dans
`build-web-test7f/<Configuration>/runner/`, puis exécute CTest, les tests officiels,
les 40 cas de stabilisation et les suites HTTP réelles. Les preuves et réponses
numériques sont conservées sous `logs/`. Les dépendances CMake explicites des
en-têtes et contrats évitent les objets périmés avec `/showIncludes` localisé.

`advanced.cpp` ajoute objectifs, neuf types de facteurs, 17 distributions,
états u64, modes et commandes. `distributions` compare les paramètres des
scénarios au véritable `random_factor::gen` et publie un oracle numérique lu
par `wrapper-7f-tests.mjs`. Cette suite teste les mêmes familles sur JSON et,
avec `WRAPPER_7F_HTTP=1`, par TCP Fastify en comparant chaque réponse au runner
direct. Aucun résultat scientifique de cette campagne n’est simulé par un mock.

Les modes à horloges indépendantes utilisent des constantes natives avec des
sacs enfant à 10, 10.5, 11, 11.5 et une borne 12 : bag s’arrête à 10, time à
10.5, until(10.75) et during(0.75) dépassent leur cible jusqu’à 11. La commande
parent est à 5 et ses réponses sont à 5, 15.75 ou 5.75 selon son scalaire.
Les tests affines et de commandes couvrent séparément les critères et facteurs.
