# Lot 1.7 — Comparaison à domaine spatial constant

## Expérience

Dans **Expérience logistique spatiale**, le sélecteur **Mode de l’expérience** ouvre par défaut **Populations indépendantes**. Ce mode garde ses paramètres par cellule, ses brouillons, ses résultats et son curseur lors d’un aller-retour vers **Domaine constant**. Le modèle indépendant 3 × 3 reproduit toujours le fixture et sa sortie native.

Dans **Domaine constant**, **Simuler les trois grilles** envoie successivement les modèles 2 × 2, 3 × 3 et 4 × 4 au runner C++ DEVS/QSS3 via Fastify. Le sélecteur de dimension change la grille locale au même instant simulé. Le curseur pilote les biomasses des cellules, le total de la grille affichée et les repères temporels des trois courbes agrégées. La comparaison complète est publiée après les trois calculs. Si une grille échoue, l’interface indique laquelle et permet de relancer la comparaison.

Le frontend additionne les valeurs natives des cellules au même instant. Il associe les temps avec la tolérance d’arrondi du lecteur existant. Si une observation manque, le total présente une lacune à cet instant. Les cartes des cellules affichent jusqu’à deux décimales et les valeurs agrégées jusqu’à cinq. Les tests comparent les valeurs natives avant arrondi.

## Modèle et invariants

Le générateur réutilise les sept atomes et neuf connexions du modèle monocellulaire pour chaque cellule. Les connexions restent internes à chaque cellule. Pour une grille de côté `n`, la surface par cellule vaut `A = 9/n²`, la biomasse initiale `N₀ = 150 × A` et la capacité `K = 300 × A`. Le modèle fixe `r = 0,35 mois⁻¹` et `dQ = 0,01 t` pour toutes les cellules. Le runner publie les observations tous les 0,1 mois sur l’intervalle de 0 à 20 mois.

| Grille | Surface par cellule (km²) | N₀ par cellule (t) | K par cellule (t) | Somme des surfaces (km²) | Somme des N₀ (t) | Somme des K (t) |
|---|---:|---:|---:|---:|---:|---:|
| 2 × 2 | 2,25 | 337,5 | 675 | 9 | 1 350 | 2 700 |
| 3 × 3 | 1 | 150 | 300 | 9 | 1 350 | 2 700 |
| 4 × 4 | 0,5625 | 84,375 | 168,75 | 9 | 1 350 | 2 700 |

Les tests vérifient les sommes à partir des paramètres envoyés au moteur, y compris la capacité décodée du coefficient `−1/K`. Le modèle 4 × 4 compte 112 atomes, 144 connexions, 16 observations et 3 216 points publiés. Les trois modèles utilisent les limites existantes.

## Comparaison analytique et numérique

La solution d’une cellule est `N(t) = K / [1 + (K/N₀ − 1) exp(−r·t)]`. Le rapport `K/N₀` vaut 2 pour chaque cellule. La somme des solutions analytiques est donc `B(t) = 2700 / [1 + exp(−0,35·t)]` pour les trois grilles. À 20 mois, cette référence vaut 2 697,540162 t.

Les tests natifs vérifient chaque observation avec la tolérance locale du lot 1.1, `0,15 t + 0,002 × |N(t)|`. Pour une somme de `n²` observations, la borne est la somme des tolérances locales, soit `0,15 × n² t + 0,002 × |B(t)|`. Les erreurs de cellules identiques peuvent s’ajouter. Appliquer directement la tolérance d’une cellule au total aurait rejeté le résultat 4 × 4 à 0,4 mois, alors que ses 16 cellules satisfont la tolérance locale. Pour deux tailles, le test borne l’écart par la somme de leurs deux bornes et relève le maximum observé.

| Grille | Erreur locale absolue max. (t) | Mois | Erreur totale absolue max. (t) | Mois | Biomasse totale à 20 mois (t) |
|---|---:|---:|---:|---:|---:|
| 2 × 2 | 0,201898 | 0,2 | 0,807590 | 0,2 | 2 697,539472 |
| 3 × 3 | 0,277579 | 5,8 | 2,498211 | 5,8 | 2 697,499679 |
| 4 × 4 | 0,197090 | 0,4 | 3,153442 | 0,4 | 2 697,512764 |

| Grilles comparées | Écart absolu maximal des totaux (t) | Mois |
|---|---:|---:|
| 2 × 2 et 3 × 3 | 2,456774 | 5,8 |
| 2 × 2 et 4 × 4 | 3,162467 | 0,4 |
| 3 × 3 et 4 × 4 | 3,155256 | 0,4 |

Le quantum absolu reste égal à 0,01 t dans chaque cellule. Son poids relatif augmente lorsque la surface et les biomasses par cellule diminuent. Les trois grilles partagent une solution analytique et leurs trajectoires QSS3 présentent les écarts mesurés ci-dessus.

## Performances et taille des sorties

Un lancement de chauffe par taille précède neuf lancements mesurés par taille, avec rotation de l’ordre. Le chronomètre encadre `spawnSync` après sérialisation de la requête. Il couvre le lancement du processus natif, le calcul, la sérialisation du runner et la capture des flux. Le décodage et la validation côté Node ont lieu après la mesure. Les tailles sont exprimées en octets UTF-8. La colonne « Observations » compte le tableau JSON des observations et la colonne « Stdout » la réponse native entière.

| Grille | Appels à l’ordonnanceur | Points | Observations (octets) | Stdout (octets) | Médiane (ms) | Min.–max. (ms) |
|---|---:|---:|---:|---:|---:|---:|
| 2 × 2 | 329 | 804 | 42 205 | 42 522 | 310,37 | 299,93–358,47 |
| 3 × 3 | 225 | 1 809 | 95 725 | 96 090 | 307,87 | 297,98–333,22 |
| 4 × 4 | 217 | 3 216 | 171 217 | 171 606 | 323,95 | 303,11–358,71 |

Chaque cellule publie 201 points. Les cellules identiques d’une grille partagent les instants d’ordonnancement. Le nombre de points et la taille des sorties augmentent avec le nombre de cellules, et les plages de temps mesurées se recouvrent.

## Vérifications

Branche `anim-simu`, base `28c7e11f8278c73ee8674cb5a3f16a6af4d0c0b2`, Node `v24.22.3`, runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe`, SHA-256 `A919DFDFB99B83242E42FB7C023D4AFCCC94C53B0E0DDC7B308F59D40EEF902B`.

- CLI. Les 119 tests passent, dont 24 tests logistiques des lots précédents, 91 tests généraux et 4 tests du lot 1.7.
- API. Les 92 tests sélectionnés passent en série. Le nouveau test vérifie la réception de toutes les observations des trois grilles via Fastify et le runner natif.
- Frontend. Le contrôle TypeScript et les 610 tests Vitest sur 45 fichiers passent. Les nouveaux cas couvrent l’agrégation d’observations, les lacunes, la reprise après une erreur partielle et la conservation du mode indépendant.
- Navigateur. Le parcours du domaine constant compare chaque réponse HTTP à la CLI C++, puis les trois séries Plotly aux sommes de leurs 201 échantillons. Il contrôle les valeurs locales et agrégées à 10 et 20 mois, la position du curseur pendant les changements de dimension et la conservation des résultats pendant un changement de mode.

Depuis `web`, avec `IRRITATOR_RUNNER` pointant vers le binaire Release indiqué.

```powershell
npm run build
node --test --test-concurrency=1 engine/runner/tests.mjs engine/runner/logistic-single-tests.mjs engine/runner/logistic-three-cells-tests.mjs engine/runner/logistic-nine-cells-tests.mjs engine/runner/logistic-variable-grid-tests.mjs engine/runner/logistic-constant-domain-tests.mjs
node --test --test-concurrency=1 dist/apps/api/tests/backend.test.js dist/apps/api/tests/process.test.js dist/apps/api/tests/hierarchy.test.js dist/apps/api/tests/qss-catalog.test.js dist/apps/api/tests/integration.test.js dist/apps/api/tests/units.test.js
$env:IRRITATOR_LOGISTIC_BENCHMARK = '1'
node --test engine/runner/logistic-constant-domain-tests.mjs
```

Depuis `web/apps/frontend`, avec Fastify et Next.js démarrés séparément. `FRONTEND_URL` pointe vers Next.js et `IRRITATOR_API_URL` configure son proxy vers Fastify.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache
node node_modules/@playwright/test/cli.js test logistic-spatial.spec.ts logistic-parameters.spec.ts levels-territory.spec.ts native-briefing.spec.ts workshop-journey.spec.ts workshop.spec.ts --workers=1
node node_modules/@playwright/test/cli.js test editor.spec.ts --grep 'importe le fichier sum3' --workers=1
```

Dans cet environnement, les répertoires de sortie existants `web/dist` et `.next` ont été contournés avec un miroir temporaire. Les sources modifiées utilisées pour la compilation API et les tests navigateur ont été vérifiées par SHA-256.

## Registre Playwright

Bilan de la série finale sous Chrome avec le runner natif. Les huit parcours logistiques et les huit autres parcours de régression réussissent. Les deux anomalies historiques ci-dessous se reproduisent.

| Test | Écart préexistant | Vérification du lot 1.7 |
|---|---|---|
| `workshop.spec.ts:29` | La première trace Plotly contient 0 point à l’ouverture alors que le test en attend 201. | Écart reproduit. La réponse native contient les 201 points. |
| `editor.spec.ts:33` | Le test ne voit pas le statut « Terminé » après l’import de `sum3`. | Écart reproduit. La réponse native indique `completed` et contient 10, 110 et 1 110. |

[Registre repris du lot 1.6](lot1-grille-variable-rapport.md#vérifications)
