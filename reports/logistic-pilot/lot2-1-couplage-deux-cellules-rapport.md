# Lot 2.1 — Couplage de deux cellules humides du lac de Guiers

Branche `anim-simu`, à partir de `d52b783a94287724b4d07f8fe858d83c9a5a9327`.

## Modèle natif

Chaque cellule utilise le bloc logistique QSS3 du palier 1, avec sa biomasse initiale, sa capacité `K = 300 A`, son quantum et ses observations à pas de 0,1 mois. Le taux nominal est `r = 0,35 mois⁻¹`. Les surfaces humides normalisées sont celles du maillage HydroLAKES, pour une surface totale de 300 km².

La paire réutilise les quatorze composants logistiques et ajoute trois sommes pondérées `qss3_wsum_2`. La première reçoit les deux états QSS3 et calcule `F = μ [Aⱼ/(Aᵢ + Aⱼ)] Bᵢ − μ [Aᵢ/(Aᵢ + Aⱼ)] Bⱼ`. Cette écriture donne le flux demandé et garde les coefficients compris entre `−μ` et `μ`, y compris pour les petites surfaces. Les deux autres sommes calculent `Gᵢ − F` et `Gⱼ + F`, puis envoient ces dérivées aux intégrateurs correspondants. Les deux états évoluent dans la même simulation native.

Le flux est positif dans le sens de i vers j. Le facteur surfacique s’exprime en km², la différence de densité en t/km² et `μ` en mois⁻¹. Le produit est donc exprimé en t/mois. Les valeurs expérimentales proposées sont 0, 0,25 et 0,5 mois⁻¹. Aucune calibration physique de `μ` n’a été effectuée.

## Adjacence humide

Deux cellules retenues par le maillage historique sont candidates si leurs indices de grille diffèrent d’une unité sur un seul axe. On prend le côté commun dans les coordonnées projetées existantes, puis on le découpe aux intersections avec l’anneau extérieur et avec les anneaux d’îles. Les sommets situés sur le côté et les extrémités d’arêtes colinéaires font aussi partie des coupures.

Entre deux coupures, l’appartenance à l’eau est constante. Le milieu doit être strictement dans l’anneau extérieur, hors des îles et hors de toute arête de rive ou d’île colinéaire. Une paire est admise si au moins un intervalle ainsi classé dépasse `64 × Number.EPSILON × max(largeur, hauteur)` dans la projection normalisée. Ce seuil écarte les résidus numériques. Le contact par un sommet est exclu. Si une île découpe le côté commun, seules les portions ouvertes en eau sont retenues.

Le plan HTTP applique la règle à la paire demandée. La carte surligne les voisines admissibles pendant la sélection de B et ancre la flèche au milieu de la plus longue portion commune en eau. Le contour sert aussi à clipper la flèche. La grille 6 × 3 contient 13 cellules humides et 14 paires admissibles. La grille 18 × 9 en contient respectivement 65 et 90. Sur la grille 6 × 3, `C21` et `C31` sont humides et contiguës par leurs rectangles, avec un côté commun entièrement sec.

## Lots, observations et interface

La comparaison exécute A avec les lots indépendants historiques. Elle exécute B avec un lot dédié à la paire et retire ces deux cellules des lots indépendants de B. Les deux scénarios partagent les surfaces, la distribution, les paramètres biologiques et le calendrier. Le contrat vérifie les budgets statiques avant l’envoi du plan. Chaque réponse native est vérifiée avant l’agrégation par cellule et par instant.

| Lot | Composants | Connexions | Observations | Points estimés par le contrat | Points renvoyés |
| --- | ---: | ---: | ---: | ---: | ---: |
| Paire couplée | 17 | 24 | 2 | 404 | 402 |
| Lot indépendant de 18 cellules | 126 | 162 | 18 | 3 636 | 3 618 |
| Plafond par simulation | 128 | 512 | 32 | 20 000 | 20 000 |

Sur 6 × 3, A utilise un lot et B en utilise deux. Sur 18 × 9, A en utilise quatre et B cinq. Chaque scénario restitue 201 observations par cellule humide, soit 2 613 points sur 6 × 3 et 13 065 sur 18 × 9.

Dans **Expérience logistique spatiale**, sélectionner **Interactions spatiales**. Le mode s’ouvre en 6 × 3 et sans échange. Pour lancer la comparaison, choisir le maillage, la distribution, **Échange entre deux cellules voisines**, puis sélectionner A et B sur la carte et régler `μ`. Les sélecteurs A et B offrent le même choix au clavier. Les deux cartes partagent le cadrage et le mois, en mode normal et en plein écran.

Le flux affiché est reconstitué en t/mois à partir des deux biomasses natives au mois consulté. L’affichage ramène à zéro les écarts de densité de l’ordre de l’arrondi de la division `B/A`. Le tableau présente biomasse, densité, gain depuis le mois 0 et écart au scénario A. Le graphique affiche A en pointillés et B en trait plein pour la paire, plus une trajectoire commune pour chacune des dix cellules supplémentaires qu’il est possible d’ajouter. Les biomasses totales restent dans les indicateurs des cartes. L’export SVG ou PNG reprend le cadrage, les scénarios et le flux du mois courant. **Silhouette du lac** donne accès à l’expérience historique et à ses six grilles.

## Vérification scientifique

Sans croissance, l’addition des deux équations annule le flux. En divisant chaque équation par la surface correspondante puis en les soustrayant, on obtient `d(bᵢ − bⱼ)/dt = −μ(bᵢ − bⱼ)`. Le test compare les 201 observations natives à cette décroissance exponentielle pour deux paires de surfaces inégales, aux deux valeurs de `μ > 0`. Le test de flux initial nul impose des densités égales avec des biomasses distinctes.

Avec croissance, la vérification compare `Bᵢ(t) + Bⱼ(t) − Bᵢ(0) − Bⱼ(0)` à l’intégrale trapézoïdale de `Gᵢ + Gⱼ` sur les observations à pas de 0,1 mois. Les seuils incluent l’erreur d’observation QSS3 et, pour le bilan intégré, l’erreur de quadrature.

| Vérification | Tolérance maximale |
| --- | --- |
| Écart à la trajectoire du palier 1 à `μ = 0` | `10⁻⁵ K` par cellule |
| Conservation observée à `r = 0` | `10⁻⁶ (Bᵢ(0) + Bⱼ(0))` |
| Relaxation de la différence de densité à `r = 0` | `5 × 10⁻⁵ × abs(bᵢ(0) − bⱼ(0))` |
| Bilan intégré à `r = 0,35 mois⁻¹` | `3 × 10⁻⁴ (Kᵢ + Kⱼ)` |

Sur les deux paires de contrôle, l’écart maximal au palier 1 à `μ = 0` est de 0,0170 t. À `r = 0`, la dérive maximale de la somme est de 0,00259 t et l’écart maximal à la loi exponentielle de 0,000321 t/km². Le résidu maximal du bilan intégré est de 0,392 t avec échange actif et de 1,519 t avec `μ = 0`. La répétition des scénarios a donné les mêmes observations et les mêmes nombres d’appels à l’ordonnanceur.

La campagne vérifie également le caractère fini et positif ou nul des observations, les dates, la reproductibilité des réponses et le maintien des trajectoires des cellules hors de la paire. Les 104 paires admissibles ont été passées au runner avec le gradient sigmoïde à α = 0,6, `r = 0,35 mois⁻¹` et `μ = 0,5 mois⁻¹`. Le maximum des lots couplés est de 3 951 appels à l’ordonnanceur sur 6 × 3 et de 4 001 sur 18 × 9. Dans les scénarios complets de contrôle, le lot indépendant le plus coûteux a demandé 28 361 appels. Le plafond est de 100 000 appels par simulation.

Dans le cas de contrôle entièrement stationnaire `r = μ = 0`, le runner historique n’émet que l’observation initiale. Les expériences de l’interface utilisent `r = 0,35 mois⁻¹` et les tests de conservation utilisent `r = 0` avec un échange actif et des densités initiales distinctes.

## Démonstration

La paire `C11`–`C21` sur la grille 6 × 3 couvre respectivement 81,77028 et 29,68739 km². Les deux scénarios partent du même gradient sigmoïde aux centroïdes humides, à α = 0,6. Le scénario B utilise `μ = 0,5 mois⁻¹`. Au mois 5, le flux de `C11` vers `C21` vaut environ 38,587 t/mois. Vis-à-vis de A, l’échange réduit la biomasse de `C11` d’environ 753 t et augmente celle de `C21` d’environ 1 136 t. Comme la croissance locale dépend de la biomasse, ces écarts au scénario sans échange incluent aussi la réponse biologique.

| Mois | C11 sans échange (t) | C11 avec échange (t) | C21 sans échange (t) | C21 avec échange (t) | Flux de C11 vers C21 (t/mois) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 18 714,88 | 18 714,88 | 3 379,19 | 3 379,19 | 1 252,844 |
| 5 | 23 274,14 | 22 521,08 | 6 935,09 | 8 071,28 | 38,587 |
| 10 | 24 303,01 | 24 142,20 | 8 487,03 | 8 763,29 | 0,63824 |
| 20 | 24 524,13 | 24 519,12 | 8 892,95 | 8 901,87 | 0,000163 |

Les quatre captures réunissent A à gauche et B à droite. Playwright compare les valeurs et les couleurs B/K de chaque cellule aux réponses natives aux quatre mois. Il vérifie aussi la sélection, le calcul du flux, les gains et les densités, le zoom partagé, la lecture temporelle, le plein écran, le plafond des trajectoires et les deux formats d’export.

- [Mois 0](lot2-1-couplage-deux-cellules-captures/6x3-sigmoide-06-mu-05-mois-0.png)
- [Mois 5](lot2-1-couplage-deux-cellules-captures/6x3-sigmoide-06-mu-05-mois-5.png)
- [Mois 10](lot2-1-couplage-deux-cellules-captures/6x3-sigmoide-06-mu-05-mois-10.png)
- [Mois 20](lot2-1-couplage-deux-cellules-captures/6x3-sigmoide-06-mu-05-mois-20.png)

## Reproduction

Les mesures ont été prises sous Windows avec Node.js 26.13.0 et le runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe`. Son SHA-256 est `a919dfdfb99b83242e42fb7c023d4afccc94c53b0e0ddc7b308f59d40eef902b`. Le contour HydroLAKES versionné a le SHA-256 `9ac2101b3e02f8dd890dc9c9365f60e0febe265cceba058beed5835dbbcadbe6`.

La compilation TypeScript et le build de production Next.js ont réussi, ainsi que les 660 tests Vitest. La campagne native totalise cinq tests pour le lot 2.1 et douze pour le palier 1, dont les trajectoires des six grilles indépendantes. La campagne Playwright Chrome couvre trois parcours du lot 2.1 et trois parcours historiques de contraste et de mode atelier.

Depuis `web`, définir `IRRITATOR_RUNNER` vers le binaire compilé, puis exécuter les suites natives.

```powershell
npm run build
node --test engine/runner/logistic-lake-exchange-tests.mjs engine/runner/logistic-lake-tests.mjs engine/runner/logistic-lake-continuum-tests.mjs
```

Démarrer l’API Fastify depuis `web` avec `npm start` et Next.js depuis `web/apps/frontend` avec `npm run dev`. Depuis `web/apps/frontend`, ajuster `FRONTEND_URL` si nécessaire. Pour recréer les captures, définir `IRRITATOR_LAKE_EXCHANGE_EVIDENCE` sur le dossier voulu.

```powershell
npm run test
npm run test:e2e -- tests/e2e/logistic-lake-interactions.spec.ts
```
