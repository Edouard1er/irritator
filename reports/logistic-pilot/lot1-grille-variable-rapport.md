# Lot 1.6 — Taille configurable de la grille logistique

## Expérience

Le sélecteur propose 2 × 2, 3 × 3 et 4 × 4 cellules. La grille 3 × 3 s’ouvre par défaut. Le générateur réplique les sept atomes et neuf connexions du fixture logistique monocellulaire, en préfixant chaque atome et chaque extrémité de connexion par l’identifiant `Crc`. Les lignes et colonnes sont numérotées à partir de zéro. Les cellules sont indépendantes et les observations `Crc-N` suivent l’ordre des lignes de la grille active. Le modèle 3 × 3 généré est égal au fixture des neuf cellules, y compris l’identifiant du modèle, l’ordre des atomes, les paramètres, les connexions et les observations.

Un changement de dimension conserve `N₀`, `r` et `K`, les brouillons et les comparaisons pour les cellules communes. Si la cellule sélectionnée sort de la grille, la sélection revient à C00. Les cellules qui entrent ou reviennent prennent leurs valeurs nominales. Le changement retire les résultats affichés, ramène le curseur à 0 et met la lecture en attente d’un nouveau calcul. La restauration des paramètres initiaux s’applique à la dimension active.

Les neuf cellules historiques gardent leurs paramètres de référence. Les sept autres reçoivent `r = 0,35 mois⁻¹`, `K = 300 t` et les biomasses initiales suivantes. Toutes les cellules gardent le quantum `dQ = 0,01 t`, l’horizon `[0, 20]` mois et le pas d’observation de `0,1` mois.

| Cellule | C03 | C13 | C23 | C30 | C31 | C32 | C33 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| N₀ (t) | 60 | 150 | 300 | 80 | 380 | 220 | 270 |

Les capacités nominales s’additionnent à 1 200 t, 2 700 t et 4 800 t respectivement. Chaque dimension représente un nombre différent de populations logistiques indépendantes sur une grille fictive.

## Validation et limites

Le contrat partagé valide la génération et le modèle reconstitué avant la soumission. Le client et l’API contrôlent aussi la requête. L’API applique les limites effectives du serveur avant de lancer le runner. Le modèle 4 × 4 requiert 112 atomes, 144 connexions, 16 observations et un budget de 3 232 points avec la marge du contrat. Les plafonds appliqués sont de 128 atomes, 512 connexions, 32 observations, 20 000 points et 100 000 appels à l’ordonnanceur. Le générateur refuse une grille 5 × 5 avec `LIMIT_EXCEEDED`, puisque ses 175 atomes dépassent le plafond. Des budgets plus stricts de taille, de connexions et d’échantillonnage sont refusés par le contrat. Avec un budget d’un appel, le runner renvoie `LIMIT_EXCEEDED` sans observations.

## Résultats natifs

Les trois grilles terminent à 20 mois avec le runner C++ DEVS/QSS3. Chaque point publié est comparé à `N(t) = K / [1 + (K/N₀ − 1) exp(−r·t)]` pour `N₀ > 0` et à `N(t) = 0` pour `N₀ = 0`. Tous satisfont la tolérance du lot 1.1, `|N_QSS3 − N_exact| ≤ 0,15 t + 0,002·|N_exact|`. Les équilibres C00 et C10 sur les trois grilles, ainsi que C23 sur la grille 4 × 4, publient chacun un seul point initial. L’interface prolonge ces valeurs constantes dans l’horizon déjà simulé.

Les séries communes aux différentes dimensions sont identiques point par point, avec leurs dates. La sortie native complète du modèle 3 × 3 est égale à celle du fixture historique. Modifier uniquement C33 en `N₀ = 100 t`, `r = 0,28 mois⁻¹`, `K = 260 t` change sa trajectoire et laisse les quinze autres séries identiques. Cette variante termine en 2 017 appels à l’ordonnanceur.

### Mesures nominales

Un lancement de chauffe par taille précède neuf lancements mesurés par taille. L’ordre des tailles tourne d’une répétition à l’autre. `performance.now()` encadre l’appel `spawnSync` avec la requête déjà sérialisée. Les temps incluent le démarrage du processus natif, le calcul, la sérialisation native et la capture des flux. Le JSON est décodé, validé et comparé à la sortie de chauffe après la mesure. Les intervalles de temps se recouvrent. La taille des observations est celle de leur tableau JSON en UTF-8. La taille de stdout comprend la réponse native entière.

| Grille | Cellules | Atomes | Connexions | Appels ordonnanceur | Points publiés | Observations (octets) | Stdout (octets) | Médiane (ms) | Min.–max. (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 × 2 | 4 | 28 | 36 | 569 | 404 | 21 437 | 21 745 | 327,48 | 314,42–420,86 |
| 3 × 3 | 9 | 63 | 81 | 1 777 | 1 409 | 74 609 | 74 958 | 311,37 | 296,60–350,08 |
| 4 × 4 | 16 | 112 | 144 | 1 777 | 2 616 | 138 500 | 138 904 | 323,01 | 306,02–395,42 |

L’erreur absolue maximale est de 0,070905467 t en 2 × 2 (C11, 16,1 mois) et de 0,277578995 t en 3 × 3 (C02, 5,8 mois) comme en 4 × 4 (C02 et C13, 5,8 mois).

Les sept cellules ajoutées en 4 × 4 reprennent chacune un triplet `N₀`, `r`, `K` déjà présent dans la grille 3 × 3. Elles partagent donc des instants d’ordonnancement avec les cellules historiques. Les deux grilles demandent autant d’appels à l’ordonnanceur dans ce scénario nominal, tandis que la réponse 4 × 4 contient davantage de séries et de points.

## Vérifications

Branche `anim-simu`, base `045fa02725001f22191a5a0e7b5f06ad32e2e069` (Lot 1.5), Node `v24.22.3`, runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe`, SHA-256 `A919DFDFB99B83242E42FB7C023D4AFCCC94C53B0E0DDC7B308F59D40EEF902B`.

- Frontend. Le contrôle TypeScript et les 607 tests Vitest sur 45 fichiers passent. Les nouveaux cas vérifient la structure, l’identité du 3 × 3, le redimensionnement, les brouillons, la restauration et les limites.
- Runner. Les 17 tests logistiques historiques, les 7 tests logistiques du lot 1.6 et les 91 tests CLI historiques passent.
- API. Les 91 tests passent en série. Les deux tests ajoutés exécutent les trois tailles via Fastify et le runner, puis vérifient le refus d’une grille qui dépasse les budgets de taille ou d’échantillonnage du serveur avant tout lancement natif. Une première exécution parallèle a rencontré quatre délais d’expiration sur les sous-processus simulés de `process.test.ts`. La relance en série a passé ces assertions avec les délais d’origine.

Depuis `web`, avec `IRRITATOR_RUNNER` pointant vers le binaire Release indiqué.

```powershell
npm run build
node --test engine/runner/logistic-single-tests.mjs engine/runner/logistic-three-cells-tests.mjs engine/runner/logistic-nine-cells-tests.mjs engine/runner/logistic-variable-grid-tests.mjs
node --test --test-concurrency=1 dist/apps/api/tests/backend.test.js dist/apps/api/tests/process.test.js dist/apps/api/tests/hierarchy.test.js dist/apps/api/tests/qss-catalog.test.js dist/apps/api/tests/integration.test.js dist/apps/api/tests/units.test.js
```

La compilation API a été vérifiée avec les mêmes sources et un `--outDir` temporaire, l’écriture dans le répertoire `web/dist` de cet environnement ayant été refusée. Les preuves HTTP et CLI ont été écrites dans des répertoires temporaires.

Depuis `web/apps/frontend`.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache
```

Pour Playwright, Fastify et Next.js ont été lancés séparément avec le vrai runner. Next.js a utilisé un miroir temporaire avec les sources modifiées vérifiées par SHA-256, l’écriture dans le `.next` du dépôt ayant été refusée. `FRONTEND_URL` pointe vers Next.js et `IRRITATOR_API_URL` configure son proxy vers Fastify. Le nouveau parcours exécute les grilles 3 → 4 → 2 → 3, compare les résultats HTTP à la CLI C++ et contrôle les identifiants, la réinitialisation temporelle, les courbes et les paramètres communs. Les sept parcours logistiques et huit parcours de régression adjacents passent.

```powershell
node node_modules/@playwright/test/cli.js test logistic-spatial.spec.ts logistic-parameters.spec.ts levels-territory.spec.ts native-briefing.spec.ts workshop-journey.spec.ts workshop.spec.ts --workers=1
node node_modules/@playwright/test/cli.js test editor.spec.ts --grep 'importe le fichier sum3' --workers=1
```

Les deux écarts du registre ont été reproduits. `workshop.spec.ts:29` attend 201 points dans la première trace à l’ouverture et en lit 0, alors que la réponse native contient les 201 points. `editor.spec.ts:33` ne voit pas le statut « Terminé » après l’import de `sum3`. Le runner termine avec les valeurs attendues 10, 110 et 1 110. Bilan Playwright de 15 réussites et deux écarts historiques. [Registre Playwright du lot 1.4](lot1-visualisation-rapport.md#attentes-historiques-du-niveau-1)
