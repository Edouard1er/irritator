# Irritator Web — atelier participatif, niveau 1

## État actuel : itération 2

L’itération 2 prolonge le frontend existant sur `two-modes`. Au début de cette
intervention, `git status --short` était vide. Le présent document remplace la
recette de l’itération 1 ; les limitations historiques sur les unités, les trois
indicateurs, le nombre constant de poissons et le son bref sont levées pour les
modèles explicitement documentés. Aucun commit ni push n’est créé.

Avant modification ont été inspectés les contrats v1/v2/v3, leurs validateurs
Ajv, la frontière HTTP/runner C++, les graphes Schaefer, les facteurs, les
observateurs, les inspecteurs, la sérialisation et les tests existants. Les guides
Next locaux sur les composants clients ont été consultés.

## Décision scientifique sur les modèles historiques

Les fichiers historiques déclarent `r = 0.35`, `q = 0.0008 / 0.001`, `E = 80 / 150 /
260`, N0 = 150 et K = 300. Leur graphe vérifié donne :

- dB/dt = r B (1 − B/K) − q a E B ;
- dC/dt = q a E B.

Aucune indication retrouvée dans ces sources ne permet d’affirmer que leurs taux
sont annuels ou mensuels. Les anciens JSON ne sont donc pas réétiquetés et aucune
division par 12 n’est appliquée à leurs coefficients. Ils restent chargeables,
exécutables et exportables avec des unités inconnues.

Le fichier **`web/examples/atelier-schaefer-month-v3.json`** est un nouveau modèle
d’atelier, issu du graphe vérifié des six trajectoires. Il définit explicitement
une **nouvelle hypothèse pédagogique** en tonnes et mois : r = 0,35 mois⁻¹,
q = 0,0008 ou 0,001 (unité d’effort · mois)⁻¹. Il conserve les valeurs numériques
pour cette hypothèse, sous un nouvel identifiant. Ce n’est ni la conversion d’une
ancienne trajectoire physique établie, ni une calibration du lac. Cette provenance
figure dans le JSON et dans le panneau des hypothèses.

Pour l’utiliser, ouvrir ce JSON dans Modélisation, puis lancer la simulation.
Il observe explicitement N et C pour les six scénarios déjà prévus. Les anciens
exemples et les fichiers de référence ne sont pas écrasés.

## Métadonnées JSON et dimensions

Extrait de la définition couplée `Schaefer` :

```json
{
  "units": {
    "time": "month",
    "biomass": "t",
    "cumulativeCatch": "t",
    "catchRate": "t/month",
    "growthRate": "1/month",
    "accessibility": "ratio",
    "effort": "effort",
    "catchability": "1/(effort*month)",
    "provenance": {
      "basis": "workshop-convention",
      "note": "Nouvelle hypothèse pédagogique ; échelle historique inconnue."
    }
  }
}
```

Les composants portent aussi des unités structurées :

```json
{
  "id": "N",
  "type": "qss3_integrator",
  "parameters": { "X": 150, "dQ": 0.01 },
  "units": { "output": "t", "parameters": { "X": "t", "dQ": "t" } }
}
```

`units` est facultatif sur `model`, chaque définition et chaque composant, dans
les trois schémas JSON. Les unités acceptées sont énumérées ; les champs inconnus
sont refusés. La provenance distingue déclaration, convention d’atelier et
conversion documentée (`sourceTime` requis pour cette dernière).

La validation vérifie r en temps⁻¹, q en (effort × temps)⁻¹, B/N0/K/C/dQ en masse,
InvK en masse⁻¹, a sans dimension dans [0,1], ainsi que les références de paramètres
et les délais `offset`. Ainsi rB(1−B/K) et qaEB ont la dimension masse/temps.
L’unité d’effort reste une unité définie par le modèle ; aucun bateau, jour de
pêche ou engin concret n’est inventé.

Ce contrôle vise les déclarations du vocabulaire Schaefer reconnu ; il ne
constitue pas un solveur dimensionnel général de tous les composants DEVS.
Les taux annuels déclarés peuvent être convertis explicitement avec
`convertRate(r, 'year', 'month') = r/12` et les durées avec
`convertDuration(t, 'year', 'month') = 12t`. Ces fonctions ne migrent jamais un
modèle à l’ouverture. kg↔t est testé ; l’adaptateur convertit les masses et débits
explicitement déclarés en kg pour l’affichage en tonnes, ainsi que N0/K.

## Horloges et frontière moteur

Une occurrence couplée partage l’horloge DEVS de son parent. Des déclarations
contradictoires année/mois sur ce même couplage sont refusées avant exécution.
Une horloge manquante dans un descendant couplé peut hériter de celle du parent.
En revanche, un prospectif `simulation_wrapper` possède sa propre horloge locale :
les métadonnées de sa définition sont conservées indépendamment du parent.
Aucune durée enfant n’est transformée implicitement en délai du parent.

Une transformation complète d’un couplage changeant d’échelle temporelle n’est
pas automatisée : elle doit convertir les paramètres/délais/observateurs du modèle
avant de déclarer un temps commun. Le nouveau modèle d’atelier est cohérent en
mois et ne nécessite pas cette transformation.

L’API valide les métadonnées, puis `nativeRequest` retire exclusivement `units`
avant de transmettre le document au runner installé, dont le protocole scientifique
reste inchangé. Après validation des sorties natives, `attachResultUnits` annote
les observations avec `unit` et `timeUnit`, et les trajectoires prospectives avec
leurs unités et provenance. Les annotations sont dérivées de la requête validée.
Les valeurs et temps des observations ne sont jamais recalculés par cet adaptateur.
Le test HTTP compare exactement chaque échantillon des six scénarios avec et sans
métadonnées. Aucun changement C++, équation, transition DEVS, catalogue, dépendance
ou version de protocole natif n’est nécessaire.

## Scénarios et indicateurs

Les identifiants wrapper/campagne/scénario demeurent intacts. Les libellés Pêcheur
classent les valeurs d’E par rang dans la campagne : faible, intermédiaire, élevée.
Les variantes A/B suivent les valeurs triées de q. Le numéro du scénario ne sert
jamais à déduire sa catégorie. Pour deux niveaux d’effort, seules faible/élevée
sont utilisées ; un niveau unique est annoncé comme tel. Ces catégories sont
relatives aux scénarios comparés, sans validation empirique de gestion.

La lecture Scientifique affiche le vrai numéro et E/q. Le panneau des hypothèses
conserve tous les paramètres avec leurs unités et la provenance complète.
Changer de scénario sélectionne les sorties déjà calculées ; aucun nouvel appel
moteur. Il remet la lecture, les correspondances, le seuil et l’activation sonore
à zéro pour éviter d’appliquer les conventions d’un scénario à un autre.

Les trois indicateurs Pêcheur sont désormais :

1. **Poissons dans tout le lac** : B(t), biomasse globale.
2. **Poissons pêchés depuis le début** : C(t), cumul fourni par le moteur.
3. **Pêche sur les 12 derniers mois** : C(t) − C(t−12 mois).

La fenêtre doit être complète et les deux bornes présentes dans l’observateur C.
La recherche tolère uniquement l’arrondi IEEE-754 (32 epsilon × échelle du temps),
sans rapprocher des observations physiquement distinctes. Pour t=20 mois, la borne
est 8 mois, jamais l’observation précédente. En années déclarées, la fenêtre vaut
1 an. Un historique insuffisant, une borne absente, une lacune ou un cumul incohérent
produit **Non disponible**, avec une raison explicite. Aucun cumul partiel n’est
appelé capture annuelle ; aucun débit n’est intégré sans convention numérique.

ΔB/Δt reste dans la lecture scientifique et détermine la tendance qualitative.
La priorité commune est rouge si B≤Bcrit, orange si B≤Bcrit(1+marge), jaune si la
pente est négative au-delà de la tolérance, vert sinon. Au-dessus de l’alerte,
l’historique insuffisant reste neutre. Aucun seuil par défaut : 140 t ne constitue
pas une référence écologique validée. La marge initiale de 20 % est pédagogique.

## Visualisations synchronisées et présentation

Les sélecteurs partagent le même index dans les observations enregistrées. Le
lecteur conserve les instants irréguliers, parcourt les observations simultanées
sans division par zéro, et s’arrête au dernier point disponible. Le changement
de public et le passage en Grand écran conservent scénario et temps. Quitter
Simulation ou masquer l’onglet suspend la lecture.

- Le graphique de biomasse colore les observations déjà lues et affiche le futur
  enregistré en pointillé gris, avec seuil et zone d’alerte.
- Le lac utilise un seul Canvas 2D : **1 pictogramme = 1 tonne simulée**. Le nombre
  est arrondi à la tonne la plus proche (83,87 t → 84 symboles) sans arrondir les
  indicateurs. Aucun plafond à 10/20/50. Cellules stables, ordre déterministe,
  apparition/disparition progressive pendant la lecture, mise à jour immédiate
  lors d’une recherche, et image fixe en pause ou mouvement réduit.
- Les pictogrammes ne sont ni des poissons réels d’une tonne, ni une preuve de
  répartition spatiale. Sans unité de masse établie, l’échelle n’est pas affichée.
- a×B, lorsqu’il est affiché, est une fraction accessible du stock global, jamais
  un stock autonome par zone. Aucune capture n’est multipliée à nouveau par q/a/E.
- La jauge SVG **Où en est la ressource ?** remplace les paragraphes : B, seuil,
  limite d’alerte, K réellement disponible et direction. Le jaune dépend aussi
  de la tendance ; il n’est pas déduit de la seule position sur la jauge.

Le tableau de bord compact tient à 1920×1080 sans défilement vertical dans la
recette (conteneur et contenu : 943 px). À 1366×768 et sur mobile, un défilement
raisonnable conserve des contrôles lisibles ; pas de débordement horizontal mobile.
Grand écran utilise la Fullscreen API, sinon une présentation fixe dans la fenêtre.
Le bouton de retour et Échap fonctionnent ; la navigation de fond devient inerte
au clavier. Les graphiques et le lac bénéficient de la surface supplémentaire.
Aucune entrée/sortie de ce mode ne lance de calcul.

Les graphiques scientifiques multi-scénarios natifs restent disponibles, ainsi
que décisions, événements, tableaux et CSV. Axes, survols et tableaux portent les
unités déclarées. Les CSV gardent leurs anciennes colonnes pour les résultats sans
métadonnées ; sinon `timeUnit,unit` sont ajoutées. L’export JSON contient requête,
résultats, unités, horloges, paramètres et provenance, sans conversion de nombres.

## Sons et accessibilité

Le son est désactivé initialement et nécessite un geste explicite autorisant
AudioContext. Volume réglable, bouton **Arrêter l’alarme**, aucun son vert, jaune
facultatif à l’entrée, orange de 2,4 secondes, rouge en sirène à modulation lente
(0,65 Hz), continue uniquement pendant la lecture critique autorisée.

Un seul graphe audio peut exister : remplacer une alerte détruit le précédent.
La boucle rouge utilise un oscillateur et un LFO, sans timer d’accumulation. Pause,
désactivation, recherche, changement de scénario, sortie de Simulation, onglet
masqué et sortie d’état critique arrêtent et déconnectent les nœuds. Le volume
modifie le gain sans recréer une alarme. Les refus du navigateur conservent les
alertes visuelles. L’activation asynchrone ne peut pas réactiver un son annulé.
L’annonce vocale, facultative dans la mission, n’est pas ajoutée.

La préférence système de mouvement réduit est respectée et ne peut être annulée
par inadvertance. Les boutons et curseurs fonctionnent au clavier. La bannière
annonce les changements d’état, pas chaque frame ; le temps n’est pas aria-live.
Les valeurs numériques restent disponibles indépendamment du Canvas.

## Vérification et preuves

Exécution sous Node 24.22.1 embarqué (le Node système est 26). Résultats :

| Vérification | Résultat |
| --- | --- |
| Frontend Vitest complet | 246 tests passent, 25 fichiers |
| API : backend, processus, intégration HTTP et unités | 49 tests passent |
| Chrome : workshop-v2.spec.ts + workshop.spec.ts | 7 parcours passent sur le build de production avec API et moteur C++ réels |
| TypeScript frontend et compilation API | Sans erreur |
| Build Next de production | Vérifié en fin d’itération |
| git diff --check | Vérifié en fin d’itération |

Les tests couvrent import/export/localStorage, ancienne version sans unités,
kg/t, année/mois et taux, dimensions incompatibles, horloges imbriquées, invariance
numérique réelle, libellés indépendants des numéros, fenêtres irrégulières et leurs
bornes, compte effectif de 100/150/600 symboles dessinés, pause/reprise/recherche,
composants synchronisés, refus audio, graphes audio sans superposition, véritables
oscillateurs Chrome, plein écran natif et refusé, Échap, clavier, conservation du
modèle, exports, absence de requêtes externes et de recalcul pendant la lecture.

Les suites navigateur historiques hors atelier ne sont pas toutes rejouées ; les
anciens tests qui supposent modélisation et résultats simultanément visibles
restent à adapter au découpage introduit à l’itération 1. Aucun lint séparé n’est
revendiqué : le frontend ne possède pas de script lint.

Le test dense démarre une véritable simulation à 600 t, puis vérifie l’augmentation
du nombre de symboles sans multiplication des nœuds DOM. Sur cette machine,
45 intervalles entre images donnent une médiane de 16,7 ms et un 95e percentile de
16,8 ms (maximum 16,8 ms, après chargement des graphiques). Cette mesure locale n’est pas une garantie de
fréquence d’affichage sur tout matériel ; elle est conservée dans
`canvas-performance.json`. La pause fige également les pixels du Canvas.

Preuves locales ignorées par Git : `reports/iteration2-evidence/` contient
`real-engine-result.json`, `playwright.json`, `layout-1920.json`, les preuves HTTP
d’intégration et les captures : orange, vert, rouge, jaune, Scientifique,
Grand écran, bureau 1366×768 et mobile. Les captures utilisent les sorties réelles,
pas les valeurs illustratives de la mission. Le runner utilisé est
`build-web-test8o/Release/runner/irritator-runner.exe`.

## Fichiers de cette itération

Chemins relatifs à la racine du dépôt :

- Contrats : `web/packages/contracts/{index.ts,wrapper-v3.ts,units.ts,request.schema.json,request-v2.schema.json,request-v3.schema.json}`.
- API : `web/apps/api/src/services/engine.ts`, `web/apps/api/tests/units.test.ts`.
- Exemple explicite : `web/examples/atelier-schaefer-month-v3.json`.
- Frontend, sous `web/apps/frontend/` :
  - `app/workshop.css` ;
  - `components/simulation/{simulation-workspace.tsx,workshop-chart.tsx,biomass-lake.tsx,resource-gauge.tsx}` ;
  - `components/charts/trajectory-plot.tsx` ;
  - `components/panels/{inspector.tsx,wrapper-inspector.tsx,results-panel.tsx}` ;
  - `lib/api/client.ts`, `lib/modeling/model.ts`, `lib/serialization/csv.ts` ;
  - `lib/simulation/{trajectory.ts,indicators.ts,alert-audio.ts}` ;
  - `tests/{workshop-components.test.tsx,workshop-v2.test.ts,workshop-v2-components.test.tsx,alert-audio.test.ts}` ;
  - `tests/e2e/workshop-v2.spec.ts` ;
  - `ATELIER_NIVEAU1.md`, `README.md`.

Limites scientifiques : aucune calibration écologique, aucun seuil validé, aucune
attribution rétroactive d’unités aux anciens modèles, aucune interpolation du
cumul ni conversion implicite des horloges. Les résultats décrivent les hypothèses
simulées ; ils ne constituent pas une prévision certaine de l’état réel du lac.
