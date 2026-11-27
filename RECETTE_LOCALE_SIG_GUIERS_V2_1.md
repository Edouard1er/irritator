# Recette locale du SIG du lac de Guiers V2.1

**27 novembre 2026 · Windows · branche `modelisation-spatiale`**

L’audit des données réelles reproduit le domaine candidat de **184,524930 km²**. Le chargement automatique, les quatre configurations et le calcul de croissance natif ont été exercés dans Chrome avec des couches complémentaires synthétiques sur le fond HydroLAKES. Le profil courant sert cette recette à [localhost:3000](http://localhost:3000). Les services web et le runner dialoguent en boucle locale.

L’ouverture dans le navigateur des données réelles d’Étienne Delay et les simulations sur ces données restent suspendues à une **référence documentée couvrant la dérivation et la consultation locale** des couches. La communication rapportée sur le périmètre de pêche motive le masque candidat. La consultation des rapports V2, des provenances locales et du clone `viabFishSng` n’a fourni aucune pièce avec cette portée. Les validations empirique et institutionnelle restent à établir indépendamment.

## Démarrage quotidien

Depuis `D:\these\irritator`, lancer HydroLAKES avec la commande suivante. Si une référence d’autorisation documentée est disponible, le lanceur la lit aussi dans `local-sig-guiers/local-use-proof.txt`.

```powershell
pwsh -NoProfile -File .\scripts\start-local-guiers.ps1 -Background
```

Ajouter `-Synthetic` pour charger le jeu de recette. Depuis la page d’accueil ouverte par le lanceur, suivre **Niveau 2 — Lac de Guiers → Scientifique → Explorer le référentiel du lac**. Un profil SIG local valide sélectionne `HP_PLUS` et la résolution de 1 000 m à l’ouverture du référentiel.

```powershell
pwsh -NoProfile -File .\scripts\start-local-guiers.ps1 -Synthetic -Background
pwsh -NoProfile -File .\scripts\start-local-guiers.ps1 -Stop
```

Lancer `-Stop` avant de changer de profil. Le superviseur demande l’arrêt aux processus qu’il a démarrés. Lorsqu’un port est occupé, le lanceur affiche le PID et le nom du programme. Pour le profil réel, transmettre la référence vérifiable avec `-LocalUseProof` ou la consigner dans le fichier indiqué plus haut. `-AcquiredAt` permet de préciser la date d’acquisition de la copie si elle diffère de la provenance V2. Les journaux sont dans [local-sig-guiers/runtime](local-sig-guiers/runtime/).

## État initial et environnement

| Élément | État constaté |
| --- | --- |
| Irritator | `ed8c87c1e79816f1052fa06ed860d66c2dcfd172`, branche `modelisation-spatiale` alignée sur sa référence distante locale, espace de travail propre au départ |
| viabFishSng | `master`, `e17bc25f18b11d7fa6074ec411749ad606767a76`, espace de travail propre |
| API et frontend | Anciens processus Irritator sur 3001 et 3000, identifiés puis remplacés par la session supervisée |
| Node.js et npm | Node.js **24.22.3** sélectionné depuis `build-guiers-tools/node.exe`, npm **11.20.0**. Le Node du PATH était **26.13.0** |
| Frontend | Next.js **16.4.6**, Chrome **158.0.8127.38** |
| Outils Windows | PowerShell **7.6.9**, Git **2.56.1.windows.1**, CMake **4.0.3**, Ninja **1.13.2**, MSVC x64 installé **19.52.37029** |
| Géomatique | Python **3.12.14**, Shapely **2.2.0**, GEOS **3.14.1**, pyproj **3.8.0**, PROJ **9.8.1**, pyshp **3.1.9** |
| Runner utilisé | `D:\these\irritator\build-web-test8p-bis\Release\runner\irritator-runner.exe`. Dialogue catalogue et capacités réussi, moteur et adaptateur **0.1.0** |

Les modules npm, l’environnement Python et le runner compatibles étaient disponibles. Le lanceur réutilise le runner et reconstruit seulement l’API si les sources changent. Les générations SIG sont mises en cache à partir des empreintes des sources et de la chaîne d’audit. Une divergence du clone peut être traitée par extraction du commit de référence dans le dossier ignoré. Cette récupération n’a pas été nécessaire pendant la recette.

## Audit géographique réel

Les cinq shapefiles et leurs composants requis ont été trouvés. Les **11 blobs** épinglés dans le manifeste concordent. Les **27 SHA-256** des fichiers lus pour les cinq couches concordent avec la copie locale et la provenance V2. Le référentiel H et son résumé de connectivité sont identiques, octet pour octet, aux ressources H distribuées. La validation Web des polygones accepte les **4 362 parties** des six graphes réels. Les alertes QMD, les noms et populations absents restent consignés dans la provenance. [Rapport JSON](local-sig-guiers/v2-1-audit/report.json) · [Provenance](local-sig-guiers/v2-1-audit/provenance.json)

| Mesure projetée | Résultat |
| --- | ---: |
| Aire H | 220,122208 km² |
| Aire E | 196,329240 km² |
| Aire HP_PLUS | 184,524930 km² |
| Aire H retirée au sud | 35,597278 km² |
| Étendue nord–sud et est–ouest de HP_PLUS | 44,307290 km et 19,853652 km |
| Interface aquatique tronquée | 399,298403 m |
| Seuil méridional EPSG:32628 | 1 767 012,9478467978 m |
| Variante de sensibilité `envelope` | 185,143778 km² conservés |

Le calcul applique le masque au contour HydroLAKES original. Il conserve sept trous. L’intersection H∩E reste un indicateur de comparaison à **172,609867 km²**. L’écart absolu dans le bilan d’aire de HP_PLUS est inférieur à **0,000001 m²** aux deux résolutions. [Comparaison](local-sig-guiers/v2-1-audit/carte-comparative-hp-plus.svg) · [Détail de la coupe](local-sig-guiers/v2-1-audit/carte-detail-coupure.svg)

| HP_PLUS réel | 1 000 m | 500 m |
| --- | ---: | ---: |
| Cellules actives | 288 | 967 |
| Pleines | 97 | 508 |
| Partielles | 191 | 459 |
| Sous-composantes aquatiques | 311 | 996 |
| Arêtes `water_parts_v1` | 499 | 1 728 |
| Composantes connexes | 1 | 1 |
| Isolats | 0 | 0 |

Les sources comptent **35 villages**, dont **27** dans le masque. Trois noms et 34 populations restent inconnus. Les **4** zones de réserve candidates intersectent **11,382826 km²** d’eau. Les **5** zones de Typha théorique intersectent **7,696390 km²** d’eau. Les intersections eau–thèmes concordent entre domaine et cellules à moins de **0,000001 m²**. Le graphe décrit une connectivité géométrique. La navigabilité, les flux biologiques, les réserves réglementaires et la présence contemporaine de Typha nécessitent leurs propres observations ou validations.

## Configuration et fonctionnalités vérifiées

| Profil | Disponibilité et vérification |
| --- | --- |
| HydroLAKES | Démarrage avec le lanceur sans pièce d’autorisation, chargement de H, simulation native et import manuel V1/V2 éprouvés |
| Synthétique | Démarrage du profil avec fonds H/H_PLUS, contour alternatif fictif E et périmètre HP_PLUS fictif. Calcul géomatique de **148** cellules à 1 000 m et **524** à 500 m |
| Réel | H publié. E, H_PLUS et HP_PLUS calculés en audit local. Activation de leurs couches, export autorisé et exécution depuis le navigateur en attente d’une pièce d’autorisation |

La recette Chrome a couvert les deux niveaux, les lectures Scientifique et Pêcheur, le chargement automatique, le changement des quatre configurations, la comparaison des contours, le zoom, les déplacements et le recentrage. Elle a vérifié l’affichage indépendant des villages, de leurs noms, des réserves, du Typha, du masque, des grilles, des parties aquatiques et des relations de voisinage. La sélection cartographique ouvre les surfaces, fractions et connexions d’une cellule. Les cellules restent accessibles au clavier par le sélecteur.

Le navigateur lance les calculs via le service natif existant. La recette modifie la durée et le taux, vérifie les séries reçues aux deux résolutions, parcourt les jours 0, 5 et 10, compare les résultats, vérifie les biomasses affichées pour une cellule, anime la carte et réinitialise la résolution courante. À 1 000 m, l’exemple affiché passe de **54 839,897 kg** à **65 663,938 kg** au jour 10. La croissance est autonome par cellule. Les graduations journalières de l’interface proviennent d’observations du runner.

Les trois ressources autorisées du profil restent sous `local-sig-guiers/`. L’API valide le profil explicite, l’origine et la boucle locale, la version du référentiel, les empreintes, la provenance et le graphe associé. Le navigateur a vérifié le refus d’une origine externe, d’une empreinte incohérente et d’un import sans droit documenté, ainsi que l’absence des fichiers locaux aux URL publiques testées. Le repli HydroLAKES a rendu la route SIG locale indisponible. L’import manuel reste accessible dans le mode Scientifique.

La recette a également identifié des sondes de santé simultanées des deux éditeurs contre le budget de processus du backend. Leur mutualisation évite le badge d’indisponibilité transitoire. Les journaux Next ont encore émis des avertissements React Flow lors de l’initialisation du modèle d’atelier.

## Commandes et résultats de recette

| Vérification | Commande ou preuve | Résultat |
| --- | --- | --- |
| Tests géomatiques | `build-sig-guiers/venv/Scripts/python.exe -B -m unittest discover -s scripts/guiers -v` | 9 réussis |
| Audit géomatique réel | `build-sig-guiers/venv/Scripts/python.exe -B scripts/guiers/audit_sig.py --hydro web/apps/frontend/data/geography/guiers-hydrolakes-1520.original.geojson --etienne ../viabFishSng/data --acquired-at 2026-11-27 --out local-sig-guiers/v2-1-audit` | Géométrie, thèmes, graphes et provenance contrôlés |
| Compilation API | `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --outDir build-guiers-api` depuis `web` avec Node 24 | Réussie |
| Typage frontend | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Réussi |
| Build de production frontend | `node node_modules/next/dist/bin/next build --webpack` | Réussi, typage inclus. [Journal](local-sig-guiers/v2-1-build-frontend.log) |
| Tests unitaires frontend | `node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers=1` | 678 réussis en deux passages. Les 25 tests de `logistic-lake-run.test.tsx` ont réussi à la relance après un refus d’écriture du cache Vitest |
| Parcours historiques | `playwright test tests/e2e/guiers-spatial.spec.ts tests/e2e/geo-atlas.spec.ts tests/e2e/levels-territory.spec.ts` | 9 réussis, dont la simulation H et la réimportation manuelle du résultat V2 synthétique. [Rapport](local-sig-guiers/v2-1-playwright-h.json) |
| Recette locale | `GUIERS_RECIPE=synthetic` et `playwright test tests/e2e/guiers-local.spec.ts` avec `GUIERS_SCREENSHOTS` vers le dossier de captures | 1 parcours complet réussi. [Rapport Playwright](local-sig-guiers/v2-1-playwright-synth.json) |
| Validation ciblée API et runner | `node --test --test-concurrency=1 build-guiers-api/apps/api/tests/local-guiers.test.js build-guiers-api/apps/api/tests/backend.test.js build-guiers-api/apps/api/tests/process.test.js engine/runner/guiers-logistic-tests.mjs` depuis `web` | 47 réussis. [Journal](local-sig-guiers/v2-1-tests-cibles.log) |
| Suite historique API et runner | Liste de `web/package.json` pour `test:all`, exécutée avec `node --test`, la sortie compilée `build-guiers-api` et `engine/runner/guiers-logistic-tests.mjs` | 661 réussis lors du passage parallèle. Six écritures de preuves historiques ont été refusées par l’environnement. [Journal parallèle](local-sig-guiers/v2-1-api-runner-tests.log) |
| Relances de la suite historique | `node --test --test-concurrency=1 --test-timeout=60000 --test-name-pattern ...`. Sélections HTTP QSS3 et wrapper, puis hiérarchie, intégration et QSS3 natif | Les six tests concernés ont réussi lors des deux relances. La seconde enregistre les preuves sous `local-sig-guiers/v2-1-regression-evidence`. [Relance HTTP](local-sig-guiers/v2-1-regression-http.log) · [Relance avec preuves locales](local-sig-guiers/v2-1-regression-ecriture.log) |

## Captures Chrome

Toutes les captures sont conservées dans [le dossier local de recette](local-sig-guiers/v2-1-captures/). Les vues enrichies portent sur le jeu synthétique.

| Parcours | Captures |
| --- | --- |
| Atelier et entrée Lac de Guiers | [01 Niveau 1](local-sig-guiers/v2-1-captures/01-niveau-1.png) · [02 Niveau 2](local-sig-guiers/v2-1-captures/02-niveau-2.png) |
| Configurations | [03 HydroLAKES](local-sig-guiers/v2-1-captures/03-hydrolakes-complet.png) · [04 E synthétique](local-sig-guiers/v2-1-captures/04-contour-alternatif-synthetique.png) · [05 HP_PLUS synthétique](local-sig-guiers/v2-1-captures/05-hybride-hp-plus-synthetique.png) |
| Thèmes, maillage et connexions | [06 Couches](local-sig-guiers/v2-1-captures/06-villages-reserves-typha-synthetiques.png) · [07 Grille 1 000 m](local-sig-guiers/v2-1-captures/07-grille-1000m.png) · [08 Grille 500 m](local-sig-guiers/v2-1-captures/08-grille-500m.png) · [09 Connectivité](local-sig-guiers/v2-1-captures/09-connectivite-aquatique.png) · [10 Cellule](local-sig-guiers/v2-1-captures/10-details-cellule.png) |
| Croissance et lecture Pêcheur | [11 Jour 0](local-sig-guiers/v2-1-captures/11-croissance-initiale.png) · [12 Jour 5](local-sig-guiers/v2-1-captures/12-croissance-intermediaire.png) · [13 Jour 10](local-sig-guiers/v2-1-captures/13-croissance-finale.png) · [14 Mode Pêcheur](local-sig-guiers/v2-1-captures/14-mode-pecheur.png) |

## Fichiers Git de la mission

| Créés | Modifiés |
| --- | --- |
| `RECETTE_LOCALE_SIG_GUIERS_V2_1.md` | `scripts/guiers/audit_sig.py` |
| `scripts/start-local-guiers.ps1` | `web/build-runner.ps1` |
| `scripts/guiers/local-servers.mjs` | `web/apps/api/src/app.ts` |
| `scripts/guiers/recipe_fixture.py` | `web/apps/api/src/config/index.ts` |
| `web/apps/api/src/routes/local-guiers.ts` | `web/apps/frontend/app/geo-atlas.css` |
| `web/apps/api/tests/local-guiers.test.ts` | `web/apps/frontend/components/editor/model-editor.tsx` |
| `web/apps/frontend/lib/api/local-guiers.ts` | `web/apps/frontend/components/territory/geo-atlas-map.tsx` |
| `web/apps/frontend/tests/e2e/guiers-local.spec.ts` | `web/apps/frontend/components/territory/guiers-spatial-workspace.tsx` |
| | `web/examples/guiers-logistic.ts` |
| | `web/packages/contracts/guiers-spatial.ts` |

Les changements Irritator restent dans l’espace de travail sur `modelisation-spatiale`. Les opérations Git ont été effectuées en lecture seule. Les captures, les shapefiles, les résultats de recette et le référentiel local restent dans des dossiers ignorés. Le dépôt `viabFishSng` est resté intact.
