# Niveau 2 — Incréments 2.3.B.1 et 2.3.C

Livraison locale pour revue, le 16 novembre 2026. Dépôt `Edouard1er/irritator`, branche **`anim-simu`**.

SHA initial et final : **`d071abb98d89ad3c3ab4fc4c1634eb5cfbc39596`**. L’arbre initial était propre. Aucun commit, push, changement de branche ou PR.

Archive fournie : SHA256 `a9fc91a0958cd518ba4bdf46c738171a0ca6c0f2ec9a36b170e1af2f94cb27a9`.

## État de la livraison

- **2.3.B.1 livré en premier** : barrière PRIV-01 à PRIV-08 verte avant le développement de l’animation. La protection porte sur les données rendues, pas seulement sur un avertissement ou une classe CSS.
- **2.3.C livré** : présentation SVG/CSS 2,5D dans S1, après D1 ; observations natives exactes, carte publique de référence, curseur unique, lecture/pause, pas précédent/suivant, vitesse et mouvement réduit.
- Le calcul, la prévisualisation, le commencement de présentation, sa fin et son attestation sont des actions distinctes. Un résultat obsolète ou en échec ne peut pas être attesté.
- D2 et la voie de discussion sans calcul restent disponibles selon les gardes du protocole existant. S2/S3 ne simulent aucun effet réglementaire ou économique.
- Pas de comparaison multi-runs, de modèle supplémentaire ou de dépendance nouvelle.
- La validation navigateur ciblée passe. **La totalité des anciens tests E2E du dépôt n’est pas déclarée verte** : deux anciens parcours ont des attentes déjà en échec sur le HEAD initial isolé ; détails ci-dessous.

## Audit et statut des documents

Le kit a été décompressé ; `00_LIRE_EN_PREMIER.md` a été lu intégralement, puis `06_PROMPT_CODEX.md` et les spécifications 01 à 05 et 07. Les rapports 2.3.B et 2.3.A ont été confrontés au code. `web/apps/frontend/AGENTS.md` et la documentation locale Next.js `use-client.md` ont été consultés. Les instructions du kit ont été appliquées dans le périmètre demandé par l’utilisateur, sans leur attribuer d’autorisation de publication ou de changement scientifique.

Les trois PDF ont été examinés par extraction de texte et inspection de pages rendues : plan départemental CLPA (17 pages), protocole Mbane (55 pages), analyse scientifique (44 pages). Les pages sur la demande d’étude/balisage, D1 et le modèle global ont notamment été vérifiées visuellement. L’extracteur signale une dépendance fontTools absente pour certaines fontes mathématiques ; les équations centrales ont aussi été contrôlées sur les rendus. Aucune nouvelle équation ni donnée chiffrée des PDF n’a été intégrée.

Le plan est une programmation institutionnelle, pas une mesure de biomasse. Les pirogues départementales et sorties de surveillance ne deviennent pas un effort de pêche du lac. Les limites de réserve, le calibrage, les saisons locales et les effets de surveillance ne sont pas inférés. Aucun nom de personne ou téléphone des PDF n’est intégré à l’application.

Le kit extrait est conservé hors du diff, dans `build-geo-source/kit-source-2-3-c/kit-2-3-c`. Les preuves sont dans `reports/niveau2-2.3.C/`, ignoré par Git conformément aux conventions du dépôt.

## 2.3.B.1 — Politique de confidentialité

`lib/workshop/atlas-visibility.ts` définit une politique pure commune. Le privé nécessite simultanément une lecture scientifique, un contexte non projeté et un geste explicite d’ouverture de l’espace privé. La collecte autorise la sauvegarde selon les contrôles existants ; elle ne donne aucun droit automatique à la diffusion.

Choix conservateur : **toutes les déclarations d’atelier restent masquées en vue publique**, y compris celles anciennement marquées `exportable-with-review`. Cette mention conserve sa fonction de revue pour export privé ; elle ne vaut pas consentement actuel à projeter. Aucun contrat persistant n’est modifié. Une véritable procédure de diffusion publique versionnée et reconfirmée reste à concevoir séparément.

La même projection filtre les listes, le SVG, la sélection, les descriptions, le registre et les sources sensibles. Elle est utilisée dans « Notre lac », S2 et l’encart du lecteur natif. Le lecteur reçoit une carte déjà filtrée, jamais l’atlas privé complet.

Le contrôleur suspend l’ouverture privée lors des changements d’audience, de projection, de révocation et de remplacement d’atlas. Un compteur de contexte suspend aussi les brouillons non confirmés. Leur texte et leurs sommets restent en mémoire ; ils ne sont pas montés dans le DOM public. L’animateur retrouve le brouillon après nouvelle ouverture explicite du travail privé. Une nouvelle indication volontaire dans le contexte public peut montrer son propre brouillon, sans rouvrir l’historique privé.

Un contrôle supplémentaire protège les secteurs copiés depuis l’atlas dans un modèle : leur carte héritée et leur nom ne réapparaissent pas par cette voie. Le contexte des activités affiche un libellé générique quand ce secteur est confidentiel. Les données scientifiques, les brouillons d’activités et la requête ne sont pas effacés ou réécrits pour masquer les textes.

La recette vérifie les sentinelles fictives de point, secteur, description, correction et brouillon dans **tout le HTML**, ainsi que les géométries et attributs SVG/ARIA. Elle conserve l’atlas et l’archive à l’identique après les bascules. La restauration d’un atlas conserve les contrôles existants et ne réactive jamais la vue privée.

## 2.3.C — Architecture et fidélité scientifique

```text
ModelEditor, branche de rendu Niveau 2
  LevelTwoJourney : D1 / préparation / présentation / attestation / D2
    SimulationWorkspace(guided)
      normalizeRun(HttpResult, requête exécutée)
      Playback : index, lecture/pause, vitesse et arrêt existants
        nativeReadingAt(trajectoire, index)
        FisherAnimatedBriefing
          carte HydroLAKES publique et inchangée
          SymbolicLake25D : décor SVG, six silhouettes constantes
          N, C exact éventuel, jauge relative et graphe SVG au même index
```

`nativeReadingAt` est une projection pure. Il n’intègre aucune équation, ne fabrique aucun point, n’interpole pas et n’extrapole pas. Il exige une identité de run/trajectoire/modèle, un statut exploitable et un échantillon de biomasse reconnu et fini. La série est produite par le normaliseur commun. Les observateurs arbitraires ne deviennent pas silencieusement une biomasse ; le mode guidé n’ajoute pas de mapping manuel.

Le premier point valide de la même trajectoire sert de référence. N/N₀ et N−N₀ sont explicitement des calculs dérivés. La lecture relative est absente si N₀≤0, N<0, unité physique inconnue ou calcul non fini. Un rapport supérieur à 100 % est affiché sans plafonnement silencieux ; l’échelle de la jauge est écrite. Aucune capacité écologique ou probabilité n’en est déduite.

C est affiché seulement si la série native `catch_cumulative` possède une observation à **exactement** l’instant sélectionné, via `observationAt`. Sinon : « Non observées à cet instant ». Aucune intégration locale de débit. Les conversions kg/t restent dans `normalizeRun` ; aucune tonne ou mois n’est ajouté à une unité absente.

Le graphe N2 est un SVG de lecture dédié, utilisant les mêmes points normalisés et le même index que les chiffres, le texte accessible et la jauge. Ses marches sont des guides visuels, explicités dans la trace scientifique. La courbe s’arrête au dernier point livré, y compris pour un résultat partiel. Le graphique Plotly historique et son comportement N1 ne sont pas modifiés.

La vignette n’encode pas de densité, profondeur, espèce, rive saisonnière, migration ou pirogue. **Irritator calcule N et C ; le navigateur dessine la carte, les couches d’eau et six silhouettes décoratives `aria-hidden`.** Seule la jauge et les nombres portent la variation biologique globale. Le contour HydroLAKES v1.0, `Hylak_id=1520`, ne dépend pas de N(t). Il reste une référence historique SWBD/SRTM, pas la rive actuelle ni une limite de pêche.

Le mode guidé utilise l’audience du parcours. La préférence de lecture du Niveau 1 ne l’impose pas aux pêcheurs. « Afficher les hypothèses — animateur » donne accès à l’identité, aux valeurs exactes, aux unités, aux paramètres et aux avertissements, en quittant la présentation publique. L’effort normalisé et `a_z` restent des hypothèses explicites, indépendantes des surfaces et activités déclarées. Aucun calendrier, pluie ou salinité locale n’est ajouté à cet écran.

La lecture ne démarre pas automatiquement. La préférence système de mouvement réduit prime sur la préférence manuelle. Le décor s’arrête en pause et hors étape active ; le timer existant s’arrête à la sortie et quand l’onglet est masqué. Le changement de run recrée le lecteur avec son identité. Les changements d’audience et de grand écran interrompent la lecture guidée. Aucun audio n’est initialisé par les commandes de cet écran. Les boutons et le curseur restent utilisables au clavier ; les sorties numériques sont du vrai texte, sans annonce vocale à chaque image.

## D1 / I / D2 et provenance

Les gardes sont vérifiées au rendu **et au clic** : résultat réel identifié, modèle de la requête exécutée cohérent, empreinte scientifique identique à la requête courante, absence d’erreur et de calcul en cours, biomasse native exploitable.

1. D1 est enregistré avant l’accès au support si la collecte est engagée.
2. « Lancer la simulation Irritator » calcule ; cela n’atteste rien.
3. « Prévisualiser sans enregistrer » permet une vérification ; cela n’atteste rien.
4. « Commencer la présentation » force la lecture publique et suspend la carte privée ; runId et empreinte sont mémorisés dans l’état éphémère.
5. « Terminer la présentation » arrête l’écran de lecture. Une sortie d’étape ou de niveau ne se substitue pas à cette action.
6. L’animateur confirme ensuite le support effectivement présenté ; D2 est ouvert.

L’attestation conserve exactement `WorkshopSessionV1` et `Presentation.kind='native-simulation'`, avec `runId`, `modelId`, `requestSchemaVersion`, `modelFingerprint` et note d’hypothèses. Aucune migration. L’empreinte demeure une chaîne de traçabilité, pas une signature cryptographique. Version de l’interface : **`lake-briefing-2.3.C-v1`**, documentée ici sans nouveau champ JSON.

Le run absent, non exploitable, obsolète ou en erreur ne produit aucune attestation native. D1 reste conservé ; une fiche de discussion peut être attestée explicitement et suivie de D2. Le bilan garde « maintenu / modifié / incertain », sans causalité ou amélioration supposée.

## Fichiers et préservation du Niveau 1

Nouveaux fichiers :

- `web/apps/frontend/lib/workshop/atlas-visibility.ts`
- `web/apps/frontend/lib/simulation/native-reading.ts`
- `web/apps/frontend/components/workshop/fisher-animated-briefing.tsx`
- `web/apps/frontend/app/native-briefing.css`
- `web/apps/frontend/tests/atlas-privacy.test.tsx`
- `web/apps/frontend/tests/native-reading.test.tsx`
- `web/apps/frontend/tests/e2e/native-briefing.spec.ts`
- Ce rapport.

Fichiers existants modifiés :

| Fichier sous `web/apps/frontend/` | Justification |
| --- | --- |
| `components/workshop/level-two-journey.tsx` | Confidentialité partagée, phases de présentation, gardes d’identité et d’obsolescence, audience contrôlée. |
| `lib/workshop/geo-atlas.ts` | Suspension privée et des brouillons sans effacement ; contexte de projection éphémère. |
| `components/territory/geo-atlas-workspace.tsx` | Filtrage avant rendu, sources/registre/sélection/brouillons protégés, clarification export/diffusion. |
| `components/territory/territory-workspace.tsx` | Protection de la voie secondaire des secteurs dérivés de l’atlas. Géographies historiques autonomes préservées. |
| `components/territory/fishing-activity-editor.tsx` | Libellé générique optionnel pour les noms de secteurs confidentiels ; conservation des états et calculs d’activités. |
| `components/editor/model-editor.tsx` | Passage des options guidées et de l’activité/obsolescence dans la seule branche N2. Branche de rendu N1 inchangée. |
| `components/simulation/simulation-workspace.tsx` | Option `guided` facultative ; réutilisation de Playback. Sans cette option : sélection, préférences, rendu, son, interventions et contrôles N1 conservés. |
| `app/layout.tsx` | Import du nouveau CSS, intégralement limité à `.native-briefing` et à une animation nommée propre. |
| `tests/workshop-journey.test.tsx` | Garde supplémentaire prévisualisation / présentation / obsolescence. |
| `tests/e2e/geo-atlas.spec.ts` | Ancienne attente de brouillon privé en Pêcheur remplacée par absence du DOM, puis reprise explicite et valeur intacte. Export privé clarifié. |
| `tests/e2e/workshop-journey.spec.ts` | Ajout des gestes explicites prévisualiser / commencer / terminer avant les assertions natives historiques conservées. |
| `tests/e2e/levels-territory.spec.ts` | Ouverture explicite de la prévisualisation avant les assertions historiques de lecture. |

Aucun changement de C++, API, runner, `nativeRequest`, équations, contrats persistants, schémas, normaliseur commun, données HydroLAKES, CSS cartographique, CSS global ou dépendances npm. Aucun test supprimé. Les adaptations des trois recettes existantes suivent les nouvelles gardes de confidentialité et présentation ; leurs assertions sur données, sauvegardes, requêtes et observations sont conservées ou renforcées.

`git diff --stat` des fichiers déjà suivis : **12 fichiers, 117 insertions, 60 suppressions** ; il ne compte pas les sept nouveaux fichiers de code/tests et le rapport non indexés. Les fichiers générés par la compilation et une capture historique réécrite par les anciens tests ont été restaurés à leur contenu initial après conservation de la preuve utile. Pas de changement d’index destiné à un commit.

Preuves finales : [statistiques du diff](reports/niveau2-2.3.C/git-diff-stat.txt), [état Git](reports/niveau2-2.3.C/git-status-final.txt). Les services locaux démarrés pour la recette ont été arrêtés après validation.

## Tests exécutés

Environnement : Windows, PowerShell, Node **26.13.0** fourni par le runtime, Chrome via Playwright. Les `engines` du projet demandent Node 24 : qualification spécifique sous Node 24 non exécutée. Runner préexistant `D:/these/irritator/build-web-test8p-bis/Release/runner/irritator-runner.exe`, utilisé sans modification ou recompilation. API locale 3201, frontend de production 3200.

| Commande / campagne | Résultat vérifié |
| --- | --- |
| Baseline frontend avant modification : `npm test -- --maxWorkers=2 --reporter=dot` | **461 tests, 34 fichiers : succès.** |
| Barrière P0 : tests `atlas-privacy`, `geo-atlas`, `workshop-journey` | **65 tests : succès**, dont PRIV-01 à PRIV-08, avant l’animation. |
| Frontend final : `npm test -- --maxWorkers=2 --reporter=dot` | **482 tests, 36 fichiers : succès.** |
| Frontend : `npm run typecheck -- --incremental false` | **Succès.** |
| Frontend : `npm run build` | **Succès**, build de production incluant vérification TypeScript. |
| Depuis `web` : `npm run test:all` avec `IRRITATOR_RUNNER` | **659 tests : succès, 0 échec, 0 ignoré**, compilation API et vrais runs natifs inclus. |
| Playwright : nouvelles recettes `native-briefing.spec.ts` | Confidentialité navigateur et parcours natif avec captures : **succès**. |
| Playwright : sept suites historiques pertinentes, 19 recettes | **19 réussites** ; N1/N2, lecteur, audio, grand écran, atlas, activités, import/export et provenance. |
| Playwright final groupé : ces sept suites + `native-briefing.spec.ts` | **21 tests réussis, 0 échec, 0 ignoré** ; `playwright-final.json`. |
| `git diff --check` | **Succès**, après revue finale. |
| Anciens tests éditeur/hiérarchie, contrôle isolé du HEAD initial | **2 échecs préexistants confirmés**, décrits ci-après ; pas présentés comme réussites. |

Journaux : [frontend](reports/niveau2-2.3.C/tests-frontend.log), [API/runner](reports/niveau2-2.3.C/tests-api-runner.log), [build](reports/niveau2-2.3.C/build-frontend.log), [campagne ciblée](reports/niveau2-2.3.C/playwright-regression-journey.json), [campagne finale](reports/niveau2-2.3.C/playwright-final.json), [baseline N1](reports/niveau2-2.3.C/playwright-baseline-n1.json).

### Réserve sur les anciennes recettes E2E

Une tentative élargie à 74 recettes a rencontré les attentes anciennes de `editor.spec.ts` (trois parcours arrêtés sur le statut accessible exactement « Terminé »). Une seconde campagne élargie a passé les six premières recettes carte/activités, puis rencontré `hierarchy.spec.ts` sur « Fermer les connexions ». Ces campagnes ont été interrompues pour diagnostiquer ; elles ne constituent pas une validation de tous leurs tests restants.

Pour distinguer ce problème d’une régression, le HEAD initial a été exporté avec `git archive` dans `build-geo-source/HEAD-baseline-2-3-c/`, sans changement de branche. Il a été compilé et servi séparément sur 3202, avec les mêmes dépendances et la référence JSON locale non suivie `web/model-test/modelhalieutiquetest.json`. Les deux recettes suivantes ont été exécutées sans modification de leurs assertions :

```powershell
$env:FRONTEND_URL = 'http://127.0.0.1:3202'
node node_modules/@playwright/test/cli.js test editor.spec.ts hierarchy.spec.ts --grep 'importe le fichier sum3|crée Sum2Block' --timeout 30000
```

Elles échouent aussi sur cette version initiale :

- Import sum3 : la simulation native répond correctement, puis le test attend un statut accessible exactement `Terminé`, absent de la vue courante.
- Création Sum2Block : les observations natives attendues sont obtenues, puis le test attend le bouton `Fermer les connexions`, absent de la vue courante.

Le rapport machine de baseline contient ces deux échecs, sans résultat simulé substitué. Les autres anciennes suites du grand ensemble n’ont pas toutes été menées à leur terme. Leur remise à jour demande une tâche de maintenance de recette séparée ; aucune assertion n’a été retirée pour rendre cette livraison artificiellement verte.

### Couverture du registre du kit

| Registre | Preuve |
| --- | --- |
| PRIV-01…08 | Tests de composants avec vrais contrôleurs, carte et parcours ; test Chrome du DOM complet, SVG, rôles, S2, brouillons, import et restitution. Test supplémentaire du secteur copié dans le modèle. |
| NAT-01…11 | `native-reading.test.tsx` : points 0/1/3, absence de C au temps 1, zéro, négatif/non fini, unités, partiel, identité, stale, observateurs arbitraires, kg/t, vitesse et six silhouettes constantes. Fixtures explicitement fictives et séparées des données du site. |
| UI-01…04, 08…09 | Parcours natif réel et historique, gardes avant D1, prévisualisation sans attestation, même point N/graphe, changements d’audience, fin explicite, D2, export/réimport et panne injectée sans faux résultat. |
| UI-05…07 | Préférence système restrictive, pause, curseur, absence d’initialisation audio guidée, arrêt onglet caché et sortie ; grand écran/Échap et lecteur historique dans les régressions. |
| UI-10 | Atlas vide volontaire pendant la lecture d’un résultat natif réel : message de fond manquant, nombres natifs conservés, aucune carte inventée. |
| UI-11…13 | S2/S3 sans effet calculé ; contour identique pendant la lecture ; sauvegarde, curseur, modèle et sorties N1 conservés après allers-retours. |
| CMP | Non implémenté ; aucune trajectoire B fabriquée. |

### Incidents environnementaux et limites de qualification

Le bac à sable a d’abord refusé la création du journal et du temporaire Vite (`EPERM`). Les tests ont ensuite été exécutés avec l’autorisation automatique nécessaire ; pas de modification des règles de permission du dépôt. Git signale parfois l’impossibilité de lire le fichier d’exclusions global de l’utilisateur ; les commandes finales ont néanmoins été exécutées et leurs codes vérifiés. Aucun rejet d’approbation automatique n’est resté bloquant.

Les sondes des deux niveaux peuvent saturer brièvement la limite native (`ENGINE_BUSY`) au chargement ; les recettes qui le prévoient reconnectent le moteur. La limite et le protocole restent inchangés. Les premières captures ont révélé un chevauchement propre au nouvel encart (hauteur du conteneur limitée, SVG historique plus haut) ; la règle fautive a été supprimée au profit d’une hauteur SVG locale. Une assertion vérifie maintenant que la légende suit le SVG.

Pas de recette dédiée sur téléphone ou tablette, conformément à la précision de l’utilisateur. Les anciens tests qui redimensionnent déjà leur fenêtre ont été conservés sans suppression. Pas de validation exhaustive par lecteurs d’écran, sur appareils physiques, ni d’essai de compréhension avec des pêcheurs. La recette logicielle ne constitue pas une validation biologique ou pédagogique de terrain.

## Captures et mesures ordinateur

Captures à **1 069 et 1 440 px**, inspectées sur leurs vrais pixels. Les captures déroulent les conteneurs pour montrer l’écran entier ; les assertions de largeur et de non-chevauchement portent sur la mise en page normale, avant ce style temporaire de capture.

| État | 1 069 px | 1 440 px |
| --- | --- | --- |
| Attente sans calcul | [capture](reports/niveau2-2.3.C/attente-1069.png) | [capture](reports/niveau2-2.3.C/attente-1440.png) |
| Pêcheur, lecture native | [capture](reports/niveau2-2.3.C/pecheur-lecture-1069.png) | [capture](reports/niveau2-2.3.C/pecheur-lecture-1440.png) |
| Pause au point exact | [capture](reports/niveau2-2.3.C/pause-1069.png) | [capture](reports/niveau2-2.3.C/pause-1440.png) |
| Lecture scientifique | [capture](reports/niveau2-2.3.C/scientifique-1069.png) | [capture](reports/niveau2-2.3.C/scientifique-1440.png) |
| Présentation publique protégée | [capture](reports/niveau2-2.3.C/projection-protegee-1069.png) | [capture](reports/niveau2-2.3.C/projection-protegee-1440.png) |
| Mouvement réduit système | [capture](reports/niveau2-2.3.C/mouvement-reduit-1069.png) | [capture](reports/niveau2-2.3.C/mouvement-reduit-1440.png) |

État supplémentaire : [calcul natif sans fond géographique](reports/niveau2-2.3.C/native-sans-fond-1440.png).

Mesures cartographiques : [layout-measures.json](reports/niveau2-2.3.C/layout-measures.json). À 1 024 / 1 069 / 1 440 px, les conteneurs utiles mesurent respectivement 968 / 1 013 / 1 384 px ; `scrollWidth` n’excède pas `clientWidth`, dans les deux lectures. La carte garde ses proportions. **`geo-atlas.css` est intact** : aucune refonte déduite d’une capture partielle.

## Démonstrations reproductibles

### Avec résultat natif

1. Niveau 2, Scientifique : autoriser la collecte de décisions et donner un code fictif pour la recette. Préparer explicitement une hypothèse territoriale valide ; pour reproduire les tests, la démonstration séparée « Zone fictive A » est annoncée comme fictive et n’est pas ajoutée au lac réel.
2. S1 : enregistrer D1 « Rechercher plus d’informations » ; choisir le support « Simulation calculée par Irritator ».
3. Lancer le modèle, puis prévisualiser. D2 et l’attestation sont encore verrouillés.
4. Commencer la présentation : lecture Pêcheur protégée. Lire deux ou trois observations, faire pause, examiner le temps, N, C éventuel et la référence relative. Les silhouettes restent six.
5. Terminer la présentation, revenir Scientifique et confirmer le support effectivement présenté. Enregistrer D2 « Réduire les sorties ».
6. Vérifier la fiche : D1, présentation native avec vrai runId et empreinte, puis D2 distinct ; aucun calcul de causalité.

Preuves : [requête et réponse réellement calculées](reports/niveau2-2.3.C/native-run.json), [séance D1/I/D2](reports/niveau2-2.3.C/session-d1-i-d2-native.json). Les choix et données de recette sont fictifs ; les valeurs de trajectoire de cette preuve proviennent réellement du runner.

### Discussion sans résultat

Enregistrer D1, puis constater l’absence ou l’échec du calcul. Choisir la fiche de discussion, la présenter et la confirmer explicitement ; enregistrer D2. La fiche reste `discussion-card`, sans runId natif inventé. Preuve : [séance avec repli sans calcul](reports/niveau2-2.3.C/session-discussion-sans-calcul.json). Le test injecte uniquement une panne HTTP, jamais une réponse scientifique factice.

## Limites scientifiques et idées 2.3.D non développées

- Calibrage avec observations de terrain, identification des unités d’effort et analyse d’incertitude.
- Géométries locales et réglementaires vérifiées, avec procédure séparée de consentement actuel à la diffusion des versions.
- Éventuelle comparaison de plusieurs résultats réellement conservés, identifiés par `(runId, trajectoryId)`, avec unités, définitions et temps compatibles. Le stockage courant du parcours conserve un résultat courant ; aucune refonte multi-runs entreprise ici.
- Éventuelle 3D seulement avec une question scientifique et des données spatiales adéquates ; aucun travail Three.js/WebGL commencé.

Une biomasse totale unique demeure la seule ressource représentée. Les cartes, déclarations, surfaces et décisions D1/D2 ne recalibrent pas le moteur. Ni la rive actuelle, ni une réserve géométriquement connue, ni une amélioration des décisions grâce au modèle ne sont affirmées.
