# Lot 1.12 — Référence spatiale continue du lac de Guiers

Le lot part de `b98a1bbc63bd1d0c4defded525d26a6eace75e49` sur `anim-simu`. L’expérience conserve 300 km², une biomasse initiale de 45 000 t, une capacité de 90 000 t et un taux de croissance de 0,35 mois⁻¹. Les comparaisons portent sur les 201 dates de 0 à 20 mois, au pas de 0,1 mois. La référence continue est calculée à partir du contour seul. Le maillage le plus fin a donc lui aussi une erreur spatiale mesurable. [Contour HydroLAKES](../../web/apps/frontend/data/geography/lac-de-guiers.hydrolakes.geojson) · [Module de référence](../../web/examples/logistic-lake-continuum.ts) · [Mesures JSON](lot1-reference-continue-mesures.json)

## Géométrie et normalisation

La projection locale est affine. La coordonnée `y` est la distance au nord de l’emprise en unités d’étendue latitudinale. Elle croît de 0 au nord à 1 au sud. L’écart de longitude à l’ouest de l’emprise est multiplié par le cosinus de la latitude médiane et divisé par la même étendue latitudinale.

Les latitudes distinctes des sommets délimitent 1 434 bandes. À l’intérieur d’une bande, la section horizontale croise le même ensemble d’arêtes et l’ordre des intersections reste fixe. Les intervalles entre intersections successives sont alternativement humides et secs. Cette règle conserve les fragments disjoints de la section et exclut les 13 anneaux intérieurs du contour, quel que soit leur sens de parcours. Les arêtes horizontales sont prises en compte par les limites des bandes. Entre deux limites, la largeur humide `W(y)` est affine.

L’intégration des polynômes `W(y)` et `y W(y)` par bande donne l’aire projetée `A = 0,05971193176704592` et le moment nord-sud `M = 0,023188497916177723` en unités de projection. La moyenne de `y` sur l’eau vaut `M/A = 0,3883394361891184`. Les écarts aux intégrales de contour par déterminants sont de `2,01 × 10⁻¹⁶` pour `A` et `1,73 × 10⁻¹⁶` pour `M`, pour un seuil de test de `10⁻¹²` en unités de projection. Le module continu calcule la largeur sans appeler le découpage ou les centroïdes des cellules. [Tests numériques](../../web/engine/runner/logistic-lake-continuum-tests.mjs)

La mesure d’aire expérimentale sur les sections est `dS = 300 W(y) dy / A` en km². La normalisation spatiale et la densité initiale s’obtiennent par intégration du champ affine.

```text
gα(y) = 1 + α (0,5 − y)
Zα = ∫ gα(y) W(y) dy / A = 1 + α (0,5 − M/A)
b₀(y) = 150 gα(y) / Zα                 en t/km²
x₀(y) = b₀(y) / 300
q(t) = exp(−0,35 t)
Fₜ(x) = x / [q(t) + (1 − q(t)) x]
Bcontinu(t) = (90 000 / A) ∫ W(y) Fₜ(x₀(y)) dy
```

La normalisation donne `∫ b₀ dS = 45 000 t`. Numériquement, l’écart à cette masse est inférieur à `8 × 10⁻¹¹ t` pour les trois intensités. À α = 0, `x₀ = 0,5` partout et la solution agrégée vaut `90 000 / (1 + q(t))`. Le test compare cette solution aux 201 valeurs intégrées. Pour les trois intensités, `x₀ > 0` et `Fₜ(x₀) → 1` lorsque `t → ∞`. Le calcul vérifie l’approche de 90 000 t à 100 mois et la limite avec `q = 0`.

## Stabilisation de la quadrature

La trajectoire se calcule par Gauss–Legendre à deux points par panneau, en subdivisant chaque bande en panneaux égaux et en doublant leur nombre à chaque étape. Un pas de raffinement est accepté si la variation absolue maximale sur les 201 dates est inférieure ou égale à la tolérance. L’arrêt exige deux pas acceptés consécutifs. La campagne teste `10⁻⁸ t` et retient les valeurs issues du contrôle à `10⁻¹⁰ t`. Le plafond est de 1 024 panneaux par bande. Son dépassement déclenche une erreur explicite.

| α | 1 → 2 panneaux (t) | 2 → 4 (t) | 4 → 8 (t) | 8 → 16 (t) | Panneaux retenus par bande | Écart maximal entre les deux tolérances (t) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 1,46 × 10⁻¹¹ | 1,46 × 10⁻¹¹ | — | — | 4 | 0 |
| 0,3 | 7,28 × 10⁻¹⁰ | 5,82 × 10⁻¹¹ | 1,46 × 10⁻¹¹ | — | 8 | 1,46 × 10⁻¹¹ |
| 0,6 | 9,97 × 10⁻⁹ | 6,26 × 10⁻¹⁰ | 4,37 × 10⁻¹¹ | 1,46 × 10⁻¹¹ | 16 | 4,37 × 10⁻¹¹ |

La trajectoire obtenue à `10⁻⁸ t` s’arrête à quatre panneaux par bande pour chaque intensité. Un test sur un rectangle compare également l’intégrale hétérogène à sa primitive logarithmique. Dans ce test, le passage d’un à deux panneaux modifie la biomasse de plus de 4 t et la vérification exige des raffinements supplémentaires.

| α | `Zα` | Continu à 0 mois (t) | Continu à 10 mois (t) | Continu à 20 mois (t) |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 1 | 45 000,000000 | 87 361,899232 | 89 918,005393 |
| 0,3 | 1,033498169143 | 45 000,000000 | 87 331,443675 | 89 916,967357 |
| 0,6 | 1,066996338287 | 45 000,000000 | 87 237,141736 | 89 913,717660 |

## Comparaison des six maillages

Pour chaque distribution, `Bgrille(t)` est la somme des solutions logistiques analytiques de toutes les cellules humides, avec les biomasses et capacités produites par le générateur historique. L’écart spatial signé est `Bgrille(t) − Bcontinu(t)`. Le maximum absolu `E` porte sur les 201 dates. Le rapport `Eprécédent/E` compare deux grilles successives d’une même distribution à la même référence continue. Un rapport inférieur à 1 indique une augmentation du maximum. Les facteurs de raffinement changent d’une paire de grilles à l’autre.

L’erreur QSS3 agrégée est `Bnative(t) − Bgrille(t)`. Son maximum absolu est calculé séparément avec le quantum proportionnel historique `3 × 10⁻⁷ Kᵢ`, borné par le catalogue. Les maxima relatifs spatiaux utilisent le total continu au même instant comme dénominateur. Les maxima relatifs QSS3 utilisent la solution analytique correspondante, locale ou agrégée. Le JSON donne aussi les maxima QSS3 locaux, les dates des maxima spatiaux et les écarts spatiaux signés à 0, 10 et 20 mois. [Campagne de mesure](../../web/engine/runner/logistic-lake-continuum-measure.mjs) · [Mesures JSON](lot1-reference-continue-mesures.json)

À temps positif, la dérivée seconde de `Fₜ` vaut `−2q(1 − q) / [q + (1 − q)x]³` et est strictement négative. L’inégalité de Jensen donne un total hétérogène strictement inférieur au total homogène dans le continu et sur chacune des six grilles. Elle s’applique aussi à l’intérieur de chaque cellule pour le gradient au centroïde humide. Comme le champ initial est affine, le centroïde fournit la moyenne humide exacte en arithmétique réelle, et la solution de cette moyenne majore la moyenne des solutions locales. Les tests retrouvent cette borne sur les 200 dates positives. La latitude du milieu de ligne peut s’écarter de celle du centroïde humide, notamment au bord du lac. La normalisation du gradient historique est propre à chaque grille et son écart au continu peut avoir les deux signes.

### α = 0

Les deux gradients désactivés produisent exactement les mêmes requêtes et solutions analytiques que la distribution homogène sur les six grilles. La somme analytique discrète et l’intégrale continue coïncident en arithmétique réelle. Les différences mesurées relèvent de l’arrondi, ce qui rend leur rapport sans portée pour la convergence spatiale.

| Grille | Max spatial (t) | Max QSS3 local (t) | Max QSS3 total (t) |
| --- | ---: | ---: | ---: |
| 6 × 3 | 1,16 × 10⁻¹⁰ | 0,01886 | 0,06919 |
| 12 × 6 | 1,46 × 10⁻¹⁰ | 0,00701 | 0,06919 |
| 18 × 9 | 1,60 × 10⁻¹⁰ | 0,00322 | 0,06919 |
| 24 × 12 | 1,02 × 10⁻¹⁰ | 0,00181 | 0,06919 |
| 36 × 18 | 1,89 × 10⁻¹⁰ | 0,00081 | 0,06919 |
| 48 × 24 | 2,18 × 10⁻¹⁰ | 0,00045 | 0,06919 |

### α = 0,3

| Grille | Max spatial, milieu (t) | Rapport | Max spatial, centroïde (t) | Rapport | Max QSS3 total, milieu (t) | Max QSS3 total, centroïde (t) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 × 3 | 1,88954 | — | 2,47028 | — | 0,09007 | 0,16289 |
| 12 × 6 | 0,57804 | 3,269 | 0,68441 | 3,609 | 0,09305 | 0,55083 |
| 18 × 9 | 0,09565 | 6,043 | 0,31980 | 2,140 | 0,07634 | 0,21952 |
| 24 × 12 | 0,11565 | 0,827 | 0,17962 | 1,780 | 0,04998 | 0,11676 |
| 36 × 18 | 0,04130 | 2,800 | 0,08070 | 2,226 | 0,33316 | 0,20927 |
| 48 × 24 | 0,08984 | 0,460 | 0,04684 | 1,723 | 1,80316 | 1,20616 |

À 48 × 24, l’erreur QSS3 agrégée du gradient au centroïde vaut 1,20616 t, contre 0,04684 t d’erreur spatiale. Le maximum spatial de ce gradient survient à 3,8 mois sur les six maillages.

### α = 0,6

| Grille | Max spatial, milieu (t) | Rapport | Max spatial, centroïde (t) | Rapport | Max QSS3 total, milieu (t) | Max QSS3 total, centroïde (t) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 × 3 | 7,97946 | — | 9,58204 | — | 0,08484 | 0,06694 |
| 12 × 6 | 2,47477 | 3,224 | 2,63037 | 3,643 | 0,08041 | 0,08001 |
| 18 × 9 | 0,50696 | 4,882 | 1,22850 | 2,141 | 0,18256 | 0,36549 |
| 24 × 12 | 0,67525 | 0,751 | 0,68794 | 1,786 | 0,54587 | 0,34053 |
| 36 × 18 | 0,15902 | 4,246 | 0,30887 | 2,227 | 0,36046 | 0,34405 |
| 48 × 24 | 0,35135 | 0,453 | 0,18005 | 1,715 | 0,09899 | 0,12424 |

Le maximum spatial du gradient au centroïde survient à 3,9 mois sur les six maillages. Aux deux intensités positives, il décroît à chaque raffinement observé. Pour le milieu de ligne, il augmente de 18 × 9 à 24 × 12, puis de 36 × 18 à 48 × 24. Le déplacement du point représentatif des cellules riveraines et la normalisation du gradient de ligne peuvent compenser en partie l’effet de l’agrégation logistique. Les rapports mesurés sur cette seule suite de grilles ne suffisent pas à établir un ordre de convergence.

## Limites

- La projection équirectangulaire locale sert à pondérer l’eau dans l’emprise. Elle fige le facteur longitudinal à la latitude médiane. Le calcul suppose un polygone valide dont les arêtes sont des segments dans le plan projeté. Les 300 km² sont une convention expérimentale et les détails de la rive ou des îles sont ceux du contour HydroLAKES local. Une erreur du contour ou une variation saisonnière de la surface humide affecterait les poids.
- L’accord entre raffinements mesure la stabilité observée en double précision sur les 201 dates. Une borne certifiée de l’erreur de quadrature demanderait une estimation indépendante. L’aire et le premier moment sont intégrés par bande en arithmétique flottante. Aux différences les plus faibles, l’arrondi se manifeste jusque dans le cas homogène.
- La capacité surfacique et le taux de croissance sont constants, et le champ initial nord-sud est synthétique. Les trajectoires isolent l’effet du maillage dans un modèle où les solutions locales évoluent indépendamment. Les paramètres sont ceux d’une expérience numérique fictive.

## Reproduction et vérifications

Depuis `web`, compiler les exemples et les contrats puis lancer les tests et la campagne. La commande de mesure réutilise le runner natif pour les seules erreurs QSS3. Le JSON exclut les horodatages et les durées. Les empreintes SHA-256 du contour et du runner sont enregistrées dans le fichier. La campagne publiée utilise Node.js 26.13.0 et le runner Release Windows déjà utilisé pour le lot 1.11. [Rapport du lot 1.11](lot1-convergence-spatiale-rapport.md)

```powershell
npm run build
node --test engine/runner/logistic-lake-continuum-tests.mjs
$env:IRRITATOR_RUNNER = (Resolve-Path ../build-web-test8p-bis/Release/runner/irritator-runner.exe).Path
node engine/runner/logistic-lake-continuum-measure.mjs ../reports/logistic-pilot/lot1-reference-continue-mesures.json
```

Les six tests du lot passent sous Node.js 24.22.3 et 26.13.0. Le contrôle de non-régression couvre 124 tests CLI, 10 tests d’intégration HTTP, 642 tests Vitest et 14 parcours logistiques Playwright sur Chrome. Les JSON des campagnes 1.11 et 1.12 ont été reproduits à l’octet près, sur le même environnement et avec le même runner. Les builds TypeScript et Next.js ont été exécutés dans un répertoire de vérification isolé.
