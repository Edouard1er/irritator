# Lot 1.14 — Gradient spatial contrasté du lac de Guiers

Branche `anim-simu`, base `31ce9d4fe6579bcd04fc143281553a76b9a94d8a`.

Sur **Niveau 2 — Lac de Guiers → Expérience logistique spatiale → Silhouette du lac**, sélectionner une distribution avec gradient, puis le profil **Sigmoïde contrastée**. Le curseur règle l’intensité proposée de 0 à 0,6. Dans le formulaire, le profil et l’intensité de la simulation affichée restent visibles jusqu’à l’application du réglage proposé. **Appliquer et simuler** lance le calcul. Le **Mode atelier** propose les sigmoïdes à 0,3 et 0,6 ainsi qu’une comparaison synchronisée avec la distribution homogène.

Les distributions de biomasse sont **synthétiques et non calibrées**. Le contour HydroLAKES fournit la géométrie des cellules humides. Les 300 km² normalisés, les 45 000 t initiales et la capacité totale de 90 000 t sont des paramètres du modèle. Les cellules suivent des trajectoires logistiques indépendantes, avec `r = 0,35 mois⁻¹`.

## Construction et reproductibilité

La fraction humide `fᵢ` donne `Aᵢ = 300 fᵢ / Σ fⱼ` et `Kᵢ = 300 Aᵢ`. La position `yᵢ` croît du nord au sud. Le mode **Gradient nord-sud** emploie les milieux des lignes. Le mode **Gradient pondéré par surface humide** emploie les centroïdes humides. Avec `sigmoid-v2`, les expressions suivantes donnent la biomasse initiale pour `α > 0`.

```text
ε = 0,01
s = 12 × (α / 0,6)²
B₀ᵢ = Kᵢ × [ε + (1 − 2ε) / (1 + exp(−(c + s × (0,5 − yᵢ))))]
```

Une dichotomie de 60 itérations sur `[-1 − s/2, 1 + s/2]` cherche `c` tel que `Σ B₀ᵢ = 45 000 t`. Les deux bornes placent toutes les cellules respectivement sous et au-dessus de 50 % de capacité. La somme est pondérée par `Kᵢ`, donc par l’aire humide. Tous les rapports proviennent de la même fonction monotone. À `α = 0`, le calcul reprend exactement `B₀ᵢ = 150 Aᵢ`.

Le profil `linear-v1` conserve les paramètres cellulaires des lots 1.10 à 1.12. Une requête historique sans `profile` conserve aussi ses identifiants natifs. Les identifiants des requêtes qui indiquent un profil portent sa version. Les clés des scénarios, les traces JSON et les exports SVG et PNG distinguent les profils. Le SVG contient les attributs `data-distribution`, `data-profile` et `data-alpha` et affiche la version dans la carte, y compris lors de la conversion en PNG.

## Contraste initial mesuré

Les deux dernières colonnes totalisent les surfaces biologiques des cellules dans chaque classe, en km². Les résultats ci-dessous utilisent les centroïdes humides.

| Grille | Cellules humides | B/K à α = 0,3 | B/K à α = 0,6 | B/K < 20 %, α = 0,6 | B/K > 80 %, α = 0,6 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6 × 3 | 13 | 16,80–70,96 % | 1,08–95,12 % | 82,83 | 67,59 |
| 12 × 6 | 35 | 15,77–72,60 % | 1,06–96,23 % | 85,76 | 114,76 |
| 18 × 9 | 65 | 15,33–73,58 % | 1,05–96,74 % | 97,77 | 100,55 |
| 24 × 12 | 101 | 14,81–73,93 % | 1,05–96,90 % | 93,62 | 93,33 |
| 36 × 18 | 184 | 14,62–74,34 % | 1,04–97,07 % | 92,13 | 100,55 |
| 48 × 24 | 296 | 14,49–74,57 % | 1,04–97,17 % | 93,43 | 104,19 |

Sur 18 × 9 à `α = 0,6`, 66,1 % de la surface humide se trouvent dans ces deux classes extrêmes. Les paramètres du scénario homogène fixent B/K à 50 % dans chaque cellule au mois 0. Les deux cartes utilisent la palette commune et l’échelle fixe 0 % – 50 % – 100 % en mode **Biomasse / capacité**. Chaque en-tête de carte indique l’intervalle initial de B/K.

## Contrôles natifs et analytiques

Les six grilles conservent les sommes d’aire, de biomasse initiale et de capacité à la précision de la virgule flottante. Les tests vérifient les deux positions d’échantillonnage, la monotonie, la reproductibilité, la positivité, les rapports strictement inférieurs à la capacité, ainsi que le traitement d’un fragment humide au plancher du quantum. La campagne native couvre, sur chaque grille, les centroïdes à `α = 0`, `0,3` et `0,6` et les milieux de lignes à `α = 0,6`.

Les 24 simulations ont produit **201 observations natives par cellule** entre les mois 0 et 20 au pas de 0,1 mois, soit jusqu’à **59 496 points** par simulation. Le maximum mesuré est **28 761 appels** à l’ordonnanceur par lot pour un plafond de 100 000. Le quantum du modèle est `dQᵢ = 3 × 10⁻⁷ Kᵢ`, borné au minimum de `10⁻⁹ t` et au maximum du catalogue. Sur 48 × 24, le fragment humide au plancher conserve sa série complète.

La référence utilisée pour QSS3 est la solution exacte de chaque cellule avec sa propre biomasse initiale, `Bᵢ(t) = Kᵢ / [1 + (Kᵢ/B₀ᵢ − 1) exp(−r t)]`. L’erreur relative maximale mesurée sur la campagne est de **0,234 %** localement et **0,00283 %** sur le total. Ces mesures comparent les observations natives à leur solution discrète. La référence spatiale continue affine du lot 1.12 reste réservée à son champ linéaire. La validation du lot 1.14 porte sur les champs discrets calculés sur les six grilles.

Sur 18 × 9, les biomasses natives aux mois 0, 10 et 20 sont les suivantes.

| Scénario | Mois 0 (t) | Mois 10 (t) | Mois 20 (t) |
| --- | ---: | ---: | ---: |
| Homogène | 45 000,00 | 87 361,87 | 89 918,01 |
| Sigmoïde, α = 0,3 | 45 000,00 | 86 382,04 | 89 882,31 |
| Sigmoïde, α = 0,6 | 45 000,00 | 74 471,43 | 88 762,06 |

## Captures du navigateur

Les neuf captures Playwright montrent les cartes natives sur la grille 18 × 9, au même cadrage et avec l’échelle fixe de B/K. Le mois est affiché dans les commandes plein écran.

| Scénario | Mois 0 | Mois 10 | Mois 20 |
| --- | --- | --- | --- |
| Homogène | [Capture](lot1-gradient-contraste-captures/18x9-homogene-mois-0.png) | [Capture](lot1-gradient-contraste-captures/18x9-homogene-mois-10.png) | [Capture](lot1-gradient-contraste-captures/18x9-homogene-mois-20.png) |
| Sigmoïde, α = 0,3 | [Capture](lot1-gradient-contraste-captures/18x9-sigmoide-03-mois-0.png) | [Capture](lot1-gradient-contraste-captures/18x9-sigmoide-03-mois-10.png) | [Capture](lot1-gradient-contraste-captures/18x9-sigmoide-03-mois-20.png) |
| Sigmoïde, α = 0,6 | [Capture](lot1-gradient-contraste-captures/18x9-sigmoide-06-mois-0.png) | [Capture](lot1-gradient-contraste-captures/18x9-sigmoide-06-mois-10.png) | [Capture](lot1-gradient-contraste-captures/18x9-sigmoide-06-mois-20.png) |

Le parcours compare les couleurs calculées à partir des données natives aux mois 0, 10 et 20, puis vérifie les valeurs et le mois des deux cartes synchronisées. Il vérifie aussi le changement de palette, le zoom partagé, le plein écran, l’export de la carte comparée et la limite de dix courbes supplémentaires en plus de la cellule consultée.

## Reproduction

Le build de production Next.js, le contrôle TypeScript, les 660 tests Vitest, les 12 tests des deux suites natives et les 15 parcours Playwright Chrome passent.

Campagne sous Windows avec Node.js 26.13.0, le runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe` (SHA-256 `a919dfdfb99b83242e42fb7c023d4afccc94c53b0e0ddc7b308f59d40eef902b`) et le contour HydroLAKES du dépôt (SHA-256 `9ac2101b3e02f8dd890dc9c9365f60e0febe265cceba058beed5835dbbcadbe6`). Depuis `web`, définir `IRRITATOR_RUNNER` vers ce binaire puis exécuter la suite native.

```powershell
npm run build
node --test --test-concurrency=1 engine/runner/logistic-lake-tests.mjs engine/runner/logistic-lake-continuum-tests.mjs
```

Pour le navigateur, démarrer Fastify et Next.js avec `IRRITATOR_API_URL` pointant vers Fastify. Depuis `web/apps/frontend`, définir `FRONTEND_URL` vers l’instance Next.js si elle utilise un port différent de 3000 et `IRRITATOR_LAKE_CONTRAST_EVIDENCE` vers le dossier de captures.

```powershell
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache
node node_modules/@playwright/test/cli.js test logistic-lake-contrast.spec.ts logistic-lake-exploration.spec.ts logistic-lake-workshop.spec.ts logistic-spatial.spec.ts --workers=1
```
