# Test 4 — Intégration web de libirritator

Campagne du 21 octobre 2026, dépôt effectif `D:\these\irritator`.

**Le critère principal est atteint.** Une véritable requête HTTP décrivant un
graphe JSON lance un processus C++20 distinct, construit ce graphe avec les API
publiques de libirritator et restitue des trajectoires vérifiées numériquement.
Changer les paramètres ou la topologie ne requiert aucune recompilation.

## État initial et préservation

Les cinq commandes Git prescrites ont été exécutées avant développement.
Branche conservée : `for-web-ui`. Commit :
`58cf7fd419a289bb5d1f1c3bcef6b043d35082af` (`Update .gitignore`).
`origin` pointe vers `https://github.com/Edouard1er/irritator.git` et `upstream`
vers `https://github.com/vle-forge/irritator.git`.

Les modifications locales préexistantes du Test 3 dans
`lib/include/irritator/core.hpp` et `lib/src/simulation.cpp` sont conservées.
Le moteur effectivement utilisé est libirritator **0.1.0 avec ces corrections**,
pas seulement le commit HEAD. Aucun changement du moteur n'a été nécessaire.
Les cinq sous-modules récursifs sont aux commits attendus, sans mise à jour.
Les avertissements d'accès au fichier global Git ignore restent sans effet
bloquant ; aucune configuration globale n'est modifiée.

Les trois rapports précédents, les démonstrations, les en-têtes publics,
les paramètres, la sérialisation, la conversion de projet et les fichiers CMake
ont été étudiés avant le runner. Leurs résultats historiques sont distingués
des nouvelles exécutions. Contrôle SHA-256 avant/après : **20 fichiers préservés,
zéro modification**, comprenant les démonstrations précédentes, leurs rapports
et les deux sources du moteur modifiées au Test 3. Preuves :
`build-web-test4/logs/preservation-before.json` et `preservation-result.json`.

Les ajouts sont sous `web/` et dans ce rapport. `.gitignore` ne change que pour
autoriser le suivi de ce rapport précis ; les anciens rapports et demos restent
ignorés comme auparavant. `web/.gitignore` exclut les dépendances et produits
de construction. Aucun ajout à l'index, commit, push, changement de branche,
reset ou modification de sous-module.

## Environnement vérifié

| Élément | Valeur |
|---|---|
| Plateforme | Windows x64, PowerShell ; même poste que le Test 3 |
| C++ | MSVC 19.51.36260.0, outils 14.51.36231, C++20 |
| Visual Studio | Installation `D:\Mes Programmes\Microsoft Visual Studio\2026` |
| Construction | CMake 4.0.3, Ninja ; Release et Debug |
| Moteur | Archives stabilisées `build-wrapper-test3/lib/irritators-0.1.lib` et `build-wrapper-test3-debug/lib/irritators-0.1.lib` |
| Node.js / npm | 24.11.1 (branche LTS 24) / 11.6.2 |
| TypeScript / types Node | 5.9.3, strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes / 24.19.2 |
| Backend | Fastify 5.12.7, Ajv 8.17.1 |
| JSON C++ | RapidJSON du sous-module existant |

Les versions npm résolues sont verrouillées dans `web/package-lock.json`.
Le téléchargement initial a nécessité l'accès réseau de l'environnement ;
les dépendances sont installées localement dans web, sans installation globale.
Ajv est utilisé directement pour le contrat du service ; TypeScript et les types
Node sont des dépendances de développement. Aucun binding Node/C++, framework
frontend, base de données ou ordonnanceur distribué supplémentaire.

Références officielles consultées pour la compatibilité :
[Node.js Release](https://github.com/nodejs/Release) et
[Fastify v5](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/).
Les options de validation sont choisies explicitement, notamment pour désactiver
les transformations par défaut décrites dans la
[documentation Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).

## Représentation native et décision préalable

La décision a été écrite dans `web/architecture.md` **avant** l'implémentation.

`irt::simulation` est le graphe exécutable : modèles atomiques, paramètres,
ports, connexions, ordonnanceur, observations et limites temporelles.
`generic_component` ajoute des enfants atomiques ou couplés et des connexions
internes/externes. `modeling` gère leur catalogue ; `project::set` et `rebuild`
déplient la hiérarchie en `project::sim`, remappent les identifiants et configurent
les composants spéciaux. Ces mécanismes sont éprouvés dans les tests officiels.

Les `.irt` existants sont du JSON natif : voir `examples/diffusion/cell.irt` et
`grid.irt`. Ils incluent children, dynamics, unique-id, ports, positions et,
pour les références composées, des données de catalogue de fichiers.
`json_dearchiver` accepte des buffers mémoire mais demande file_access et
component_access. Un simple composant plat pourrait utiliser un catalogue vide ;
le format natif est donc une option possible, et pertinente pour de futurs imports.

Pour v1, un **contrat intermédiaire autonome, versionné et limité** a été retenu.
Il évite d'exposer immédiatement les sources externes, chemins, types non autorisés
et identifiants internes du format natif. Une traduction directe vers les objets
publics de simulation suffit pour ce graphe atomique. Aucun mécanisme scientifique
n'est dupliqué. La représentation ne dépend d'aucun modèle particulier.

## Architecture et livrables

```text
HTTP JSON
  -> Fastify / schéma applicatif et validation sémantique
  -> ProcessEngine / spawn, stdin, limites, timeout, annulation
  -> irritator-runner / RapidJSON et validation indépendante
  -> allocation, paramètres, connexions, observations libirritator
  -> initialize, run, tick, finalize, fermeture des observations
  -> stdout JSON complet + code de sortie
  -> vérification du protocole et du résultat / réponse HTTP
```

- `web/apps/api/src/config` : variables d'environnement et plafonds.
- `web/apps/api/src/services/engine.ts` : isolation et contrôle des processus.
- `web/apps/api/src/routes/v1.ts`, `app.ts`, `server.ts` : routes et démarrage.
- `web/packages/contracts` : schéma, catalogue, types et validations.
- `web/engine/runner` : CMake, runner, contrats embarqués et tests natifs.
- `web/examples` : référence, valeurs modifiées, somme à deux entrées, QSS1/QSS3.
- `web/build-runner.ps1`, `web/README.md` : reproduction et utilisation.

Un seul package npm porte cette première application. Les répertoires apps et
packages préparent un futur frontend et le partage du contrat. L'interface Engine
isole le lancement du calcul pour permettre ensuite un service de jobs asynchrones.
Le runId actuel identifie seulement une réponse : ni stockage ni suivi asynchrone.

## Contrat JSON et correspondance native

`schemaVersion=1` ; model.id ; components (id/type/parameters) ; connections
(from/to, component/port) ; observations (component/samplingInterval) ;
simulation.start/end ; limits facultatif pour abaisser les budgets.

| Type | Paramètres JSON obligatoires | Construction et configuration |
|---|---|---|
| constant | value, offset | alloc<constant>, parameter.set_constant(value,offset) |
| qss1_sum_2 | objet vide | alloc<qss1_sum_2>, paramètres natifs initiaux |
| qss1_sum_3 | objet vide | alloc<qss1_sum_3>, paramètres natifs initiaux |
| qss1_integrator | X, dQ | alloc<qss1_integrator>, parameter.set_integrator(X,dQ) |
| qss3_integrator | X, dQ | alloc<qss3_integrator>, parameter.set_integrator(X,dQ) |

Le registre associe des noms à cinq constructeurs typés, sans graphe préprogrammé.
L'allocation typée réutilise l'initialisation native des paramètres. Une table
id externe → model_id natif construit toutes les connexions par
`simulation::connect`, précisément l'implémentation appelée par connect_dynamics.
Les statuts natifs sont vérifiés et leurs catégorie/code sont propagés.

Chaque intégrateur a deux entrées (0 dérivée, 1 reset), une sortie (0 X).
Les sommes ont 2 ou 3 entrées et une sortie ; constant n'a aucune entrée.
offset est relatif au début de simulation. Les paramètres, ports et contraintes
proviennent des API réelles ; les autres composants du moteur ne sont pas annoncés.

Le schéma est embarqué par CMake et consommé par Fastify/Ajv. Un sous-ensemble
commun draft 4/draft 7 est utilisé ; la déclaration draft 4 est retirée pour Ajv,
sans changer ses règles. Le runner refait la validation, y compris si lancé seul.
Identifiants uniques, types autorisés, paramètres requis/inconnus, références,
ports et directions, duplications de connexions/observations, temps et budgets
sont contrôlés. Aucune coercition, suppression silencieuse de propriété ou
compilation d'un schéma fourni par le client.

Les cycles ne sont pas assimilés à une erreur de DAG. Un cycle entre deux sommes
est accepté et limité par son budget d'appels. L'auto-connexion est rejetée par
is_ports_compatible du moteur ; le JSON ne contourne pas cette règle.

## Cycle temporel et observations

Cycle repris du Test 1 : allocation, paramètres, connexions, observe, initialize,
run avec contrôle de statut et tick à chaque appel, finalize et tick final.
Le rééchantillonneur est ensuite fermé explicitement par tick(observer,+inf)
après expiration, comme dans la sonde publique du Test 2 et le chemin terminal
stabilisé du Test 3. Aucun changement de observer.cpp ou du wrapper.

Les événements à end restent exclus. Le temps final et l'état observé à l'horizon
ne signifient pas qu'un événement y a été exécuté. Les historiques sont ceux du
moteur : interpolation/rééchantillonnage et déduplication. Aucun point synthétique
n'est ajouté par TypeScript ou par le runner. Une constante peut ne fournir
qu'un point ; le temps du dernier échantillon peut différer de finalTime.

La réponse indique modelId, status, start/end/finalTime, runCalls, observations,
samplingInterval, samples(time/value), diagnostics et, côté HTTP, runId.
Les échantillons doivent être finis, ordonnés strictement et dans l'intervalle.

## Routes

| Route | Fonctionnement vérifié |
|---|---|
| GET /api/v1/health | Lance réellement --describe ; valide catalogue et versions ; échec explicite et available=false sinon |
| GET /api/v1/components | Catalogue actuel du runner comparé au contrat applicatif |
| POST /api/v1/simulations/run | Calcul synchrone borné dans un processus distinct, résultats structurés |

Health prouve que le binaire démarre et parle le protocole attendu. Il ne prétend
pas exécuter un oracle scientifique à chaque appel. Les expériences d'intégration
complètent cette vérification. Aucun état de simulation n'est partagé entre requêtes.

## Validation automatique réellement exécutée

| Campagne | Résultat |
|---|---|
| Suite web complète Release | **73/73**, zéro échec/ignoré, environ 12,74 s |
| Détail de cette suite | 33 tests du vrai runner, 25 tests de routes/contrats avec mocks explicites, 10 tests de contrôle de processus, 5 groupes d'intégration réels |
| CTest runner Release | **1/1**, contenant les 33 tests natifs, environ 14,56 s |
| CTest runner Debug, IRRITATOR_ENABLE_DEBUG actif | **1/1**, mêmes 33 tests, environ 16,24 s |
| HTTP réel final Release | **5/5**, environ 6,75 s |
| HTTP réel Debug | **5/5**, environ 8,92 s |
| Test 3 stabilisation Release / Debug | **40/40** et **40/40**, environ 14,01 s / 15,19 s |
| Tests officiels Release / Debug | **4/4** et **4/4**, environ 3,61 s / 7,18 s |
| Démonstration Test 1 recompilée contre l'archive stabilisée | **code 0**, oracle original inchangé |

Les tests natifs sont des tests boîte noire du véritable exécutable C++, inscrits
dans CTest et orchestrés par node:test sans dépendance npm. Ils couvrent parsing,
JSON dupliqué/NUL/non fini, allocation, paramètres, connexions, exécution,
observations, limites et erreurs. Les 5 groupes d'intégration utilisent le vrai
runner ; le premier écoute une socket TCP et envoie de véritables requêtes fetch.
Il ne se limite pas à Fastify.inject. Il vérifie 10 simulations positives et des
erreurs, dont une erreur native de connexion avec catégorie/code.

Les fixtures de processus sont isolées dans les tests de robustesse : blocage,
stdout/stderr excessifs, résultat JSON malformé, désaccord entre code de sortie
et statut JSON, arrêt, concurrence, annulation et réutilisation d'un créneau.
Un test distinct impose aussi un timeout au véritable runner. La déconnexion
HTTP du client libère le processus et permet une nouvelle vérification health.

Les quatre tests officiels retrouvent respectivement 7 321, 1 015 784, 23 et
6 012 assertions : **1 029 140 par configuration**. Le cas imbriqué original est
actif ; aucune assertion ni exclusion n'est changée. La suite de 40 réexécute
aussi les scénarios historiques du Test 2 contre le wrapper stabilisé.
Les corps préexistants sous #if 0 restent une limite des tests officiels.

Journaux dans `build-web-test4/logs` : web-tests.log, http-tests-final.log,
http-tests-debug.log, http-results.json, regression-release/debug.log et .xml,
official-release/debug.log et .xml, fichiers *-detail.log ; sous build-release
et build-debug, les journaux et JUnit de construction et CTest du runner.
headless-run.log conserve la démonstration Test 1. Ces durées ne sont pas un benchmark.
Le démarrage de server.js sur 127.0.0.1:3001 et les commandes Invoke-RestMethod
ont aussi été exécutés : powershell-http.json contient health et le résultat
numérique, server-start.log le démarrage. Ce serveur de vérification a été arrêté.
`npm ci --offline --cache .npm-cache` a réinstallé les 52 paquets du verrou puis
TypeScript a été recompilé avec succès. Un test complémentaire Debug rend
irt-mem.txt impossible à ouvrir : debug-stream-error.json confirme un document
d'erreur valide, code 2 et INITIALIZATION_ERROR, sans mélange sur stdout.

## Résultats numériques HTTP

| Requête | Résultats attendus et obtenus | Appels natifs |
|---|---|---:|
| Référence, trois constantes 10/100/1000 | (0,10), (1,110), (2,1110), fin 3 | 10 |
| Valeurs modifiées -2/7/40 | (0,-2), (1,5), (2,45), sans recompilation | 10 |
| Autre topologie, deux constantes -2/7 → sum_2 | (0,-2), (1,5) | 7 |
| Somme référence → deuxième sum_2, plus constant c1 | Deuxième sortie (0,20), (1,120), (2,1120), deux observations | 16 |
| QSS1, X0=5, r=-2/0/+2, [50,53[ | X=5+r(t-50) à tous les points ; dernières valeurs -1/5/11 | 26/3/26 |
| QSS3, mêmes conditions | Même oracle affine ; dernières valeurs -1/5/11 | 4/3/4 |

Tolérance absolue **1e-9**, justifiée pour ces petits graphes affines et les
arrondis des temps de rééchantillonnage ; elle ne constitue pas une borne
universelle d'erreur QSS. Sur ces sorties HTTP enregistrées, l'écart maximal
calculé à l'oracle affine est 0 en double précision. Les trajectoires variables
contiennent ici 31 points en QSS1 et 30 en QSS3, avec un point final à 53.
La trajectoire constante contient un seul point à 50. Les nombres différents
de points/appels sont conservés, sans compléter artificiellement les séries.
Les demandes et réponses sont sauvegardées dans http-results.json.

## Compilation, démarrage et reproduction

Le README contient les commandes complètes et des variantes Debug.
Commandes utilisées sur les archives actuelles, depuis la racine :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File web/build-runner.ps1 -SkipEngineBuild -EngineBuildDir build-wrapper-test3
powershell -NoProfile -ExecutionPolicy Bypass -File web/build-runner.ps1 -Configuration Debug -SkipEngineBuild -EngineBuildDir build-wrapper-test3-debug
```

Sans archive existante, `powershell -File web/build-runner.ps1` configure et
reconstruit libirritator avec WITH_GUI=OFF, WITH_NATIVE_ARCH=OFF, puis construit
et teste le runner. Ce chemin complet est fourni ; cette campagne a réutilisé
les deux archives du Test 3 dont les sources sont inchangées. La compilation
de la démonstration Test 1 a aussi été refaite dans build-web-test4/headless.

```powershell
# Runner seul, depuis D:\these\irritator :
Get-Content web/examples/sum3.json -Raw | & .\build-web-test4\runner\irritator-runner.exe
& .\build-web-test4\runner\irritator-runner.exe --describe

Set-Location web
npm.cmd ci
npm.cmd run build
npm.cmd start
# Second terminal, depuis D:\these\irritator :
$api='http://127.0.0.1:3001/api/v1'
Invoke-RestMethod "$api/health"
Invoke-RestMethod "$api/components" | ConvertTo-Json -Depth 12
$body=Get-Content web/examples/sum3.json -Raw
$r=Invoke-RestMethod "$api/simulations/run" -Method Post -ContentType 'application/json' -Body $body
$r.observations[0].samples | Format-Table
```

Les fichiers changed.json, sum2.json, qss1_integrator.json et
qss3_integrator.json s'envoient de la même façon. Le README donne aussi
la modification directe des paramètres PowerShell, sans changer ces fichiers.

```powershell
# Depuis web :
npm.cmd test
npm.cmd run test:runner
npm.cmd run test:integration
npm.cmd run test:all
# Runner Debug dans les tests HTTP :
$env:IRRITATOR_RUNNER=(Resolve-Path ../build-web-test4/runner-debug/irritator-runner.exe).Path
npm.cmd run test:integration
Remove-Item Env:IRRITATOR_RUNNER
```

## Erreurs, sécurité et limites effectives

Format stable : schemaVersion=1, status=failed, error.code/message, et
engineCategory/engineCode pour un statut natif. Le runner retourne 2 pour une
erreur contrôlée, 3 pour une exception interne ; aucun résultat partiel n'est
publié comme terminé. stdin/stdout/stderr sont séparés. Le backend vérifie
également les incohérences statut/code de sortie et les échantillons reçus.
En Debug, le runner redirige aussi la trace mémoire de l'allocateur natif vers
stderr. Le fichier irt-mem.txt est encore ouvert par l'API native mais reste vide
et est ignoré ; si son ouverture échoue, le runner rejette l'initialisation avant
que le fallback stdout du moteur puisse contaminer le document JSON. Aucun
changement de macros.hpp ou memory-resource.cpp n'a été nécessaire.

Plafonds fixes : 128 composants, 512 connexions, 32 observations, 100 000 appels,
20 000 points, requête 1 MiB, stdout 4 MiB, stderr 64 KiB. Défauts : 2 processus
simultanés et timeout 10 s ; plafonds serveur 8 processus et 60 s. Les variables
d'environnement peuvent abaisser les limites de calcul ; la requête peut encore
les réduire, sans les relever. La grille potentielle ceil(horizon/pas)+2 par
observation doit tenir dans le budget, même si les valeurs seront dédupliquées.
Les nombres sont finis et bornés ; les pas doivent avancer l'horloge flottante.

spawn utilise un chemin configuré par l'administrateur, sans shell et sans
argument de commande fourni par le client. Aucun chemin .irt/.pirt utilisateur,
source externe, code arbitraire, expression ou schéma JSON utilisateur n'est
accepté. Le serveur écoute uniquement sur la boucle locale. Les processus sont
tués puis attendus sur timeout, annulation, sortie excessive ou arrêt du serveur.
Le créneau de concurrence reste occupé jusqu'à la fermeture effective.

Limites assumées : pas de quota mémoire OS, pas d'authentification ou service
public, de persistance, de résultats progressifs ni de jobs longs. Le runner seul
n'a pas de timeout mural ; il conserve les budgets internes. Catalogue limité à
cinq types, sans QSS2, import natif, composant couplé ou simulation_wrapper HTTP.
Les exceptions natives d'initialisation/exécution ont leurs chemins de propagation,
mais aucune panne mémoire ni faute numérique interne du moteur n'est revendiquée
comme provoquée dans cette campagne. Les oracles affines ne valident pas tout QSS3.
Seule Windows/MSVC a été exécutée.

Les premiers essais de développement ont exposé des erreurs de compilation
d'accès au conteneur d'observateurs, corrigées vers try_to_get, puis des chemins
de sortie TypeScript corrigés dans tsconfig. Un premier test de cycle utilisait
une auto-connexion interdite nativement ; le cas entre deux composants démontre
l'acceptation des cycles. Ces échecs intermédiaires ne sont pas comptés comme
validation. Les journaux finaux indiqués ci-dessus correspondent aux succès.

## Préparation du wrapper et de l'éditeur

Le catalogue est directement exploitable pour générer les nœuds, formulaires
et ports d'un futur éditeur React Flow. Les identifiants restent indépendants
des model_id internes. Aucun éditeur Next.js/React Flow n'a été développé ici.

Le chemin natif a été étudié : simulation_component::assign(project&&) prépare
les facteurs et sélections ; copy_to(embedded_simulation&) copie le modèle,
résout unique_id_path en model_id et conserve plan/objectif. project.cpp remappe
la référence de composant vers le sim_id d'exécution et dimensionne x=F+2,
y=S+F. La sérialisation native du wrapper référence un projet .pirt par
path/directory/file et conserve factors/selections/objective.

Cette conversion existe et fonctionne dans les tests natifs. Une entrée HTTP
autonome et bornée exige toutefois un catalogue serveur maîtrisé ou des modèles
imbriqués nommés dans le document, la résolution validée des références, les
facteurs/critères/modes et des plafonds sur scénarios, profondeur et calculs
enfants. Le budget d'appels parent ne borne pas un run complete enfant dans une
transition. Ce travail dépasse l'ajout d'un simple constructeur à la liste blanche.
Il n'est donc pas présenté comme un support HTTP du wrapper dans cette livraison.

Étape suivante proposée : modèle imbriqué référencé, facteurs single/fixed/random
et variantes, critères min/max/min_last/max_last, objectif simple/weighted_sum/
epsilon, mode complete/bag/time/until/during, connexions aux ports existants.
Traduire vers les structures natives, jamais vers un moteur d'expérimentation
Node. Conserver la sémantique de x0, le double rôle temporel de x1, les facteurs,
la sélection et les sorties du Test 3. Expliciter le silence sans candidat,
les indices de critères et la différence entre conditions initiales et checkpoint.
Aucun changement d'architecture du wrapper, aucun modèle halieutique, B* ou T*.
