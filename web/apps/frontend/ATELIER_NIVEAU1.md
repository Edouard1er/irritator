# Irritator Web — atelier participatif, niveau 1

## Audit initial

Branche : `two-modes`. Aucun changement local au début de l’intervention. Le pack
`Irritator_Web_Niveau1_Pack_Codex.zip` a été lu avec ses six documents de consignes
et ses cinq maquettes. Les références extraites sont dans
`reports/niveau1-reference/` (non suivies par Git).

Points d’entrée vérifiés :

| Fonction | Chemin |
| --- | --- |
| Page Next.js et thème | `app/page.tsx`, `app/layout.tsx`, `app/globals.css` |
| Document, navigation hiérarchique, React Flow, import/export et exécution | `components/editor/model-editor.tsx` |
| Inspecteurs et observateurs des wrappers | `components/panels/wrapper-inspector.tsx` |
| Résultats scientifiques, décisions, événements et CSV | `components/panels/results-panel.tsx` |
| Trajectoires des scénarios et campagnes | `components/panels/wrapper-trajectories.tsx` |
| Plotly local | `components/charts/trajectory-plot.tsx` |
| HTTP et validation des résultats | `lib/api/client.ts`, `web/packages/contracts/` |
| API et moteur | `POST /api/v1/simulations/run`, `web/apps/api/src/services/engine.ts`, `web/engine/runner/` |

Le frontend utilise Next 16.4.2, React 19, React Flow et Plotly. Les guides locaux
Next sur les composants clients et le CSS ont été consultés. Aucune dépendance,
version, licence, équation, transition DEVS, API ou fréquence d’observation moteur
n’a été modifiée.

## Intégration

Les espaces Modélisation et Simulation restent montés, mais seul l’espace choisi
est visible. Cela conserve le document, les nœuds, les ports, les connexions,
la sélection, le viewport et les résultats en mémoire. La modélisation récupère
la hauteur auparavant occupée par les résultats. Ouvrir/Nouveau revient à la
modélisation ; lancer une exécution ouvre la simulation.

`components/simulation/simulation-workspace.tsx` présente les deux publics et les
scénarios déjà calculés. La préférence Pêcheur/Scientifique est conservée dans
le stockage local. Les résultats eux-mêmes gardent la politique existante : en
mémoire seulement. Le changement de lecture conserve le scénario et le curseur.
Le changement de scénario remet la lecture, la correspondance manuelle et le
seuil d’atelier à zéro : aucune convention d’un scénario n’est appliquée en secret
à un autre.

`lib/simulation/trajectory.ts` fournit le contrat normalisé, les adaptations,
les sélecteurs, conversions explicites et la classification pure. Le lecteur
ne fait aucun appel HTTP. La lecture dure environ 20 secondes à 1× ; les délais
sont proportionnels aux écarts de temps enregistrés, avec un minimum de 24 ms par
observation. Elle parcourt tous les points, y compris les observations simultanées,
sans les interpoler. Quitter l’espace Simulation suspend la lecture. Les plages
irrégulières gardent leurs instants réels.

## Correspondance scientifique et unités

Le graphe de référence est celui de `web/examples/wrapper-schaefer-v3.json`.
La reconnaissance vérifie le nombre d’atomes, leurs identifiants et types,
les connexions avec leurs ports, ainsi que les coefficients signés des sommes.
Le nom `N` ou `C` seul n’autorise aucune interprétation. Les valeurs des paramètres
peuvent varier ; les facteurs de chaque résultat de scénario sont conservés.
Les observations parent sont regroupées par occurrence couplée : le stock d’un
modèle n’est jamais associé automatiquement à la capture d’un autre.

| Source vérifiée | Présentation | Unité actuelle |
| --- | --- | --- |
| Intégrateur `N` du graphe Schaefer reconnu | Stock global / biomasse totale du lac | unité du modèle ; dimension physique à valider |
| Intégrateur `C`, alimenté par `qaEN` | Capture cumulée depuis le début | unité du modèle |
| Multiplicateur `qaEN` si observé | Débit de capture | unité du modèle / unité de temps du modèle |
| `N.parameters.X` | B0/N0 | unité du modèle |
| Constantes `r`, `q`, `E`, `a` | Paramètres disponibles | unités non déclarées, sauf `a` comme fraction de présentation |
| Constante `InvK` | K = 1/InvK si positif | unité du modèle |
| `scenarioTrajectories[*].observations` | Séries natives du scénario | temps local enfant, sans conversion calendaire |
| `observations` | Séries de l’exécution principale | temps du moteur parent |

Dans ce graphe, `dN/dt = rN(1 − N/K) − qaEN` et `dC/dt = qaEN`.
Le navigateur ne reconstruit pas ces équations : il affiche leurs observations.
Il ne multiplie jamais une capture par `a` ou `q`. Le seul produit dérivé affiché
est `a × N` si `a ∈ [0,1]`, explicitement décrit comme une fraction accessible du
stock global et non comme un stock local autonome.

Pour les graphes différents, le panneau « Comprendre les hypothèses » permet une
correspondance explicite des séries : biomasse totale, capture cumulée, débit ou
capture par intervalle. Sans correspondance, la donnée reste indisponible. Une
modification de topologie ou de noms ne force pas une interprétation Schaefer.

Le contrat HTTP actuel ne fournit ni unité physique, ni origine calendaire, ni date
d’exécution. L’identifiant d’exécution, le modèle, le moteur et l’adaptateur sont
affichés. Aucune tonne, année ou quantité de poissons n’est fabriquée. Les fonctions
de conversion testées acceptent kg↔t et mois↔années avec origine explicitement
déclarée ; elles ne sont pas appliquées à ces résultats sans métadonnées.

`ΔC` est la différence entre deux observations consécutives du cumul, sur leur
intervalle exact. Il n’est jamais étiqueté « annuel ». Une capture négative ou un
cumul décroissant produit un avertissement ; un incrément négatif est indisponible.
Les valeurs de capture des tuiles nécessitent un échantillon exactement au temps
sélectionné : aucune interpolation ni rapprochement silencieux. En cas de plusieurs
captures au même instant, la dernière observation dans l’ordre source fait foi.

## Seuils et lecture

Aucun seuil n’est présélectionné. Le participant saisit un seuil positif dans
l’unité de la série ; la marge de présentation est initialement 20 %. Le seuil
est toujours nommé « seuil choisi pour l’atelier », sans validation écologique.

Priorité : rouge si `B <= seuil`, orange si `B <= seuil × (1 + marge)`, jaune si
la pente est négative au-delà de la tolérance, vert si elle est stable ou positive.
L’historique insuffisant reste neutre au-dessus de l’alerte. La pente vaut
`ΔB/Δt` entre observations adjacentes ; elle est inconnue si le temps est répété
ou une valeur invalide. La tolérance initiale est exactement zéro et peut être
réglée dans les hypothèses selon l’échelle du modèle. Pas d’hystérésis cachée.

Les points non finis sont signalés. Les temps invalides sont exclus ; les valeurs
invalides restent des lacunes graphiques. Le tri est stable et conserve les
observations simultanées. Le lecteur ne dépasse jamais le dernier point disponible,
y compris pour une exécution partielle ou annulée.

La bannière, les segments, les indicateurs et les commentaires consomment les mêmes
sélecteurs. Le futur déjà enregistré est indiqué en pointillé gris ; les marches
ne sont que des guides visuels. Les graphiques scientifiques complets existants
restent disponibles, avec leurs tableaux et CSV ; un texte de curseur commun
donne la position de lecture sans tronquer les sorties scientifiques.

## Accessibilité et maquettes

Le thème clair existant suit la hiérarchie des maquettes 04–05 : état coloré et
textuel, trois indicateurs, biomasse et lac symbolique, capture et commentaire,
puis contrôles regroupés. L’espace de modélisation reprend la structure de la
maquette 01 avec le vrai React Flow. La lecture scientifique préserve les graphes
multi-scénarios des variantes 02–03.

Les boutons, curseurs natifs et sélecteurs fonctionnent au clavier. Le curseur
annonce l’instant et la valeur ; la bannière `aria-live=polite` change au changement
d’état seulement. Le mouvement des silhouettes respecte la préférence système et
le réglage explicite. Le nombre de silhouettes est constant et non proportionnel
au stock réel. Le son est désactivé à l’ouverture, autorisé par un geste utilisateur,
faible et bref, uniquement à l’entrée orange/rouge en lecture continue. Chercher
un point, recommencer ou changer de réglage ne déclenche aucune rafale.

## Vérification et preuves

Tests ajoutés : `tests/workshop.test.ts`, `tests/workshop-components.test.tsx`,
`tests/e2e/workshop.spec.ts`. Les jeux unitaires sont exclusivement dans les tests ;
aucun jeu de démonstration n’est inclus dans l’interface réelle.

Les tests de navigateur appellent l’API et le runner C++ réels, sans interception.
Ils comparent les 201 valeurs de la courbe à la réponse native, vérifient les six
scénarios et les douze courbes scientifiques N/C, puis charger/lancer/lire/pause/
reprendre/recommencer, clavier, conservation du modèle et du temps, CSV, absence
de requêtes externes et absence de nouveau calcul pendant la lecture.

Les preuves locales sont dans `reports/niveau1-evidence/` : réponse réelle JSON,
rapport Playwright et captures ordinateur/mobile. Les PNG montrent les données
du moteur, pas les séries illustratives du pack.

Recette finale sous Node 24.22.1 :

| Commande (depuis `web/apps/frontend`) | Résultat |
| --- | --- |
| `npm test -- --maxWorkers=2` | 219 tests passent, 22 fichiers |
| `npm run typecheck -- --incremental false` | TypeScript sans erreur |
| `npm run build` | Build de production et génération statique réussis |
| `npm run test:e2e -- tests/e2e/workshop.spec.ts` | 3 tests passent dans Chrome avec l’API et le runner réels |
| `git diff --check` | Vérification des espaces et fins de lignes |

Les exécutables CLI de Vitest/TypeScript/Playwright ont également été invoqués
directement avec le Node 24 embarqué, car le Node par défaut de la machine est
26.13.0. La compilation de l’API existante (`npm run build` depuis `web`) réussit.
Le runner utilisé est `build-web-test8o/Release/runner/irritator-runner.exe`.
Aucun script `lint` n’existe dans le frontend : aucun lint séparé n’est revendiqué.

La capture ordinateur a été comparée aux références : constructeur réel étendu,
onglets séparés, bandeau et indicateurs, graphiques annotés et lac symbolique. La
capture à 390 × 844 et les assertions navigateur confirment l’absence de débordement
horizontal de la page et du tableau de bord pêcheur. Les captures incluent l’état
favorable et le franchissement du seuil d’atelier ; la vue scientifique affiche
les douze séries N/C des six scénarios réels.

## Limites conservées

- Pas de nouvelle cartographie, de modèle spatial ou de fonctionnalité de niveau 2.
- Pas de conversion physique/calendaire sans évolution explicite du contrat.
- Pas d’agrégation annuelle, faute d’origine et de convention d’intégration.
- La comparaison multi-scénarios existe dans la vue scientifique ; pas de nouvelle
  référence automatique entre exécutions dont les unités sont inconnues.
- La modélisation dense conserve son canevas avec défilement horizontal sur les
  petits écrans ; la vue pêcheur passe en une colonne sans débordement.
- Les anciens tests e2e qui supposent l’éditeur et les résultats simultanément
  visibles doivent suivre la nouvelle navigation ; ils ne sont pas réécrits en bloc.
- Aucune validation scientifique des unités ou du seuil n’est revendiquée.

## Fichiers livrés et état Git

Modifiés : `README.md`, `app/layout.tsx`,
`components/editor/model-editor.tsx`, `components/charts/trajectory-plot.tsx`.

Ajoutés : `ATELIER_NIVEAU1.md`, `app/workshop.css`,
`components/simulation/simulation-workspace.tsx`,
`components/simulation/workshop-chart.tsx`, `lib/simulation/trajectory.ts`,
`tests/workshop.test.ts`, `tests/workshop-components.test.tsx`,
`tests/workshop-fixture.ts`, `tests/e2e/workshop.spec.ts`.

Ces chemins sont relatifs à `web/apps/frontend`. L’état final contient quatre
fichiers suivis modifiés et neuf nouveaux fichiers, sans changement backend.
Les preuves restent locales dans le répertoire `reports` ignoré par le dépôt.
Le fichier `next-env.d.ts` généré par le build a été rétabli dans son état initial.

Aucun commit ni push n’a été créé. Proposition de message :
`feat(frontend): add participatory fisheries simulation workspace`.
