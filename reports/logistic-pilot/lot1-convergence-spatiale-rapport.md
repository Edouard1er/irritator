# Lot 1.11 — Gradient biologique continu et convergence spatiale

Le lot est développé sur `anim-simu` à partir de `3fee144276cd7c5e6112b8ae5116a50c2f8eda8b` (lot 1.10). Les six maillages utilisent le contour HydroLAKES local déjà projeté dans le plan, avec le nord en haut. La biologie est synthétique et les cellules évoluent indépendamment. [Contour](../../web/apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson) · [Lot 1.10](lot1-heterogeneite-rapport.md)

## Géométrie et distribution initiale

Chaque anneau est découpé aux quatre limites de la cellule. Une somme de déterminants donne l’aire et les deux premiers moments de l’anneau découpé, dans les coordonnées locales de la cellule. Les arêtes de raccordement entre fragments disjoints s’annulent dans les sommes signées. Les aires et moments des anneaux intérieurs sont soustraits de ceux du contour extérieur, quel que soit le sens de parcours des anneaux. Les moments nets divisés par l’aire humide donnent le centroïde. Celui-ci peut se trouver dans une partie sèche d’une cellule concave ou fragmentée.

Le seuil géométrique historique détermine les fractions humides `fᵢ` retenues. Chaque cellule reçoit `Aᵢ = 300 fᵢ / Σfⱼ` km². Le nouveau gradient emploie la coordonnée nord-sud du centroïde divisée par la hauteur du domaine, avec `y = 0` au nord et `y = 1` au sud.

```text
gᵢ = 1 + α (0,5 − yᵢ)
B₀ᵢ = 45 000 Aᵢ gᵢ / Σ(Aⱼ gⱼ)
Kᵢ = 300 Aᵢ
rᵢ = 0,35 mois⁻¹
```

Comme le champ `g(y)` est affine, sa moyenne sur l’eau d’une cellule est exactement sa valeur au centroïde humide, à l’arrondi du calcul géométrique près. Le gradient historique utilise toujours `yᵢ = (ligneᵢ + 0,5) / nombre_de_lignes`. La distribution homogène et les deux gradients à α = 0 passent par `B₀ᵢ = 150 Aᵢ` avec l’ordre historique des opérations. Pour le nouveau gradient à intensité positive, le résidu d’arrondi de la normalisation est absorbé par la dernière cellule du lac. [Découpage et moments](../../web/examples/logistic-lake.ts) · [Paramètres des cellules](../../web/examples/logistic-grid.ts)

Les tests couvrent un rectangle, un triangle, un contour concave, une île intérieure, des îles traversant une limite et deux fragments disjoints d’aires inégales. Ils vérifient aussi le rejet des portions sous le seuil et la pondération de la biomasse sur un triangle à cheval sur deux cellules. Pour les six maillages, l’aire et le moment nord-sud recomposés à partir des cellules coïncident avec les intégrales indépendantes sur le contour entier à `10⁻¹²` près en unités de projection. [Tests géométriques](../../web/apps/frontend/tests/logistic-lake-geometry.test.ts)

## Comparaison dans l’interface

Dans **Niveau 2 — Lac de Guiers → Expérience logistique spatiale → Silhouette du lac**, choisir la résolution puis la distribution. Les deux gradients partagent l’intensité α, réglable de 0 à 0,6. Lancer chacune des trois distributions pour renseigner le tableau aux mois 0, 10 et 20. Le tableau présente les sommes des observations natives à résolution et intensité communes. La carte et les courbes suivent la distribution active. La trace JSON identifie la distribution, l’intensité, les lots natifs et leurs diagnostics. La carte conserve le zoom, le déplacement, le plein écran et le curseur temporel.

## Méthode d’évaluation

La campagne compare d’abord les trajectoires analytiques. À chaque date `t = 0, 0,1, …, 20` mois, la référence de la cellule est `Bᵢ(t) = Kᵢ / [1 + (Kᵢ/B₀ᵢ − 1)e^(−rᵢt)]`. La référence agrégée d’un gradient est la somme de ses références locales.

- L’**écart entre maillages** compare deux totaux analytiques pour une même distribution. Le maillage 48 × 24 sert de référence provisoire. Son écart à lui-même vaut zéro par construction et sa distance à la limite continue reste inconnue.
- L’**écart entre gradients** compare les deux totaux analytiques sur la même grille et à la même intensité.
- L’**erreur QSS3** compare l’observation native à sa référence analytique locale, ou la somme native au total analytique de la même grille et de la même distribution.

Pour vérifier l’inégalité entre distributions, poser `xᵢ = B₀ᵢ/Kᵢ` et `q = exp(−r t)`. Pour `t > 0` et le même `r > 0` dans toutes les cellules, `Fₜ(x) = x / [q + (1 − q)x]` a pour dérivée seconde `−2q(1 − q) / [q + (1 − q)x]³`. Elle est strictement concave sur les rapports initiaux observés. Comme `ΣKᵢxᵢ / ΣKᵢ = 0,5`, l’inégalité de Jensen pondérée par les capacités donne `ΣKᵢ Fₜ(xᵢ) ≤ 90 000 Fₜ(0,5)`. La campagne retrouve l’égalité initiale à l’arrondi près et vérifie l’inégalité stricte aux 200 dates positives pour les deux gradients, les deux intensités et les six grilles.

## Sommes et écarts spatiaux analytiques

Sur les 24 configurations de gradient, les écarts maximaux aux sommes de référence sont de `1,71 × 10⁻¹³` km² pour l’aire et `1,46 × 10⁻¹⁰` t pour la capacité. La somme des biomasses initiales des cellules vaut exactement 45 000 t en virgule flottante pour les 12 configurations du gradient pondéré. L’écart d’arrondi du gradient historique est au plus de `5,83 × 10⁻¹¹` t.

Les écarts sont les maxima absolus en tonnes sur les 201 dates. Chaque colonne « à 48 × 24 » compare un gradient à sa propre trajectoire analytique sur la grille de référence.

| Grille | α | Milieu de ligne à 48 × 24 | Centroïde à 48 × 24 | Milieu de ligne / centroïde sur la grille |
| --- | ---: | ---: | ---: | ---: |
| 6 × 3 | 0,3 | 1,97921 | 2,42344 | 0,60517 |
| 6 × 3 | 0,6 | 8,32855 | 9,40199 | 1,98668 |
| 12 × 6 | 0,3 | 0,48820 | 0,63757 | 1,26245 |
| 12 × 6 | 0,6 | 2,12343 | 2,45032 | 5,10513 |
| 18 × 9 | 0,3 | 0,00914 | 0,27296 | 0,41493 |
| 18 × 9 | 0,6 | 0,17228 | 1,04845 | 1,72686 |
| 24 × 12 | 0,3 | 0,20459 | 0,13278 | 0,07066 |
| 24 × 12 | 0,6 | 1,01953 | 0,50790 | 0,14404 |
| 36 × 18 | 0,3 | 0,04858 | 0,03386 | 0,12199 |
| 36 × 18 | 0,6 | 0,19264 | 0,12882 | 0,46784 |
| 48 × 24 | 0,3 | 0,00000 | 0,00000 | 0,13668 |
| 48 × 24 | 0,6 | 0,00000 | 0,00000 | 0,53138 |

Les écarts analytiques du gradient pondéré à 48 × 24 baissent sur la série des six grilles observées. À α = 0,6, ils culminent entre 3,8 et 3,9 mois et passent de 9,402 t sur 6 × 3 à 0,129 t sur 36 × 18. Pour le milieu de ligne, le passage de 18 × 9 à 24 × 12 augmente les écarts aux deux intensités. La distance à la grille fine de chaque méthode dépend aussi de la latitude choisie pour représenter les cellules riveraines. Sur 48 × 24, ce choix produit encore un écart de 0,531 t à α = 0,6.

## Erreur numérique QSS3

Les maxima absolus en tonnes ci-dessous comparent les résultats natifs à leur propre solution analytique. Les maxima locaux portent sur toutes les cellules humides et tous les instants. Les maxima agrégés portent sur les sommes à chaque instant, ce qui permet des compensations entre cellules.

| Grille | α | Local, milieu de ligne | Local, centroïde | Total, milieu de ligne | Total, centroïde |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6 × 3 | 0,3 | 0,03834 | 0,08535 | 0,09007 | 0,16289 |
| 6 × 3 | 0,6 | 0,05835 | 0,03082 | 0,08484 | 0,06694 |
| 12 × 6 | 0,3 | 0,02163 | 0,43966 | 0,09305 | 0,55083 |
| 12 × 6 | 0,6 | 0,02900 | 0,02122 | 0,08041 | 0,08001 |
| 18 × 9 | 0,3 | 0,01333 | 0,22186 | 0,07634 | 0,21952 |
| 18 × 9 | 0,6 | 0,05777 | 0,27598 | 0,18256 | 0,36549 |
| 24 × 12 | 0,3 | 0,00189 | 0,05213 | 0,04998 | 0,11676 |
| 24 × 12 | 0,6 | 0,17908 | 0,17906 | 0,54587 | 0,34053 |
| 36 × 18 | 0,3 | 0,07958 | 0,07958 | 0,33316 | 0,20927 |
| 36 × 18 | 0,6 | 0,03801 | 0,06959 | 0,36046 | 0,34405 |
| 48 × 24 | 0,3 | 0,30645 | 0,26323 | 1,80316 | 1,20616 |
| 48 × 24 | 0,6 | 0,00494 | 0,03843 | 0,09899 | 0,12424 |

À α = 0,3, sur 48 × 24, l’erreur QSS3 agrégée de 1,20616 t du gradient pondéré dépasse l’écart analytique de 0,03386 t entre 36 × 18 et 48 × 24. Une comparaison des totaux natifs seuls mélangerait ces deux effets. Pour le gradient pondéré, le maximum relatif local hors plancher atteint 0,1014 % sur 18 × 9 à α = 0,6. Le maximum relatif agrégé atteint 0,001567 % sur 48 × 24 à α = 0,3.

La borne de régression locale du gradient pondéré est fixée à `1,2 × 10⁻³` en relatif pour ces essais. Le gradient historique conserve `7 × 10⁻⁴`. Les deux contrôles accordent une marge absolue locale de `10⁻⁷` t au plancher du quantum et utilisent une borne relative agrégée de `3 × 10⁻⁵`. Ces seuils testent les écarts observés. Le quantum historique `3 × 10⁻⁷ Kᵢ` est borné à `[10⁻⁹, 10¹²]` t. Les six grilles ont 13, 35, 65, 101, 184 et 296 cellules humides, réparties en 1, 2, 4, 6, 11 et 17 lots d’au plus 18 cellules. Chaque cellule fournit 201 points. Le maximum observé est de 24 465 appels à l’ordonnanceur par lot, pour un plafond de 100 000.

À titre de comparaison à résolution commune, voici les totaux natifs sur 48 × 24, pour α = 0,6 dans les deux gradients.

| Distribution | 0 mois (t) | 10 mois (t) | 20 mois (t) |
| --- | ---: | ---: | ---: |
| Homogène | 45 000,000 | 87 361,866 | 89 918,011 |
| Gradient par milieu de ligne | 45 000,000 | 87 237,006 | 89 913,718 |
| Gradient pondéré par surface humide | 45 000,000 | 87 237,154 | 89 913,724 |

## Reproduction

La campagne a utilisé le runner Release Windows `build-web-test8p-bis/Release/runner/irritator-runner.exe`, d’empreinte SHA-256 `a919dfdfb99b83242e42fb7c023d4afccc94c53b0e0ddc7b308f59d40eef902b`. Le contour porte l’empreinte `9ac2101b3e02f8dd890dc9c9365f60e0febe265cceba058beed5835dbbcadbe6`. Les builds et tests frontend utilisent Node.js 24.22.3 et les campagnes CLI Node.js 26.13.0.

Depuis `web`, définir `IRRITATOR_RUNNER` vers le runner Release. La variable facultative `IRRITATOR_LAKE_CONVERGENCE_EVIDENCE` choisit la destination du JSON de mesures. Le JSON contient les empreintes du runner et du contour, les écarts analytiques maximaux et leur date, les écarts signés à 0, 10 et 20 mois, ainsi que les diagnostics numériques des 24 simulations de gradient. [Campagne native](../../web/engine/runner/logistic-lake-tests.mjs)

```powershell
npm run build
node --test --test-concurrency=1 engine/runner/tests.mjs engine/runner/logistic-single-tests.mjs engine/runner/logistic-three-cells-tests.mjs engine/runner/logistic-nine-cells-tests.mjs engine/runner/logistic-variable-grid-tests.mjs engine/runner/logistic-constant-domain-tests.mjs engine/runner/logistic-lake-tests.mjs
node --test --test-concurrency=1 dist/apps/api/tests/integration.test.js
```

Pour les vérifications navigateur, démarrer Fastify et Next.js avec `IRRITATOR_API_URL` vers Fastify. Depuis `web/apps/frontend`, définir `FRONTEND_URL` vers Next.js.

```powershell
npm run build
npm run typecheck
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache
node node_modules/@playwright/test/cli.js test logistic-spatial.spec.ts logistic-parameters.spec.ts --workers=1
```

## Vérifications exécutées

- Les requêtes natives, les solutions analytiques et les résultats du runner sont identiques à ceux du commit de départ pour les 18 configurations historiques vérifiées. La comparaison porte sur les six grilles en homogène et en gradient par milieu de ligne aux deux intensités. Sur les six grilles, le nouveau gradient à α = 0 produit les mêmes requêtes, solutions analytiques et résultats natifs que l’homogène historique. La trace du nouveau calcul indique la distribution et l’intensité sélectionnées.
- Les 124 tests CLI passent, dont la campagne native du lot 1.11, également rejouée isolément. Ses 24 simulations de gradient valident chacune les 201 observations de chaque cellule humide.
- Les builds Fastify et Next.js, le contrôle TypeScript, les 642 tests Vitest et les 10 tests d’intégration HTTP passent.
- Les 14 parcours Playwright logistiques passent sur Chrome 158. Le nouveau parcours compare les trois séries de totaux HTTP, vérifie l’isolement des comparaisons entre résolutions, rejoue α = 0 et contrôle la trace JSON, le zoom et le curseur en plein écran.
