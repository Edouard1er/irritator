# Lot 1.9 — Raffinement du lac de Guiers et plein écran

Branche `anim-simu`, base distante vérifiée `9d983cb67817b81c90a3b143f8ab93aeb15837ca` (lot 1.8). Dans **Niveau 2 — Lac de Guiers**, ouvrir **Expérience logistique spatiale**, choisir **Silhouette du lac**, sélectionner une résolution, puis lancer le calcul. La résolution initiale reste **6 × 3**.

## Contour, surfaces et biologie

Le découpage utilise le même polygone HydroLAKES et sa projection locale que le lot 1.8. Il conserve les 14 anneaux, dont 13 intérieurs, ainsi que les fragments disjoints des cases riveraines. Le masque SVG suit la règle pair-impair. Les tests comparent l’aire plane obtenue par découpage à l’intégrale sur les anneaux entiers à `10⁻¹²` unité de projection carrée près. Ils vérifient également le pointage dans l’eau, sur la rive et dans une île. [Contour source](../../web/apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson)

Une case de fraction humide `fᵢ` reçoit `Aᵢ = 300 × fᵢ / Σ fⱼ` km². Le seuil géométrique du lot 1.8 reste calculé à partir du nombre de sommets et de la précision de la virgule flottante. Toute case sous ce seuil est exclue du modèle. La grille 6 × 3 garde les identifiants `C<ligne><colonne>`. Les grilles raffinées emploient `C<ligne>_<colonne>` pour distinguer les indices à plusieurs chiffres. L’ordre est ligne par ligne, du nord au sud.

Pour chaque cellule, `N₀ = 150 × Aᵢ`, `K = 300 × Aᵢ` et `r = 0,35 mois⁻¹`. Les six grilles totalisent **300 km²**, **45 000 t** de biomasse initiale et **90 000 t** de capacité de charge. Le mode **Domaine constant** conserve ses **9 km²**, ses paramètres et son quantum. Les données biologiques restent synthétiques. Les cellules sont indépendantes et ce lot reste au palier 1.

## Exécution et provenance

Chaque cellule instancie 7 atomes DEVS/QSS3, 9 connexions internes et 1 observation de biomasse. Les lots suivent l’ordre du maillage et contiennent au plus 18 cellules. Un lot plein utilise 126 atomes sur 128, 162 connexions sur 512, 18 observations sur 32 et 3 636 points prévisionnels sur 20 000, marge terminale comprise. Le moteur C++ et ses plafonds restent ceux du lot 1.8.

Le navigateur soumet les lots successivement à `/api/v1/simulations/run`. Les contrôles couvrent l’identifiant du modèle, les composants observés, les valeurs finies, l’horizon 0–20 mois et la présence des 201 instants attendus au pas de 0,1 mois. Une exécution publie la carte, les totaux et les courbes une fois tous les lots validés. La barre de progression compte les lots validés. `ENGINE_BUSY` est signalé avant le lancement du processus natif et autorise jusqu’à quatre nouvelles tentatives, dans la limite de 3 secondes d’attente cumulée. Une autre erreur arrête le calcul au premier lot en échec. Une annulation ou un changement de résolution interrompt la requête côté navigateur et écarte les réponses tardives.

Le bouton **Télécharger la trace JSON** exporte la dernière exécution réussie ou en erreur pour la résolution choisie pendant la session. La trace enregistre les paramètres, l’heure de départ, le temps écoulé, les lots prévus et validés, les identifiants HTTP des lots validés, les appels à l’ordonnanceur, les points, et les maxima d’erreur absolue et relative. La taille correspond au JSON compact réencodé en UTF-8 dans le client, en octets et hors en-têtes ou compression HTTP. La campagne CLI conserve aussi la taille originale de chaque sortie standard et les empreintes SHA-256 du contour et du binaire natif. [Mesures reproductibles](lot1-raffinement-mesures.json)

## Quantum QSS3 et précision

La vérification utilise `Nᵢ(t) = Kᵢ / [1 + (Kᵢ/N₀ᵢ − 1) exp(−r t)]` pour chaque point natif. Le rapport `Kᵢ/N₀ᵢ = 2` donne la référence agrégée `90 000 / [1 + exp(−0,35 t)]`. Les calculs analytiques servent aux diagnostics. L’affichage repose sur les observations du moteur natif.

À quantum fixe, `0,01 t / Kᵢ` augmente dans les petits fragments. Les trois grilles les plus fines échouent à la validation de couverture. Le moteur publie respectivement 159, 196 et 159 points sur 201 pour les premières cellules signalées. L’observateur natif déduplique les valeurs consécutives identiques, et le pas d’observation seul ne garantit donc pas une série complète. Les cases sèches restent exclues et les petites cases humides sont conservées. [Code de l’observateur](../../lib/src/observer.cpp)

| Grille | Quantum fixe, écart local relatif maximal | Premier lot rejeté en quantum fixe | Quantum proportionnel, écart agrégé maximal |
| --- | ---: | --- | ---: |
| 6 × 3 | 0,1264 % | — | 0,06919 t |
| 12 × 6 | 0,6145 % | — | 0,06919 t |
| 18 × 9 | 1,3597 % | — | 0,06919 t |
| 24 × 12 | 2,2816 % sur les lots validés | 3/6, `C10_5` | 0,06919 t |
| 36 × 18 | 3,2896 % sur les lots validés | 6/11, `C17_5` | 0,06919 t |
| 48 × 24 | 2,7719 % sur les lots validés | 9/17, `C20_10` | 0,06919 t |

La référence est `dQᵢ = 3 × 10⁻⁷ × Kᵢ`, bornée par le catalogue QSS3 à `[10⁻⁹, 10¹²]` t. Sur 24 × 12, les essais avec `dQᵢ/Kᵢ` égal à `10⁻⁵`, `3 × 10⁻⁶`, `3 × 10⁻⁷` et `10⁻⁷` ont donné des erreurs agrégées maximales de 26,92 t, 6,81 t, 0,0692 t et 0,0224 t, pour des maxima de 6 177, 9 649, 21 281 et 30 761 appels par lot. La référence retenue couvre toutes les grilles et laisse une marge sur les 100 000 appels permis par lot. [Catalogue Irritator](../../web/packages/contracts/catalog.json)

La tolérance de non-régression est `2 × 10⁻⁶ × Nᵢ(t)` localement et `2 × 10⁻⁶ × B(t)` pour le total, soit 0,0002 %. L’erreur relative observée hors plancher reste inférieure à `9,52 × 10⁻⁷`. Sur 48 × 24, seule `C41_5` atteint le plancher, avec `K ≈ 0,00013128 t`. L’écart absolu maximal de cette cellule vaut `3,93 × 10⁻⁸ t`, soit 0,039 g, pour un écart relatif maximal d’environ 0,0578 %. La tolérance locale accorde `10⁻⁷ t` (0,1 g) de marge absolue supplémentaire aux cellules au plancher. La tolérance de comparaison des totaux entre grilles est de `10⁻⁷ t`. Le plus grand écart observé entre grilles vaut `3,93 × 10⁻⁸ t`. Ces bornes évaluent la précision numérique du modèle synthétique.

## Campagne native

Runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe`, SHA-256 `A919DFDFB99B83242E42FB7C023D4AFCCC94C53B0E0DDC7B308F59D40EEF902B`. Les mesures ont été enregistrées sous Windows avec Node.js 26.13.0 pour l’orchestration CLI. Les temps en secondes incluent les lancements de processus, la validation et la fusion. Les octets donnent la taille compacte des résultats validés.

| Grille | Humides | Lots | Points | Temps (s) | Résultats (octets) | Capture à 10 mois |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 6 × 3 | 13 | 1 | 2 613 | 0,56 | 138 619 | [6 × 3](lot1-raffinement-captures/grille-6x3.png) |
| 12 × 6 | 35 | 2 | 7 035 | 1,01 | 372 493 | [12 × 6](lot1-raffinement-captures/grille-12x6.png) |
| 18 × 9 | 65 | 4 | 13 065 | 1,90 | 694 196 | [18 × 9](lot1-raffinement-captures/grille-18x9.png) |
| 24 × 12 | 101 | 6 | 20 301 | 2,76 | 1 077 300 | [24 × 12](lot1-raffinement-captures/grille-24x12.png) |
| 36 × 18 | 184 | 11 | 36 984 | 5,36 | 1 960 719 | [36 × 18](lot1-raffinement-captures/grille-36x18.png) |
| 48 × 24 | 296 | 17 | 59 496 | 6,99 | 3 155 833 | [48 × 24](lot1-raffinement-captures/grille-48x24.png) |

Les six grilles donnent environ **45 000,000 t** à 0 mois, **87 361,866 t** à 10 mois et **89 918,011 t** à 20 mois. Le plus grand nombre d’appels à l’ordonnanceur dans un lot est de 21 305. Les quatre lots de la grille 18 × 9 reproduisent exactement les séries d’une exécution à l’autre. Passer le taux d’une cellule de 0,35 à 0,28 mois⁻¹ dans un lot modifie seulement sa série. Les connexions sont contrôlées dans chaque lot jusqu’à 296 cellules.

## Plein écran et cadrage

Les commandes **Plein écran** s’appliquent à la carte, à l’ensemble **Biomasse par cellule**, aux indicateurs du domaine, aux détails de la cellule et aux trajectoires. La résolution, la sélection et le curseur sont partagés avec l’affichage normal. Le curseur reste utilisable en plein écran. Échap ou **Quitter le plein écran** ramène à la vue précédente. Les commandes de carte permettent de zoomer, puis de déplacer la vue à la souris ou au clavier avec les flèches. **Réinitialiser** restaure le cadrage initial. [Carte](lot1-raffinement-captures/plein-ecran-carte.png) · [Trajectoires](lot1-raffinement-captures/plein-ecran-trajectoires.png)

## Reproduction

Depuis `web`, définir `IRRITATOR_RUNNER` vers le runner Release et, pour la campagne instrumentée, `IRRITATOR_LAKE_NATIVE_EVIDENCE` vers le fichier de mesures de destination. Pour la suite HTTP complète, définir également `IRRITATOR_LEGACY_RUNNER` vers un runner historique des tests 4 à 6.

```powershell
npm run build
node --test --test-concurrency=1 engine/runner/tests.mjs engine/runner/logistic-single-tests.mjs engine/runner/logistic-three-cells-tests.mjs engine/runner/logistic-nine-cells-tests.mjs engine/runner/logistic-variable-grid-tests.mjs engine/runner/logistic-constant-domain-tests.mjs engine/runner/logistic-lake-tests.mjs
node --test --test-concurrency=1 dist/apps/api/tests/*.test.js
```

Pour Playwright, démarrer Fastify et Next.js avec `IRRITATOR_API_URL` vers Fastify. Depuis `web/apps/frontend`, définir `FRONTEND_URL` et `IRRITATOR_LAKE_REFINEMENT_EVIDENCE` vers l’adresse de Next.js et le dossier des captures.

```powershell
npm run build
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache
node node_modules/@playwright/test/cli.js test logistic-spatial.spec.ts logistic-parameters.spec.ts levels-territory.spec.ts native-briefing.spec.ts workshop-journey.spec.ts workshop.spec.ts --workers=1
node node_modules/@playwright/test/cli.js test editor.spec.ts --grep 'importe le fichier sum3' --workers=1
```

## Résultats des vérifications

- Le build de production Next.js et le contrôle TypeScript réussissent avec Node.js 24.22.3. Les 625 tests Vitest passent sur 47 fichiers, avec les cas géométriques, l’erreur partielle et la réponse tardive.
- Les 122 tests CLI passent avec le runner C++ Release. Les 110 tests API réussissent sur la campagne et sa reprise isolée. Trois tests historiques de délai de lancement du processus fixture ont été rejoués après la campagne concurrente.
- Les deux nouveaux parcours Playwright Chrome passent avec le plafond HTTP par défaut de deux processus simultanés. Ils observent les résultats HTTP sur les six grilles, vérifient le téléchargement de la trace et couvrent les cinq vues plein écran.
- Les dix parcours logistiques précédents et huit autres parcours historiques passent. Les tests logistiques attendent que chaque éditeur ait vérifié sa connexion avant de démarrer le suivant sur le serveur partagé. Les assertions sur les résultats natifs restent actives lors de cette reprise.
- Les deux anomalies Playwright déjà relevées au lot 1.8 se reproduisent. L’atelier reçoit 201 points natifs et sa première trace Plotly en contient 0. L’éditeur reçoit un résultat `completed` et les valeurs 10, 110 et 1 110, tandis que son statut « Terminé » reste absent. [Rapport du lot 1.8](lot1-silhouette-lac-rapport.md#vérifications)
