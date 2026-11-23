# Lot 1.8 — Silhouette du lac de Guiers

## Utilisation

Dans **Niveau 2 — Lac de Guiers**, ouvrir **Expérience logistique spatiale**, puis choisir **Silhouette du lac**. Le bouton **Lancer la simulation** envoie un modèle au runner C++ via le proxy Next.js et Fastify. La lecture temporelle pilote la couleur, les biomasses affichées, le total et les repères sur les courbes. Le dégradé suit le rapport entre la biomasse et la capacité de la cellule, de 50 % à 100 %.

Un clic dans la partie humide ou la touche Entrée ou Espace sur une cellule affiche sa fraction humide, sa surface fictive, sa biomasse initiale, son taux de croissance et sa capacité. L’infobulle indique la biomasse à l’instant consulté. Les cases à cocher permettent de superposer les trajectoires. La sélection, les résultats et l’instant consulté sont conservés lors d’un aller-retour entre les modes.

## Découpage et précision

Le frontend charge le [contour HydroLAKES fourni](../../web/apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson) depuis un fichier statique local. La projection d’affichage prend l’ouest et le nord de l’emprise comme origine. Elle multiplie les écarts de longitude par le cosinus de la latitude médiane de l’emprise et divise les deux axes par l’étendue en latitude. Le nord reste en haut. L’emprise projetée mesure environ 0,450247 × 1 en unités d’affichage. Les surfaces en km² sont fictives et la projection sert à répartir ces surfaces.

Le calcul découpe les segments de chaque anneau contre les quatre demi-plans de chaque case. L’aire orientée par la formule du lacet permet d’additionner les fragments disjoints d’un anneau concave. Le calcul prend la valeur absolue par anneau et soustrait les aires des 13 anneaux intérieurs. Les cases ont la même aire plane, donc le calcul en coordonnées unitaires de case donne directement la fraction humide `fᵢ`. La somme des fractions vaut 2,387164625694628. Un second calcul sur les anneaux projetés entiers vérifie la conservation de l’aire plane à `10⁻¹²` unité d’affichage carrée près.

Les fractions sont calculées en virgule flottante à partir des segments du GeoJSON. Dans une case normalisée, le seuil de résolution est `64 × Number.EPSILON × nombre de sommets`, soit environ `2,05 × 10⁻¹¹` pour ce contour. Une fraction calculée sous ce seuil, ou égale au seuil, donne une case sans atome. Les résidus positifs exclus sont comptabilisés avant la normalisation des surfaces. Aucun résidu positif n’a été exclu pour le contour fourni. La plus petite fraction retenue vaut environ 0,00665821.

Le rendu SVG découpe chaque rectangle humide avec les mêmes anneaux projetés et la règle pair-impair. Les parties sèches et les îles laissent voir le fond du panneau. Le test navigateur compare tous les sommets du masque au GeoJSON projeté puis vérifie le pointage sur l’eau, la rive et l’intérieur d’une île.

## Cellules et modèle

Les identifiants `C<ligne><colonne>` utilisent des indices à partir de zéro. Les cinq cases sèches C00, C22, C32, C41 et C42 ne produisent aucun atome ni observation. La surface de chaque cellule vaut `Aᵢ = 9 × fᵢ / Σ fⱼ`. Le tableau arrondit les valeurs pour la lecture.

| Cellule | Fraction humide (%) | Surface fictive (km²) |
|---|---:|---:|
| C01 | 33,9581 | 1,280274 |
| C02 | 18,7971 | 0,708680 |
| C10 | 0,6658 | 0,025103 |
| C11 | 65,0664 | 2,453108 |
| C12 | 1,0304 | 0,038848 |
| C20 | 29,6668 | 1,118487 |
| C21 | 23,6229 | 0,890622 |
| C30 | 22,2841 | 0,840146 |
| C31 | 1,0022 | 0,037785 |
| C40 | 17,0147 | 0,641483 |
| C50 | 5,5162 | 0,207969 |
| C51 | 16,3098 | 0,614907 |
| C52 | 3,7820 | 0,142589 |

Le [générateur logistique](../../web/examples/logistic-grid.ts) instancie le même sous-modèle DEVS/QSS3 pour chacune des 13 cellules. La simulation comporte 91 atomes sur les 128 autorisés et 117 connexions sur les 512 autorisées. Chaque connexion reste interne à sa cellule. Les 13 séries contiennent 201 points chacune, soit 2 613 valeurs publiées pour un plafond de 20 000 points. Le calcul nominal s’achève en 2 553 appels à l’ordonnanceur sur un budget de 100 000.

Chaque cellule utilise `N₀ = 150 × Aᵢ`, `K = 300 × Aᵢ`, `r = 0,35 mois⁻¹` et `dQ = 0,01 t`. Le runner publie de 0 à 20 mois par pas de 0,1 mois. Les tests vérifient les sommes à `10⁻¹² km²` près pour les surfaces et à `10⁻¹⁰ t` près pour les biomasses et capacités. Les sommes attendues sont 9 km², 1 350 t et 2 700 t. La comparaison à l’instant initial admet `10⁻¹² t` d’arrondi entre les valeurs de la requête et celles publiées par le runner.

## Comparaison analytique

Pour chaque cellule, la solution est `Nᵢ(t) = Kᵢ / [1 + (Kᵢ/N₀ᵢ − 1) exp(−0,35 t)]`. Toutes les cellules ont `Kᵢ/N₀ᵢ = 2`. La somme analytique retrouve donc la trajectoire du domaine homogène, `B(t) = 2700 / [1 + exp(−0,35 t)]`. L’écart entre les deux calculs analytiques reste inférieur à `10⁻¹⁰ t` sur les 201 instants.

La comparaison des observations à l’analytique utilise la tolérance locale du lot 1.1, `0,15 t + 0,002 × |Nᵢ(t)|`. La tolérance du total est la somme des tolérances locales, `13 × 0,15 t + 0,002 × |B(t)|`. Le plus grand écart local vaut 0,255404 t pour C01 à 0,3 mois. Le plus grand écart du total vaut 1,305812 t à 0,3 mois. Modifier seulement le taux de C11 de 0,35 à 0,28 mois⁻¹ change sa trajectoire et laisse les 12 autres séries identiques point par point.

| Mois | Biomasse totale du runner (t) | Capture |
|---:|---:|---|
| 0 | 1 350,000000 | [Grille à 0 mois](lot1-silhouette-lac-captures/grille-t0.png) |
| 10 | 2 620,759475 | [Grille à 10 mois](lot1-silhouette-lac-captures/grille-t10.png) |
| 20 | 2 697,526002 | [Grille à 20 mois](lot1-silhouette-lac-captures/grille-t20.png) |

## Vérifications

Branche `anim-simu`, base `301eaf755fd624f166c5dc029817afa67d05d007` (lot 1.7). Runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe`, SHA-256 `A919DFDFB99B83242E42FB7C023D4AFCCC94C53B0E0DDC7B308F59D40EEF902B`.

- CLI avec le runner C++. 121 tests réussis, dont les tests des lots 1.1 à 1.7 et les deux tests du lot 1.8.
- API. 93 tests réussis, dont le passage via Fastify avec les 13 séries du runner.
- Frontend. Contrôle TypeScript, build de production Next.js et 614 tests Vitest sur 46 fichiers réussis. Les cas géométriques couvrent les îles qui traversent une case, les fragments disjoints, le seuil de résolution et la conservation de l’aire.
- Navigateur Chrome. 18 parcours réussis sur 20, dont les dix parcours de l’expérience logistique. Le nouveau parcours compare la réponse HTTP à la CLI C++, puis vérifie la sélection à la souris et au clavier, les couleurs, les courbes et le total à 0, 10 et 20 mois. Le second parcours vérifie la reprise après un échec du chargement du contour.

Depuis `web`, définir `IRRITATOR_RUNNER` vers l’exécutable Release et lancer les commandes suivantes.

```powershell
npm run build
node --test --test-concurrency=1 engine/runner/tests.mjs engine/runner/logistic-single-tests.mjs engine/runner/logistic-three-cells-tests.mjs engine/runner/logistic-nine-cells-tests.mjs engine/runner/logistic-variable-grid-tests.mjs engine/runner/logistic-constant-domain-tests.mjs engine/runner/logistic-lake-tests.mjs
node --test --test-concurrency=1 dist/apps/api/tests/backend.test.js dist/apps/api/tests/process.test.js dist/apps/api/tests/hierarchy.test.js dist/apps/api/tests/qss-catalog.test.js dist/apps/api/tests/integration.test.js dist/apps/api/tests/units.test.js
```

Depuis `web/apps/frontend`, démarrer Fastify et Next.js séparément. Définir `FRONTEND_URL` vers Next.js, `IRRITATOR_API_URL` vers Fastify et, pour régénérer les captures, `IRRITATOR_LAKE_BROWSER_EVIDENCE` vers le dossier des captures.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache
node node_modules/@playwright/test/cli.js test logistic-spatial.spec.ts logistic-parameters.spec.ts levels-territory.spec.ts native-briefing.spec.ts workshop-journey.spec.ts workshop.spec.ts --workers=1
node node_modules/@playwright/test/cli.js test editor.spec.ts --grep 'importe le fichier sum3' --workers=1
```

Les sorties de compilation et les serveurs de vérification ont utilisé une copie des sources dans un dossier de build local.

Les deux anomalies du [registre Playwright du lot 1.7](lot1-domaine-constant-rapport.md#registre-playwright) se reproduisent. Dans `workshop.spec.ts:29`, la première trace Plotly contient 0 point alors que la réponse native en contient 201. Dans `editor.spec.ts:33`, le statut « Terminé » reste absent après l’import de `sum3`. La réponse native indique `completed` et livre les valeurs 10, 110 et 1 110.
