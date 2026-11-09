# Test 8I — Plans dynamiques sous incertitude et décision générique dans T*

9 novembre 2026, Windows x64/MSVC, WITH_GUI=OFF. Travail sans commit ni push.
Les modifications 8H présentes au début du travail sont conservées.

## Résultat et périmètre

Le démonstrateur compose directement 8G et 8H : B* observe le Plant, construit
un plan E×q et H dans des atomes DEVS, reçoit les vrais résultats de ses
enfants, calcule CH−C0, regroupe par E, sélectionne et applique uniquement E.
Le modèle principal exécute six puis quatre enfants et applique 150 à t=1
et t=3. La variante à action unique exécute six puis deux enfants et applique
80 à t=3, avec la trajectoire différente attendue. Un troisième document
démontre la réduction réelle du domaine contextuel q.

**Aucune primitive, aucun algorithme QSS et aucun code moteur de production
n'est ajouté ou modifié pour 8I.** Le C++ ajouté est un exécutable de preuve,
pas un composant scientifique. Les calculs JavaScript supplémentaires sont
des générateurs de documents et des oracles de test ; ils ne pilotent pas
la simulation. Les exemples restent des modèles scientifiques JSON v3
importables et modifiables dans React Flow.

## Audit de compatibilité 8G/8H, avant construction

Sources examinées : rapports 8A à 8H, les trois exemples demandés, générateurs
8B/8C/8E/8F/8G/8H, suites correspondantes, `core.hpp`, `simulation.cpp`,
`event.cpp`, `group-native-tests.hpp`, compilateur hiérarchique et wrapper
JSON/natif, contrats `wrapper-v3.ts`, catalogue et inspecteurs React Flow.
Les validations historiques 7A–7G sont aussi reprises par les suites natives,
runner, API et navigateur.

| Fonction | Existant audité | Choix 8I |
|---|---|---|
| Observer puis agir | 8D/8E : state_observer, zero_order_hold, SynchronizePair | Réutilisation exacte du Plant, du prospectif et de la synchronisation 8H |
| Produire Pk dans DEVS | 8H : BuildPlan, comparateur, filtres, opérateurs déclenchés et event_tag.preserveCampaign | Paramétrage de deux domaines fixed, sans générateur de plan dans le frontend |
| Deux facteurs indépendants | 8H accepte plusieurs domaines indexés ; produit premier facteur le plus rapide | E en facteur 2, q en facteur 3, après N0/C0 single |
| H et état initial | Plan scellé, requiredInputs, copies de prototype fixes, bornes locales | H=20/10 et états observés exigés à chaque campagne |
| Transaction confluente | Correctifs 8H préservant plan-ready sur init | Réutilisation ; nouvelle preuve init/seal/run dans un même sac |
| Regrouper les hypothèses | 8G : group_aggregate, clé et action séparées, validation stricte, manifeste et clôture | Clé=E et action=E ; q ne devient jamais une action |
| Capture future | 8G comparait CH dans une campagne, en conservant C0 dans l'interface | event_operator(operation=2, required=3) calcule explicitement CH−C0 |
| Validité commune | chReady/joinCH/joinN et scoreReady/joinGroups de 8G | Même câblage extrait dans des couplés réutilisables |
| Contrainte, tri, repli | 8C/8G : event_operator, candidate_filter, candidate_select, selection_priority | Réutilisation de ConditionalDecision ; seuil et directions éditables |

Le test multidimensionnel 8H établissait déjà un produit dynamique à deux
facteurs. 8I vérifie en plus la variation de chacun des domaines, leur
changement simultané, les groupes, les décisions et la trajectoire bouclée.
Aucune incompatibilité générique nécessitant une modification native n'a été
constatée. L'extraction en couplés ne modifie pas les règles des atomes 8G.

## Architecture complète et contrats

```text
A*c = plant:SchaeferPlant
  state_observer N/C ← read de B*
  effort:zero_order_hold ← E uniquement

B* = observer:ObserverDecision
  request → SynchronizePair → BuildPlan → domaines E/q et métadonnées
  N0/C0 → requiredInputs d'A**
  plan-ready d'A** → opérateur execute → run d'A**
  GroupedDecision
    receive:ReceiveResults → groups:AggregateActions
                            → evaluate:EvaluateGroups
                                → choose:ConditionalDecision
                                  filtre + deux sélecteurs + priorité
  action retenue → maintien du Plant

A** = forecast:simulation_wrapper
  prototype SchaeferProspect fixe, scénario local [0,H]
  enfants réels → facteurs et critères individuels → B*
```

Toutes les valeurs événementielles identifiées suivent `[valeur,identité,campagne]`.
Les identités de résultats sont des scénarios ; après agrégation, ce sont des
groupes locaux. L'action finale est volontairement `[E,0,0]`.

| Sous-modèle | Entrées | Sorties / contrat |
|---|---|---|
| SchaeferPlant | read, action | Observations N/C identifiées ; q principal reste 0.001 |
| SynchronizePair | N, C, demande et reset | Deux états de la même campagne ; aucune observation initiale de substitution |
| BuildPlan | observation N synchronisée, reset | Domaine E sur sortie 0 ; plan sur 1 ; domaine q sur 2 ; mêmes identités de campagne |
| ReceiveResults | Nmin, CH, C0, valid, end, reset | DeltaC réellement soustrait et validité commune ; jointures par scénario/campagne |
| AggregateActions | Nmin, DeltaC, E, valid, end, reset, weight, seal | Crob, Cmax, Nrob, count, action, end, status, validCount, totalCount, member, campaignStatus |
| EvaluateGroups | Crob, Nrob, action, end, reset | Jointure des groupes ayant les deux métriques, comparaison du seuil et sortie de sélection |
| ConditionalDecision | primaire, secondaire, action, condition, end, reset | Action, identité, scores, selected, taggedAction, end et statuts des deux branches |

`ReceiveResults` exige CH et le C0 du **même scénario et de la même campagne**.
Sa clôture de soustraction compte les résultats numériques effectivement
transmis. La chaîne de validation commune provient de 8G ; les agrégateurs
attendent toujours le **total** annoncé par le wrapper. Un statut invalide
ne crée pas de critère ni de facteur numérique. La comparaison des groupes
attend un vrai Crob et un vrai Nrob ; aucun zéro de jointure n'est un score
scientifique de remplacement.

Les quatre `group_aggregate` sont min DeltaC, max DeltaC, min Nmin, count.
Les identifiants historiques `minCH`/`maxCH` des atomes sont conservés ; dans
ces nouveaux documents leur entrée est **DeltaC**, et non CH. Validation=0,
required=11, endCount=1 ; les champs omis gardent les défauts du catalogue.
Les sorties status/validCount/totalCount/member/campaignStatus exposées par le
couplé proviennent de minCH ; la preuve C++ vérifie ces sorties sur **chacun**
des quatre agrégateurs.

## Construction et transfert des plans

Paramètres principaux : N0=150, C0=0, E0=260, r=0.35, K=300, a=1,
q=0.001, dQ=0.01, temps parent [0,5], demandes aux dates 1 et 3.
Le prototype prospectif et ses critères restent fixes : Nmin=min(N),
CH=max-last(C). Le prototype déclare une capacité E=[80,150,260],
q=[0.0008,0.001], Hmax=20. Ses états sentinelles ne peuvent pas remplacer
les observations requises.

BuildPlan contient une comparaison N<140. Deux candidate_filter activent
les branches complémentaires ; leurs sorties déclenchent des event_operator
contenant les valeurs éditables et des event_tag les adressant. Les domaines,
cardinalités, identité/version, H et seal sont donc **émis après observation**,
pendant la simulation. Le frontend ne les choisit pas à l'exécution.

| Document / campagne | t | N observé | C observé | E transmis | q transmis | H | plan/version | Enfants réels |
|---|---:|---:|---:|---|---|---:|---|---:|
| Principal, 1 | 1 | 138.722797477662 | 37.474201388035 | 80,150,260 | .0008,.001 | 20 | 1/1 | 6 |
| Principal, 2 | 3 | 148.032956366218 | 80.549582911628 | 80,150 | .0008,.001 | 10 | 2/1 | 4 |
| Single, 1 | 1 | idem principal | idem principal | 80,150,260 | .0008,.001 | 20 | 1/1 | 6 |
| Single, 2 | 3 | idem principal | idem principal | 80 | .0008,.001 | 10 | 2/1 | 2 |
| Context, 1 | 1 | idem principal | idem principal | 80,150,260 | .0008,.001 | 20 | 1/1 | 6 |
| Context, 2 | 3 | idem principal | idem principal | 80,150 | .0008 | 10 | 2/1 | 2 |

Avec F=4/S=2, les ports réels du wrapper sont :

| Entrée | Contenu |
|---|---|
| x0/x1 | init / run historiques |
| x2/x3 | N0/C0 single `[observation,0,campagne]` ; requiredInputs=initialN,initialC |
| x4/x5 | E/q fixed `[valeur,indice,campagne]` |
| x6 | `[valeur,champ,campagne]` : 0 planId, 1 version, 2 H, 3 seal, 4 cancel, 7 cardinalité E, 8 cardinalité q |

| Sortie | Contenu |
|---|---|
| y0..y5 | Gagnant historique : Nmin, CH, N0, C0, E, q ; ce gagnant ne commande pas le Plant |
| y6 | Statut individuel |
| y7/y8/y9/y10 | N0, C0, E, q réellement appliqués à chaque enfant |
| y11/y12 | Nmin et CH bruts de chaque enfant |
| y13 | `[valides,total,campagne]` |
| y14 | plan-ready `[nombre réel,planId,campagne]` |

Toutes les sources d'un plan et son seal peuvent parvenir dans le même sac.
La validation inspecte la transaction complète ; le run est déclenché par
**plan-ready**, dans des sacs suivants à la même date parent. Aucun epsilon
ou délai artificiel n'est ajouté. La preuve native contrôle observation <
ready < run < action, le plan/version scellé, les domaines, leur produit,
la taille de `embedded_sims`, les paramètres et dQ de chaque enfant, ses
limites [0,H], le q inchangé du Plant et le reset du même graphe compilé.

Les campagnes repartent chacune du scénario 0. Le premier facteur fixed E
varie le plus vite. Les enfants ne sont pas exécutés puis retirés : quatre
ou deux simulations sont effectivement allouées au second cycle.

## Résultats individuels natifs du modèle principal

Valeurs arrondies ici ; les doubles complets et les sacs sont conservés dans
les JSON HTTP/native et les journaux C++. H=20 en campagne 1, H=10 en campagne 2.

| Campagne | Scénario | E | q | N0 réel | C0 réel | Nmin | CH | DeltaC | Valide |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 80 | .0008 | 138.722797478 | 37.474201388 | 138.722797478 | 319.944905667 | 282.470704279 | 1 |
| 1 | 1 | 150 | .0008 | 138.722797478 | 37.474201388 | 138.722797478 | 474.839064801 | 437.364863413 | 1 |
| 1 | 2 | 260 | .0008 | 138.722797478 | 37.474201388 | 122.591960082 | 565.838984697 | 528.364783309 | 1 |
| 1 | 3 | 80 | .001 | 138.722797478 | 37.474201388 | 138.722797478 | 372.695377104 | 335.221175716 | 1 |
| 1 | 4 | 150 | .001 | 138.722797478 | 37.474201388 | 138.722797478 | 525.092425402 | 487.618224014 | 1 |
| 1 | 5 | 260 | .001 | 138.722797478 | 37.474201388 | 83.248187791 | 552.393434572 | 514.919233184 | 1 |
| 2 | 0 | 80 | .0008 | 148.032956366 | 80.549582912 | 148.032956366 | 211.757046851 | 131.207463939 | 1 |
| 2 | 1 | 150 | .0008 | 148.032956366 | 80.549582912 | 148.032956366 | 291.003022188 | 210.453439276 | 1 |
| 2 | 2 | 80 | .001 | 148.032956366 | 80.549582912 | 148.032956366 | 237.553329243 | 157.003746332 | 1 |
| 2 | 3 | 150 | .001 | 148.032956366 | 80.549582912 | 148.032956366 | 321.545162150 | 240.995579239 | 1 |

Les dix résultats sont comparés à dix simulations **plates natives distinctes**
du même prospectif et de ses vrais paramètres, tolérance 1e-9, puis à un
oracle analytique indépendant, tolérances Nmin=0.05 et CH=0.30. Aucune de
ces références ne fournit une donnée d'entrée décisionnelle.

## Groupes, indicateurs, contraintes et repli

| Campagne | Groupe local | Membres | E | min DeltaC = Crob | max DeltaC | min Nmin = Nrob | Valides/total | Statut |
|---|---:|---|---:|---:|---:|---:|---|---|
| 1 | 0 | 0,3 | 80 | 282.470704279 | 335.221175716 | 138.722797478 | 2/2 | 1 complet |
| 1 | 1 | 1,4 | 150 | 437.364863413 | 487.618224014 | 138.722797478 | 2/2 | 1 complet |
| 1 | 2 | 2,5 | 260 | 514.919233184 | 528.364783309 | 83.248187791 | 2/2 | 1 complet |
| 2 | 0 | 0,2 | 80 | 131.207463939 | 157.003746332 | 148.032956366 | 2/2 | 1 complet |
| 2 | 1 | 1,3 | 150 | 210.453439276 | 240.995579239 | 148.032956366 | 2/2 | 1 complet |

Le groupe est identifié par le minimum des scénarios de son manifeste, dans
sa campagne. La filiation `member=[scénario,groupe,campagne]` et l'action
`[E,groupe,campagne]` sont vérifiées sur les quatre agrégateurs. Après la
réduction du domaine, le groupe d'E=80 contient 0/2 au lieu de 0/3. Les
essais avec E=[150] ou E=[150,80] au deuxième cycle vérifient que le groupe
0 peut désigner 150 : aucun identifiant permanent d'action n'est supposé.

La sélection principale exige Nrob>=140 et maximise Crob. Le repli maximise
Nrob, puis Crob ; le dernier départage utilise la plus petite identité
locale de groupe. En campagne 1, aucun groupe n'est admissible, car Nmin
comprend l'état initial inférieur à 140. Le repli compare les vrais groupes :
80 et 150 ont le même Nrob ; Crob choisit 150. En campagne 2, les deux
actions sont admissibles, et Crob choisit 150. `selection_priority` attend
les statuts des deux sélections et ne fabrique pas d'action de remplacement.

Les agrégats ne sont comparés **qu'à l'intérieur d'une campagne**. Les deux
horizons 20 et 10 ne sont jamais utilisés comme des durées équivalentes.
Soustraire le même C0 à tous les candidats d'une campagne conserve leur
classement ; un essai natif synthétique vérifie aussi le dernier départage.

### Variante E unique et variante contextuelle

| Variante, campagne 2 | Scénario | E | q | Nmin | CH | DeltaC | Groupe / membres |
|---|---:|---:|---:|---:|---:|---:|---|
| single | 0 | 80 | .0008 | 148.032956366 | 211.757046851 | 131.207463939 | 0 / 0,1 |
| single | 1 | 80 | .001 | 148.032956366 | 237.553329243 | 157.003746332 | 0 / 0,1 |
| context | 0 | 80 | .0008 | 148.032956366 | 211.757046851 | 131.207463939 | 0 / 0 |
| context | 1 | 150 | .0008 | 148.032956366 | 291.003022188 | 210.453439276 | 1 / 1 |

Dans single, le groupe complet 2/2 choisit 80, seule action candidate, et
l'applique réellement à t=3. Dans context, chaque groupe est complet 1/1,
min=max DeltaC ; les deux actions ont le même ensemble contextuel explicite
{.0008}, et 150 est choisi. L'absence de .001 figure dans le plan scellé
(cardinalité q=1) et dans les enfants : ce n'est pas un résultat manquant.
**Cette décision ne démontre pas une robustesse sur {.0008,.001}.** Les
agrégateurs partitionnent E ; la cohérence de l'ensemble q comparé résulte
ici du produit cartésien réellement exécuté, du manifeste commun et de la
validation stricte, pas d'une interprétation probabiliste implicite.

### Politiques alternatives vérifiées

Une configuration `constrained=false` retire le comparateur et utilise le
masque 11 du filtre : maximiser Crob seul choisit 260 au premier cycle,
modifie la seconde observation, conserve la branche N<140 et exécute six
scénarios avec H=20 au second cycle. Ce résultat dépend bien des états
calculés, pas d'un calendrier de plans précodé.

Les directions des deux candidate_select sont aussi modifiées séparément :
minimiser le score principal choisit 80 au deuxième cycle ; avec seuil=1000
et repli minimisant Nrob, 260 est choisi. Le navigateur modifie les deux
directions, le seuil et l'opération d'agrégation, puis retrouve sa nouvelle
politique après export/réimport. Aucun de ces changements ne nécessite un
nouveau composant C++.

## Actions et trajectoires du Plant, oracle indépendant

Les sorties actives natives de `plant/effort` donnent exactement :

| Configuration | t=0 | t=1 | t=3 |
|---|---:|---:|---:|
| Principal | 260 | 150 | 150 |
| Single | 260 | 150 | 80 |
| Context | 260 | 150 | 150 |

Les deux valeurs prospectives de q n'ont aucune connexion vers un paramètre
principal : `plant/q` est relu à 0.001 en fin de preuve native. Le port
d'action transporte uniquement E. Les deux trajectoires N/C complètes du
principal et de single sont également comparées exactement à leurs
configurations 8H respectives, malgré leurs nombres d'enfants différents.

| Cas / t | N natif | C natif | N analytique | C analytique |
|---|---:|---:|---:|---:|
| Tous, 0 | 150 | 0 | 150 | 0 |
| Tous, observation à 1 | 138.722797478 | 37.474201388 | 138.723549183 | 37.473918002 |
| Tous, observation à 3 | 148.032956366 | 80.549582912 | 148.034332814 | 80.550344479 |
| Principal / Context, 5 | 155.007095479 | 126.058376507 | 155.008187407 | 126.060295771 |
| Single, 5 | 174.227245075 | 106.405070064 | 174.230760351 | 106.406133908 |

Oracle uniquement dans les tests : alpha=.35−qE, beta=.35/300,
D=1+beta*N0*expm1(alpha*t)/alpha, N=N0*exp(alpha*t)/D,
C=C0+qE*log(D)/beta, avec la limite alpha=0. Chaque changement d'effort
reprend l'état analytique terminal précédent. À t=5, les erreurs N/C sont
0.001092/0.001919 pour le principal et 0.003515/0.001064 pour single.
Tous les échantillons de trajectoires sont comparés à cette solution par
morceaux (tolérances N=0.05, C=0.10).

Les dates exactes d'action et les observations aux décisions proviennent
des sacs natifs. Les courbes rééchantillonnées gardent les conventions 8H,
notamment les horodatages historiques des atomes discrets ; elles ne sont
pas utilisées pour déduire la date d'une action. Une grille flottante proche
de t=1 peut aussi afficher un état continu voisin de l'observation native
exacte ; les assertions de décision utilisent les ports state_observer.

## Robustesse transactionnelle et absence de fabrication

| Cas | Preuve / comportement vérifié |
|---|---|
| Plans à 6,4,2 enfants | Trois exemples, lignes individuelles et tailles natives ; clôtures [6,6,1], [4,4,2] ou [2,2,2] |
| E et q modifiés ensemble | E=[150], q=[.001] au cycle 2 ; un vrai enfant, action 150 et identité locale 0 |
| H modifié | 20→10 et variante H=5 ; bornes natives et comparaison analytique des critères |
| Plan incomplet / domaine absent | Champs identité/version/H/comptes/valeurs manquants, dont q absent du second plan : rejet au seal, aucun héritage |
| Cardinalité incohérente | Comptes E/q incompatibles avec les indices transmis : rejet |
| Seal prématuré | Scellement avant observation : rejet immédiat |
| Champ après seal / campagne dupliquée | Valeur, seal ou run rejoués après exécution : rejet explicite |
| Plan non scellé | Attente sans résultat ; run explicite rejeté |
| Résultat dupliqué | Injection de vrais événements DEVS synthétiques dans le groupe : erreur native ; duplication d'une trame HTTP : rejet du parseur |
| Résultat absent / groupe incomplet | Groupe natif synthétique incomplet, seal explicite : aucune action ; trame numérique absente : rejet du parseur |
| Deux campagnes chevauchantes | Réponses différées à t=5/t=7 ; autre essai avec plans différents finit campagne 2 à t=3 avant campagne 1 à t=6, sans mélange |
| Annulation avant run | Plan clos sans enfant exécuté, reprise rejetée |
| init et seal confluents | Même sac init/seal/run sur un plan à six enfants ; plan-ready conservé avant les résultats |
| Reset | Réinitialisation du même graphe C++ après ses deux campagnes ; campagnes, domaines et réponses remis à zéro, deux cycles rejoués |
| Aucun groupe admissible | Première campagne et seuil=1000 : repli sur de vrais candidats |
| Aucun résultat exploitable | Groupe invalide/sans valeur : aucune action ; enfant natif non fini : échec global explicite |

La puissance QSS3 d'exposant 2000 ajoutée **au modèle de test** déborde sur
un vrai enfant ; l'optimiseur historique échoue avant restitution individuelle,
avec EXECUTION_ERROR catégorie 3/code 67. Le processus ne restitue aucun
resultEvents. Aucun agrégat partiel ni nouvelle action ne peut être produit
par B* à partir de cette restitution absente.

La limite héritée est donc conservée : un enfant numériquement défaillant
peut faire échouer globalement le wrapper. Les mutations de réponses dans
les tests du parseur et les sources synthétiques des tests de groupes sont
signalées comme telles. Elles ne prouvent pas une tolérance native à cette
défaillance d'enfant. Les tests ne substituent jamais une valeur scientifique
inventée à un critère ou état absent.

## Ressources et budgets conservés

Le document principal n'ajoute aucun objet limits. Les défauts restent :
128 atomes parent, 512 connexions développées, 100000 appels parent run,
20000 points parent, 32 observations ; maxScenarios=128,
maxTotalScenarios=256, maxTotalModels=8192, maxTotalConnections=32768,
maxInternalPoints=200000, maxResultEvents=20000, 8 wrappers. Le timeout
du processus API reste **10000 ms** ; aucun relèvement de budget n'est utilisé.

Le parent développé contient 102 atomes/186 connexions et 20 observations ;
le prospectif 15 atomes/18 connexions. Avec les copies, prototypes et 15
collecteurs effectivement comptés par le contrat, l'enveloppe déclarée est
252 modèles/363 connexions et 2424 points internes estimés, pour une capacité
de six scénarios. Le principal restitue 86 événements wrapper, 304 points
parent dédupliqués et utilise 393 appels parent. Les trois preuves utilisent
un seul récepteur de trace ordinaire supplémentaire, déclaré avant compilation
et soumis aux mêmes budgets (aucun grow de capacité hors contrat).

Les mémoires, opérateurs et agrégateurs gardent capacity=128 par défaut,
pour au plus six lignes prospectives et trois groupes par campagne dans ces
exemples. Les tables transactionnelles et les réponses du wrapper restent
bornées à 128 ; les domaines restent non vides, dans la capacité statique
du produit 6 et avec 0<H<=20. Les réponses différées possèdent leurs données.

**maxRunCalls borne les appels du parent, pas les appels synchrones internes
de tous ses enfants.** `run_complete` boucle sur les enfants jusqu'à leur
fin ; aucun compteur global enfant supplémentaire n'a été introduit. Le
timeout API reste une protection du processus. La preuve mesure séparément
les appels internes par rejeu déterministe de copies des vrais enfants avec
leurs paramètres, en vérifiant les mêmes états terminaux N/C. Ce décompte
mesuré ne constitue pas une nouvelle borne de production.

| Campagne réelle | Enfants | H | Modèles enfants | Points critères stockés | Appels internes mesurés par rejeu |
|---|---:|---:|---:|---:|---:|
| Première, tous documents | 6 | 20 | 90 | 2412 | 1486 |
| Deuxième, principal | 4 | 10 | 60 | 816 | 699 |
| Deuxième, single | 2 | 10 | 30 | 408 | 386 |
| Deuxième, context | 2 | 10 | 30 | 408 | 375 |

Les temps de transition du vrai run wrapper sont enregistrés séparément de
ce rejeu, avec chrono natif. Les benchmarks de processus utilisent une seule
campagne observée à t=1, H=20, deux hypothèses q, E réduit à un/deux/trois
efforts et temps parent [0,2]. Chaque taille est exécutée trois fois par
configuration. Ils conservent requêtes, sorties, latence incluant démarrage
et échanges du processus, appels parent et échantillonnage mémoire. Les
pics mémoire échantillonnés sont des bornes observées ; une exécution trop
brève sans échantillon est enregistrée null, jamais 0 octet supposé.

Les mesures détaillées sont sous `build-web-test8i/benchmarks/` ; la matrice
de validation et les chemins finaux sont précisés ci-dessous.

Pour la série finale, les latences de processus incluent l'instrumentation
PowerShell/.NET, le démarrage et les échanges ; elles ne mesurent pas le
seul calcul DEVS et sont prises pendant les autres validations. Elles ne
justifient aucune conclusion de croissance linéaire ou de comparaison de
vitesse Release/Debug. Les pics mémoire sont échantillonnés pendant l'entrée
et le calcul ; ils ne garantissent pas la capture du maximum instantané.

| Configuration | Enfants, H=20 | Latence min–max (ms), 3 mesures | Mémoire observée min–max (MiB) | Appels parent | Événements wrapper |
|---|---:|---:|---:|---:|---:|
| Release | 2 | 1056–1234 | 11.273–11.316 | 191 | 22 |
| Release | 4 | 907–1228 | 11.410–11.430 | 214 | 36 |
| Release | 6 | 764–823 | 11.527–11.570 | 237 | 50 |
| Debug | 2 | 1266–1478 | 58.766–58.832 | 191 | 22 |
| Debug | 4 | 1136–1307 | 58.836–58.855 | 214 | 36 |
| Debug | 6 | 1102–1199 | 58.867–58.902 | 237 | 50 |

Sources : `benchmarks/Release-20261109-190656-7744945/measurements.json`
et `benchmarks/Debug-20261109-190708-4847682/measurements.json`.
À titre distinct, la mesure chrono de la **vraie transition wrapper** dans
les traces natives Release est 0.925 ms pour six enfants/H=20, 0.217 ms pour
quatre/H=10, 0.124 ms pour deux/H=10 (single), 0.108 ms pour deux/H=10
(context). Le rejeu de décompte des appels est exclu de ces temps natifs.

## React Flow : construction et édition réellement exercées

Les trois parcours 8I ne se limitent pas à importer un JSON :

1. Importer T*, ouvrir B*, créer UiPlanCondition et ses ports dans l'éditeur,
   ajouter un event_operator, configurer N<140, câbler ses trois connexions,
   remplacer le comparateur de BuildPlan par ce couplé et recréer ses
   connexions réelles ; exécuter avec H=5, modifier le seuil de planification,
   restaurer H, modifier le seuil écologique, les directions des deux
   sélecteurs et l'opération d'agrégation, puis exporter/réimporter.
2. Modifier highCount à 1 et supprimer la deuxième valeur E et son tag dans
   le graphe ; vérifier six/deux enfants, E=80 au second cycle, N/C finaux,
   puis exporter/réimporter ce modèle construit par édition.
3. Modifier la cardinalité q de la branche haute et retirer sa seconde
   valeur/tag ; vérifier deux groupes d'un membre, puis modifier les valeurs
   q des branches basse et haute à .0009 et vérifier les facteurs réellement
   exécutés et le roundtrip.

Chaque réponse HTTP du navigateur est comparée au même document exécuté
directement par le binaire C++. Les captures de B* et de la condition
construite sont inspectées visuellement. Les cas Vitest conservent les trois
documents dans les formats scientifique et workspace, et vérifient les
paramètres éditables de plan, agrégation et sélection.

Les captures `bstar-react-flow.png`, `condition-built-react-flow.png` et
`single-domain-react-flow.png`, les requêtes/résultats et les exports se
trouvent dans `build-web-test8i/browser-full-release/` et
`build-web-test8i/browser-full-debug/`. La reprise isolée initiale réussie
est conservée séparément dans `browser-release-run2/`.

## Validation, incidents et preuves conservées

Les journaux initiaux ne sont jamais réécrits par une reprise. Chaque script
de régression crée un dossier horodaté et un exit-codes.json. Les preuves
navigateur des anciennes séries ont été copiées avant chaque réutilisation
de leurs chemins historiques. Le CSV `web/model-test/modelhalieutiquetest-points.csv`
reste absent ; il n'est ni reconstitué ni remplacé.

Incidents de préparation conservés :

- Le premier tap de preuve utilisait `counter`, absent du catalogue web :
  erreur Unsupported component type. Il est remplacé dans le **banc** par
  un qss1_sum_2 ordinaire, sans changement du moteur ni des exemples.
- La première assertion de statut lisait le statut transitoire 3 (attente)
  au lieu du dernier statut 1 : correction de la lecture de preuve, avec
  conservation du journal et de toute la séquence 3→1.
- Le serveur frontend déjà lancé sur 3000 utilisait un ancien manifeste ;
  son chunk `page-44693a0916698068.js` renvoyait 500. Les trois premiers
  parcours échouent avant handshake et leur trace réseau le conserve.
  Une instance de production indépendante sur 3200 utilise le build présent.
  Des proxys locaux 3110/3120 servent ces vrais assets et dirigent /api vers
  de vraies instances Fastify liées respectivement aux binaires Release/Debug.
  Aucun calcul ou résultat n'est simulé par ces proxys ; les serveurs
  précédemment lancés sur 3000/3001 ne sont pas arrêtés.
- La première mesure de processus utilisait l'encodage stdin implicite de
  .NET : rejet INVALID_JSON à un caractère français. Le banc déclare UTF-8
  sans BOM ; les premières requêtes et erreurs restent dans les benchmarks.
- L'ajout final d'un champ de preuve HTTP utilisait `res.status()` comme
  dans Playwright, alors que fetch expose la propriété `res.status`. Les
  reprises v2 échouent dans cette écriture **après** comparaison native/HTTP,
  sans défaut de simulation. La propriété est corrigée ; les journaux v2 et
  les reprises v3 restent dans des dossiers distincts.

### Matrice finale

R = `build-web-test8i/Release/logs/run-20261109-185131-4628451-39000/`.
D = `build-web-test8i/Debug/logs/run-20261109-185301-3461815-38892/`.
Les deux scripts conservent runner-tests=8 et un code global 1 à cause des
trois références CSV absentes ; aucune exclusion ne transforme ces échecs
en succès.

| Vérification | Release | Debug | Preuve |
|---|---|---|---|
| Bibliothèque moteur et runner correspondants | Ninja : aucun travail moteur restant ; nouvelle preuve compilée | Même contrôle, nouvelle preuve compilée | `logs/{engine-check,runner-check}-{Release,Debug}.log`, `logs/build-*.log` |
| CTest runner / wrappers / décision 7A–8I | 49/52, 98.99 s ; trois échecs CSV connus | 49/52, 606.22 s ; mêmes trois échecs | R/D `runner-tests.log`, `runner.xml` |
| Preuve C++ 8I, enfants, groupes, actions et reset | 3/3 | 3/3 | R/D `native-8i{,-single,-context}.log` |
| Moteur officiel, dont QSS1/QSS2/QSS3 | 10/10 | 10/10 | R/D `official-tests.log`, `official.xml` |
| Clients historiques 7A–7C | 40/40 | 40/40 | R/D `historical-tests.log`, `historical.xml` |
| API/processus/HTTP historiques | 94/94 | 94/94 | R/D `api-tests.log` |
| HTTP 8B / 8C / 8D / 8E / 8F / 8G / 8H | 12/12 ; 13/13 ; 13/13 ; 23/23 ; 20/20 ; 11/11 ; 19/19 | Mêmes résultats | R/D `http-8*.log` |
| Diagnostics natifs/HTTP et destination invalide | 2/2 | 2/2 | R/D `diagnostics.log`, `diagnostics/` |
| Suite 8I finale, chaque requête HTTP strictement comparée au runner direct | 17/17, 197.19 s | 17/17, 236.89 s | `logs/http-8i-{release,debug}-final-v3.log` |
| Preuves HTTP 8I et égalité entre configurations | 59 instantanés | 59 instantanés identiques | `{Release,Debug}/final-http-v3/`, `final-evidence-comparison.json` |
| Vitest et TypeScript frontend commun | 166/166 ; typecheck réussi | Même frontend | `logs/vitest-final.log`, `logs/typecheck-final.log` |
| Playwright complet, construction React Flow et HTTP/native | 74/74, 8.3 min | 74/74, 15.5 min | `logs/playwright-full-{release,debug}.{log,json}` |

Les 59 paires requête/résultat et les codes de sortie/erreur/statuts HTTP de
la reprise v3 sont strictement identiques entre Release et Debug ; chaque
capture conserve `httpEqualsNative=true`. Les trois traces natives sont
également identiques après retrait du seul temps chrono `wrapper_run_ms`.
La comparaison est enregistrée dans `final-evidence-comparison.json`.
Les durées des tests incluent les processus, les assertions et les autres
validations concurrentes ; les délais API et les bornes scientifiques ne
sont pas augmentés.

Les trois échecs CTest sont `runner-wrapper-7g`,
`native-wrapper-schaefer-trajectories`, `native-wrapper-schaefer-pair`.
Le premier conserve ENOENT sur le CSV historique ; les deux preuves natives
conservent FAIL: CSV reference. Les validations plates et analytiques de
8I n'en constituent pas un remplacement. Les journaux des réussites
ultérieures et des échecs initiaux sont tous conservés.

## Limites conservées

- Modèle prospectif, critères et structure des facteurs restent déclarés
  statiquement ; dynamicPlan adapte leurs domaines directs et H dans cette
  enveloppe. Il ne modifie pas un graphe DEVS pendant son exécution.
- Les enfants sont calculés synchroniquement. Un retard concerne la date de
  restitution dans le parent ; ce n'est pas une exécution enfant asynchrone.
- La défaillance numérique native décrite plus haut peut arrêter toute une
  campagne avant restitution individuelle. Aucun traitement partiel fiable
  de ce cas n'est annoncé.
- Une donnée absente sans seal peut rester en attente. Il n'existe pas de
  timeout scientifique implicite pour compléter un groupe. Les mémoires
  explicites et les identités closes restent bornées ; reset garde son rôle.
- Les identités de groupe sont locales, les clés sont des doubles comparés
  exactement et les hypothèses q n'ont pas de probabilités implicites.
- Les graphiques scalaires représentent les dernières valeurs ; les tables
  de résultats individuels, les manifests et les sacs natifs établissent les
  groupes et les dates d'application. Les conventions de rééchantillonnage
  héritées ne sont pas modifiées pour faire passer une assertion.
- Les trois tests historiques dépendant du CSV 7G absent restent des échecs
  de validation documentaire ; les autres références ne s'y substituent pas.

## Livrables et reproduction

- `web/examples/tstar-schaefer-dynamic-uncertainty-v3.json`
- `web/examples/tstar-schaefer-dynamic-uncertainty-single-v3.json`
- `web/examples/tstar-schaefer-dynamic-uncertainty-context-v3.json`
- Générateur : `web/engine/runner/decision-8i-fixture.mjs --write`.
- Tests JSON/HTTP : `web/engine/runner/decision-8i-tests.mjs`.
- Preuve C++ : `web/engine/runner/dynamic-uncertainty-native.cpp`, trois
  entrées CTest et contrôle du reset sur la même simulation.
- Frontend : `tests/dynamic-uncertainty.test.ts`, `tests/e2e/decision-8i.spec.ts`.
- `web/engine/runner/tests-wrapper/run-8i.ps1 -Configuration Release` ou Debug
  reconstruit puis teste ; `-TestsOnly` utilise les builds 8H correspondants.
  L'option `-BuildOnly` prépare uniquement les binaires. Les timeouts existants
  sont conservés ; les scripts retournent un échec global si un test échoue.
- `benchmark-8i.ps1 -Configuration Release` ou Debug mesure les trois tailles.
- `npm run test:decision-8i` dans web ; IRRITATOR_RUNNER désigne le binaire
  correspondant. DECISION_8I_HTTP=1 active la comparaison HTTP/native.

Les sources de production modifiées avant 8I restent celles de 8H. Les
changements 8I portent sur les exemples/compositions, tests, documentation,
enregistrement CMake/npm et outils de preuve. Aucun commit ni push n'est créé.
