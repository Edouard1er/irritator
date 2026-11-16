# Niveau 2 — Incrément 2.3.B — Carte 2D et lieux de pêche

**Branche : `anim-simu` ; base : `f98ad14f` (revue 2.3.A). Date : 16 novembre 2026.**
Travail prêt pour revue locale. Aucun commit, push, changement de branche ou PR.

## État livré et portée scientifique

Une **géométrie réellement extraite de HydroLAKES v1.0** est intégrée pour le lac de Guiers. Le rendu n’est donc pas seulement une infrastructure sans fond. Il affiche une **référence hydrologique ancienne**, avec origine, millésime et attribution. Il ne constitue **pas une validation de la rive actuelle, une carte officielle de pêche ou une limite de réserve**.

Les participants peuvent indiquer un point, dessiner un secteur approximatif avec fermeture et annulation, décrire un lieu sans coordonnées, ou passer la question. L’atlas est distinct des modèles, des activités et des décisions. Les lieux sont éphémères par défaut ; autorisation cartographique, sauvegarde et autorisation de diffusion sont des actions explicites et distinctes de D1/D2.

La précision ultérieure de l’utilisateur dispense de recette dédiée sur mobile/tablette. Les nouvelles captures sont réalisées **sur ordinateur, viewport 1440 px**. Les styles adaptatifs sont conservés. Certaines recettes historiques, rejouées sans suppression de leurs assertions, redimensionnent déjà le navigateur ; cela ne constitue pas une validation sur appareil mobile réel.

## Audit et documents

État initial propre, branche et six derniers commits contrôlés. `web/apps/frontend/AGENTS.md` et la documentation locale Next.js `use-client.md` ont été consultés. Le ZIP a d’abord été extrait hors du dépôt, dans le répertoire temporaire. Ses Markdown, son manifeste et le rapport 2.3.A ont été examinés comme **spécification subordonnée à la demande de l’utilisateur**, sans autorisation de commit/push ou d’extension des modèles.

Les trois PDF ont été extraits en texte ; des pages rendues ont été inspectées, notamment la demande d’étude et de balisage de réserve. Le protocole distingue consentement, choix avant/après et restitution ; ses exemples numériques et les propositions scientifiques ne sont pas devenus de nouveaux modèles biologiques.

Le plan CLPA est départemental : les 989 pirogues ne sont pas un parc mesuré du lac ; les sorties mensuelles sont une programmation de surveillance ; les trois stations de senne projetées concernent le fleuve Sénégal. Les listes est/ouest sont des secteurs de sensibilisation, sans contours de pêche. Aucun nom de personne ni téléphone des documents n’est intégré.

L’audit a suivi `LevelNavigation → ModelEditor → LevelTwoJourney → TerritoryWorkspace`, les activités, le lecteur natif, les sauvegardes, `WorkshopSessionV1`, `TerritoryGeography`, `applyTerritorialZone`, `validateRequest` et `nativeRequest`. Les contrats historiques et le moteur ne sont pas modifiés.

## Sources effectivement intégrées

| Source | Obtention / version / licence | Usage réel |
| --- | --- | --- |
| [HydroLAKES](https://www.hydrosheds.org/products/hydrolakes) | Archive `HydroLAKES_polys_v10_shp.zip`, effectivement téléchargée ; v1.0 ; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Objet `Hylak_id=1520`, `Lake_name=Guiers`, `Country=Senegal`, `Poly_src=SWBD` ; contour d’eau uniquement |
| Plan d’action CLPA Dagana 2026, octobre 2025, pp. 8 et 10, fourni dans le kit | Document institutionnel de programmation ; licence publique non établie ; aucun vecteur fourni | Trois références **sans géométrie** : Mbane, Ngnith, étude/balisage sollicités vers Témeye-Toucouleur |
| Déclarations locales | Aucune déclaration réelle préchargée | Source créée seulement lors d’une indication en atelier ; date, précision approximative et statut non vérifié |

Archive producteur : [téléchargement direct](https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip), **820 295 132 octets**, SHA256 :

```text
9ef63498569dd7ccd0b8d8852da026e009a75f42d293f00e483f3b9fcfe8e1f9
```

Première extraction documentée : `2026-11-16T15:43:19.000Z`. La [documentation technique HydroLAKES](https://data.hydrosheds.org/file/technical-documentation/HydroLAKES_TechDoc_v10.pdf), pp. 4–5 et 9, décrit SWBD/SRTM : collecte principale février 2000, données sources d’environ 30 m, précision finale variable après généralisation. Une date de récupération en 2026 ne rend pas la rive contemporaine.

Extraction reproductible par bibliothèque standard Python : sélection DBF par nom/pays, vérification d’identifiant et de source, SHX puis SHP, contrôle du PRJ WGS84 en degrés. Un contour extérieur, treize îles/trous, **1 458 sommets**, tous conservés. Orientation des anneaux adaptée à RFC 7946 et arrondi à sept décimales ; aucun contour redessiné, aucun lissage ou découpage. L’arrondi n’est pas une précision de mesure centimétrique. L’emprise vient du fichier source, sans coordonnées retapées depuis une image.

Livrables de données :

- [Atlas avec registre complet](data/geography/lac-de-guiers.atlas.json).
- [Contour GeoJSON standard avec sourceId](data/geography/lac-de-guiers.hydrolakes.geojson).
- [Extrait original avec attributs et coordonnées non arrondies](data/geography/guiers-hydrolakes-1520.original.geojson).
- [Provenance, limites et procédure d’intégration](data/geography/README.md).
- [Script d’extraction reproductible](scripts/extract-guiers-hydrolakes.py).

L’archive mondiale reste dans `build-geo-source/`, ignoré par Git ; elle n’est pas redistribuée comme donnée de l’application. Les attributs originaux de surface, profondeur ou volume sont conservés dans l’extrait documentaire, mais **jamais utilisés par l’interface ou le moteur**.

Sources consultées sans intégration vectorielle : [OLAC](https://www.olac.sn/reseau-hydrographique/le-lac-de-guiers), page descriptive sans vecteur licencié récupéré ; [Géo Sénégal](https://www.geosenegal.gouv.sn/), consultation indisponible (HTTP 502). Aucune donnée OSM ni tuile distante n’est utilisée. Aucune limite réglementaire de réserve n’a été obtenue.

## Fonctionnement et protections

### Carte et participation

SVG 2D hors ligne, projection locale tenant compte de la latitude, trous conservés, zoom, déplacement par glisser et boutons, recentrage, repère clavier et sélection réciproque carte/liste. Un glisser ne crée pas de point. Les points, secteurs et références non localisées restent distincts ; les origines sont indiquées en texte, avec symboles et styles différenciés.

Le mode point demande une confirmation et permet de déplacer ou annuler le repère. Le secteur montre ses sommets, propose « Annuler le dernier point », « Tout recommencer » et une fermeture explicite avant confirmation. Les géométries invalides sont refusées sans effacer le brouillon. Une description verbale conserve `geometry:null` ; elle ne reçoit jamais un point par défaut. Les lieux hors emprise sont conservés, signalés et jamais déplacés automatiquement.

Une correction crée un nouvel identifiant avec `supersedesId`. L’original reste dans l’atlas ; l’affichage courant présente la dernière version, et le scientifique peut revoir l’historique. Des déclarations différentes ne sont pas fusionnées en consensus. Les brouillons survivent aux changements Pêcheur/Scientifique, d’étape et de niveau.

La vue sans fond a été réellement testée : état explicite « Fond géographique réel manquant », dessin désactivé, description verbale et atelier toujours possibles. Les rectangles historiques restent dans l’**espace territorial séparé de démonstration fictive**. Ils ne sont jamais ajoutés au contour réel ni au support S2.

### Contrat, sauvegarde et diffusion

`GeoAtlasV1` est un contrat autonome fermé, non réexporté dans `RunRequest`. Il valide version, EPSG:4326 explicite, dates UTC, révision, IDs et références de sources, classification/preuve, textes et volumes, nombres finis, coordonnées, fermeture, surface non nulle, sommets répétés, auto-intersections, trous et multipolygones superposés. Les projets institutionnels restent non localisés ; une déclaration ne peut pas devenir un contour de référence.

Bornes : 2 Mio de JSON, 32 sources, 256 objets historique compris, 20 000 sommets au total, 2 048 par anneau, 32 anneaux/parties, 64 sommets dans l’éditeur de secteur. Une source vectorielle vérifiée exige URL, licence, version, récupération UTC, millésime, transformation, attribution, limites et empreinte SHA256. La validation structurelle d’un import ne certifie pas l’exactitude externe de sa provenance.

Clé dédiée : `irritator.level2.geo-atlas.v1`. Les clés historiques modèles et décisions sont inchangées. Il n’y a pas d’autosauvegarde de la collecte : les indications restent en mémoire tant que l’animateur n’a pas autorisé la collecte cartographique **et demandé la sauvegarde**. Cette autorisation est réinitialisée à l’ouverture, indépendamment du consentement D1/D2. Elle est également exigée avant de copier un secteur déclaré dans un modèle sauvegardé.

Par défaut, les lieux privés et leurs textes sont masqués pour la projection, y compris le nom d’un objet sélectionné. L’animateur peut ouvrir explicitement le travail privé en petit groupe. Une autorisation par déclaration/version est nécessaire avant projection partagée ou export. L’export contenant des lieux demande aussi une confirmation de fichier privé. Une autorisation n’est jamais déduite de la présence d’un fichier importé. Aucun upload, synchronisation ou fond Internet obligatoire.

Import validé avant remplacement : aperçu ID/révision/CRS/sources et nombres d’ajouts, retraits et modifications, puis confirmation. L’import reste en mémoire jusqu’à une sauvegarde séparée. Un GeoJSON brut sans registre n’est pas promu automatiquement en atlas vérifié ; la procédure d’enveloppement est documentée, et l’import territorial historique conserve son format et son comportement.

Une archive locale existante doit être restaurée ou remplacée explicitement avant écriture. Fichier illisible, version future, quota ou refus de collecte : la dernière archive reste intacte. Les fonds publics peuvent être sauvegardés/exportés sans consentement de collecte lorsqu’ils ne contiennent pas de déclarations.

### Atelier et modèle

Les six étapes, les verrous D1/I/D2, le refus de répondre et les imports de séances 2.3.A restent conservés. S2 utilise la même carte après D1, avec la demande d’étude/balisage et **aucune frontière de réserve**. L’animateur doit toujours confirmer le support effectivement présenté avant D2. Une référence `geo-discussion-2.3.B-v1`, l’ID de l’atlas, sa révision et la modalité de vue sont enregistrés dans le champ `note` existant ; `WorkshopSessionV1` n’est pas changé.

Un point, une description ou le contour d’eau ne peut pas être simulé comme secteur. Pour un secteur, l’animateur saisit lui-même `a_z` entre 0 et 1, sans défaut, avec justification et confirmation de son caractère hypothétique. L’adaptateur pur prépare une `TerritoryGeography`, conserve ID/source et statut fictif, puis la confirmation séparée appelle **`applyTerritorialZone` et `validateRequest`**. Si l’atlas change après préparation, il faut préparer de nouveau. Aucun calcul n’est lancé automatiquement.

Une biomasse globale unique `N(t)` ; aucun stock local ni dérivation de l’accès depuis la surface. Activités déclarées, géographie et séances ne recalibrent ni effort ni scénarios natifs. `nativeRequest` continue d’exclure les données cartographiques et territoriales ; l’API fermée refuse une clé d’atlas supplémentaire.

## Avant / après et fichiers

| Avant 2.3.B | Après |
| --- | --- |
| Carte territoriale importée ou rectangles de démonstration | Fond hydrologique réellement sourcé, atlas indépendant ; démonstration séparée préservée |
| Sélection d’une zone de modèle | Recueil point/secteur/verbal ; sélection sans mutation scientifique |
| Sources territoriales libres | Registre vectoriel documenté, preuves et dates contrôlées |
| S2 lié à la carte territoriale du modèle | S2 utilise l’atlas, avec révision et attribution, sans réserve inventée |
| Collecte D1/D2 autonome | Consentement cartographique supplémentaire ; lieux privés masqués par défaut |

Fichiers existants modifiés :

- `app/layout.tsx` : ajout de la feuille de style limitée à l’atlas.
- `components/editor/model-editor.tsx` : passage du contrôleur cartographique au seul parcours N2.
- `components/territory/territory-workspace.tsx` : intégration dans « Notre lac » et séparation du territoire historique.
- `components/workshop/level-two-journey.tsx` : état d’atlas partagé, support S2 et référence versionnée.
- `tests/e2e/levels-territory.spec.ts` : l’attente initiale de carte absente devient l’attente du contour sourcé, avec assertion d’absence de zones inventées ; les autres assertions historiques sont conservées.

Nouveaux fichiers :

- `web/packages/contracts/geo-atlas.ts` : contrat et validation géométrique.
- `components/territory/geo-atlas-map.tsx`, `geo-atlas-workspace.tsx` : carte et recueil.
- `lib/workshop/geo-atlas.ts`, `lib/serialization/geo-atlas.ts` : état, échanges et sauvegarde distincts.
- `lib/modeling/geo-to-territory.ts` : adaptateur explicite.
- `app/geo-atlas.css` ; `data/geography/*` ; `scripts/extract-guiers-hydrolakes.py`.
- `tests/geo-atlas.test.ts`, `tests/e2e/geo-atlas.spec.ts`, `web/apps/api/tests/geo-atlas-http.test.ts`.
- Le présent rapport.

Aucune modification de `LevelNavigation`, des éditeurs de décisions/activités, du moteur C++, de Fastify, des schémas natifs, des contrats territoriaux/temporels ou des dépendances npm.

## Tests exécutés et preuves

| Commande / contexte | Résultat |
| --- | --- |
| Frontend : `npm test -- --maxWorkers=2 --reporter=dot` | **Succès : 461 tests, 34 fichiers**, dont 50 nouveaux cas cartographiques |
| Frontend : `npm run typecheck -- --incremental false` | **Succès** |
| Frontend : `npm run build` | **Succès**, production Next.js |
| `web` : `npm run build` | **Succès** |
| `web` : `npm run test:all` | **Succès : 659 tests**, aucun ignoré, API et runner réel |
| `web` : `node --test dist/apps/api/tests/geo-atlas-http.test.js` | **Succès**, preuve native JSON enregistrée |
| Frontend : `node node_modules/@playwright/test/cli.js test geo-atlas.spec.ts` | **Succès : 5 recettes** sur Chrome/production |
| Frontend : `node node_modules/@playwright/test/cli.js test workshop-journey.spec.ts levels-territory.spec.ts fishing-activity.spec.ts workshop.spec.ts workshop-v2.spec.ts workshop-v31.spec.ts` | **Succès : 14 recettes historiques** |
| Captures supplémentaires : `node node_modules/@playwright/test/cli.js test geo-atlas.spec.ts --grep 'keyboard point/sector\|S2 after D1'` | **Succès : 2 recettes ciblées**, sélection carte/liste et preuves détaillées |
| `git diff --check` | **Succès**, vérifié en fin de travail |
| Appareils physiques mobile/tablette | **Non exécuté**, dispensé explicitement par l’utilisateur |
| Validation terrain de la rive et compréhension par les pêcheurs | **Non exécuté** ; nécessite atelier et autorités/participants |

Environnement : Node 24, Chrome via Playwright ; runner existant `D:/these/irritator/build-web-test8p-bis/Release/runner/irritator-runner.exe`, non recompilé ou modifié. API de recette sur `127.0.0.1:3201`, frontend sur `127.0.0.1:3200` ; le service déjà présent sur 3001 n’a pas été arrêté.

Variables de recette (PowerShell) :

```powershell
$env:IRRITATOR_RUNNER = 'D:/these/irritator/build-web-test8p-bis/Release/runner/irritator-runner.exe'
$env:TEMP = 'D:/these/irritator/build-geo-source/tmp'
$env:TMP = $env:TEMP
$env:npm_config_cache = 'D:/these/irritator/build-geo-source/npm-cache'
$env:FRONTEND_URL = 'http://127.0.0.1:3200'
$env:IRRITATOR_API_URL = 'http://127.0.0.1:3201'
$env:IRRITATOR_PLAYWRIGHT_REPORT = '../../../reports/niveau2-2.3.B/playwright-geo.json'
# Pour le test API de preuve, depuis web :
$env:IRRITATOR_GEO_EVIDENCE = 'D:/these/irritator/reports/niveau2-2.3.B'
```

Les tentatives initiales ont rencontré les permissions du bac à sable, le disque C: saturé et un manque de mémoire du serveur de développement. Les fichiers temporaires/cache de cette recette ont été dirigés vers D:, et la recette navigateur utilise la production optimisée. Une course du test avec la sauvegarde initiale différée de l’éditeur a été corrigée en attendant son initialisation avant comparaison. Les tests n’ont été ni supprimés ni affaiblis pour masquer une régression.

### Couverture de la recette du kit

| Recette | Preuves |
| --- | --- |
| A01–A12 : vide, source, verbal, points, topologie, version/CRS/provenance fermés | 50 cas unitaires ; import invalide non destructif ; vrais contour et mode sans fond dans Chrome |
| B01–B08 : pureté, refus des points, accès explicite 0/1/intermédiaire, application native | Unités contrat/adaptateur, test API réel avec 100 déclarations, comparaison navigateur avant confirmation |
| B09 : résultats et anciennes sélections | Parcours historiques territoire/activités, conservation de requêtes et observations natives |
| C01–C07 : D1/I/D2, révision S2, brouillons et séances | `workshop-journey.spec.ts`, nouvelle recette S2 et stockage corrompu |
| C08–C11 : collecte séparée, refus, projection et export | Nouvelle recette avec D1/D2 autorisé mais carte non autorisée ; vérification d’absence de sauvegarde et de noms privés exposés ; export réel réimporté |
| D01–D07 : niveau 1, territoire, activités et schéma fermé | 14 recettes navigateur historiques, 461 tests frontend, 659 API/runner |
| E : ordinateur, clavier, hors ligne, pan distinct du clic | Nouvelles recettes Chrome ; captures réellement inspectées |

### Artifacts locaux de preuve

Dossier : [reports/niveau2-2.3.B](../../../reports/niveau2-2.3.B/). Il est ignoré par Git conformément aux conventions existantes ; les fichiers sont présents localement pour revue.

- `playwright-geo.json`, `playwright-regression.json`, `playwright-captures-details.json` : résultats structurés.
- `atlas-export-reimporte.json` : fichier téléchargé, rechargé puis comparé à l’atlas sauvegardé ; données de test explicitement fictives, aucune collecte réelle.
- `purete-native-avant-apres-carte.json` : entrées natives avant/après 100 descriptions identiques ; deux exécutions réelles, observations/simulation/événements identiques, `runId` distincts attendus.
- `requete-apres-confirmation-explicite.json` : accès `0.234` appliqué seulement après hypothèse et confirmation, secteur de recette fictif.
- `seance-s2-reference-atlas.json` : D1, attestation `discussion-map` versionnée et D2, sans ajout de champ au contrat de séance.
- Journaux frontend/API/runner et extraction conservés avec les preuves ; sorties complètes aussi dans `build-geo-source/`.

Captures ordinateur inspectées : `carte-source-pecheur-1440.png`, `carte-source-scientifique-1440.png`, `carte-sans-source-pecheur-1440.png`, `carte-sans-source-scientifique-1440.png`. Contrôle visuel : contour et îles visibles, source/millésime présents, grands boutons, carte/fiche côte à côte, aucune superposition ni débordement, sources lisibles en scientifique, état sans fond honnête. Les captures `point-en-preparation-1440.png`, `secteur-ferme-en-preparation-1440.png` et `s2-support-carte-apres-d1-1440.png` complètent ces vues. Leur inspection a conduit à supprimer un numéro de sommet répété sur l’aperçu fermé et à retirer un ancien message d’erreur dès la fermeture du secteur.

## Données manquantes et limites pour l’atelier

- Aucun lieu de pêche réel n’a encore été recueilli et autorisé ; les seules déclarations des preuves sont des fixtures de test clairement nommées fictives.
- Aucune rive actuelle certifiée ou validée localement. HydroLAKES documente une référence hydrologique ancienne ; la saison, les aménagements et les évolutions de rive doivent être discutés.
- Aucune géométrie réglementaire de réserve, aucun texte/localisation d’autorité permettant d’en tracer la limite sud, aucune attestation de bouées installées.
- Aucune coordonnée de village déduite des PDF ; repères CLPA non localisés. Pas de polygones de sensibilisation transformés en secteurs de pêche.
- Les contrôles d’import sont structurels ; le chercheur reste responsable de vérifier licence, empreinte, origine et adéquation au lieu réel. Le SVG est une projection locale de discussion, pas un SIG mondial ni une mesure de surface.
- La sauvegarde locale n’est pas une archive durable. Exporter après autorisation et contrôle de toutes les versions ; conserver une copie avant remplacement d’un atlas. Les brouillons éphémères sont perdus à la fermeture de la page, volontairement.
- La compréhension des formulations et les modalités de traduction doivent encore être éprouvées avec les pêcheurs. L’interface ne certifie ni consentement institutionnel ni validité juridique.

Le code et les données de référence sont disponibles pour validation. **La carte hydrologique sourcée est livrée ; la cartographie des pratiques et des règles actuelles reste à établir avec les participants et les autorités.**
