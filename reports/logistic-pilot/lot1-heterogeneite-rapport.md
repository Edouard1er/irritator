# Lot 1.10 — Hétérogénéité initiale de la biomasse du lac de Guiers

Travail sur `anim-simu`, à partir de `6202ec7d736da87c2b20ecb27ca1d77c769fd9e1`, tête distante vérifiée avant les modifications.

## Modèle et utilisation

Dans **Niveau 2 — Lac de Guiers → Expérience logistique spatiale → Silhouette du lac**, choisir une résolution et une distribution biologique avant de lancer la simulation. **Distribution homogène** est le réglage initial. **Gradient synthétique nord-sud** ouvre un curseur entre 0 et 0,6, au pas de 0,01, avec 0,3 comme intensité initiale. L’interface affiche **« Gradient biologique synthétique — non calibré »**. Le gradient est une hypothèse expérimentale sur la biomasse initiale. Aucune observation de poissons du lac ne sert à son étalonnage.

Les fractions humides du même contour HydroLAKES se partagent 300 km². La surface humide normalisée de la cellule `i` est `Aᵢ = 300 fᵢ / Σfⱼ`. Les lignes sont numérotées depuis zéro, du nord au sud. Pour une intensité positive, le générateur calcule `yᵢ = (ligneᵢ + 0,5) / nombre_de_lignes`, `gᵢ = 1 + α(0,5 − yᵢ)`, puis `B₀ᵢ = 45 000 Aᵢgᵢ / Σ(Aⱼgⱼ)`. En homogène et à α = 0, il emploie l’expression historique `B₀ᵢ = 150 Aᵢ`. Dans les deux cas, `Kᵢ = 300 Aᵢ`, `rᵢ = 0,35 mois⁻¹` et le quantum QSS3 est `3 × 10⁻⁷ Kᵢ`, borné par le catalogue à `[10⁻⁹, 10¹²]` t. [Générateur](../../web/examples/logistic-grid.ts)

Le serveur Next.js prépare le maillage, les requêtes et les références analytiques à partir du contour local. Le navigateur soumet les lots à Fastify et assemble les observations du runner natif. Chaque cellule conserve son intégrateur QSS3, ses 7 atomes et ses 9 connexions internes. Les lots restent limités à 18 cellules et les plafonds du runner sont ceux du lot 1.9. Le pas d’observation est de 0,1 mois jusqu’à 20 mois. Chaque série validée contient 201 valeurs. [Préparation côté serveur](../../web/apps/frontend/app/api/logistic-lake/route.ts) · [Exécution partitionnée](../../web/examples/logistic-lake-run.ts)

La carte utilise le rapport local `Bᵢ/Kᵢ`. Pour un gradient d’intensité positive, la palette distingue les rapports inférieurs à 50 %. La sélection, le zoom, les trajectoires et les vues plein écran restent disponibles. Après avoir lancé les deux distributions sur une grille, leurs biomasses totales observées figurent ensemble à 0, 10 et 20 mois. Chaque ligne se remplit après validation de tous ses lots. Un changement de résolution, de distribution ou d’intensité annule le calcul en cours. La trace JSON identifie la grille, la distribution, l’intensité s’il y a lieu, les lots et leurs diagnostics.

## Conservation, indépendance et reproductibilité

- Les six maillages conservent 300 km², 45 000 t de biomasse initiale et 90 000 t de capacité, à l’arrondi flottant près. Les séries à α = 0,3 et α = 0,6 restent positives sur les 201 instants. Les intégrateurs reçoivent les biomasses initiales locales et les quanta attendus.
- À α = 0,6, deux exécutions de chaque grille produisent des observations et des nombres d’appels à l’ordonnanceur identiques. Sur chaque grille, réduire de 10 % la biomasse initiale d’une cellule dans un lot modifie sa série. Les autres séries du même lot restent strictement égales. Les connexions de tous les lots sont internes à leur cellule.
- Les requêtes homogènes et à α = 0 coïncident exactement avec les requêtes construites par le lot 1.9. La réexécution des six grilles depuis la version historique et la version actuelle à α = 0 donne des séries et des maxima d’erreur identiques. Les traces du lot 1.10 ajoutent les paramètres de distribution.

## Erreur numérique QSS3

Pour chaque cellule, la référence est `Bᵢ(t) = Kᵢ / [1 + (Kᵢ/B₀ᵢ − 1)e^(−rᵢt)]`. Pour un gradient positif, la référence du total est `ΣBᵢ(t)`. Au lot 1.9 et à α = 0, le rapport initial commun de 0,5 permet la forme fermée historique du total. Les maxima ci-dessous couvrent les 201 dates communes, de 0 à 20 mois. [Référence analytique](../../web/examples/logistic-lake-analysis.ts) · [Test natif](../../web/engine/runner/logistic-lake-tests.mjs)

| Grille | Cellules | Lots | α = 0,3 · erreur totale max. (t) | α = 0,6 · erreur totale max. (t) | α = 0,6 · erreur locale max. (t) | α = 0,6 · appels max. par lot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 × 3 | 13 | 1 | 0,09007 | 0,08484 | 0,05835 | 15 865 |
| 12 × 6 | 35 | 2 | 0,09305 | 0,08041 | 0,02900 | 22 289 |
| 18 × 9 | 65 | 4 | 0,07634 | 0,18256 | 0,05777 | 23 233 |
| 24 × 12 | 101 | 6 | 0,04998 | 0,54587 | 0,17908 | 23 849 |
| 36 × 18 | 184 | 11 | 0,33316 | 0,36046 | 0,03801 | 24 337 |
| 48 × 24 | 296 | 17 | 1,80316 | 0,09899 | 0,00494 | 24 433 |

À α = 0,3 sur 48 × 24, le maximum relatif local atteint `5,9465 × 10⁻⁴` (0,0595 %) hors plancher du quantum, et le maximum relatif du total atteint `2,3427 × 10⁻⁵` (0,00234 %). La cellule au plancher sur cette grille a un écart absolu inférieur à `2,46 × 10⁻⁹` t aux deux intensités. Les bornes de régression du gradient, évaluées à α = 0,3 et α = 0,6, sont `7 × 10⁻⁴` localement et `3 × 10⁻⁵` sur le total, avec `10⁻⁷` t de marge absolue locale au plancher. Le test homogène conserve son seuil historique de `2 × 10⁻⁶`. Les maxima observés restent propres aux intensités testées.

## Effet du maillage

Ce tableau compare les **sommes des références analytiques locales**, avec 48 × 24 comme grille de référence. Les colonnes de maximum donnent des écarts absolus sur tout l’horizon. Les colonnes par date donnent les écarts signés à α = 0,6. À 0 mois, tous les écarts restent inférieurs à `10⁻⁹` t.

| Grille | Écart max. à α = 0,3 (t) | Écart max. à α = 0,6 (t) | Date du max. à α = 0,6 (mois) | Écart à 10 mois (t) | Écart à 20 mois (t) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6 × 3 | 1,97921 | 8,32855 | 4,3 | +2,84005 | +0,10002 |
| 12 × 6 | 0,48820 | 2,12343 | 3,9 | −0,64499 | −0,02228 |
| 18 × 9 | 0,00914 | 0,17228 | 5,5 | −0,08164 | −0,00308 |
| 24 × 12 | 0,20459 | 1,01953 | 4,5 | +0,36412 | +0,01293 |
| 36 × 18 | 0,04858 | 0,19264 | 4,1 | +0,06018 | +0,00208 |
| 48 × 24 | 0 | 0 | — | 0 | 0 |

Les écarts reflètent la variation des fractions humides et la représentation de la latitude par le milieu de la ligne. Leur amplitude varie de façon non monotone avec le raffinement. Sur les 15 paires de grilles, le maximum est entre 6 × 3 et 12 × 6, avec 2,46637 t à 4 mois pour α = 0,3 et 10,43936 t à 4,2 mois pour α = 0,6. À α = 0,3, l’erreur QSS3 de 1,80316 t sur la grille la plus fine dépasse plusieurs écarts de maillage. La comparaison des seuls totaux QSS3 confondrait ces deux effets.

## Comparaison des distributions

Biomasses totales natives en tonnes, arrondies à trois décimales. À α = 0,6, sur 48 × 24, la référence du rapport local évolue de 33,10–60,63 % au départ à 94,25–98,08 % au mois 10 puis 99,82–99,94 % au mois 20. L’approche de la capacité réduit le contraste spatial au cours du temps.

| Grille | Distribution | 0 mois | 10 mois | 20 mois |
| --- | --- | ---: | ---: | ---: |
| Six grilles | Homogène | 45 000,000 | 87 361,866 | 89 918,011 |
| 6 × 3 | Gradient α = 0,6 | 45 000,000 | 87 239,845 | 89 913,818 |
| 12 × 6 | Gradient α = 0,6 | 45 000,000 | 87 236,366 | 89 913,696 |
| 18 × 9 | Gradient α = 0,6 | 45 000,000 | 87 236,891 | 89 913,714 |
| 24 × 12 | Gradient α = 0,6 | 45 000,000 | 87 237,377 | 89 913,732 |
| 36 × 18 | Gradient α = 0,6 | 45 000,000 | 87 237,008 | 89 913,719 |
| 48 × 24 | Gradient α = 0,6 | 45 000,000 | 87 237,006 | 89 913,718 |

### Captures Playwright Chrome

| Grille | Instant | Homogène | Gradient α = 0,6 |
| --- | --- | --- | --- |
| 6 × 3 | 0 mois | [Capture](lot1-heterogeneite-captures/6x3-homogene-t0.png) | [Capture](lot1-heterogeneite-captures/6x3-gradient-t0.png) |
| 6 × 3 | 10 mois | [Capture](lot1-heterogeneite-captures/6x3-homogene-t10.png) | [Capture](lot1-heterogeneite-captures/6x3-gradient-t10.png) |
| 6 × 3 | 20 mois | [Capture](lot1-heterogeneite-captures/6x3-homogene-t20.png) | [Capture](lot1-heterogeneite-captures/6x3-gradient-t20.png) |
| 48 × 24 | 0 mois | [Capture](lot1-heterogeneite-captures/48x24-homogene-t0.png) | [Capture](lot1-heterogeneite-captures/48x24-gradient-t0.png) |
| 48 × 24 | 10 mois | [Capture](lot1-heterogeneite-captures/48x24-homogene-t10.png) | [Capture](lot1-heterogeneite-captures/48x24-gradient-t10.png) |
| 48 × 24 | 20 mois | [Capture](lot1-heterogeneite-captures/48x24-homogene-t20.png) | [Capture](lot1-heterogeneite-captures/48x24-gradient-t20.png) |

## Reproduction

Campagne réalisée sous Windows avec Node.js 26.13.0 et le runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe` du lot 1.9, SHA-256 `A919DFDFB99B83242E42FB7C023D4AFCCC94C53B0E0DDC7B308F59D40EEF902B`.

Depuis `web`, définir `IRRITATOR_RUNNER` vers le runner Release. La suite HTTP historique utilise aussi `IRRITATOR_LEGACY_RUNNER` vers le runner des lots historiques. `IRRITATOR_HTTP_EVIDENCE` permet de choisir le répertoire des résultats HTTP.

```powershell
npm run build
node --test --test-concurrency=1 engine/runner/tests.mjs engine/runner/logistic-single-tests.mjs engine/runner/logistic-three-cells-tests.mjs engine/runner/logistic-nine-cells-tests.mjs engine/runner/logistic-variable-grid-tests.mjs engine/runner/logistic-constant-domain-tests.mjs engine/runner/logistic-lake-tests.mjs
node --test --test-concurrency=1 dist/apps/api/tests/integration.test.js
```

Démarrer Fastify depuis `web` et Next.js depuis `web/apps/frontend`, avec `IRRITATOR_API_URL` vers Fastify. Pour Playwright, définir `FRONTEND_URL` vers Next.js et `IRRITATOR_LAKE_GRADIENT_EVIDENCE` vers le dossier des captures.

```powershell
npm run build
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache
node node_modules/@playwright/test/cli.js test logistic-spatial.spec.ts --workers=1
```

## Vérifications exécutées

- Les builds Fastify et Next.js de production passent, avec contrôle TypeScript.
- Les 123 tests CLI du runner et de la campagne logistique passent. Le test historique des définitions QSS3 imbriquées a été rejoué dans une copie de travail pour écrire son fichier de résultats.
- Les 10 tests HTTP d’intégration et les 633 tests Vitest passent.
- Les 10 parcours Playwright logistiques passent sur Chrome 158. Le parcours du gradient contrôle les 41 lots natifs des six grilles, la comparaison à trois dates, le retour exact à α = 0 et la trace exportée. Le parcours du lot 1.9 couvre les cinq vues plein écran, la sélection et le cadrage. La vérification finale inclut l’avertissement et le curseur temporel dans la carte en plein écran avec le gradient actif.
