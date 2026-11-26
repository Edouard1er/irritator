# Lot 2.2 — Réseau local de cellules humides couplées

Branche `anim-simu`, à partir de `cef0badfae6f2b659273f9aa7d57a786d9a29796`.

## Modèle et topologie

Le plan prend une liste de trois à six cellules et une liste d’arêtes. Le serveur contrôle l’existence des cellules humides, l’unicité des cellules et des arêtes non orientées, la connectivité et chaque frontière avec `lakeWetFrontier`. Le contact par un coin ou par un côté entièrement occupé par la rive ou par une île est exclu. Si la frontière comporte plusieurs portions humides, la flèche est ancrée sur la plus longue et clippée à la silhouette HydroLAKES.

Pour chaque arête orientée conventionnellement de i vers j, un composant `qss3_wsum_2` reçoit les deux états QSS3 et produit le flux signé

```text
Fᵢⱼ = μ [Aⱼ/(Aᵢ + Aⱼ)] Bᵢ − μ [Aᵢ/(Aᵢ + Aⱼ)] Bⱼ
     = μ [Aᵢ Aⱼ/(Aᵢ + Aⱼ)] (Bᵢ/Aᵢ − Bⱼ/Aⱼ)
```

Cette écriture borne les coefficients en valeur absolue par μ, y compris pour les petites surfaces. Le flux est exprimé en t/mois. Il entre avec le coefficient −1 dans la dérivée de i et +1 dans celle de j. Le générateur ajoute un étage de somme pondérée par flux incident, dans l’ordre des arêtes canoniques. La cellule centrale d’une chaîne reçoit donc bien ses deux flux. Chaque cellule conserve le bloc logistique QSS3, la surface humide normalisée, la capacité, la biomasse initiale et le quantum du palier 1. Le taux nominal vaut 0,35 mois⁻¹. Toutes les arêtes partagent le même μ expérimental, choisi parmi 0, 0,25 et 0,5 mois⁻¹. La longueur de frontière sert à valider et à placer les connexions, sans pondérer l’intensité d’échange.

## Exécution et budgets

A utilise les lots indépendants historiques. B place la composante entière dans un seul lot natif et retire ses membres des lots indépendants de B. Les lots qui ne contenaient aucun membre sont repris tels quels. Chaque scénario couvre 13 cellules sur 6 × 3 (A en un lot, B en deux) et 65 cellules sur 18 × 9 (A en quatre lots, B en cinq).

Pour n cellules et m arêtes, le lot réseau compte `7n + 3m` composants, `9n + 6m` connexions, n observations et `202n` points avec la marge du contrat. Ces quatre effectifs sont contrôlés à la préparation du plan. Le message de refus cite le budget concerné et les effectifs. Le contrat valide ensuite la requête complète. Le plafond d’exécution du runner reste de 100 000 appels à l’ordonnanceur par simulation.

| Lot | Composants | Connexions | Observations | Points estimés | Points renvoyés |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chaîne de trois cellules | 27 | 39 | 3 | 606 | 603 |
| Cycle de quatre cellules | 40 | 60 | 4 | 808 | 804 |
| Deux cycles sur six cellules | 63 | 96 | 6 | 1 212 | 1 206 |
| Lot indépendant de 18 cellules | 126 | 162 | 18 | 3 636 | 3 618 |
| Plafond par requête | 128 | 512 | 32 | 20 000 | 20 000 |

## Parcours cartographique

Dans **Expérience logistique spatiale**, ouvrir **Interactions spatiales**, choisir **Réseau local de cellules connectées** et ajouter une première cellule sur l’une des cartes. La carte surligne ensuite les voisines qui touchent le réseau par une frontière humide. Le sélecteur donne accès aux mêmes choix au clavier. Chaque nouvelle cellule ajoute automatiquement toutes ses frontières humides avec les membres déjà choisis. Les connexions redondantes peuvent être décochées. Le bouton de retrait enlève le dernier ajout et ses arêtes, puis réactive les connexions restantes si le retrait a coupé le réseau. La simulation est disponible à partir de trois cellules et la sélection s’arrête à six.

Le mois et le cadrage sont partagés entre A et B. Les flèches sur B changent de sens avec le signe du flux. La liste donne les extrémités et l’intensité de chaque arête. Le tableau compare les biomasses natives, les densités calculées sur les surfaces humides et les flux nets en t/mois. Un flux net positif correspond à un apport. Le graphique présente les trajectoires du réseau en pointillés pour A et en trait plein pour B, avec jusqu’à dix trajectoires supplémentaires communes aux deux scénarios. Le zoom, le plein écran, la lecture et les exports SVG/PNG réutilisent les résultats chargés. Le mode atelier reste accessible via **Silhouette du lac**.

## Vérification scientifique

À r = 0, chaque flux s’annule dans la somme des dérivées. En écrivant `bᵢ = Bᵢ/Aᵢ` et `b̄ = ΣBᵢ(0)/ΣAᵢ`, la dérivée de la dispersion pondérée `Σ Aᵢ(bᵢ − b̄)²/2` vaut `−Σ μ AᵢAⱼ/(Aᵢ+Aⱼ) (bᵢ − bⱼ)²`, où la somme porte sur les arêtes. Sur un réseau connecté à μ positif, l’annulation de cette dérivée impose l’égalité des densités et la conservation fixe leur valeur commune à b̄. Le test suit la dispersion aux 201 instants et compare les trajectoires à une intégration RK4 du système complet, au pas de 0,01 mois.

Pour le bilan local, la différence `Bᵢ(t) − Bᵢ(0)` est comparée à l’intégrale de la croissance plus le flux net, calculés aux dates natives. Les trapèzes au pas de 0,1 mois donnent le résidu à chaque date. Simpson, aux dates paires, fournit un second ordre de grandeur de l’erreur de quadrature. L’écart des états natifs à la référence RK4 mesure séparément l’écart de trajectoire QSS3. Les tests vérifient également la non-négativité, les instants d’observation, le signe opposé des deux usages d’un flux et la reproductibilité.

Les mesures couvrent six topologies sur 6 × 3 et 18 × 9. Les scénarios nominaux utilisent les trois valeurs de μ. Les contrôles sans croissance utilisent μ = 0,25 et 0,5 mois⁻¹. Les trajectoires hors réseau sont identiques point par point entre A et B. Le maximum des lots réseau est de 11 801 appels à l’ordonnanceur et le maximum tous lots confondus est de 28 361.

| Vérification | Maximum mesuré | Seuil du test |
| --- | ---: | ---: |
| Écart à A quand μ = 0 | 0,01697 t | 10⁻⁵ K par cellule |
| Dérive de masse quand r = 0 | 0,00481 t | 10⁻⁶ fois la masse initiale du réseau |
| Écart de densité à RK4 quand r = 0 | 0,000119 t/km² | 0,003 t/km² |
| Résidu local par trapèzes, échange actif | 0,39767 t | 10⁻⁴ K par cellule |
| Résidu local par trapèzes, μ = 0 | 1,49582 t | 5 × 10⁻⁴ K par cellule |
| Écart d’état QSS3 à RK4, échange actif | 0,00852 t | 3 × 10⁻⁵ K par cellule |

La dispersion quadratique pondérée, exprimée en racine carrée, tombe entre 0,006 % et 31,36 % de sa valeur initiale au mois 20 selon la topologie et μ. En échange actif, le maximum du résidu de Simpson est de 0,01154 t. À μ = 0, le cas le plus défavorable atteint 1,50779 t avec Simpson et présente un écart d’état à RK4 d’environ 1,37 t sur `C6_4`. Le scénario indépendant reproduit ce comportement à moins de 0,0033 t sur cette cellule. Le seuil de bilan à μ = 0 tient compte de cet écart d’observation du solveur. Le cas stationnaire historique r = μ = 0 n’émet que l’observation initiale. L’interface utilise r = 0,35 mois⁻¹.

## Démonstration

La démonstration sur 18 × 9 utilise la chaîne `C5_4–C5_3–C6_3`, le gradient sigmoïde aux centroïdes humides, α = 0,6 et μ = 0,5 mois⁻¹. Les densités initiales de `C5_3`, `C5_4` et `C6_3` sont respectivement d’environ 184,1, 182,8 et 117,2 t/km². `C5_3` est la cellule centrale. Le flux sur sa frontière avec `C5_4` s’inverse au premier dixième de mois observé, tandis que la connexion avec `C6_3` reste sortante.

| Mois | Flux C5_3 → C5_4 (t/mois) | Flux C5_3 → C6_3 (t/mois) | Flux net de C5_3 (t/mois) |
| ---: | ---: | ---: | ---: |
| 0 | +1,33551 | +45,13891 | −46,47442 |
| 5 | −5,56021 | +5,08654 | +0,47366 |
| 10 | −0,59003 | +0,49242 | +0,09761 |
| 20 | −0,00411 | +0,00338 | +0,00073 |

Au mois 5, la biomasse de `C6_3` vaut 810,50 t dans B et 751,33 t dans A. Les captures montrent la silhouette complète et le tableau des trois cellules pour les deux scénarios.

- [Mois 0](lot2-2-reseau-local-captures/18x9-sigmoide-06-mu-05-mois-0.png)
- [Mois 5](lot2-2-reseau-local-captures/18x9-sigmoide-06-mu-05-mois-5.png)
- [Mois 10](lot2-2-reseau-local-captures/18x9-sigmoide-06-mu-05-mois-10.png)
- [Mois 20](lot2-2-reseau-local-captures/18x9-sigmoide-06-mu-05-mois-20.png)

## Reproduction

Les mesures utilisent Node.js 26.13.0 sous Windows et le binaire Release `build-web-test8p-bis/Release/runner/irritator-runner.exe`. Son SHA-256 est `a919dfdfb99b83242e42fb7c023d4afccc94c53b0e0ddc7b308f59d40eef902b`. Le contour HydroLAKES versionné a le SHA-256 `9ac2101b3e02f8dd890dc9c9365f60e0febe265cceba058beed5835dbbcadbe6`.

La compilation TypeScript et le build de production Next.js ont réussi. Les 671 tests Vitest, les trois tests natifs du réseau et les 17 tests natifs historiques ont réussi. Les huit parcours Playwright Chrome couvrent les deux parcours réseau et six parcours de régression. Ils vérifient notamment que la lecture, le zoom partagé, le plein écran, la sélection de trajectoires et les exports ne déclenchent aucune simulation supplémentaire.

Depuis `web`, définir `IRRITATOR_RUNNER` sur le binaire compilé, puis exécuter les campagnes natives.

```powershell
npm run build
node --test engine/runner/logistic-lake-network-tests.mjs engine/runner/logistic-lake-exchange-tests.mjs engine/runner/logistic-lake-tests.mjs engine/runner/logistic-lake-continuum-tests.mjs
```

Démarrer Fastify avec `npm start` depuis `web` et Next.js avec `npm run dev` depuis `web/apps/frontend`. Depuis le dossier frontend, régler `FRONTEND_URL` si nécessaire et définir `IRRITATOR_LAKE_NETWORK_EVIDENCE` sur le dossier de sortie pour régénérer les captures.

```powershell
npm run typecheck
npm run build
npm run test
npm run test:e2e -- tests/e2e/logistic-lake-network.spec.ts tests/e2e/logistic-lake-interactions.spec.ts tests/e2e/logistic-lake-contrast.spec.ts tests/e2e/logistic-lake-workshop.spec.ts
```
