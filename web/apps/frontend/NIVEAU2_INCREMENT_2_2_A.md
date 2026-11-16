# Niveau 2 — Incrément 2.2.A — Activités de pêche

Travail sur `anim-simu`, sans commit ni push. Les modifications préexistantes du niveau 2 ont été conservées.

## Audit préalable

- Branche vérifiée avant modification : `anim-simu`.
- État initial examiné : dix fichiers suivis déjà modifiés, ainsi que les composants, contrats et tests territoriaux non suivis des incréments précédents. Aucun de ces travaux n’a été annulé.
- Instructions `AGENTS.md` du frontend et documentation Next.js embarquée lues.
- Parcours examiné : navigation des niveaux → `ModelEditor` → `TerritoryWorkspace`, éditeur scientifique partagé et `SimulationWorkspace`.
- Contrats examinés : schéma v3 fermé, validations Ajv et sémantiques, unités, compilation temporelle, frontière `nativeRequest`, service API et runner C++.
- Persistance examinée : `saveWorkspace`/`loadWorkspace`, `serializeModel`/`deserializeModel`, import/export JSON et sauvegarde différée du document.
- Niveau 1 préservé : clés `irritator.workspace.v2`/`irritator.workspace.v1`, composants d’animation, conditions et vues de résultats existants. La clé du niveau 2 reste `irritator.level2.workspace.v2`. Les changements apportés au composant éditeur partagé sont conditionnés par `level === 2` pour la gestion des résultats et des métadonnées d’activité.

## Parcours livré

Après confirmation d’une zone, le bouton « Comment allez-vous pêcher ? » et les étapes Zone / Activité / Résumé permettent de préparer l’activité, revenir à la carte et rejoindre la simulation existante. La confirmation ne force pas le changement d’écran et conserve le parcours territorial antérieur.

L’utilisateur choisit une période relative explicite, crée plusieurs groupes, les modifie et les supprime après une confirmation dont le premier choix conserve le groupe. Les identifiants sont stables, générés à la création et conservés lors des modifications. L’ordre des groupes est préservé.

Chaque groupe décrit catégorie et nombre de pirogues, pêcheurs mobilisés, sorties mensuelles par pirogue, durée totale de sortie et engin principal. Les champs facultatifs comprennent nombre d’engins, dimensions de filet, pêche effective par sortie, durée de pose et notes. Les champs de filet sont absents pour un autre engin. « Autre » impose une description, sans imposer de maillage réglementaire.

La lecture Pêcheur présente les pratiques, le résumé et un message bref : les données décrivent la pêche prévue et ne modifient pas encore les résultats. La lecture Scientifique ajoute identifiants, variables, unités, provenance modifiable, hypothèses, données manquantes et limites.

Les étapes sont gardées montées : les saisies en cours survivent aux changements d’étape, de lecture, d’espace et de niveau. Les groupes et périodes **enregistrés** sont sauvegardés localement, exportés et restaurés. Les brouillons de groupe non enregistrés restent en mémoire ; ils ne survivent pas à un rechargement ou au remplacement explicite du document. Lors du changement de période avec un groupe en cours, une confirmation prévient l’abandon de cette saisie.

Les activités sont rattachées au document courant (projet), au scénario temporel déclaré, à un instantané de zone/carte et à leur période. Des périodes différentes peuvent être conservées pour le même contexte. Changer de zone ne réattribue pas les anciennes activités. Les autres zones/scénarios restent consultables dans « Autres activités conservées » ; pour les éditer, reconfirmer la zone et utiliser le scénario correspondant. Une référence à une carte remplacée reste un instantané déclaré, sans certification géographique.

## Contrat facultatif et versionné

Le document scientifique reste en version 3. Il accepte cette extension :

```json
{
  "fishingActivities": {
    "version": 1,
    "units": {
      "boats": "canoe",
      "fishers": "person",
      "tripsPerBoatPerMonth": "trip/(canoe*month)",
      "tripDurationHours": "h",
      "gearCount": "gear",
      "netLengthM": "m",
      "meshSizeMm": "mm",
      "effectiveFishingHours": "h",
      "soakHours": "h"
    },
    "activities": [{
      "id": "activity-example",
      "zone": { "geographyId": "synthetic-demo-v1", "zoneId": "demo-A", "name": "Zone fictive A" },
      "scenario": "identifiant du scénario temporel du document",
      "period": { "start": 0, "end": 12, "unit": "month" },
      "provenance": { "basis": "declared", "note": "Déclaration des participants, exemple fictif." },
      "groups": [{
        "id": "group-example",
        "canoe": { "category": "small", "count": 2 },
        "fishers": 4,
        "tripsPerBoatPerMonth": 12,
        "tripDurationHours": 6,
        "gear": { "category": "net" }
      }]
    }]
  }
}
```

Ce fragment illustre l’extension ; le document complet effectivement exporté et réimporté est `reports/niveau2-2.2.A/activite-exportee-reimportee.json`.

Les catégories de pirogue sont `small`, `medium`, `large`, `other`. Celles d’engin sont `net`, `line`, `trap`, `other`. Les descriptions des catégories `other` sont obligatoires. Les autres caractéristiques sont facultatives et restent absentes lorsqu’elles ne sont pas connues.

Les périodes sont des intervalles `[start,end[` en mois relatifs au début de l’expérience, sans calendrier civil implicite. L’activité y est constante. Des intervalles contigus peuvent porter des pratiques différentes, y compris un repos (aucun groupe ou zéro sortie). Deux périodes de la même zone/carte et du même scénario ne peuvent se chevaucher : les groupes doivent alors être réunis.

Validation commune à l’import, la sauvegarde, l’export et l’API : schéma fermé, version et unités exactes, catégories reconnues, entiers non négatifs exacts, nombres finis, identifiants uniques, période ordonnée et cohérence des valeurs. Des sorties positives exigent pirogues, pêcheurs et durée positifs. Un nombre d’engins explicitement nul ne peut accompagner des sorties positives. La pêche effective par sortie ne peut dépasser la durée de sortie ; la pose peut s’étendre sur plusieurs sorties. Les durées supérieures à 24 h sont acceptées.

Limites exclusivement techniques : 120 périodes, 100 groupes par période et textes de 500 caractères pour borner volume et coût de validation ; la limite HTTP existante de 1 Mio s’applique toujours à l’ensemble du document. Les entiers sont bornés par `Number.MAX_SAFE_INTEGER` pour préserver leur précision, y compris le total des sorties. Les totaux d’heures doivent rester finis en IEEE-754. Aucune borne physique ou écologique n’est déduite de ces limites.

## Formules et séparation scientifique

- `T_m = Σ_i P_i × S_i,m` : sorties-pirogue/mois.
- `H_m sortie = Σ_i P_i × S_i,m × D_i,m` : heures-pirogue/mois de sortie.

Exemple : 2 pirogues × 12 sorties = **24 sorties-pirogue/mois**, puis 24 × 6 h = **144 heures-pirogue/mois**. Les 4 pêcheurs ne multiplient aucun de ces indicateurs. Plusieurs groupes s’additionnent ; zéro sortie produit zéro pour les deux indicateurs.

Le temps de pêche effective et la pose ne sont ni imputés aux données absentes ni substitués à la durée totale. Aucun total d’effort effectif n’est déduit.

`nativeRequest` retire l’extension complète avant l’envoi au runner. Aucune modification du protocole natif, des équations, du graphe scientifique, de `E(t)`, `q(t)`, `a(t)`, des interventions ou de l’animation n’est réalisée. La formule `E = 50 G u_G + 30 M u_M + 20 P u_P` reste inchangée. Les résultats biologiques sont exclusivement ceux d’Irritator.

Une modification descriptive ne rend pas les résultats scientifiques périmés. L’export d’expérience depuis Simulation reçoit les dernières métadonnées descriptives, et une intervention conserve ces données même si elle part d’un résultat calculé avant leur saisie. Le chemin de niveau 1 conserve son comportement initial.

## Fichiers de cet incrément

Créés :

- `web/packages/contracts/fishing-activity.ts` : types, vocabulaire, unités, indicateurs et validation sémantique.
- `web/apps/frontend/components/territory/fishing-activity-editor.tsx` : saisie, groupes, résumé et deux lectures.
- `web/apps/frontend/tests/fishing-fixture.ts` : données de référence fictives.
- `web/apps/frontend/tests/fishing-activity.test.ts` : calculs, contrat, import/export/sauvegarde et séparation scientifique.
- `web/apps/frontend/tests/fishing-activity-components.test.tsx` : création, édition, suppression protégée, conservation et présentation.
- `web/apps/frontend/tests/e2e/fishing-activity.spec.ts` : parcours navigateur, moteur réel, captures et réimport.
- `web/apps/api/tests/fishing-activity-http.test.ts` : comparaison avec le runner C++ et intervention temporelle réelle.
- Le présent compte rendu.

Modifiés à partir de l’état préexistant :

- `web/packages/contracts/index.ts` et `request-v3.schema.json` : extension facultative et validation commune.
- `web/packages/contracts/units.ts` : retrait de l’extension à la frontière native.
- `web/packages/contracts/README.md` : contrat et limites documentés.
- `web/apps/frontend/lib/modeling/model.ts` : validation locale et comparaison scientifique indépendante de la description.
- `web/apps/frontend/components/territory/territory-workspace.tsx` : étapes et intégration.
- `web/apps/frontend/components/editor/model-editor.tsx` : conservation des métadonnées dans Simulation et comparaison des résultats au niveau 2.
- `web/apps/frontend/app/territory.css` : formulaire et résumés adaptatifs, cibles tactiles et focus visibles.
- `web/apps/frontend/components/charts/trajectory-plot.tsx` et `components/simulation/workshop-chart.tsx` : garde de visibilité avant redimensionnement et gestion du retour asynchrone de Plotly ; les parcours ont révélé une tentative de redimensionnement après masquage du graphique. Aucun contenu, tracé, paramètre ou calcul scientifique n’est modifié.

Les autres fichiers déjà modifiés au début de la tâche ne font pas partie de cet incrément.

## Vérifications et preuves

- `npm run build` depuis `web/` : compilation TypeScript API/contrats réussie.
- `npm test -- --reporter=dot --maxWorkers=4` depuis le frontend : **373 tests réussis**, 31 fichiers, dont les tests antérieurs du niveau 1 et du territoire. La limitation des workers évite la saturation simultanée avec les tests natifs ; le test d’intégration de composant dispose de 15 secondes pour son parcours complet.
- Typage frontend vérifié par `npm run typecheck -- --incremental false` et par le build Next.js strict, sans désactiver les erreurs TypeScript.
- `npm run build` frontend : **build de production réussi**, trois pages statiques générées. Un répertoire temporaire isolé a permis de préserver le serveur de développement préexistant ; la configuration de build initiale est restaurée après les vérifications.
- Tests API sélectionnés : **48 réussis**, via `node --test` sur `backend.test.js`, `process.test.js`, `territory-http.test.js`, `fishing-activity-http.test.js`, `interventions.test.js` et `units.test.js`. Runner réel : `build-web-test8p-bis/Release/runner/irritator-runner.exe`.
- Le test scientifique utilise le même modèle territorial avec une intervention à t = 1 mois ; les descriptions à 0, 12 et 120 sorties donnent exactement le même document natif, les mêmes observations, les mêmes événements et le même déroulement natif que sans extension. Le graphe et l’expérience temporelle (dont E/q/a) sont inchangés. Les imports/charges invalides sont refusés.

- Playwright, build de production sur `127.0.0.1:3200` et API isolée sur `127.0.0.1:3003` : **7 tests réussis** (1,1 minute), rapport `reports/niveau2-2.2.A/playwright-acceptance.json`. Fichiers : `fishing-activity.spec.ts` (1), `levels-territory.spec.ts` (1), `workshop.spec.ts` (3), `workshop-v31.spec.ts` (2). Le nouveau parcours se termine sans erreur JavaScript navigateur et compare les observations natives avant/après la description. Les serveurs temporaires sont arrêtés ; les serveurs préexistants ne sont pas arrêtés.

Les tests ont conduit à corriger les noms accessibles des sélecteurs, l’affichage des erreurs d’import dans Territoire et le redimensionnement d’un graphique masqué. Des contrôles initiaux du runner peuvent répondre `ENGINE_BUSY` lorsque les deux niveaux montés interrogent simultanément le service (limite existante de deux processus) ; le nouveau parcours attend la fin des requêtes et reconnecte explicitement le moteur, sans modifier cette limite ni le protocole.

Captures réelles dans `reports/niveau2-2.2.A/` :

| Format | Pêcheur | Scientifique |
| --- | --- | --- |
| Bureau 1440 px | `activite-pecheur-bureau.png`, `resume-pecheur-bureau.png` | `activite-scientifique-bureau.png` |
| Tablette 1024 × 900 | `activite-pecheur-1024.png`, `saisie-pecheur-1024.png` | `activite-scientifique-1024.png` |
| Mobile 390 × 900 | `activite-pecheur-390.png`, `saisie-pecheur-390.png` | `activite-scientifique-390.png` |

Les captures complètes déroulent temporairement les conteneurs pour exposer le contenu entier ; elles ne changent ni les données ni les contrôles. Les fichiers bureau et mobile ont été inspectés visuellement. Les contrôles automatiques vérifient l’absence de débordement horizontal, les noms accessibles, le focus et la navigation au clavier, les commandes tactiles, la conservation des données et le cloisonnement des deux lectures.

Le JSON `activite-exportee-reimportee.json` contient le modèle v3 complet, sa carte fictive et l’exemple de référence (2 pirogues, 4 pêcheurs, 12 sorties, 6 heures). Il est effectivement téléchargé puis réimporté dans le navigateur. La sauvegarde locale est comparée à l’export ; après réimport et rechargement, les groupes et les totaux sont à nouveau vérifiés. Un import JSON invalide laisse le document précédent intact.

## Limites et incrément 2.2.B

- Définir et valider avec les scientifiques la correspondance entre pratiques déclarées et `E(t)` : unités, catégories, rendements, temps effectif, engins et hypothèses de capturabilité. Aucun coefficient de conversion provisoire n’a été introduit.
- Décider comment distinguer les temps de déplacement, pêche, pose et relève, et quelles données sont nécessaires par technique. Une durée de pose longue n’équivaut pas à des heures-pirogue de sortie.
- Valider provenance et catégories locales avant d’interpréter les déclarations comme des données de terrain. Les captures et l’exemple restent fictifs.
- Définir le futur passage des périodes descriptives aux événements temporels, sans dupliquer le compilateur existant ; l’extension actuelle peut déjà stocker des périodes contiguës différentes selon les mois.
- Définir ensuite la correspondance avec l’animation et l’éventuelle évolution des scénarios et zones ; aucun changement de ces mécanismes n’est anticipé ici.
- Une activité descriptive associée à une ancienne carte reste conservée comme instantané. Il n’existe pas encore d’outil de migration entre référentiels géographiques ni de sélecteur autonome de scénarios descriptifs.
