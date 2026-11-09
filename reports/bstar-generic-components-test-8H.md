# Test 8H — Plans expérimentaux dynamiques génériques

8–9 novembre 2026. Audit, contrat et preuves 8H. Les résultats mesurés,
les reprises et les limites sont détaillés dans le tableau de validation.
Aucun commit ni push n'a été créé.

## 1. Sources présentes et audit préalable

Les sept rapports `reports/bstar-generic-components-test-8A.md` à
`reports/bstar-generic-components-test-8G.md` sont présents et ont été consultés,
ainsi que les définitions et générateurs d'exemples 8F/8G, le wrapper natif,
les structures de facteurs/sélections/objectifs, les transactions 8E,
`group_aggregate`, le compilateur hiérarchique et les contrats JSON v3.

**Le fichier `web/examples/tstar-schaefer-uncertainty-v3.json` est réellement
présent dans le dépôt audité.** Son SHA-256 avant modification est
`B96646BFF7C84EB2DF7975AC9B44D4EDF4BC3D435F9B6C3648A5C9DDB1AFDAD7`.
Il provient du générateur `decision-8g-fixture.mjs`, fonction
`uncertaintyTstar`, lignes 63–86 dans l'état initial audité. Ce fichier n'est
donc pas manquant ; son absence parmi deux JSON transmis séparément ne vaut
pas absence dans le dépôt.

L'article local `docs/JFSMA26.pdf` est présent, comporte dix pages et a été lu
directement avec pypdf. Son SHA-256 est
`3D2E298283036A9A530DBC5E7C94370E7F6EF48027D41B83D41B6776ADAB1703`.
Il s'agit de « Modéliser les processus de décision : une approche DEVS par
simulation imbriquée ». Aucun article ou rapport absent n'est reconstitué.

### Lecture scientifique

- Le §3.1, page 3, autorise explicitement des réalisations atomiques ou
  couplées des trois rôles. B* peut donc être composé de sous-fonctions
  d'observation, de génération de scénarios, d'évaluation et de sélection.
- Le §3.4, page 4, distingue observation mémorisée, plan, résultats et action.
  B* construit Pk après réception de l'observation et évalue les résultats Rk.
- Le §3.5, page 5, modélise l'entrée abstraite `parameters` comme un plan Pk,
  tandis que la référence de simulation et le mode restent dans les attributs
  de configuration. Cette interface abstraite n'établit pas à elle seule que
  le code existant transporte déjà un domaine variable.
- Le §3.6, page 5, sépare temps parent et temps prospectif local [0,H].
  Le §3.7, équation 17, ferme la boucle A*c / B* / A**.
- Le §3.8, équations 18–24, pages 5–6, définit
  `Pk={ei}`, `ei=(x0k,u(i),theta(i))` : conditions initiales observées,
  facteurs actionnables et hypothèses contextuelles. Le produit cartésien
  discret est une première réalisation du plan, pas une exigence de
  planification statistique optimale.
- L'article présente min/max/last/area comme indicateurs possibles. Les
  critères réellement exposés par le moteur audité sont seulement `min`,
  `max`, `min-last` et `max-last` (`core.hpp`, `criteria_type`). 8H n'annonce
  pas un calcul natif d'aire sous la courbe inexistant.

Le §3.5 affirme que le wrapper ne réalise pas l'évaluation décisionnelle.
L'implémentation auditée conserve pourtant un optimiseur historique. Cette
différence est explicite : la décision externe utilise les résultats
individuels ; l'optimiseur et les sorties historiques restent disponibles.

### Capacités réellement établies avant 8H

Les références de lignes de ce tableau désignent l'état source au début de
l'audit ; les fonctions nommées permettent de retrouver le code après ajout
de l'extension.

| Niveau | Configuration ou comportement réel | Preuve source initiale |
|---|---|---|
| Compilation hiérarchique | Définition prospective, chemins cibles, nombre et ordre des facteurs/sélections, ports et connexions | `hierarchy.hpp:73–105`, `native_wrapper.cpp:54–105` |
| Configuration d'occurrence avant initialize | Une ressource prospective privée par occurrence ; dimensions identiques à la définition connectée ; bind interdit après initialisation | `native_wrapper.cpp:264–319` |
| Initialisation du wrapper | Produit des cardinalités configurées, allocation des copies du prototype, copie des paramètres et initialisation | `simulation.cpp:482–550` |
| Entrées historiques par campagne | Une seule valeur scalaire par facteur ; remplacement direct, addition ou multiplication suivant le type ; aucune modification de cardinalité | `simulation.cpp:363–386`, rapport 8D:160–174 |
| Transaction 8E | Champs scalaires par campagne, masque requiredInputs, init/run après complétude, conflits et arrivées périmées rejetés | `simulation.cpp:610–669`, rapport 8E:36–68 |
| Horizon avant 8H | Limites du prototype copiées dans les enfants ; aucun port de durée prospective complète | `simulation.cpp:250`, `native_wrapper.cpp:294–297` |
| Résultats individuels | Instantanés des vrais paramètres et critères de chaque enfant ; statut puis clôture `[valides,total,campagne]` | `simulation.cpp:558–587` |
| Groupement 8G | Réduction de lignes identifiées par campagne, pas génération de domaines prospectifs | `group-event.hpp:21–151` |
| Plan 8F/8G | Définition, domaines, horizon et critères statiques ; observations et commandes dynamiques | rapport 8F:364–369, rapport 8G:287–291 |

En particulier, envoyer une nouvelle valeur à un facteur `fixed` historique
remplace chaque valeur de sa grille sans diminuer le nombre d'enfants. On
peut ainsi obtenir plusieurs scénarios identiques : cela ne constitue pas un
changement de domaine. `requiredInputs` transporte dix scalaires au maximum,
pas des tableaux de cardinalité variable. L'argument run garde son rôle
historique de commande d'avancement et de délai de réponse parent ; il ne
remplace pas, en mode complete, la durée déclarée du prototype.

Le mécanisme natif `embedded_sims_alloc` (`simulation.cpp:224–263`) efface et
alloue déjà des simulations enfants par copie de `embed_sims.sim`, avec leurs
tables d'observation. L'extension peut réutiliser cette opération contrôlée
sur des copies d'un prototype fixe. Cela n'autorise ni modification du graphe
parent actif, ni changement arbitraire de modèle DEVS pendant son exécution.

### Identités et clôtures déjà disponibles

Les messages identifiés sont `[valeur,identité,campagne]`. Les identifiants
entiers sont exactement représentables en double jusqu'à 2^53−1. Une campagne
est locale à une occurrence de wrapper ; deux occurrences ne doivent pas
fusionner directement leurs espaces d'identification.

Le produit cartésien natif fait varier le premier facteur le plus vite
(`simulation.cpp:400–421`). Le scénario est l'indice zéro-based de cette
itération. Les identités 8G de groupes correspondent au plus petit scénario
du groupe et ne sont pas des identifiants permanents d'action entre plans.
`group_aggregate` peut attendre un compte annoncé et des champs retardés ;
un seal explicite permet de terminer une campagne incomplète selon son mode
de validation. Son groupement ne transporte pas le plan d'entrée d'A**.

## 2. Formalisation retenue de Pk

Le contrat conceptuel est :

```text
Pk = (modelRef, initialState, horizon, factorDomains, selections, metadata)
```

| Élément | Sémantique et identité | Dynamique dans cette première version |
|---|---|---|
| campaignId | Transaction d'observation/exécution locale au wrapper, entière positive et strictement croissante lors des exécutions | Oui |
| planId et version | Identité et version de définition du plan, distinctes du numéro de campagne ; réutilisables pour une campagne ultérieure | Oui |
| modelRef | Référence de définition prospective déjà compilée et occurrence native associée | Fixe |
| initialState | Champs observés de la campagne, explicitement déclarés obligatoires ; aucune copie implicite de l'état principal | Oui, facteurs single directs |
| horizon | Durée locale H, positive, bornée par la durée prospective déclarée | Oui |
| factorDomains | Domaines ordonnés, finis, non vides, transmis pour chaque facteur fixed direct | Oui dans l'enveloppe de capacité déclarée |
| Rôle des facteurs | Actionnable, contextuel/hypothèse ou observation initiale ; rôle scientifique donné par le graphe et la documentation | Association fixe aux facteurs |
| ScenarioId | Indice de combinaison dans l'ordre cartésien déterministe de la campagne | Recalculé selon ses domaines |
| selections | Critères, cibles observées et ordre des ports | Fixes et préalablement déclarés |
| metadata | Identité/version et état de transaction ; les métadonnées descriptives peuvent rester dans le document JSON | Transport numérique limité |
| Status | Collecte, validé, exécuté, annulé, ou rejet explicite de protocole ; validité individuelle séparée de celle du plan | Oui |

Ce contrat ne contient aucun nom imposé de variable scientifique. Un facteur
initialState est une donnée obligatoire de la transaction, un facteur fixed
décrit un domaine de scénarios. L'association d'une sortie de facteur à une
action du Plant est une connexion explicite du modèle décisionnel ; une
hypothèse contextuelle ne devient pas automatiquement une action.

Les statuts ont des supports distincts : collecte et exécution sont des états
natifs internes, validation est observable par ready, restitution complète
par end, invalidité individuelle par la sortie statut, rejet par l'erreur de
protocole du moteur. L'annulation ferme la transaction sans nouveau port
d'accusé d'annulation ; son effet doit être vérifié par absence d'exécution
et rejet d'une reprise. Cette première version n'annonce pas un flux de
statuts textuels ni une restitution de toutes les métadonnées descriptives.

La réalisation 8H constitue un transport de valeurs et de cardinalités dans
une structure prospective fixe, et non une sélection entre quelques plans
entièrement précalculés. Les valeurs candidates restent configurables dans
les sources et connexions génériques de React Flow. La capacité maximale est
déclarée statiquement afin de réserver un budget sûr.

## 3. Contrat transactionnel minimal retenu

Cette section décrit le contrat de l'extension 8H. Ses validations sont
rapportées séparément pour distinguer spécification et preuve d'exécution.

L'extension est optionnelle : `experiment.dynamicPlan: true`. Son absence ou
false conserve les ports et comportements historiques. Le mode dynamique
est limité à `complete`, avec `scenarioResults=true`, de 1 à 9 facteurs,
des types directs `single` et `fixed`, au moins un critère déjà déclaré et
3 à 12 facteurs et critères au total. `requiredInputs` contient exactement
tous les facteurs single, sans facteur fixed. Les facteurs fixed reçoivent
obligatoirement leur domaine dans chaque campagne.

Les identifiants de campagne, de plan et de version sont des entiers de 1 à
2^53−1, exactement représentables en double. Les valeurs numériques reçues
pour les facteurs sont finies et comprises entre −10^12 et +10^12.

### Ports et messages

Les ports x0 init, x1 run et x[2+i] facteur i sont conservés. Un port plan
est ajouté en x[F+2]. La borne F<=9 respecte les douze entrées natives.

| Port ou champ | Message et règle |
|---|---|
| Facteur single i | `[valeur,0,campagne]`, valeur finie de l'observation requise |
| Facteur fixed i | `[valeur,index,campagne]`, index entier zéro-based dans le domaine reçu |
| plan, champ 0 | `[planId,0,campagne]`, planId entier positif |
| plan, champ 1 | `[version,1,campagne]`, version entière positive |
| plan, champ 2 | `[H,2,campagne]`, durée positive inférieure ou égale à la durée déclarée |
| plan, champ 3 | `[0,3,campagne]`, seal : fin de transmission et validation complète |
| plan, champ 4 | `[0,4,campagne]`, annulation explicite de la trame |
| plan, champ 5+i | `[cardinalité,5+i,campagne]` pour le facteur fixed à l'indice natif i, singles compris dans la numérotation ; interdit sur single |
| init, run | Commandes historiques identifiées `[argument,0,campagne]`, autorisées seulement sur un plan validé |
| plan-ready | Sortie ajoutée après tous les anciens ports : `[nombreRéelScénarios,planId,campagne]` |

La nouvelle sortie est y[2(F+S)+2]. Le marqueur de résultats existant
y[2(F+S)+1] reste `[valides,totalRéel,campagne]`. La cardinalité statique
déclarée représente la capacité, pas le nombre effectivement simulé pour
toutes les campagnes ; les consommateurs et la validation HTTP doivent
utiliser la cardinalité réelle annoncée pour la campagne.

Comme auparavant, le parseur de résultat peut recevoir une FIFO tronquée par
la fin de l'horizon parent. Il vérifie strictement toute clôture reçue, mais
ne transforme pas l'absence de clôture en fin complète : sans end observé,
la campagne ne doit pas être présentée comme entièrement restituée.

### Causalité et complétude

La première donnée identifiée ouvre implicitement une trame de collecte.
PlanId, version, H, toutes les observations obligatoires et les cardinalités
doivent exister dans la même trame avant seal. Chaque domaine doit contenir
exactement les indices 0 à cardinalité−1. Un domaine vide, un trou, une valeur
non finie, un champ illégal ou un dépassement de budget est rejeté.
Les valeurs reçues sont bornées par la capacité et les contrôles numériques
du moteur avant toute allocation d'enfants.

Deux indices distincts d'un domaine peuvent porter la même valeur ; ils
décrivent alors deux positions explicites et deux scénarios potentiellement
équivalents, avec des identités distinctes. Répéter un même index ou champ
de la même campagne est en revanche une duplication de transmission rejetée.
La capacité borne le produit global : plusieurs facteurs fixed peuvent
redistribuer leurs cardinalités si ce produit reste dans l'enveloppe.

Le seal constitue une barrière explicite. Avant seal, une trame incomplète
reste passive en collecte ; seal prématuré ou run prématuré est une erreur
de protocole. Aucun délai epsilon n'impose un ordre. Le graphe doit joindre
les fins de ses sources et la complétude des observations avant d'émettre
seal, puis attendre `plan-ready` avant sa commande run. Une chaîne
`event_tag` avec préservation générique de campagne et changement d'identité
permet de transformer ready en commande identifiée, et un opérateur/source
générique donne la valeur de run configurée.

Les champs du sac sont traités avant validation et exécution. Une validation
capturée produit un unique ready ; les duplications de champs de plan ou
de domaine, les contradictions, les nouvelles données après seal, les
réexécutions et les arrivées après consommation ou annulation sont rejetées.
Les anciennes transactions requiredInputs sans dynamicPlan conservent leur
idempotence des duplications identiques ; cette règle historique ne doit pas
être modifiée silencieusement par le nouveau protocole.

Une campagne ne récupère ni observation, ni domaine, ni horizon d'une autre.
L'annulation est une opération avant run, y compris après seal : elle ferme
la campagne et retire les trames antérieures ou égales ainsi que leurs ready
encore en attente. Elle n'interrompt pas une simulation enfant synchrone déjà
exécutée et ne supprime pas les résultats différés de runs antérieurs. Un init
conserve l'annulation historique des réponses différées en attente.
Le reset complet/initialize du parent efface
trames, résultats en attente et compteurs ; le reset local du modèle B* reste
distinct d'une annulation d'A**. Les réponses différées déjà capturées doivent
posséder leurs valeurs afin qu'un nouveau plan ne puisse pas les réécrire.

### Exécution contrôlée et budgets

Après validation, l'exécution copie le prototype fixe dans le nombre exact
d'enfants du produit reçu, applique les facteurs de cette campagne, fixe les
limites à `[begin,begin+H]`, puis initialise et exécute ces enfants. Le chemin
réutilise allocation/copie/initialisation natives du wrapper. Aucun
intégrateur QSS et aucun couplage du graphe parent actif ne sont restructurés.

Les graphes livrés utilisent directement run après ready : le run dynamique
prépare toujours les enfants du plan validé avant de les simuler. Ils n'ont
pas besoin d'un init entre seal et run. L'interface init reste disponible pour
son rôle d'annulation des réponses en attente, après validation de sa trame.
Si seal et init sont confluents dans un même sac, init conserve les acks
ready des plans scellés conservés et annule les réponses d'exécution ; avec
run dans ce même sac, ready reste émis avant les résultats. Cela inclut les
plans futurs déjà scellés, dont les trames restent présentes après init.
La première implémentation effaçait ces acks lors de pending.clear ; la revue
a conduit à distinguer les validations de plan des réponses d'exécution.
Les cas confluents et les plans futurs scellés sont couverts par les tests.

La découverte suit les 16 premiers tests réussis : un dix-septième test
reproduit le défaut contre le binaire antérieur et retourne 1 avec
`RUNNER_PROTOCOL_ERROR`, l'ack étant absent. Ce journal reste dans
`build-web-test8h/Release/logs/seal-init-before-fix-20261108-013102.log`.
Un cas supplémentaire couvre deux plans scellés simultanément, dont le
second doit garder son ready après init du premier. Après reconstruction,
la suite à 18 tests réussit ; les 16 premiers succès ne sont pas
présentés comme cette preuve du correctif.

Le produit reçu reste inférieur ou égal au produit statique déclaré et au
budget maxScenarios. H reste inférieur ou égal à la durée déclarée. Cela
maintient une enveloppe connue avant simulation pour les modèles, connexions,
points d'observation et résultats. Les limites web auditables sont notamment
8 wrappers, 128 scénarios par wrapper, 256 scénarios au total, 8192 modèles,
32768 connexions, 200000 points internes et 20000 événements de résultats
(`wrapper-v3.ts`, wrapperCaps). Les limites configurées plus basses et le
budget maxRunCalls restent applicables. Aucun plafond n'est relevé pour 8H.

Le stockage transactionnel est borné séparément à 128 trames et à 128
réponses en attente. Cette seconde capacité inclut les acknowledgements
ready et les réponses d'exécution différées ; ce n'est pas une capacité de
128 pour chacun de ces deux types. Les dépassements produisent une erreur
de capacité explicite avant une croissance illimitée.

L'audit du budget des wrappers dynamiques compte aussi leurs collecteurs de
résultats réellement alloués, jusqu'à `2(F+S)+3` sorties, et non seulement les
F+S sorties gagnantes historiques. Le runner JSON et le validateur TypeScript
utilisent ce même nombre dans leur estimation conservative des modèles et
connexions. La correction est limitée au mode dynamique et ne relève aucune
limite ; les modèles historiques gardent leur contrat antérieur.

Le graphe parent développé est lui-même borné à 128 atomes et 512 connexions,
avec 32 observations et 20000 points parent au maximum ; maxRunCalls est
plafonné à 100000 (`index.ts`, caps/validateHierarchy, et schéma v3).
La capacité de 128 scénarios du wrapper ne signifie donc pas que 128 valeurs
peuvent toutes être représentées simultanément par deux atomes source/retag
chacune dans ce même parent. Un grand domaine exige une composition réutilisant
des flux et des mémoires dans ces limites, ou un autre transport générique
qui resterait à concevoir et vérifier.

`maxRunCalls` borne les sacs du parent dans le runner, pas les appels internes
de chaque simulation enfant. Le `run_complete` natif existant boucle jusqu'à
la fin de l'horizon sans compteur indépendant d'appels enfant. L'enveloppe
scénarios/H, l'estimation de mémoire/points et le timeout du processus API
(10 secondes par défaut) ne constituent donc pas une garantie native générale
contre une boucle Zeno arbitraire dans un prospectif CLI. Les graphes livrés
doivent être vérifiés comme terminants ; 8H n'annonce pas un budget natif
d'appels enfants qui n'existe pas.

## 4. Construction par composants génériques

Le déclencheur est une constante datée ou le générateur natif existant.
`state_observer` lit l'état courant ; `value_memory` conserve le contexte ;
les jointures `event_operator(required=3)` attendent les observations de la
même campagne. Les comparaisons `event_operator`, leurs seuils et leurs
connexions sélectionnent les branches. Les sources de valeurs, opérateurs
et filtres transmettent les valeurs candidates et les cardinalités du domaine
retenu. Les composants de clôture existants fournissent la barrière avant
seal. La sortie plan-ready fournit la barrière avant run.

Dans les exemples, les payloads d'une branche partent du même déclenchement
et empruntent des chemins de même profondeur (source puis retag). Les champs
et seal arrivent donc dans un même sac dont le wrapper collecte tous les
champs avant la validation. Si l'utilisateur ajoute des chemins de durée ou
de profondeur différente, il doit joindre leur complétude avant seal ; un
seal incomplet est rejeté. Aucune clôture automatique fictive ou délai epsilon
n'est introduit pour compenser un raccordement incomplet.

Dans le constructeur de plan, les filtres de branche doivent recevoir une
clôture singleton identifiée en plus de l'observation et de la condition.
`candidate_filter` ne publie pas ses candidats sans clôture ; une comparaison
seule ne constitue pas une émission de branche. Cette exigence a été repérée
par lecture de `event.cpp` avant les premières exécutions 8H.

L'assemblage ne choisit aucune action scientifique. Les critères individuels
retournés alimentent le modèle externe de décision, composé des agrégateurs,
filtres et sélecteurs existants. Le groupement d'hypothèses 8G reste distinct
de la construction du domaine d'entrée. Les identités, facteurs et critères
du gagnant historique sont conservés dans leurs ports antérieurs.

React Flow édite paramètres, ports et connexions ; il ne calcule aucune
comparaison, ne choisit aucun domaine et n'applique aucune décision pendant
l'exécution. Une extension générique d'`event_tag` préservant le numéro de
campagne peut être utilisée pour le transport. Aucun B* atomique, planificateur
scientifique ou règle d'effort halieutique n'est ajouté au moteur.

### Graphes livrés : paramètres et interfaces

La définition `BuildPlan` est construite par `decision-8h-fixture.mjs`.
`less` est une comparaison native inférieure stricte et `otherwise` un NON
logique. Les filtres `low` et `high` reçoivent observation, condition et fin
singleton. Chaque branche retenue déclenche des sources `event_operator`
commandées, puis des `event_tag(preserveCampaign=1)` : Identity, Version,
Horizon, Count, Seal et Value0… sont des paramètres ordinaires du graphe.
Une valeur candidate supplémentaire exige une source et une connexion ;
changer une valeur, un seuil ou H utilise l'inspecteur sans recompilation C++.

Le minimal associe `LinearPlant`, `LinearProspect` et `LinearDecision`.
Le Plant contient un intégrateur QSS3, un maintien d'action et un observateur
d'état ; le prospectif contient un intégrateur et une constante u.
L'observation X part vers l'état initial du wrapper et vers `BuildPlan`.
Les critères terminaux et les u des enfants partent vers le sélecteur externe.
Le wrapper a F=2, S=1 : plan en x4, statut individuel y3, état initial y4,
u y5, critère terminal y6, clôture y7 et ready y8.

Le Schaefer conserve les définitions du Plant, du prospectif et de la
synchronisation de 8F ; l'architecture de décision groupée provient de 8G.
La démonstration demandée à trois puis deux enfants utilise une seule
hypothèse q=0.001, toujours explicitement transmise comme facteur contextuel.
Elle ne prétend pas représenter à elle seule l'incertitude à deux q de 8G.
Le plan a F=4, S=2 : initialN, initialC, effort et qHypothesis ; plan en x6,
statut individuel y6, N0/C0 y7/y8, E/q y9/y10, Nmin/CH y11/y12,
clôture y13 et ready y14. Le choix de plan dépend de l'observation N jointe
à C ; la sélection d'action utilise les indicateurs réels en aval.

La variante `tstar-schaefer-dynamic-plan-single-v3.json` configure le domaine
de la seconde branche à [80]. Elle est générée par le même constructeur et
le même chemin de décision ; aucune action 80 n'est codée comme résultat
dans une fonction native.

### Parcours graphiques vérifiés

Le premier parcours importe le modèle minimal, crée dans React Flow une
définition `UiCondition` avec ses ports observation/reset/condition, y ajoute
et câble un comparateur natif, puis l'insère dans `BuildPlan` à la place de
la comparaison initiale. Le seuil est réglé à 2 dans l'inspecteur : la seconde
campagne utilise alors trois candidats et H=2, et le Plant termine à X=3.
La définition complète `BuildPlan` de départ provient du JSON livré ; la
construction graphique vérifiée porte ici sur la condition couplée et son
insertion dans ce plan.

Le second parcours règle la cardinalité de la branche haute à 1 et supprime
sa deuxième source de valeur et son retag dans le graphe Schaefer. La seconde
campagne exécute E=80 comme candidat unique et modifie la trajectoire réelle.
Les deux parcours comparent la réponse HTTP au runner direct, exportent puis
réimportent le document et vérifient les résultats. Ils passent avec les
deux configurations natives Release et Debug.

Les premiers essais ont aussi révélé des cartes superposées : l'espacement
fixe de 170 pixels ne tenait pas compte du nombre de ports. Le placement
automatique utilise désormais leur hauteur estimée, ou mesurée lors d'un
ajout. Le zoom minimal passe à 0.05 pour cadrer les grands graphes au retour
d'une définition. Les positions et caméras manuelles restent sauvegardées.
La tentative `playwright-full-release-run1` conserve l'échec de cadrage 8E ;
son parcours isolé puis la suite Release finale passent après ce correctif,
sans modifier les anciens tests ni leurs timeouts.

## 5. Expériences et preuves

Les mesures numériques ci-dessous proviennent des exécutables Release 8H.
Les validations des deux configurations natives sont détaillées dans la
matrice, avec les preuves HTTP et navigateur et leurs reprises.

| Expérience | Configuration | Contrôle réalisé |
|---|---|---|
| Minimal indépendant | dX/dt=u ; comparaison de X au seuil ; domaines [-1,0,1]/[-1,0], H=2/1 | Deux campagnes avec observations, domaines émis, enfants, H, résultats, décision et action natifs |
| Triade Schaefer | Plant N0=150,C0=0,E0=260,r=.35,K=300,a=1,q=.001,dQ=.01 ; décisions t=1 et t=3 | Branche N<140 : E=[80,150,260],H=20 ; autre branche E=[80,150],H=10 ; deuxième campagne réellement réduite |
| Modification du plan | Deuxième domaine configurable réduit à [80] | Première action 150 par repli réel, deuxième action 80 par sélection de l'unique candidat ; trajectoire Plant modifiée |
| Transactions | Plans complets, incomplets, dupliqués, contradictoires, vides, excessifs, tardifs, chevauchants, annulés, reset | Acceptation ou rejet explicite et borné ; aucune donnée héritée |
| Résultats | Lignes natives valides ; injections dans le parseur de lignes invalides, absentes/dupliquées et clôtures incohérentes ; critère natif non fini | Facteurs réellement appliqués, critères bruts, validation des comptes et rejet explicite de la campagne numérique invalide |
| Interfaces graphiques | Création/câblage, modification de seuil/domaines/H, plusieurs occurrences, export/import | Comportement natif préservé et état indépendant des occurrences |

Les modèles livrés produisent uniquement des lignes natives valides. Le cas
8H de ligne invalide est un contrôle du parseur : le banc modifie une réponse
valide en statut 0, retire ses valeurs numériques et ajuste le compte valide,
puis vérifie cette clôture et rejette toute valeur ajoutée artificiellement.
Ce test du parseur ne prétend pas avoir provoqué un enfant numériquement
invalide au cours d'une exécution DEVS. Les tests d'absence, de duplication et de nombre de
résultats incohérent restent également identifiés comme contrôles de contrat.

Cette distinction reflète aussi une limite native héritée : le run appelle
`compute_response` avant `scenario_response`. L'optimiseur historique appelle
`compute_embedded_simulation_results`, qui rejette un critère non fini avec
`simulation_wrapper_embedded_simulation_observation_error`. Un tel enfant
fait donc échouer la campagne avant restitution, au lieu de produire une
ligne statut 0 et une clôture partielle. L'acceptation par le parseur d'une
ligne 0 bien formée ne prouve pas une tolérance native aux défaillances
numériques individuelles. 8H conserve ce chemin d'erreur explicite, sans
fabriquer de résultat ou de valeur de remplacement.

Un cas natif distinct a ensuite été ajouté : une puissance QSS3 d'exposant
2000 reçoit u=2 dans un prospectif, et un critère observe sa sortie. Le plan
complet d'un enfant, H=1, est accepté ; son critère déborde et la campagne
retourne `EXECUTION_ERROR`, catégorie 3/code 67. L'exploration est conservée
dans `build-web-test8h/invalid-child-exploration.json`, puis le cas est intégré
comme dix-neuvième test 8H. Cette preuve vérifie bien le rejet natif global,
sans annoncer une ligne native statut 0 ni un résultat partiel.

### Mesures natives Release

Le dossier de preuves initiales est
`build-web-test8h/Release/logs/targeted-20261108-012258-6738510/`.
Les trois exécutables de preuve ont retourné 0, avec `RESET_PASS` et
`NATIVE_DYNAMIC_PLAN_PASS`. Ils relisent les vrais enfants, leurs paramètres,
leurs limites temporelles et les sorties actives avant sérialisation HTTP.

| Modèle/campagne | Observation initiale | Domaine réellement appliqué | H réel | Résultats individuels terminaux | Action externe |
|---|---|---|---:|---|---:|
| Linéaire 1, t=1 | X=−1 | u=[−1,0,1] | 2 | X(H)=[−3,−1,1] | 1 |
| Linéaire 2, t=3 | X=1 | u=[−1,0] | 1 | X(H)=[0,1] | 0 |

Le premier plan dépend donc de l'observation −1 ; son action fait évoluer le
Plant à X=1 lors de la seconde observation. Le comparateur choisit alors
l'autre domaine et l'autre durée. Le Plant linéaire termine à X=1.

| Campagne Schaefer | N0 observé | C0 observé | E des enfants | q des enfants | H réel | Nombre |
|---|---:|---:|---|---:|---:|---:|
| 1, t=1 | 138.72279747766177 | 37.474201388034722 | 80,150,260 | 0.001 | 20 | 3 |
| 2, t=3 | 148.0329563662178 | 80.549582911628249 | 80,150 | 0.001 | 10 | 2 |

Les résultats bruts effectivement restitués sont :

| Campagne | Scénario | E | Nmin | CH | Validité |
|---|---:|---:|---:|---:|---:|
| 1 | 0 | 80 | 138.72279747766177 | 372.69537710368786 | 1 |
| 1 | 1 | 150 | 138.72279747766177 | 525.092425401785 | 1 |
| 1 | 2 | 260 | 83.24818779055533 | 552.3934345722605 | 1 |
| 2 | 0 | 80 | 148.0329563662178 | 237.55332924342457 | 1 |
| 2 | 1 | 150 | 148.0329563662178 | 321.5451621504805 | 1 |

Les clôtures sont `[3,3,1]`, puis `[2,2,2]`. Aucun troisième enfant ne
subsiste dans la seconde campagne. CH conserve ici le C0 observé ; comparer
les résultats d'une même campagne ne mélange pas ces origines entre cycles.

Le repli externe de la première campagne sélectionne 150 parmi les vrais
résultats ; la seconde sélection choisit également 150. Les actions sont
émises sur le maintien aux dates natives 1 et 3. Avec le second domaine réduit
à [80], le premier cycle reste identique et le second produit un seul enfant
E=80,H=10, Nmin=148.0329563662178, CH=237.55332924342457, clôture `[1,1,2]`.
La sélection externe applique alors réellement 80 à t=3.

| Trajectoire du Plant à t=5 | N natif | C natif |
|---|---:|---:|
| Plans [80,150,260] puis [80,150] | 155.00709547863144 | 126.05837650688633 |
| Plans [80,150,260] puis [80] | 174.22724507457158 | 106.40507006405633 |

### Chronologie native de la triade

| Étape | Campagne 1 : sac/date | Campagne 2 : sac/date |
|---|---|---|
| Observations N/C réelles | 76 / 1 | 232 / 3 |
| Payloads du plan, y compris domaine et H | 88 / 1 | 246 / 3 |
| Plan validé, ready | 90 / 1 | 248 / 3 |
| Run et inspection des vrais enfants | 95 / 1 | 253 / 3 |
| Action du maintien, exemple à deux candidats | 163 / 1 | 313 / 3 |

L'ordre observation < plan < validation < simulation < action est ainsi
capturé dans des sacs successifs à date parent constante, sans epsilon.
Les courbes scalaires rééchantillonnées des atomes discrets conservent leur
convention historique : leurs dates ne représentent pas cette chronologie
des sacs. En particulier, le témoin effort peut afficher 150 à 0.1 et 80 à
1.1 ; seules les émissions natives établissent l'application à t=1 et t=3.
Ce comportement du rééchantillonnage discret n'est pas modifié par 8H.

Pour la comparaison Schaefer indépendante, sur chaque intervalle d'effort
constant, poser `alpha=r-q*a*E`, `beta=r/K`,
`D=1+beta*N0*expm1(alpha*t)/alpha`, puis
`N(t)=N0*exp(alpha*t)/D` et
`C(t)=C0+(q*a*E/beta)*log(D)` ; traiter alpha=0 par sa limite.
Les états terminaux d'un intervalle deviennent les états initiaux du suivant.
Cet oracle appartient aux tests et n'intervient pas dans la simulation ou
la décision. À t=5, l'oracle indépendant donne :

| Cas | N analytique | C analytique | Écart absolu N natif | Écart absolu C natif |
|---|---:|---:|---:|---:|
| Efforts 260 jusqu'à 1, puis 150 | 155.00818740717037 | 126.06029577109132 | 0.001092 | 0.001920 |
| Efforts 260 jusqu'à 1, 150 jusqu'à 3, puis 80 | 174.23076035118225 | 106.40613390813866 | 0.003516 | 0.001064 |

Les contrôles HTTP comparent également les critères bruts de chaque enfant
à cet oracle, avec tolérances Nmin=0.05 et CH=0.30. Les contrôles de la
trajectoire parent utilisent 0.05 sur N et 0.10 sur C. Les valeurs natives
ne sont jamais remplacées par la solution analytique.

### Validation

La première suite HTTP 8H a réussi 15/16 tests en 81.40 s. Son unique échec
était une assertion du banc datant les actions par les échantillons du
maintien. Le contrôle correct vérifie leur séquence de valeurs ; les dates
et la séquence exacte sont vérifiées sur les sorties actives par la preuve
C++ renforcée. Le modèle, le moteur et le rééchantillonneur ne sont pas
modifiés pour corriger ce contrôle. `http-8h.log` conserve l'échec initial,
`http-8h-variant-corrected.log` la reprise ciblée 1/1, et `http-8h-final.log`
la reprise complète à **16/16 en 86.16 s**. Les trois traces `*-strict.log` prouvent
aussi la séquence exacte des actions et le reset du même graphe.

Après le correctif natif de préservation des acks sur init et l'ajout de
deux cas confluents, la nouvelle suite complète réussit **18/18 en 71.96 s**.
Le journal et les JSON sont conservés dans
`Release/logs/final-targeted-20261108-013750-4828681/`.
Les trois preuves natives de ce même dossier passent avec reset et donnent
des traces identiques par SHA-256 à leurs traces strictes antérieures : les
événements et résultats scientifiques des graphes livrés restent identiques.

L'ajout du cas natif de critère non fini (code 67) porte la suite à
**19/19 tests HTTP en 63.76 s**, chaque appel étant strictement comparé
à l'exécution C++ directe. Cette première validation à 19 cas est dans
`Release/logs/run-20261108-015259-3637621-32680/http-8h.log` et son dossier
`http-8h/`. La reprise CTest isolée 8H réussit aussi les 19 cas en 22.54 s,
sans retranspilation concurrente de dist. Son journal complet est conservé
dans `Release/logs/criterion-final-20261108-020251-9623122-36268/runner-8h-complete.log`
en plus du JUnit, dont system-out est tronqué par CTest à 1024 octets.

La vérification finale des fichiers de preuve a repéré un nom partagé par
les deux rejets d'horizon (`H=3` et `H=0`) : les premières captures à 19 tests
contenaient 39 fichiers pour 40 appels. Le nom inclut désormais la valeur du
cas. Les mêmes 19 contrôles sont rejoués sans changer leur logique :

- Release : **19/19 en 19.12 s**, 40 fichiers distincts dans
  `Release/logs/final-http-evidence-20261109-175740-4717418-30204/`.
- Debug : **19/19 en 133.43 s**, 40 fichiers distincts dans
  `Debug/logs/final-http-evidence-20261109-175740-5144363-25880/`.

Chaque fichier contient la requête, le résultat natif, le code de sortie et
la confirmation d'égalité HTTP/native. Les 40 paires de requêtes/résultats
sont aussi strictement identiques entre Release et Debug. Cette vérification
est conservée dans `build-web-test8h/final-8h-evidence-comparison.json`.
Les premiers journaux et les premières captures restent présents.

La compilation Debug complète a terminé le 8 novembre, avec tous ses codes
de construction à zéro, dans
`Debug/logs/run-20261108-015257-4047858-300/`. Les tests ont repris le
9 novembre dans `Debug/logs/run-20261109-173239-2455620-23228/`.
Le runner CTest donne 45/48 en 562.35 s, avec les mêmes trois références CSV
absentes qu'en Release. Les 19 cas 8H passent dans ce groupe en 39.80 s,
y compris le critère non fini et son erreur 67. `runner-complete.log`
conserve la sortie complète, en complément de `runner.xml`.

Les trois preuves natives Debug passent avec reset. Leurs journaux sont
identiques octet par octet aux journaux Release de la validation complète :

| Preuve native | SHA-256 commun Release/Debug |
|---|---|
| Minimal | `31A0009CCD028D07CD83188F8F30841B52FD14152E5E3EB97209AB1685C38809` |
| Schaefer | `8752587383A66A54430F484971E88D1DCCA95DCA6941CB3324B5F72A520CE659` |
| Variante à un candidat | `85D5BE288D789EB53AA348D491789C80B5F0CC67D6CD6C63E1DEFE784C389935` |

Le navigateur Debug a d'abord réussi 65/71 parcours en 12.6 minutes.
Le téléchargement du cas qss3_multiplier a été annulé, puis Chrome a signalé
`Espace insuffisant sur le disque (0x70)` pour ses caches de profil sur C:
lors des cinq lancements suivants. Les six échecs, captures et traces sont
conservés dans `playwright-debug-full-20261109-173416-4148524-34044` et les
journaux/JSON de même nom sous `build-web-test8h/logs/`.

La reprise des six seuls cas utilise TEMP et TMP sous
`build-web-test8h/debug-disk-recovery-20261109/temp/` sur D: et réussit
**6/6 en 36.6 s**. Aucun code ni timeout ne change. Une première sélection
de reprise, trop restrictive, n'a trouvé aucun test ; son journal
`playwright-debug-qss-retry-20261109-174756-4262170-1596.log` reste conservé.
La reprise effective est
`playwright-debug-qss-retry-20261109-174826-8949883-30028`.
`debug-browser-coverage.json` vérifie que ses six identités correspondent
exactement aux six échecs initiaux : les 71 parcours sont donc couverts en
Debug, sans test ignoré. Les données des anciens dossiers de preuve sont
archivées avant leur réutilisation ; les deux parcours 8H restent dans
`browser-debug-full-20261109-173416-4148524-34044/`.

La première tentative a lancé deux compilations, Release et Debug, avec trois
jobs chacune. Le système a épuisé son fichier de pagination ; MSVC a produit
`fatal error C1060` (tas du compilateur insuffisant), et un nouveau processus
PowerShell n'a pas pu charger son assembly système. Les deux builds ont
retourné 2 et leurs scripts 1. Les journaux initiaux restent dans
`build-web-test8h/Release/logs/run-20261108-005903-2111810-23836/` et
`build-web-test8h/Debug/logs/run-20261108-005903-2232114-19860/`.
La reprise utilise un seul job de compilation et une seule configuration à
la fois. Cette réduction de concurrence répond à l'erreur mémoire observée ;
aucun timeout de test n'est augmenté. Ce diagnostic de build ne vaut pas un
échec scientifique du modèle ; les validations mesurées restent séparées.

Les dossiers complets de validation ci-dessous sont notés R et D :

- R : `build-web-test8h/Release/logs/run-20261108-015259-3637621-32680/`.
- D : `build-web-test8h/Debug/logs/run-20261109-173239-2455620-23228/`.

La construction Release complète est conservée dans
`Release/logs/run-20261108-014827-1181135-25820/` ; celle de Debug est
référencée plus haut. Les captures HTTP 8H finales sont détaillées ci-dessus.

| Groupe | Release | Debug | Journaux/preuves |
|---|---|---|---|
| Construction native et groupes C++ 8H | Construction réussie ; 3/3 preuves strictes, reset compris | Construction réussie ; 3/3, traces identiques à Release | R et D : `native-dynamic-*.log` |
| Plans dynamiques JSON et HTTP, comparaison événements natifs | 19/19 ; 40 paires HTTP/native | 19/19 ; 40 paires HTTP/native identiques à Release | Captures finales ci-dessus : `http-8h.log`, `result.json` et 40 JSON par configuration |
| CTest runner et non-régression 8A–8H, group_aggregate, requiredInputs, T*, rééchantillonnage et décisions | 45/48 ; reprise 8H à 19/19 en 22.54 s | 45/48 ; 8H à 19/19 en 39.80 s | R et D : `runner-tests.log`, `runner.xml` ; D : `runner-complete.log` ; reprise Release : `criterion-final-20261108-020251-9623122-36268/runner-8h-complete.log` |
| Moteur officiel, dont QSS1/QSS2/QSS3 | 10/10 | 10/10 | R et D : `official-tests.log`, `official.xml` |
| Clients historiques 7A–7C | 40/40 | 40/40 | R et D : `historical-tests.log`, `historical.xml` |
| API/processus/HTTP historiques | 94/94 | 94/94 | R et D : `api-tests.log` |
| HTTP 8B | 12/12 | 12/12 | R et D : `http-8b.log` |
| HTTP 8C | 13/13 | 13/13 | R et D : `http-8c.log` |
| HTTP 8D | 13/13 | 13/13 | R et D : `http-8d.log` |
| HTTP 8E | 23/23 | 23/23 | R et D : `http-8e.log` |
| HTTP 8F | 20/20 | 20/20 | R et D : `http-8f.log` |
| HTTP 8G | 11/11 | 11/11 | R et D : `http-8g.log` |
| Diagnostics et destination invalide | 2/2 | 2/2 | R et D : `diagnostic-streams.log` |
| Vitest, TypeScript, frontend | 162/162 Vitest, typecheck et build Next final réussis | Frontend commun ; ces contrôles sont exécutés une fois | `build-web-test8h/logs/{vitest-layout,typecheck-layout,next-build-minzoom-attempt4}.log` |
| Playwright et comparaison runner/HTTP | 71/71 en une suite complète de 7.5 min, deux parcours 8H inclus | 65/71 initialement, puis reprise 6/6 en 36.6 s ; 71 parcours couverts, deux 8H inclus | `logs/playwright-full-release-run2.*`, journaux Debug détaillés plus haut ; `debug-browser-coverage.json` |

Le CSV historique 7G reste absent et n'est pas reconstitué. Les trois échecs
CTest sont `runner-wrapper-7g`, `native-wrapper-schaefer-trajectories` et
`native-wrapper-schaefer-pair`, tous liés à cette référence manquante.
Le journal et le JUnit conservent leurs échecs et CTest retourne 8 ; aucun
de ces tests n'est ignoré ou transformé artificiellement en succès.
Toutes les autres étapes de `exit-codes.json` sont à zéro dans chaque
configuration ; les deux scripts globaux conservent le code 1 en raison de
ce runner-tests=8. Les reprises ciblées réussies ne réécrivent pas cet état.

### Reproduction et conservation des journaux

Le script `web/engine/runner/tests-wrapper/run-8h.ps1` prépare un build
indépendant dans `build-web-test8h/Release` ou `build-web-test8h/Debug`.
Il accepte `-BuildOnly`, `-TestsOnly` et l'alias `-TestOnly`. Chaque invocation
crée un dossier `logs/run-<horodatage>-<PID>` ; `logs/latest-run.txt` en donne
le chemin. Les journaux, JSON de preuve et JUnit d'une tentative antérieure
ne sont pas écrasés par une reprise. Les timeouts CTest déclarés sont
conservés ; les tests officiels gardent 120 secondes comme en 8G.

L'option `-NativeOnly` construit seulement la bibliothèque et le projet du
runner afin de lancer les contrôles 8H avant de compiler les clients de
tests officiels/historiques. Elle implique BuildOnly. Une reprise Release
initialement lancée avec tous les clients a été interrompue volontairement
pour cette priorité ; son code d'arrêt et son journal sont conservés dans
`Release/logs/run-20261108-010015-5060277-11412`. Les objets complets sont
réutilisés par Ninja. Cet arrêt volontaire n'est pas classé comme défaut
scientifique ou source.

Le dossier `Release/logs/run-20261108-011030-3525635-29032` conserve aussi un
arrêt volontaire de la cible globale du runner après compilation de main et
de la preuve : Ninja retardait leurs liens derrière les autres clients. La
reprise `run-20261108-012225-3332072-34732` cible seulement `irritator-runner`
et `dynamic-plan-native` et réussit leurs deux liens. La reprise suivante
`run-20261108-012507-9022329-34440` recompile la preuve à assertions d'actions
renforcées et réussit également. Ces codes d'arrêt ne sont pas effacés ni
convertis en succès dans les journaux de leur tentative.

La tentative `Release/logs/run-20261108-012759-5625434-36416` termine aussi
les vingt étapes du stage moteur officiel avec code 0. Elle est ensuite
arrêtée à la frontière du stage suivant afin de libérer la mémoire pour le
build Next.js final ; aucune unité lourde du moteur n'est interrompue.
Ce créneau explicite évite de reproduire la saturation mémoire initiale.

```powershell
./web/engine/runner/tests-wrapper/run-8h.ps1 -Configuration Release
./web/engine/runner/tests-wrapper/run-8h.ps1 -Configuration Debug
```

Les trois exécutions natives ciblées appellent `dynamic-plan-native` avec
chacun des exemples livrés. Les suites HTTP utilisent le même runner de
configuration que les tests C++. Les journaux de chaque étape, résultats
JSON, traces et JUnit référencés dans le tableau établissent les exécutions.

Pour éviter de lancer un exécutable Windows pendant son remplacement par le
linker, le navigateur Release utilise la copie immuable
`build-web-test8h/Release/runner/irritator-runner-browser-release.exe`.
Son SHA-256, vérifié identique au binaire canonique final utilisé pour les
19 tests HTTP, est
`C11D7114DBAD7FCD1FB431FDC42AD94EC41AF213629FE0C879889E80ED91603A`.
Un parcours antérieur a croisé un lien et produit ENGINE_UNAVAILABLE ; cette
tentative reste conservée et n'est pas classée comme erreur scientifique.

Le navigateur Debug utilise de même
`build-web-test8h/Debug/runner/irritator-runner-browser-debug.exe`, dont le
SHA-256 est identique au runner Debug canonique :
`2CB61B65C99C1AA2DF7BB72B04994AB4D24ABEBCA0516154CB1AF9FD4FF0DA53`.
Après les parcours Debug, la session locale de relecture sur
`http://127.0.0.1:3003` utilise de nouveau le runner Release immuable via
l'API sur le port 3001. Le handshake natif et sa capacité dynamicPlan sont
confirmés.

## 6. Limites explicites pour un Pk arbitraire

Cette version vise une définition prospective fixe, un nombre/ordre fixe de
facteurs et de critères, des cibles reals[0] validées et des domaines discrets
numériques. Elle ne transporte pas de référence de modèle alternative, de
chaîne arbitraire, de nouvel état interne complet, de nouveau critère, de
nouvelle équation, de nouvelle connexion ou de fonction d'échantillonnage
scientifique. L'identité/version du plan ne recompile pas le modèle.

La génération reste un produit cartésien ordonné des domaines reçus ; elle
ne transporte pas une liste libre de combinaisons corrélées ou une méthode
statistique de planification. Les champs de cardinalité 5+i sont positionnels
dans l'ordre natif des facteurs. Réordonner ces facteurs demande aussi de
mettre en cohérence les identités numériques des sources de métadonnées du
graphe ; le remappage des seules connexions par id ne réécrit pas ces valeurs.

L'enveloppe déclarée borne le nombre de scénarios et H. Un domaine numérique
peut changer ses valeurs sans être un simple sous-ensemble de la grille
initiale, mais ne peut dépasser cette capacité. Un choix structurel de modèle,
un changement de dimension, un critère nouvellement créé ou une reconstruction
arbitraire du graphe demanderait un contrat distinct et la preuve de prise en
charge par le moteur. Ni les résultats antérieurs 8F/8G ni cette extension
bornée ne doivent être présentés comme cette capacité générale.

Livrables 8H demandés :

- `web/examples/decision-dynamic-plan-minimal-v3.json`.
- `web/examples/tstar-schaefer-dynamic-plan-v3.json`.
- Variante de preuve : `web/examples/tstar-schaefer-dynamic-plan-single-v3.json`.
- Le présent rapport et les preuves de validation référencées.
