# Référentiel SIG du lac de Guiers

Ce document conserve la recette V1. La [recette V2](SIG_HYBRIDE_GUIERS_V2.md) ajoute Hₚ+, corrige `hydroAttributes` et audite la connectivité par parties. Les rapports historiques restent consultables séparément.

Ce document conserve la recette V1. La [recette V2](SIG_HYBRIDE_GUIERS_V2.md) ajoute Hₚ+, corrige `hydroAttributes` et audite la connectivité par parties. Les rapports historiques restent consultables séparément.

## État du dépôt et périmètre

Le travail part de `anim-simu` à `3f6bae9bbfa404ffe24334bdd6575dc87986def7`, synchronisée avec la référence locale `origin/anim-simu` et sans modifications au départ. La référence historique du niveau 1 est `two-modes` à `578b95271696f5f431fcb924511c13d5c1a254c8`. Les modifications ont été réalisées sur `codex/sig-hybride-guiers`. La recette ci-dessous utilise les fichiers réels disponibles localement, les instructions de la mission du 27 novembre 2026 et la matrice R1–R4 jointe.

| Configuration | Contour | Disponibilité et usage |
| --- | --- | --- |
| H | HydroLAKES v1.0, objet 1520 | Fourni avec l’interface et sélectionné à l’ouverture. Référence historique documentée, grilles à 1 km et 500 m. |
| E | `lac.shp` de viabFishSng | Audit réalisé. L’interface accepte un fichier local autorisé pour comparer E à H à échelle et résolution communes. |
| H+ | Même contour, cellules, aires et voisinage que H | Audit réalisé. L’import local propose les villages, zones de scénario et Typha théorique disponibles dans le fichier candidat. Chaque couche se commande indépendamment de la simulation. |
| Lv+ | Contour contemporain et couches qualifiées par usage | Choix désactivé en lecture scientifique. Les pièces empiriques, institutionnelles et de réutilisation sont à réunir par couche. |

## Données et audit des fichiers réels

HydroLAKES provient de l’extrait original suivi dans Irritator. Les empreintes Git des deux GeoJSON correspondent au registre de départ après normalisation des fins de ligne pour les fichiers texte. Le SHA256 canonique de l’original est `787f3c25e836c2dc773ab92d6e352fad71db01b0d77e1f2b16736f3e6a4f50ce`. La recette laisse les extraits intacts. L’aire attributaire `Lake_area` de 221,01 km² est distincte de l’aire projetée. Le contour SWBD/SRTM est historique. Février 2000 correspond au contexte de collecte principal et la date d’observation précise de l’objet reste inconnue. L’extraction est datée du 16 novembre 2026. [HydroSHEDS](https://www.hydrosheds.org/products/hydrolakes) · [Messager et al.](https://doi.org/10.1038/ncomms13603) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

La copie locale viabFishSng examinée pointe sur `e17bc25f18b11d7fa6074ec411749ad606767a76`. Les blobs cités dans le registre concordent. Les PRJ et les coordonnées stockées indiquent WGS84 géographique. Le QMD de `lac` indique EPSG:32628. Le calcul applique une reprojection réelle avec `always_xy`, en conservant les QMD auprès des originaux. `envelope` sert à décrire l’emprise du modèle NetLogo et figure uniquement dans l’audit. Le README et les variantes `modelv0.nlogo` et `modelv0_viab.nlogo` permettent de vérifier ce rôle. Les règles NetLogo d’exclusion et de déplacement des villages servent de contexte scientifique pour la comparaison des modèles. [viabFishSng](https://github.com/ElCep/viabFishSng)

### Aires, grille et voisinage

| Indicateur GEOS/PROJ | H | E |
| --- | ---: | ---: |
| Aire UTM en km² | 220,122208 | 196,329240 |
| Périmètre des anneaux en km | 383,883290 | 152,519898 |
| Sommets avec fermetures | 1 458 | 168 |
| Anneaux intérieurs | 13 | 0 |
| À 1 km, actives / partielles / multiparties | 405 / 307 / 37 | 293 / 181 / 6 |
| À 500 m, actives / partielles / multiparties | 1 283 / 752 / 46 | 970 / 385 / 2 |
| Liens bloqués vers les cellules multiparties à 1 km / 500 m | 108 / 148 | 22 / 7 |

L’intersection est de 172,609867 km², l’union de 243,841582 km² et le Jaccard de 0,707877. H seul couvre 47,512341 km² et E seul 23,719374 km². Les aires et effectifs reproduisent les repères de la recette. Les petits écarts sur l’intersection sont compatibles avec le passage de l’estimation par bandes de 5 m au découpage GEOS. L’extrémité sud diffère d’environ 16,2 km entre les contours. L’origine de l’écart reste à qualifier avec des données datées.

Sur les six grilles auditées, l’écart maximal du bilan d’aire est de 6,56 × 10⁻⁷ m². Une cellule est active au-dessus de 0,001 m² d’eau et entière à 0,001 m² près. Le graphe exige un côté commun mouillé sur une longueur supérieure à 10⁻⁶ m, vérifie la réciprocité et écarte les liens incidents aux cellules multiparties. Le rapport donne l’identité de ces cellules et la liste des composantes résultantes. L’accessibilité des pirogues reste à qualifier séparément.

| Union des couches candidates | Aire totale | Dans H | Dans E |
| --- | ---: | ---: | ---: |
| 4 zones d’exclusion, en km² | 20,660716 | 11,382826 | 11,878210 |
| 5 objets Typha théorique, en km² | 8,456356 | 7,696390 | 8,314930 |

Le calcul utilise l’union interne avant les intersections avec l’eau. Aucun chevauchement surfacique entre objets d’une même couche n’a été observé dans ces blobs. Le fichier de villages compte 35 points, 3 sans nom et 34 sans valeur numérique de population, dont une valeur non numérique conservée dans l’attribut source. Deux exclusions ont le même identifiant attributaire. Les identifiants techniques sont dérivés du nom de couche, du commit et de l’ordre d’enregistrement. Un objet Typha contient un sommet répété consécutivement. La carte garde ses coordonnées et le contrôle de topologie de l’import ignore ce pas de longueur nulle. Une distance de proximité entre village et cellule ne qualifie ni un embarcadère ni un accès navigable.

Shapely 2.2.0, GEOS 3.14.1, pyproj 3.8.0, PROJ 9.8.1 et pyshp 3.1.9 ont servi à la recette. `report.json` et `provenance.json` sont conservés sous `local-sig-guiers/`. Le statut des droits viabFishSng reste non confirmé. Sur les fichiers réels, la recette a calculé les métriques localement et a intégré au code Web le référentiel issu d’HydroLAKES. Le paquet géographique réel viabFishSng exige une référence d’autorisation couvrant la dérivation et l’usage local. Le dépôt, le build public et l’atlas d’atelier restent exempts de ses géométries et dérivés. [Registre HydroLAKES de l’application](../web/apps/frontend/data/geography/README.md)

## Contrats Web et simulation

- `scripts/guiers/audit_sig.py` adapte l’audit fourni. Le manifeste source et les dépendances figurent dans le même dossier. Le pipeline vérifie les empreintes, les composants des Shapefiles, le CRS, la topologie et les bilans, puis écrit dans un dossier protégé du suivi Git par `.gitignore`. La version du script et les versions GEOS/PROJ doivent accompagner toute comparaison reproductible.
- `web/packages/contracts/guiers-spatial.ts` valide le paquet local version 1 en réutilisant les contrôles de géométrie de `geo-atlas.ts`. La couche absente garde une fraction `null`. Le mode H+ reprend les coordonnées, surfaces et voisins de la référence H distribuée et applique uniquement les attributs d’enrichissement. Le hash du fichier candidat, celui de H, la version, la configuration et la résolution identifient l’affichage des résultats. Une pièce indépendante documente l’autorisation.
- `web/apps/frontend/components/territory/guiers-spatial-workspace.tsx` s’ouvre depuis `geo-atlas-workspace.tsx` et réutilise `geo-atlas-map.tsx` avec les styles de `geo-atlas.css`. L’aperçu précède l’activation locale. L’import, les notes et les résultats restent en mémoire et peuvent être fermés. L’atlas historique, ses trois références CLPA non géolocalisées, ses sauvegardes et les scénarios du modèle suivent leurs chemins existants. L’activation du mode de projection retire le volet SIG local et ses données de la vue.
- `web/examples/guiers-logistic.ts` construit des lots pour le graphe QSS3 natif existant avec `K_i = k_s A_i` et `B_i(0) = b_0 A_i`. Le build TypeScript inclut cet adaptateur pour la commande `web/engine/runner/guiers-logistic.mjs`. Sur H et H+, l’action de simulation Web transmet le seul modèle autonome construit à partir des surfaces publiques H. E se calcule via la commande locale. Les résultats par cellule sont exprimés en kg, le temps en jours et la couleur en kg/m². L’interface affiche les résultats uniquement sur la configuration, la version et la résolution calculées. La diffusion, les captures et l’effort propre au SIG métrique restent hors du palier autonome. Les réseaux logistiques historiques du niveau 2 restent un parcours distinct.

Avec les hypothèses de démonstration `b0=0,0005 kg/m²`, `ks=0,001 kg/m²` et `r=0,035 jour⁻¹`, le runner donne environ 110 061,104 kg à l’initialisation et 147 082,959 kg au jour 20 sur H, pour chacune des deux résolutions. Il s’agit d’une expérience numérique illustrative.

## Reproduire l’audit

Windows PowerShell, depuis la racine.

```powershell
python -m venv build-sig-guiers/venv
$py = './build-sig-guiers/venv/Scripts/python.exe'
& $py -m pip install -r scripts/guiers/requirements.txt
& $py -B -m unittest discover -s scripts/guiers -v
$hydro = 'web/apps/frontend/data/geography/guiers-hydrolakes-1520.original.geojson'
& $py -B scripts/guiers/audit_sig.py --hydro $hydro --out local-sig-guiers/h-audit
& $py -B scripts/guiers/audit_sig.py --hydro $hydro --etienne ../viabFishSng/data --acquired-at 2026-11-27 --out local-sig-guiers/audit-reel
```

Linux, depuis la racine.

```sh
python3 -m venv build-sig-guiers/venv
py=./build-sig-guiers/venv/bin/python
"$py" -m pip install -r scripts/guiers/requirements.txt
"$py" -B -m unittest discover -s scripts/guiers -v
hydro=web/apps/frontend/data/geography/guiers-hydrolakes-1520.original.geojson
"$py" -B scripts/guiers/audit_sig.py --hydro "$hydro" --out local-sig-guiers/h-audit
"$py" -B scripts/guiers/audit_sig.py --hydro "$hydro" --etienne ../viabFishSng/data --acquired-at 2026-11-27 --out local-sig-guiers/audit-reel
```

Utiliser la date réelle d’acquisition de la copie pour une nouvelle recette. Lorsque la référence d’autorisation d’usage local est établie, ajouter `--local-use-proof "référence documentée"` et choisir un nouveau dossier `--out`. Le pipeline produit alors `candidate-local.json` pour Irritator et `viabFishSng-candidate.geojson` pour un SIG local. Pour un dossier `data` détaché du clone, fournir également `--etienne-commit` avec le SHA complet attesté. Un jeu incomplet de composants pour une couche est bloquant. Une couche entièrement absente reste indisponible et est signalée. Le `reference-H.json` généré est le seul artefact destiné à être copié dans `web/apps/frontend/data/geography/guiers-metric-reference.json` pour une régénération publique.

## Ouvrir et simuler dans Irritator Web

1. Démarrer Fastify et Next.js selon le [guide Web](../web/README.md). Ouvrir `http://127.0.0.1:3000`, choisir **Niveau 2 — Lac de Guiers**, puis **Explorer le référentiel du lac** dans les lieux de pêche.
2. Sélectionner **Scientifique** pour lire la provenance, les surfaces et les anomalies. Choisir 1 km ou 500 m. Pour un fichier autorisé, sélectionner **Ouvrir un référentiel candidat local**, examiner l’aperçu et activer explicitement. Le mode **Pêcheur** conserve la carte, les couches visibles et les indicateurs utiles.
3. Sur H ou H+, utiliser **Simuler la croissance autonome**. Le résultat apparaît avec un curseur en jours. Pour E, ou pour produire un fichier sur disque, exécuter la commande locale et choisir **Ouvrir un résultat local** avec la même configuration et résolution.

```powershell
Set-Location web
npm.cmd run build
$env:IRRITATOR_RUNNER = (Resolve-Path '../build-web-test8p-bis/Release/runner/irritator-runner.exe').Path
node engine/runner/guiers-logistic.mjs --config H --resolution 1000 --out ../local-sig-guiers/h-audit/native-H-1000.json
```

```sh
cd web
npm run build
export IRRITATOR_RUNNER=/chemin/vers/irritator-runner
node engine/runner/guiers-logistic.mjs --config H --resolution 1000 --out ../local-sig-guiers/h-audit/native-H-1000.json
```

Pour E ou H+, utiliser respectivement `--config E` ou `--config H_PLUS`, puis `--candidate ../local-sig-guiers/<dossier>/candidate-local.json`. Donner un nouveau fichier `--out`. Si ce fichier ou le dossier de recette existe déjà, choisir un autre nom.

## Recette d’acceptation

| Cas | État | Commande ou preuve |
| --- | --- | --- |
| SIG-01 à SIG-06 | PASS | `python -B -m unittest discover -s scripts/guiers -v` (8 tests) et audit des sources réelles. Empreinte du référentiel H régénéré identique à celle du fichier Web. |
| SIG-07 | PASS sur synthétique | Export local conditionné par la référence d’usage, validation TS et géométries réelles vérifiées en mémoire. L’ouverture du paquet complet réel reste bloquée par la référence d’autorisation. |
| SIG-08 | PASS | `git check-ignore -- local-sig-guiers/real-audit-geos/report.json`. Seul le JSON H dérivé d’HydroLAKES est embarqué dans le code Web. |
| UI-01 à UI-06 | PASS | Playwright sur les parcours `levels-territory`, `geo-atlas` et `guiers-spatial`. Bascule des niveaux, archives anciennes, H réel, E et H+ synthétiques, Lv+ désactivée, lecture à 400 px, couches sans effet de simulation, résultat H lié à sa grille. |
| SIM-01 | PASS | Depuis `web`, `node --test engine/runner/guiers-logistic-tests.mjs` (3 tests). Commande locale sur H réel aux deux résolutions et sur E/H+ synthétiques. |
| SIM-02, SIM-03 | NON APPLICABLE | Le modèle livré sur les grilles UTM est autonome. Les réseaux historiques ont leurs propres tests. |
| DOC-01 | PASS | Commandes PowerShell exécutées avec Python 3.12. Équivalents Linux fournis. |

Les deux builds `npm run build` ont abouti, avec contrôle TypeScript. La suite `npm run test:all` depuis `web` a réussi ses 664 tests avec le runner Release déjà disponible. Vitest a réussi ses 676 tests sous Node 24 avec `--configLoader runner --maxWorkers=1`. Une exécution concurrente avait dépassé la limite de temps d’un test historique de l’animation. Les 12 tests natifs des réseaux logistiques historiques (`logistic-lake-exchange-tests.mjs`, `logistic-lake-network-tests.mjs`, `logistic-lake-full-network-tests.mjs`) et les 8 parcours Playwright ont réussi. Les commandes Linux sont documentées et la recette a été exécutée sous Windows. La qualification empirique et institutionnelle relève du protocole qui suit.

## Protocole vers Lv+

1. Confirmer auprès d’Étienne Delay et du producteur amont les sources, millésimes, hypothèses et droits distincts d’usage, de dérivation et de diffusion. Qualifier notamment la provenance du contour, les exclusions et le Typha.
2. Définir avec l’OLAC le périmètre du lac et du Bas Ferlo, le niveau hydrologique et des observations satellitaires datées avec incertitude. Documenter au moins deux conditions saisonnières pertinentes et les écarts H/E.
3. Relever avec les pêcheurs les véritables points de mise à l’eau, accès, obstacles et itinéraires. Conserver les désaccords. Faire confirmer par le CLPA et le service des pêches les polygones réglementaires, calendriers et pièces applicables avant d’associer une géométrie aux références sans coordonnées.
4. Consigner pour chaque couche une décision, un responsable, une date, des preuves, des empreintes, le périmètre d’usage et les droits. Rejouer les bilans et tests d’intégration après chaque nouvelle version. Comparer H et E à résolution et paramètres égaux, puis H et H+ à domaine égal. Pour une comparaison de décisions issues de A**, conserver A_c* commun et refuser ou remapper explicitement les actions hors référentiel selon le protocole.
