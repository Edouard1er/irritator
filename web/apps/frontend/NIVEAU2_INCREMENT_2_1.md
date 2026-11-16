# Niveau 2 — Incrément 2.1 : coexistence et territoire

Implémentation sur `anim-simu`, sans modification du moteur C++, sans commit ni push.

## Fonctionnalités et architecture

Le menu global donne accès à **Niveau 1 — Atelier actuel** et **Niveau 2 — Lac de Guiers**. Chaque niveau possède ses propres espaces Modélisation et Simulation. Le niveau 1 réutilise intégralement l'atelier existant. Le niveau 2 ajoute les vues **Territoire** et **Éditeur scientifique**, et partage le lecteur et le service de simulation natif existants.

Les deux ateliers restent montés après leur première ouverture : modèle, modifications non enregistrées, scénario, paramètres, résultats, comparaison, réglages et curseur temporel restent dans leur instance. Le niveau inactif transmet `active=false` au lecteur : pause et arrêt audio, sans remise à zéro du curseur. Ses raccourcis de suppression du graphe sont désactivés. Aucun transfert automatique de modèle n'est effectué.

Le niveau 1 conserve sa clé de sauvegarde `irritator.workspace.v2` et son repli v1. Le niveau 2 utilise `irritator.level2.workspace.v2`. Les préférences de lecture et de son ont également des clés distinctes. La session de lecture reste en mémoire lors de la navigation ; un rechargement de page restaure le modèle, pas les résultats ni le lecteur, comme historiquement.

La vue Territoire démarre sans géométrie, avec un état explicite « Les zones restent à renseigner ». Elle charge un GeoJSON local ou une démonstration clairement fictive. Une seule zone peut être sélectionnée par clic, Entrée ou Espace, avec contour épais en pointillés et coche. Zoom, recentrage et déplacement sur le fond de carte sont disponibles.

Sélectionner une zone prépare un choix, sans modifier le modèle et sans lancer de calcul. **Confirmer cette zone** applique une copie validée du modèle. **Préparer la simulation** ouvre l'espace Simulation ; **Simuler** appelle Irritator. La configuration préparée, celle appliquée et celle des résultats sont distinguées.

La lecture Pêcheur présente la zone, les poissons dans tout le lac, l'accès et les poissons accessibles. La lecture Scientifique ajoute identifiants, coefficient exact, unités, provenance, hypothèses, paramètres et limites. En Simulation, une synthèse de zone calcule la biomasse accessible au point natif actuellement sélectionné. En Territoire, après calcul, la dernière observation native disponible est utilisée et datée, avec l'indication de la configuration calculée.

## Invariant scientifique et limites

`N(t)` reste la biomasse globale unique en tonnes. La lecture accessible est uniquement `a_z × N(t)` : **100 t × 0,10 = 10 t**, sans changer les 100 t globaux. Aucun stock local, intégrateur par zone, solveur JavaScript, partage par surface ou double application de `a` n'est ajouté.

L'application territoriale exige l'expérience temporelle Schaefer v3 reconnue en tonnes/mois. Le niveau 2 commence avec `web/examples/atelier-interventions-month-v3.json`, qui conserve ses hypothèses pédagogiques existantes. L'accès est mis à jour dans la constante `a` et dans `temporal.parameters.a`, puis contrôlé par le validateur et compilateur temporels existants. Les autres modèles restent utilisables dans l'éditeur scientifique ; l'application d'une zone est refusée si le modèle n'est pas reconnu.

Avant exécution, la biomasse vient de `N.parameters.X` uniquement si l'expérience est reconnue et validée. Après exécution, seules les observations natives reconnues en tonnes sont utilisées ; sinon « Non disponible » est affiché. Aucun résultat biologique n'est fabriqué.

Les interventions existantes sur pluie, salinité, effort et autres conditions restent disponibles. Pour une zone appliquée, l'accès reste constant : le curseur est verrouillé et les validateurs refusent un historique modifiant `a`. Une expérience contenant déjà une intervention sur `a` ne peut pas recevoir silencieusement une zone. Multi-zone, changements de zone en cours de simulation, stocks locaux et dynamiques spatiales restent réservés aux incréments suivants.

## Sources et contrat géographiques

Aucun fichier géographique du lac n'a été trouvé dans le dépôt. Aucun contour réel, limite officielle ou zone de gestion n'a été inventé ; aucun site d'échantillonnage n'a été requalifié. Les rectangles de démonstration sont synthétiques, situés à l'origine des coordonnées et sans relation avec le lac de Guiers. Le caractère fictif est indiqué dans le bandeau et sur la carte.

Le chargement fonctionne hors ligne, sans fond de carte distant. Le contrat est une collection GeoJSON Polygon/MultiPolygon en longitude/latitude WGS84 avec les métadonnées suivantes :

```json
{
  "type": "FeatureCollection",
  "id": "exemple-fictif-v1",
  "name": "Territoire fictif",
  "source": "Géométrie synthétique, aucune donnée réelle",
  "demonstration": true,
  "features": [{
    "type": "Feature",
    "properties": {
      "id": "zone-fictive-A", "name": "Zone fictive A", "role": "zone",
      "accessibility": 0.1, "provenance": "Valeur pédagogique fictive"
    },
    "geometry": { "type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,1],[0,0]]] }
  }]
}
```

`role` vaut `lake` pour un contour ou `zone` pour une zone sélectionnable. Le coefficient peut manquer dans un fichier incomplet : la zone reste consultable, mais sa confirmation exige une accessibilité finie entre 0 et 1 et sa provenance. Les identifiants sont uniques dans toute la collection ; les champs supplémentaires non déclarés sont refusés.

La validation contrôle les coordonnées finies, leurs bornes, les anneaux fermés et leur surface non nulle. Elle ne certifie ni l'autorité administrative/écologique des limites ni toute la topologie du jeu de données. La projection locale et les positions des étiquettes sont indicatives ; aucune surface scientifique n'est calculée.

Bornes : 750 ko par chargement géographique, 128 éléments, 128 polygones par MultiPolygon, 128 anneaux par Polygon, 20 000 positions par anneau. L'import/export complet reste soumis à la limite historique de 1 Mio.

## Extension JSON facultative

Le schéma v3 fermé accepte `territory = { geography, zoneId, accessibility, provenance, parameter: "a" }`. La géographie complète est embarquée pour un aller-retour hors ligne reproductible. Sélection, coefficient, provenance, paramètre temporel et constante du graphe doivent concorder. L'extension est conservée par import/export et sauvegarde locale, puis retirée par `nativeRequest` avant le runner C++. Aucun champ territorial n'est requis pour les anciens JSON v1/v2/v3.

## Fichiers créés et adaptés

Créations :

- `components/navigation/level-navigation.tsx` : navigation globale et maintien des instances.
- `components/territory/level-two-workspace.tsx` : espace indépendant du niveau 2.
- `components/territory/territory-workspace.tsx` : lectures, choix préparé/appliqué, chargement local.
- `components/territory/territory-map.tsx` : carte SVG, zoom, déplacement, sélection accessible.
- `lib/modeling/territory-demo.ts` : données fictives explicitement signalées.
- `app/territory.css` : styles adaptatifs et contrôles tactiles.
- `web/packages/contracts/territory.ts` : types, validation, application atomique et lecture algébrique.
- `tests/territory.test.ts`, `tests/territory-components.test.tsx`, `tests/e2e/levels-territory.spec.ts` et `web/apps/api/tests/territory-http.test.ts` : tests.
- Le présent compte rendu.

Adaptations : `app/page.tsx`, `app/layout.tsx`, `components/editor/model-editor.tsx`, `components/simulation/simulation-workspace.tsx`, `components/simulation/conditions-editor.tsx`, `lib/modeling/model.ts`, `web/packages/contracts/index.ts`, `request-v3.schema.json`, `units.ts`, README des contrats. Aucun fichier C++ modifié.

## Validation exécutée le 14 novembre 2026

- Frontend : **330 tests réussis**, dont les suites historiques et 34 nouveaux cas territoriaux.
- API historique (`npm test`) : **42 tests réussis**.
- Intégration HTTP/TCP avec Irritator réel : **5 tests réussis**.
- API unités et moteur réel : **2 tests réussis**.
- API territoriale et moteur réel : **1 test réussi**, couvrant `a=0`, `a=0,10`, `a=1` et la comparaison exacte des observations avec un modèle de contrôle.
- Chrome/Playwright : **6 tests réussis** (`levels-territory`, `workshop`, `workshop-v31`), couvrant navigation, conservation du curseur et du scénario, audio, grand écran, animation, saisons, pluie, captures, export/import et mobile.
- Typage frontend, compilation API et build frontend de production réussis.

Les commandes initiales ont rencontré des refus d'écriture de caches dans le bac à sable ; elles ont ensuite été exécutées avec les autorisations nécessaires. Des erreurs de typage dans les nouveaux tests ont été corrigées et le typage a été réexécuté avec succès. Le runner existant utilisé est `build-web-test8o/Release/runner/irritator-runner.exe`. Les serveurs de vérification ont utilisé les ports séparés 3002/3100 pour préserver le serveur déjà actif. L'environnement observé utilise Node v26.13.0 ; le dépôt déclare Node 24 dans ses contraintes `engines`.

Commandes reproductibles depuis les répertoires correspondants :

```text
# web/apps/frontend
npm run typecheck
npm test -- --reporter=dot
npm run build
npx playwright test levels-territory.spec.ts workshop.spec.ts workshop-v31.spec.ts --reporter=list

# web
npm test
npm run test:integration
node --test dist/apps/api/tests/units.test.js dist/apps/api/tests/territory-http.test.js
```

## Captures vérifiables

Dans `reports/niveau2-2.1/` depuis la racine du dépôt :

- `territoire-pecheur.png` et `territoire-pecheur-complet.png` : navigation et lecture Pêcheur avec actions.
- `territoire-scientifique.png` et `territoire-scientifique-complet.png` : identifiants, valeur exacte, sources et hypothèses.
- `territoire-1024.png` et `territoire-390.png` : tablette et mobile.
- `zone-confirmee.json` : export effectivement réimporté pendant le test.

La démonstration utilise l'état initial pédagogique existant de 150 t : accès de 10 %, soit 15 t accessibles. Ce n'est pas une estimation réelle du lac. Le cas obligatoire 100 t et 10 % donnant 10 t est vérifié séparément dans les tests.
