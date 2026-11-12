# Test 8O — Trajectoires prospectives natives

11 novembre 2026 — dépôt `D:\these\irritator`, branche `for-web-ui`,
HEAD initial `8cf15a93146e269f5a387a0b96a533052ca02c66`.

## Audit initial

Le worktree initial était propre. Aucun commit, push, reset ou remplacement par
la branche distante n'a été effectué. Les rapports 7F, 7G, 8A, 8H, 8J, 8K, 8N,
les observations natives, le cycle de vie `embedded_simulation`, la compilation
JSON/hierarchique, les contrats, la négociation API, l'éditeur et ses exports ont
été inspectés. Les empreintes des fichiers joints et le HEAD sont conservés
sous `build-web-test8o/audit/`.

7G inspectait les tables `simulation_observation` de N/C, sans les exposer dans
la réponse. 8A fournit des triplets individuels et une FIFO de décision ; 8H
recrée les enfants pour les domaines/horizons dynamiques ; 8J isole les scénarios
et peut arrêter un enfant avant expiration. Les observateurs sont dédupliqués
par modèle pour plusieurs critères, mais seul le pas 0,1 est configuré par le
wrapper. Les observations d'un enfant expiré sont fermées sur l'état gauche en
H ; celles d'un enfant arrêté par budget ne sont pas complétées pour l'affichage.

Le fichier 3B annoncé a été retrouvé dans les Téléchargements et sert de source
à la fixture 8O. Il contient une seule définition Schaefer et un seul wrapper ;
les atomes de jointure du parent restituent les agrégats individuels. Les deux
fichiers d'oracle annoncés ne sont présents ni dans le dépôt ni dans les
Téléchargements. Le script stdlib et son CSV analytique livrés ici ont donc été
créés à partir des équations spécifiées ; ce sont des contrôles indépendants,
jamais des données de production ni un remplacement du contrôle enfant/plat.
Le CSV historique `web/model-test/modelhalieutiquetest-points.csv` reste absent.

## Implémentation

- `lib/include/irritator/core.hpp` : manifeste facultatif de modèles observés,
  captures possédées par scénario et compteurs de points/lignes.
- `lib/src/simulation.cpp` : union des observateurs de critères et de
  trajectoires, capture avant réutilisation/init du même graphe, identités
  normales et adressées, lecture des historiques réellement publiés en cas
  d'arrêt. Aucun appel enfant supplémentaire ni nouvelle transition DEVS.
- `lib/include/irritator/error.hpp` : erreur de dépassement ajoutée après les
  codes existants pour conserver leur valeur numérique.
- `native_wrapper.hpp/.cpp` : configuration générique, validation native des
  chemins/observabilité/mode/bornes, manifeste privé par occurrence.
- `json_wrapper.hpp`, `main.cpp` : compilation et bornage, collecte séparée de
  la FIFO, transfert par mouvement des captures possédées, validation et JSON.
- `request-v3.schema.json`, `wrapper-v3.ts`, `runner-capabilities.json` : option
  fermée, types facultatifs de résultat v2, validation scientifique des
  requêtes/réponses et capacités exactes ; aucune nouvelle version d'enveloppe.
- API : transfert existant sans recalcul ; borne serveur générique reprise
  automatiquement depuis `wrapperCaps`, chemin du runner par défaut actualisé.
- React : section « Observations prospectives », vue distincte de comparaison
  avec filtres wrapper/campagne/variables/scénarios, tooltips avec identité et
  facteurs, export CSV long générique. Le graphique reçoit seulement les points
  de la réponse. Les références sont remappées lors des renommages et protégées
  contre la suppression ; JSON/workspaces les conservent.
- Tests : `trajectory-native.cpp`, `trajectory-8o-tests.mjs`,
  `trajectory-8o.test.tsx`, `trajectory-8o.spec.ts`, inscription CTest et npm,
  campagne reproductible `tests-wrapper/run-8o.ps1`.

## Temps, statuts et limites

Le contrat détaillé est dans `web/packages/contracts/README.md`. La v1 expose
le pas 0,1 et le mode complete. Le moteur général accepte d'autres pas, mais le
wrapper ne configure pas deux observateurs distincts pour un modèle. Les
critères restent donc inchangés et partagent la collecte à 0,1.

Identité : `(wrapperId,campaignId,scenarioId,observations[].component)`. Les
facteurs sont ceux réellement appliqués ; les scénarios varient dans l'ordre
cartésien natif. `time` est une date de l'horloge enfant, dont l'origine est
`start`. `horizonRequested` est la durée du plan exécuté ; `horizonApplied`
est la durée réellement atteinte, distincte de l'ancien port d'horizon 8J.
Les transitions restent dans [start,H[ ; le point en H est une observation
native de l'état gauche. Les plateaux peuvent être dédupliqués.

Une capture décrit une exécution réelle, y compris si init annule ensuite sa
publication DEVS différée. Une campagne jamais exécutée ne crée pas de ligne.
Les campagnes complete réutilisées copient les mêmes données sous leur nouvelle
identité, sans réexécution. Les captures restent immuables après remplacement
des domaines, init et campagnes ultérieures. Une interruption garde son statut,
son temps réellement atteint et seulement le préfixe confirmé de ses observations natives. Le tampon brut
est drainé au temps réellement atteint, sans fermer anticipativement son
extrémité ni exécuter un appel enfant supplémentaire. Un historique
numérique invalide conserve son préfixe fini avec un statut explicite.

Bornes conservées : 200000 points internes et 20000 événements. Les nouveaux
plafonds sont 20000 points de trajectoires (`maxTrajectoryPoints`, abaissable),
2048 lignes et 4 Mio UTF-8 par réponse contenant des trajectoires. Les budgets
internes comptent l'union des cibles, sans double observateur. La marge de grille
est celle des contrats existants (ceil(durée/0,1)+2). Les dépassements statiques,
cumulés ou à la sérialisation échouent explicitement, sans succès tronqué.
Les flux de décision et leurs budgets restent distincts.

## Organisation des preuves

Les journaux initiaux et les reprises sont conservés séparément. Les chemins
ci-dessous sont relatifs à `build-web-test8o/`, sauf indication contraire.

## Mesures scientifiques Release

| Scénario | E | q | N natif(20) | C natif(20) | max erreur N | max erreur C |
|---|---:|---:|---:|---:|---:|---:|
| e1 (id 0) | 80 | 0.0008 | 244.633948872625 | 286.944250556813 | 0.019284043 | 0.008470590 |
| e2 (id 1) | 150 | 0.0008 | 196.520871572503 | 445.312497501595 | 0.066308569 | 0.045816034 |
| e3 (id 2) | 260 | 0.0008 | 123.069801559923 | 541.603785129742 | 0.013934332 | 0.014309104 |
| e4 (id 3) | 80 | 0.001 | 230.862382347223 | 340.707560226347 | 0.024717607 | 0.011846951 |
| e5 (id 4) | 150 | 0.001 | 170.980494521712 | 497.451213012496 | 0.009258695 | 0.009142756 |
| e6 (id 5) | 260 | 0.001 | 83.873960859594 | 530.667969259608 | 0.018171187 | 0.024390122 |

Les douze séries contiennent chacune 201 points, soit 2412. Chaque date et
chaque valeur est comparée à une exécution plate native indépendante à 1e-9 ;
l’écart maximal mesuré est 0 sur cette plateforme. Le contrôle natif est répété
après réinitialisation du même parent et confirme deux observateurs pour N/C,
partagés avec Nmin/NH/CH. Les appels enfant supplémentaires d’un complete
réutilisé sont exactement 0.

L’oracle analytique indépendant mesure max/MAE/RMSE sur tous les points. Le
seuil de 0,1 est conservé : dix quantum dQ=0,01, couvrant l’approximation QSS3
et le rééchantillonnage natif sur cet horizon. Le maximum constaté est
0,06630856856838818 (N, scénario 1). Ce seuil est un contrôle de fixture, pas
une borne mathématique universelle. Les identités/facteurs sont contrôlés
exactement et le contrôle enfant/plat reste à 1e-9 ; cette tolérance analytique
ne permet donc pas de masquer une permutation de scénarios. Les métriques
complètes sont dans `Release/final-http-edge/numerical-summary.json` et
`Release/analytic-final.json`.

Le payload nominal N+C mesure 147121 octets avant identifiant HTTP :
6 lignes, 12 séries, 2412 points enfants, 42 événements décisionnels et
300 points parent. Les résultats sans option et avec tableau vide sont
comparés intégralement au résultat historique, champ de trajectoires exclu.

## Changements détaillés par fichier

| Fichier | Changement réel |
|---|---|
| `.gitignore` | Exception pour livrer ce rapport dans le worktree. |
| `lib/include/irritator/core.hpp` | Manifeste de modèles, captures possédées et compteurs par ressource. |
| `lib/include/irritator/error.hpp` | Code de dépassement ajouté à la fin de l'enum ; anciens codes conservés. |
| `lib/src/simulation.cpp` | Observateurs partagés, captures au run, budgets cumulés, drainage natif des préfixes arrêtés, conservation des statuts. |
| `web/engine/runner/native_wrapper.hpp` | Cibles de trajectoires et plafond de points dans la configuration interne. |
| `web/engine/runner/native_wrapper.cpp` | Validation d'observabilité réelle et liaison privée par occurrence. |
| `web/engine/runner/json_wrapper.hpp` | Lecture JSON, estimation des ressources, collecte et sérialisation distinctes des événements. |
| `web/engine/runner/main.cpp` | Erreur de quota claire et plafond de 4 Mio pour les réponses avec trajectoires. |
| `web/engine/runner/CMakeLists.txt` | Exécutable natif, suite JSON et dépendances explicites des nouveaux contrôles. |
| `web/packages/contracts/request-v3.schema.json` | Option fermée et limite `maxTrajectoryPoints`. |
| `web/packages/contracts/wrapper-v3.ts` | Types v3/v2, validations de cibles, identités, statuts, facteurs, temps, doublons et quotas. |
| `web/packages/contracts/runner-capabilities.json` | Pas, mode, horloge, nombre de lignes, points et octets annoncés. |
| `web/packages/contracts/README.md` | Sémantique complète de la nouvelle option et des réponses. |
| `web/apps/api/src/config/index.ts` | Runner 8O par défaut ; la borne serveur supplémentaire suit `wrapperCaps`. |
| `web/apps/api/src/services/engine.ts` | Diagnostic de reconstruction 8O ; transport natif existant conservé. |
| `web/apps/api/src/routes/v1.ts` | Vérification des 4 Mio après ajout du `runId` HTTP. |
| `web/apps/api/tests/process.test.ts` | Attentes des limites effectives mises à jour, sans retirer d'assertion. |
| `web/apps/api/tests/trajectory-http-limit.test.ts` | Test de transport explicitement mocké, couvrant la place prise par `runId`. |
| `web/apps/api/tests/integration.test.ts` | Répertoire de preuves configurable, contrôles inchangés. |
| `web/apps/api/tests/hierarchy.test.ts` | Répertoire de preuves configurable, contrôles inchangés. |
| `web/apps/api/tests/qss-catalog.test.ts` | Répertoire de preuves configurable, contrôles inchangés. |
| `web/apps/frontend/components/panels/wrapper-inspector.tsx` | Multisélection des atomes observables, pas fixe annoncé. |
| `web/apps/frontend/components/panels/wrapper-trajectories.tsx` | Comparaison, provenance, filtres, états partiels et CSV. |
| `web/apps/frontend/components/panels/results-panel.tsx` | Vue prospective indépendante et rafraîchissement à chaque réponse. |
| `web/apps/frontend/components/charts/trajectory-plot.tsx` | Horloge enfant, légendes et tooltips génériques, palette distincte. |
| `web/apps/frontend/app/globals.css` | Espace de résultats adapté au graphe et à ses filtres. |
| `web/apps/frontend/lib/modeling/wrapper.ts` | Renommage et protection des références de trajectoires. |
| `web/apps/frontend/lib/serialization/csv.ts` | CSV long avec facteurs JSON cités, valeurs et dates originales. |
| `web/apps/frontend/tests/trajectory-8o.test.tsx` | Six tests d'inspecteur, persistance, références, filtres et export. |
| `web/apps/frontend/tests/e2e/trajectory-8o.spec.ts` | Deux parcours réels, comparaison HTTP/runner, 6/12/6 séries, campagnes, CSV et préfixes partiels. |
| `web/engine/runner/trajectory-native.cpp` | Comparaison native complète enfant/plat, reset, observateurs partagés et observabilité du catalogue. |
| `web/engine/runner/trajectory-8o-tests.mjs` | Campagne scientifique et de contrats, HTTP réel et cas invalides. |
| `web/engine/runner/tests-wrapper/run-8o.ps1` | Construction et vérifications Release/Debug, journaux uniques, échec non masqué. |
| `web/engine/runner/tests-wrapper/browser-8o.ps1` | Campagne navigateur et artefacts propres à 8O. |
| `web/engine/runner/tests-wrapper/verify-8o.mjs` | Comparaison exacte des réponses entre configurations. |
| `web/examples/test-8o-schaefer-six-trajectories-v3.json` | Modèle 3B dérivé, un wrapper, une définition, N sélectionné. |
| `oracles/schaefer_8o_oracle.py` | Vérificateur analytique indépendant en bibliothèque standard Python. |
| `oracles/schaefer-8o-analytic.csv` | 2412 lignes analytiques, jamais utilisées par le produit. |
| `web/package.json` | Suite 8O et inclusion dans `test:all`. |
| `web/.env.example` | Chemin du runner et variable de plafond de trajectoires. |
| `web/README.md` | Import, utilisation et reproduction. |
| `reports/bstar-generic-components-test-8O.md` | Présent rapport. |

## Validations et portée

<!-- VALIDATION_8O_START -->
| Contrôle | Release | Debug |
|---|---:|---:|
| Builds complets moteur/runner/historiques | OK | OK |
| C++ 8O : 12 séries × 201 points, deux passes/reset, écart enfant/plat | 0 | 0 |
| Matrice native + HTTP 8O finale | 25/25 | 25/25 |
| CTest complet (groupes) | 68/71 ; 3 CSV absents | 68/71 ; 3 CSV absents |
| CTest 8O après dernier correctif : C++, compilation TS, 25 cas JSON | 3/3 | 3/3 |
| Tests officiels | 10/10 | 10/10 |
| Stabilisation historique | 40/40 | 40/40 |
| API/processus/TCP, dont un nouveau contrôle de transport mocké | 97/97 | 97/97 |
| Navigateur complet | 88/88 | Non réexécuté intégralement |
| Navigateur 8O sur les derniers binaires | 2/2 | 2/2 |

Frontend commun : TypeScript sans erreur, **189/189 Vitest** dans 20 fichiers
et build de production Next.js réussi. La dernière correction ne concerne
que la collecte optionnelle d'un suffixe non fini ; les contrôles CTest 8O
et les deux matrices de 25 cas sont réexécutés après son relink, sans modifier
les cas historiques ni masquer leurs échecs CSV. Les derniers CTest complets
durent 628,39 s / 838,99 s ; leurs codes non nuls restent enregistrés.

**39 enveloppes natives** sont strictement identiques entre Release et Debug,
erreurs natives incluses. Toutes les réponses HTTP positives enregistrées
concordent avec les réponses directes ; les rejets HTTP ont leurs codes et
statuts vérifiés. Le payload nominal N+C conserve 6 scénarios, 12 séries,
2412 points et 147121 octets natifs. Aucun échec 8O ne reste ouvert.
<!-- VALIDATION_8O_END -->

Les tests API mélangent des tests unitaires explicitement mockés et des
contrôles de processus/TCP réels ; ils ne représentent pas autant d'oracles
scientifiques. Les preuves scientifiques sont les historiques C++ comparés,
les réponses natives et HTTP complètes, les CSV et les captures réelles.

Le CTest complet conserve trois échecs historiques, tous liés au fichier absent
`web/model-test/modelhalieutiquetest-points.csv` : `runner-wrapper-7g`,
`native-wrapper-schaefer-trajectories`, `native-wrapper-schaefer-pair`.
Les journaux montrent `ENOENT` ou `CSV reference`. Aucun test n'est supprimé,
ignoré ou transformé en succès. La campagne complète `run-8o.ps1` conserve
donc un code non nul tant que cette référence manque. Le nouveau contrôle
8O enfant/plat ne dépend pas de ce CSV et passe sur ses 2412 points.

La suite navigateur complète Release couvre 88 parcours, avant le dernier
raffinement des préfixes invalides. Les deux parcours 8O ont ensuite été
réexécutés sur les builds actualisés en Release et Debug, avec export des
points, réimport, filtres et vrais arrêts natifs. Une comparaison de 37
enveloppes est conservée dans `cross-configuration-before-edge.json` ; la
comparaison finale inclut en plus les cas numériques invalides.

## Captures et artefacts

- `Release/final-http-edge/` et `Debug/final-http-edge/` : requêtes, réponses,
  simulations plates, erreurs natives, métriques et CSV des six scénarios.
- `Release/native-8o-final.log`, `Debug/native-8o-final.log` et JUnit ciblés :
  contrôles natifs avec reset, 201 points par série et écart maximal 0.
- `cross-configuration.json` : comparaison finale exacte des enveloppes.
- `Release/analytic-final.json`, `Debug/analytic-final.json` : oracle stdlib.
- `Release/ctest-runner-final.{log,xml}`, `Debug/ctest-runner-final.{log,xml}` :
  CTest complet, y compris les échecs CSV conservés.
- `*/ctest-official-final.*`, `*/ctest-historical-final.*` : officiels et historiques.
- `*/api-all-final.log` et `*/api-final-evidence/` : API, processus et HTTP.
- `playwright-release-20261111-163749-1060611-27672/` : 88 parcours complets.
- `playwright-release-20261111-175608-1938875-30768/8o/` : dernières captures
  Release de N, N+C, campagnes et préfixes partiels.
- `playwright-debug-20261111-175648-9084256-13416/8o/` : parcours 8O Debug réels.
- `audit/` : HEAD, empreintes des sources jointes et binaires, vérification du diff.

![N : six trajectoires natives](D:/these/irritator/build-web-test8o/playwright-release-20261111-175608-1938875-30768/8o/N-six-curves.png)

![N et C : douze séries natives](D:/these/irritator/build-web-test8o/playwright-release-20261111-175608-1938875-30768/8o/N-C-twelve-curves.png)

![Préfixes natifs arrêtés par budget](D:/these/irritator/build-web-test8o/playwright-release-20261111-175608-1938875-30768/8o/partial-native-prefix.png)

## Incidents conservés et limitations

- Le premier build du runner a rencontré une surcharge RapidJSON `AddMember`
  incorrecte. L'appel est corrigé ; le journal initial reste dans le premier
  dossier Release `run-20261111-155650-8042126-30496/`.
- Une compilation a été interrompue pour prioriser le runner. Une tentative de
  régénération concurrente a rencontré le verrou Ninja ; elle est conservée
  séparément. Les constructions finales complètes réussissent dans les deux
  configurations, sans abaisser les vérifications ni modifier leurs délais.
- Deux premiers tests de quotas produisaient trop peu de campagnes : le
  générateur natif augmente ses délais successifs. Seul l'horizon parent des
  fixtures de stress est corrigé ; plafonds de points, lignes, octets et appels
  restent inchangés. Les premiers 21/23 et leur reprise ne sont pas effacés.
- Un premier appel de tests API depuis la racine cherchait les exemples au
  mauvais endroit. Les reprises sont exécutées depuis `web/`. Les premiers
  tests API utilisaient aussi les dossiers de preuves historiques par défaut ;
  les campagnes finales fixent désormais leur destination sous 8O.
- La revue des interruptions a ajouté le drainage du tampon brut au temps
  réellement atteint. Il ne fait aucun `run()` supplémentaire et ne ferme pas
  l'extrémité courante. Son préfixe fini concorde avec une simulation plate.
- Un statut d'isolation déjà établi reste inchangé même si l'observation a
  un suffixe non fini. Une observation supplémentaire non finie d'un scénario
  dont les critères restent valides échoue avec l'erreur native d'observation
  (`EXECUTION_ERROR`, catégorie 3, code moteur 67), au lieu de requalifier la décision ou de
  produire une enveloppe contradictoire. Les cas correspondants sont testés.
- Les écritures locales ont été refusées par le bac à sable en fin de campagne ;
  la compilation et les preuves ont été reprises avec l'autorisation d'outil.
  Aucun changement permanent de permissions n'a été ajouté.
- Les fichiers générés `next-env.d.ts` et `irt-mem.txt` ont été ramenés à leur
  contenu initial après sauvegarde du diagnostic ; les modifications initiales
  de l'utilisateur n'ont pas été supprimées.

La v1 reste limitée à complete, au pas 0,1, aux composants réellement observables
du catalogue et au domaine hiérarchique existant. Les plateaux peuvent être
dédupliqués ; 201 points ne sont pas garantis pour toute variable constante.
La réponse arrive à la fin du parent, sans streaming. Une annulation HTTP ou
un timeout qui tue le processus ne permet pas d'inventer une réponse partielle.
Les budgets d'appels natifs restent logiques, sans préemption OS nouvelle.
L'axe Y est générique, le document ne portant pas de métadonnée d'unité.
Les formats de fichiers du bureau natif ne reçoivent pas de nouvel éditeur.
La validation est Windows x64/MSVC, Node 24 et Next 16.4.2 ; l'égalité exacte
entre configurations ne constitue pas une garantie binaire interplateforme.

## Reproduction et utilisation

Depuis la racine, avec les dépendances déjà présentes :

```powershell
./web/engine/runner/tests-wrapper/run-8o.ps1 -Configuration Release
./web/engine/runner/tests-wrapper/run-8o.ps1 -Configuration Debug
node web/engine/runner/tests-wrapper/verify-8o.mjs build-web-test8o final-http-edge
```

Les options `BuildOnly` et `TestsOnly` sont exclusives ; `CoreOnly` s'emploie
avec `BuildOnly` pour une construction de développement ciblée. Les campagnes
normales construisent tous les contrôles. Aucun commit ni push n'est effectué.

L'API et le frontend de démonstration sont laissés sur
`http://127.0.0.1:3111` et `http://127.0.0.1:3110`, avec le runner Release 8O.
Importer l'exemple, ouvrir `prospectives`, cocher N puis exécuter. Cocher C et
relancer donne douze séries. Le CSV de la vue prospective conserve chaque
point, ses facteurs et son identité. Les serveurs/proxies temporaires Debug
ont été arrêtés ; les autres serveurs préexistants n'ont pas été remplacés.
