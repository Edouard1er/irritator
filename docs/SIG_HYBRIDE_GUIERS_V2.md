# Recette V2 du périmètre candidat du lac de Guiers

Travail effectué sur `codex/sig-hybride-guiers`, au-dessus d’`anim-simu` `3f6bae9bbfa404ffe24334bdd6575dc87986def7` et des modifications V1 présentes dans le worktree. Les rapports V1 demeurent dans leurs dossiers d’origine. Aucun commit ni push. [Recette V1](SIG_HYBRIDE_GUIERS_IMPLEMENTATION.md)

| Configuration | Rôle et disponibilité |
| --- | --- |
| `H` | HydroLAKES intégral, référence historique et affichage disponible à l’ouverture. |
| `E` | Contour d’Étienne Delay, comparatif accessible après import local autorisé. |
| `H_PLUS` | H intégral et couches complémentaires candidates, disponible avec les imports V1 ou V2 autorisés. |
| `HP_PLUS` | H recoupé par le masque de pêche en pirogue, enrichi des couches disponibles. Premier choix à la première activation autorisée d’un paquet V2 dans une nouvelle session SIG. Les projets et scénarios sauvegardés gardent leur configuration. |
| `L_V_PLUS` | Choix désactivé. Chaque couche et le périmètre attendent des pièces empiriques, institutionnelles et de réutilisation. |

## Construction et provenance

La décision de tester la coupe sud est motivée par l’échange avec Étienne Delay rapporté par le doctorant le 27 novembre 2026, au sujet du périmètre fréquenté par les pêcheurs en pirogue qu’il a étudiés. La communication ne fournit ni levé, ni état hydrologique, ni localisation d’ouvrage. La carte de Youssoupha Tall (2020) mentionnée dans l’échange distingue le lac et la vallée du Ferlo. Une exploitation métrique demanderait une carte géoréférencée et une validation préalable.

Le masque `south_cut_min_northing_E_v1` est une boîte couvrant toute la largeur de H et son extrémité nord, avec marge de 1 km. Son bord sud se calcule sur `lac.shp` reprojeté, au commit `e17bc25f18b11d7fa6074ec411749ad606767a76`, avec contrôle des blobs épinglés. La recette reprojecte WGS84→UTM 28N (EPSG:32628), avec `always_xy`. Elle calcule `Lₚ = H ∩ Dₚ` par GEOS et affiche la géométrie en WGS84. Le masque consigne l’auteur de la décision, sa justification, la source, le CRS, les bornes, le seuil et le SHA256 du WKB 2D normalisé. Pour le cas réel, l’empreinte du masque est `28202b428c088032e10d8b9e4c186490ac65aa5ed2daf834481ae0ca97356abf`. L’autre mode accepte un polygone explicite RFC 7946 et consigne l’auteur et le SHA256 de son fichier. Le masque demeure candidat dans les deux modes. La variante `minY(envelope)` reste un résultat de sensibilité. [HydroLAKES et conditions d’attribution](https://www.hydrosheds.org/products/hydrolakes) · [viabFishSng épinglé](https://github.com/ElCep/viabFishSng/tree/e17bc25f18b11d7fa6074ec411749ad606767a76)

La correction `hydroAttributes` résulte d’une collision de variable dans `execute`. La boucle d’anomalies parcourait les enregistrements de villages sous le même nom que les attributs du lac. Le rapport et la provenance recopient désormais l’objet d’attributs original sous des champs dédiés, avec les types de l’extrait. `Hylak_id="1520"`, `Lake_name="Guiers"`, `Country="Senegal"` et `Lake_area="221.01"` sont des chaînes dans le GeoJSON original. La surface attributaire de 221,01 km² reste distincte de l’aire projetée. Les populations non calculables et les noms absents demeurent inconnus.

## Résultats géographiques

Origine UTM `[0,0]`. Une cellule est active si son aire en eau dépasse `0,001 m²` et pleine si son déficit est au plus `0,001 m²`. Les identifiants sont les indices métriques V1. Les coordonnées, les contours de H et les sorties V1 restent reproductibles. H contient 13 trous et Lₚ en conserve 7 dans la zone retenue. L’inclusion de Lₚ dans H donne un résidu hors H de 0 m². Le bilan conservé + retiré − H vaut environ `−7,45 × 10⁻⁹ m²`. Les bilans de grilles sont inférieurs à `10⁻⁶ m²` en valeur absolue. Les résultats concordent avec les calculs indépendants fournis pour la recette V2.

| Périmètre | Y sud UTM (m) | Aire en eau (km²) | Aire de H retirée (km²) | 1 km actives / pleines / partielles | 500 m actives / pleines / partielles |
| --- | ---: | ---: | ---: | ---: | ---: |
| H et H+ (même support) | — | 220,122208 | 0 | 405 / 98 / 307 | 1 283 / 531 / 752 |
| E | — | 196,329240 | — | 293 / 112 / 181 | 970 / 585 / 385 |
| Hₚ+ | 1 767 012,947847 | 184,524930 | 35,597278 | 288 / 97 / 191 | 967 / 508 / 459 |
| Sensibilité `envelope` | 1 766 375,135829 | 185,143778 | 34,978430 | 290 / 97 / 193 | 974 / 508 / 466 |

H∩E couvre 172,609867 km² et reste un indicateur comparatif. Le seuil candidat retranche 16,17 % de la surface de H. La sensibilité est décalée de 637,81 m vers le sud et conserve 0,618848 km² supplémentaires. À la coupe candidate, le contour H présente une seule interface d’eau tronquée de 399,30 m. La sensibilité coupe 1 628,28 m d’interface au total. Les cartes SVG et leurs aperçus PNG présentent les quatre vues à la même échelle et un zoom de la coupure. Ils restent dans le dossier d’audit local.

Après union des objets, les quatre zones de scénario couvrent 11,382826 km² de Lₚ et les cinq objets Typha théorique 7,696390 km². Dans les couches épinglées, ces deux surfaces dans Lₚ coïncident avec leurs surfaces dans H. Les fractions se divisent par l’aire mouillée de chaque cellule. Elles valent zéro en cas d’intersection vide et `null` si la couche manque. Le rapport vérifie le bilan entre les intersections du domaine et la somme de celles des cellules. Les 35 coordonnées originales de villages sont conservées pour l’import autorisé. Les 35 points sont hors du polygone d’eau Lₚ et 8 sont aussi hors du masque de périmètre. Cela laisse 27 points sur terre à l’intérieur du masque. Trois noms et 34 populations numériques restent inconnus. `accessPoint` reste `null`. La distance à l’eau et le village proche de la cellule sont descriptifs et ne déclenchent ni navigation, ni déplacement de coordonnées, ni création de pirogues.

Le prototype prend le même domaine écologique calculé que le périmètre général de pêche étudié, réserves comprises. Il pose un flux nul à la frontière. Cette hypothèse permet de comparer des scénarios autonomes. Un futur modèle peut étendre le domaine écologique et ajouter des échanges, tout en conservant un masque de pêche séparé. Les zones d’étude, les règles officielles et l’état biologique de la partie sud relèvent de sources et de procédures de qualification propres.

## Connectivité aquatique

`aggregate_cells_v1` porte le voisinage historique. Il écarte toute interface incidente à une cellule multipartite. À 1 km, 108 interfaces sont ainsi écartées pour H, 22 pour E et 64 pour Hₚ+. À 500 m, les nombres sont 148, 7 et 90. `water_parts_v1` crée un nœud par polygone aquatique non vide de chaque cellule active et garde la cellule pour l’affichage. L’identifiant associe l’ID de cellule et les 16 premiers caractères du SHA256 de sa géométrie canonique dans le CRS métrique. L’audit contrôle les collisions et les bilans. Les IDs sont reproductibles à géométrie et chaîne GEOS identiques. Un changement de la partie peut changer son ID.

Une arête relie exclusivement deux parties de cellules jointives par un côté, si la longueur d’eau commune dépasse `10⁻⁶ m`. Une arête non orientée conserve cette longueur en m et chaque nœud référence son voisin réciproque. Les parties disjointes ne partagent pas d’arête dans la même cellule. Les contacts par un coin et les proximités de centroïdes restent sans effet. Le rapport donne la plus grande composante selon son aire et le maximum de cellules couvertes. H+ partage le graphe H et est référencé par alias dans la sortie détaillée.

| Domaine et résolution | Composantes V1 | Plus grande V1 · cellules / km² | Isolats V1 · n / km² | Nœuds / liens par parties | Plus grande par parties · cellules / km² |
| --- | ---: | ---: | ---: | ---: | ---: |
| H, 1 km | 49 | 240 / 167,948 | 40 / 11,113 | 449 / 679 | 405 / 220,122 |
| H, 500 m | 55 | 1 163 / 211,727 | 49 / 3,311 | 1 335 / 2 209 | 1 283 / 220,122 |
| E, 1 km | 7 | 287 / 194,650 | 6 / 1,679 | 299 / 498 | 293 / 196,329 |
| E, 500 m | 3 | 968 / 196,246 | 2 / 0,083 | 972 / 1 744 | 970 / 196,329 |
| Hₚ+, 1 km | 25 | 240 / 167,948 | 21 / 6,730 | 311 / 499 | 288 / 184,525 |
| Hₚ+, 500 m | 29 | 935 / 182,175 | 27 / 2,225 | 996 / 1 728 | 967 / 184,525 |

Le graphe par parties trouve une composante et zéro isolat dans chaque ligne du tableau. Ces résultats décrivent la topologie des polygones. Ils ne qualifient ni profondeur, ni obstacle, ni navigabilité effective. Le graphe par parties est prêt pour la définition et les essais de flux conservatifs. La croissance autonome tourne toujours par cellule agrégée, sans transfert entre cellules. [Plan expérimental](PLAN_EXPERIMENTAL.md)

## Reproduction et fichiers

Depuis la racine, après l’installation du fichier `scripts/guiers/requirements.txt` dans un environnement Python. Employer la date effective de l’acquisition de la copie locale. Le dossier de sortie doit être nouveau et sous `local-sig-guiers/`.

```powershell
$py = './build-sig-guiers/venv/Scripts/python.exe'
$hydro = 'web/apps/frontend/data/geography/guiers-hydrolakes-1520.original.geojson'
& $py -B -m unittest discover -s scripts/guiers -v
& $py -B scripts/guiers/audit_sig.py --hydro $hydro --etienne ../viabFishSng/data --acquired-at 2026-11-27 --out local-sig-guiers/v2-audit
```

Sous Linux, employer `./build-sig-guiers/venv/bin/python` et les mêmes arguments. `--perimeter-geojson <fichier>` et `--mask-author <auteur>` activent le mode explicite. L’audit local produit `report.json`, `provenance.json`, `reference-H.json`, `connectivity-H.json`, `water-part-graphs.json` et les deux SVG dès qu’un masque est disponible. Les PNG ont été rendus depuis les SVG avec Chromium pour la revue. Les dossiers `v2-recette` et `v2-reproductibilite` correspondent à deux exécutions indépendantes sur les entrées réelles.

Le clone ne fournit pas de licence confirmée pour les couches étudiées. La copie de travail, ses cartes et les graphes locaux sont réservés à cette recette. L’export destiné à l’interface exige `--local-use-proof <référence d’autorisation documentée>`. Quand la pièce existe, la chaîne écrit `candidate-local-v2.json`, `mask-local.geojson` et les exports V1 compatibles. Les données d’Étienne et les dérivés du masque restent hors du build public et de Git. H et son résumé de connectivité sont reproductibles indépendamment de ces données. Pour lever le statut candidat, consigner la justification de la limite, confronter des observations datées à la carte et au terrain, recueillir l’examen par le doctorant et les acteurs concernés et documenter la qualification des règles avec les autorités compétentes.

Dans **Niveau 2 — Lac de Guiers → Explorer le référentiel du lac → Scientifique**, importer et activer le fichier V2 autorisé. Le mode Pêcheur affiche la carte, les couches, le nombre de cellules et la surface. Le mode Scientifique affiche les sources, les deux graphes et la sensibilité. La croissance autonome H/H+ utilise les seules aires H publiques dans le parcours serveur. Pour Hₚ+ et E, le runner natif lit le fichier local et le résultat est réimporté. La configuration, la résolution et le SHA256 du paquet identifient le résultat. Changer de configuration ou de résolution masque un résultat jusqu’au retour à son contexte.

```powershell
Set-Location web
npm.cmd run build
$env:IRRITATOR_RUNNER = (Resolve-Path '../build-web-test8p-bis/Release/runner/irritator-runner.exe').Path
$candidateDir = '../local-sig-guiers/v2-autorise'
node engine/runner/guiers-logistic.mjs --config HP_PLUS --resolution 1000 --candidate "$candidateDir/candidate-local-v2.json" --out "$candidateDir/native-hp-1000.json"
```

## Vérifications effectuées

- `python -B -m unittest discover -s scripts/guiers -v` réussit ses 9 tests, dont l’identité exacte des attributs dans le rapport et la provenance, les contacts ponctuels, un chenal préservé, les parties disjointes, la réciprocité, les bilans, les exports autorisés sur données synthétiques et le masque explicite. Deux exécutions réelles produisent sept sorties identiques octet pour octet. Le référentiel H est identique au fichier Web. Une lecture indépendante du graphe confirme la validité des extrémités, les côtés adjacents, les longueurs positives, les aires totales et les composantes des six graphes réels. Shapely 2.2.0, GEOS 3.14.1, pyproj 3.8.0 et PROJ 9.8.1.
- Le build Fastify/TypeScript et `npm run test:all` passent leurs 664 tests. Les trois tests SIG QSS3 et les douze tests des réseaux historiques passent. Le runner natif termine aussi sur un paquet V2 généré par GEOS avec un polygone de périmètre et un village synthétiques, avec 148 séries à 1 km et 524 à 500 m. Le paquet et les résultats réels enrichis Hₚ+ restent conditionnés par l’autorisation documentée.
- Le build de production Next.js passe avec contrôle TypeScript. `vitest run --configLoader runner --maxWorkers=1` réussit 678 tests dans 51 fichiers. Les 9 parcours Playwright `geo-atlas`, `guiers-spatial` et `levels-territory` réussissent, y compris le paquet SIG V2 synthétique produit par le pipeline et le réimport de son résultat natif. Le test vérifie qu’aucune requête de simulation serveur ne part sur le parcours V2. La recette a été exécutée sous Windows avec Node 24.22.3. Aucun essai Linux ou NetLogo/OpenMOLE n’a été effectué.
