# Lot 2.3 — Réseau complet du lac de Guiers sur la grille 6 × 3

Branche `anim-simu`, à partir de `3d2fa9f411135c04e3f9e00e7f5f8efc21f53bbc`.

## Modèle natif

Le scénario A utilise le générateur logistique historique du palier 1. Le scénario B place les 13 cellules et leurs 14 frontières humides dans une même requête DEVS/QSS3. Les deux scénarios utilisent 300 km² de surface biologique, 45 000 t de biomasse initiale, 90 000 t de capacité totale, un taux nominal de 0,35 mois⁻¹ et le même quantum par cellule. Les distributions homogène, linéaire historique et sigmoïde contrastée sont disponibles. Les observations sont demandées de 0 à 20 mois par pas de 0,1 mois.

Le bloc compact relie directement `rB` à la somme pondérée. Il calcule `rB²` en multipliant `rB` par `B`, puis applique les poids `1` et `−1/K`. La croissance reste donc exactement `rB − rB²/K = rB(1 − B/K)`. Le bloc comporte un intégrateur QSS3, une constante, deux multiplicateurs QSS3 et une somme pondérée QSS3.

Le générateur énumère les côtés communs avec `lakeWetFrontier`. Un contact ponctuel ou un côté entièrement sec ne crée pas d’arête. Les intervalles humides d’un côté morcelé sont conservés. La topologie actuelle forme une composante connexe. Le test avec une île occupant tout un côté commun vérifie le cas de deux composantes séparées.

Pour chaque arête orientée par identifiant de i vers j, la somme pondérée native calcule

```text
Fᵢⱼ = μ [Aⱼ/(Aᵢ + Aⱼ)] Bᵢ − μ [Aᵢ/(Aᵢ + Aⱼ)] Bⱼ
     = μ [Aᵢ Aⱼ/(Aᵢ + Aⱼ)] (Bᵢ/Aᵢ − Bⱼ/Aⱼ)
dBᵢ/dt = rᵢ Bᵢ(1 − Bᵢ/Kᵢ) − Σⱼ Fᵢⱼ
```

La même sortie native alimente les deux dérivées avec des signes opposés. La longueur humide sert à déterminer l’admissibilité et à tracer la frontière. Ce couplage est un modèle sur graphe. Une discrétisation de la diffusion continue demanderait notamment une conductance liée à la géométrie et une calibration physique de ses paramètres. Ici, μ prend les valeurs 0, 0,25 ou 0,5 mois⁻¹.

## Budgets et reproductibilité

L’assemblage compte `5n + 3m` composants et `7n + 6m` connexions pour n cellules et m arêtes. Chaque arête ajoute une somme de flux, deux sommes dans les dérivées et six connexions. La requête générée contrôle ses effectifs, l’estimation contractuelle des points et sa taille UTF-8.

| Ressource par requête | Valeur pour B, campagne nominale | Plafond |
| --- | ---: | ---: |
| Composants | 107 | 128 |
| Connexions | 175 | 512 |
| Observations | 13 | 32 |
| Points estimés par le contrat | 2 626 | 20 000 |
| Points publiés | 2 613 | 20 000 |
| Requête JSON maximale | 24 995 octets | 1 048 576 octets |
| Résultat JSON maximal mesuré dans la trace | 138 763 octets | 4 194 304 octets en sortie du processus |
| Appels à l’ordonnanceur | 22 925 à 26 347 | 100 000 |

Les neuf requêtes nominales produisent chacune les 201 points natifs par cellule. Leur répétition redonne exactement les séries et le nombre d’appels. Le mode `full-network` apparaît dans les traces et dans les exports. L’identifiant natif contient μ et une empreinte déterministe de la topologie, de la distribution et de l’assemblage réellement soumis. Le SVG conserve également ces métadonnées. Le PNG présente le titre du scénario B et μ dans l’image, et identifie le mode dans le nom du fichier.

Les maillages plus fins présentent des composantes connexes qui excèdent déjà le plafond de 128 composants avec les seuls blocs biologiques. Avec toutes leurs arêtes, ils atteignent les effectifs suivants.

| Grille | Cellules humides | Frontières | Composants | Connexions | Observations | Points estimés |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 18 × 9 | 65 | 90 | 595 | 995 | 65 | 13 130 |
| 48 × 24 | 296 | 464 | 2 872 | 4 856 | 296 | 59 792 |

Découper une composante connectée en lots indépendants supprimerait des termes de la dérivée aux frontières des lots. Pour garder ces termes, un découpage demanderait un protocole d’échange temporel et une validation numérique propres.

## Validation numérique

### Bloc logistique compact

La solution analytique utilisée est `K/[1 + (K/B(0) − 1) exp(−rt)]`. Les maxima ci-dessous portent sur toutes les cellules et les 201 instants.

| Distribution | Historique contre analytique (t) | Compact contre analytique (t) | Compact contre historique (t) |
| --- | ---: | ---: | ---: |
| Homogène | 0,018858 | 0,017330 | 0,002490 |
| Linéaire, α = 0,6 | 0,058353 | 0,057807 | 0,006365 |
| Sigmoïde humide, α = 0,6 | 0,325733 | 0,325642 | 0,005807 |

Le chemin linéaire de `rB` vers la dérivée perd un multiplicateur. Un multiplicateur QSS3 qui reçoit un message programme une sortie au même temps simulé, lors d’une transition ultérieure. Dans le bloc historique, les deux multiplicateurs aval propagent les termes issus d’une même émission de `rB` à la somme. Dans le bloc compact, le terme linéaire atteint la somme une transition plus tôt que sa contribution quadratique. La somme peut ainsi transmettre une dérivée intermédiaire pendant la propagation au même temps simulé.

Les deux modèles ont été exécutés jusqu’à six horizons. Les compteurs cumulés sont égaux aux horizons sondés et les valeurs rééchantillonnées diffèrent. Le runner v1 fournit le compteur agrégé comme donnée d’ordonnancement.

| Distribution | 10⁻⁶ mois | 0,1 mois | 1 mois | 5 mois | 10 mois | 20 mois |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Homogène | 9 | 137 | 1 449 | 5 289 | 10 177 | 15 377 |
| Linéaire | 9 | 297 | 1 569 | 5 761 | 10 521 | 15 865 |
| Sigmoïde humide | 9 | 233 | 1 113 | 4 889 | 9 313 | 16 329 |

### Réseau complet

La référence RK4 intègre les 13 équations et évalue directement la loi de flux en densité. Diviser son pas de 0,01 à 0,005 mois change les valeurs nominales d’au plus 1,87 × 10⁻⁸ t. Le bilan instantané additionne les flux nets calculés sur les biomasses observées. Le bilan local compare `Bᵢ(t) − Bᵢ(0)` à l’intégrale de la croissance et du flux net. Les trapèzes couvrent toutes les dates et Simpson fournit un contrôle aux dates paires.

| Vérification nominale | Maximum mesuré | Seuil du test |
| --- | ---: | ---: |
| Écart à A pour μ = 0 | 0,022642 t, soit au plus 1,53 × 10⁻⁶ Kᵢ | 10⁻⁵ Kᵢ |
| Écart à A à densité initiale homogène, μ positif | 0,014095 t, soit au plus 8,49 × 10⁻⁶ Kᵢ | 10⁻⁵ Kᵢ |
| Écart à RK4 | 0,325055 t, soit au plus 4,24 × 10⁻⁵ Kᵢ | 5 × 10⁻⁵ Kᵢ |
| Résidu local par trapèzes | 6,49 × 10⁻⁵ Kᵢ | 10⁻⁴ Kᵢ |
| Résidu local par Simpson | 0,245650 t, soit au plus 3,97 × 10⁻⁵ Kᵢ | 5 × 10⁻⁵ Kᵢ |
| Valeur absolue du bilan instantané | inférieure à 10⁻⁹ t/mois | 10⁻⁹ t/mois |

À r = 0, la masse d’une composante se conserve. Avec `bᵢ = Bᵢ/Aᵢ` et `b̄ = ΣBᵢ/ΣAᵢ` dans cette composante, la dispersion `V = Σ Aᵢ(bᵢ − b̄)²` vérifie

```text
dV/dt = −2 Σ_arêtes μ [Aᵢ Aⱼ/(Aᵢ + Aⱼ)] (bᵢ − bⱼ)² ≤ 0.
```

À μ positif, la dérivée s’annule dans une composante connexe exactement lorsque ses densités sont égales. À r positif, la croissance intervient dans la dérivée de V. L’interface donne la dispersion observée des deux scénarios à chaque date.

Les quatre contrôles hétérogènes sans croissance donnent une dérive de masse maximale de 0,00874 t sur 45 000 t et un écart maximal à RK4 de 0,000269 t/km². La dispersion aux dates observées décroît à la tolérance numérique du test. Au mois 20, elle vaut entre 21,30 % et 49,96 % de sa valeur initiale selon le gradient et μ.

L’observateur natif écarte les valeurs consécutives identiques. À r = μ = 0, il publie uniquement le point initial. À r = 0 et μ positif, le contrôle homogène publie quelques points à cause des arrondis, avec des variations inférieures à 10⁻⁹ t. Pour le gradient linéaire sans croissance, le même mécanisme écarte aussi un ou deux points de C52 alors que le reste du réseau évolue. Le lecteur restitue les dates omises par report de la dernière valeur publiée, selon la sémantique de déduplication de l’observateur. La trace compte les points bruts et distingue les dates restituées. La comparaison RK4 porte sur les états ainsi lus, sans intégration supplémentaire.

## Démonstration

Dans **Expérience logistique spatiale → Interactions spatiales**, choisir **Réseau complet — grille 6 × 3**. Les deux cartes partagent le mois, le zoom et le cadrage. L’échelle de biomasse sur capacité reste fixée à 0 %, 50 % et 100 %. Les traits sur B indiquent les portions humides des frontières actives. On peut filtrer les frontières d’une cellule et masquer les flèches. La liste des flux se trie par amplitude ou identifiants. Le flux net indique un apport lorsqu’il est positif. Les graphiques portent sur la cellule consultée et jusqu’à dix cellules supplémentaires, avec deux trajectoires par cellule.

Les captures utilisent la sigmoïde aux centroïdes humides, α = 0,6 et μ = 0,5 mois⁻¹. Dans ce cas, le flux orienté C30 → C31 passe de +2,11636 t/mois au départ à −0,00447 t/mois à 11,7 mois, premier instant d’inversion observé.

| Mois | Biomasse A (t) | Biomasse B (t) | B − A (t) | Dispersion A (t²/km²) | Dispersion B (t²/km²) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 45 000,00 | 45 000,00 | 0,00 | 3 546 428,32 | 3 546 428,32 |
| 5 | 61 610,53 | 65 024,29 | +3 413,75 | 3 360 998,44 | 2 114 229,52 |
| 10 | 74 477,57 | 80 633,87 | +6 156,30 | 1 842 400,42 | 568 381,85 |
| 20 | 88 759,71 | 89 589,47 | +829,76 | 17 367,27 | 942,49 |

- [Mois 0](lot2-3-reseau-complet-6x3-captures/6x3-sigmoide-06-mu-05-mois-0.png)
- [Mois 5](lot2-3-reseau-complet-6x3-captures/6x3-sigmoide-06-mu-05-mois-5.png)
- [Mois 10](lot2-3-reseau-complet-6x3-captures/6x3-sigmoide-06-mu-05-mois-10.png)
- [Mois 20](lot2-3-reseau-complet-6x3-captures/6x3-sigmoide-06-mu-05-mois-20.png)

## Reproduction des tests

Les mesures utilisent Node.js 26.13.0 sous Windows et le runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe`. Son SHA-256 est `a919dfdfb99b83242e42fb7c023d4afccc94c53b0e0ddc7b308f59d40eef902b`. Le contour HydroLAKES versionné a le SHA-256 `9ac2101b3e02f8dd890dc9c9365f60e0febe265cceba058beed5835dbbcadbe6`.

La compilation TypeScript et le build de production Next.js ont réussi. Les 24 tests natifs et analytiques, les 671 tests Vitest et les dix parcours Playwright Chrome ont réussi, y compris les régressions des lots 2.1 et 2.2. Les captures finales mesurent 1 440 × 1 430 px.

Depuis `web`, définir `IRRITATOR_RUNNER` vers le binaire puis lancer les tests natifs.

```powershell
npm run build
node --test engine/runner/logistic-lake-full-network-tests.mjs engine/runner/logistic-lake-network-tests.mjs engine/runner/logistic-lake-exchange-tests.mjs engine/runner/logistic-lake-tests.mjs engine/runner/logistic-lake-continuum-tests.mjs
```

Démarrer Fastify avec `npm start` depuis `web` et Next.js avec `npm run dev` depuis `web/apps/frontend`. Depuis le dossier frontend, définir `FRONTEND_URL` si nécessaire et `IRRITATOR_LAKE_FULL_NETWORK_EVIDENCE` vers le dossier de captures pour régénérer les quatre PNG.

```powershell
npm run typecheck
npm run build
npm run test
npm run test:e2e -- tests/e2e/logistic-lake-full-network.spec.ts tests/e2e/logistic-lake-network.spec.ts tests/e2e/logistic-lake-interactions.spec.ts tests/e2e/logistic-lake-contrast.spec.ts tests/e2e/logistic-lake-workshop.spec.ts
```
