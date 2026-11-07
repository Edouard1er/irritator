# Contrats scientifiques v1, v2 et v3

Les schémas JSON draft-04 sont exécutés par RapidJSON dans le runner et par Ajv
dans le service et l’éditeur. `request.schema.json` reste le schéma v1.
`request-v2.schema.json` ajoute la composition. Le catalogue global reste une
liste de **types atomiques natifs** ; les définitions couplées appartiennent
uniquement au document. Les réussites des requêtes scientifiques v1/v2 gardent
le résultat v1 ; les requêtes v3 utilisent explicitement le résultat v2.
Les erreurs conservent l'enveloppe v1.

Le catalogue contient 13 types atomiques depuis le Test 6.1. Les schémas v1/v2
acceptent déjà des noms de types et des paramètres numériques génériques :
l’extension est portée par `catalog.json` et sa validation sémantique commune,
sans changement de forme ni de version des documents existants.
`qss3_multiplier`, `qss3_inverse`, `qss3_square` et `qss3_sqrt` exigent
`parameters: {}`. `qss3_wsum_2` exige `coeff-0` et `coeff-1` ; `qss3_power`
exige `n`. Ces trois paramètres sont des nombres finis dans ±1e12.
La métadonnée `default: 1` sert à la création dans l’éditeur ; la validation
n’insère aucun paramètre absent. Les six types ont une sortie 0 ; multiplier
et wsum ont les entrées 0/1, les quatre autres une seule entrée 0.

## Racine et définitions

La requête v2 conserve `model.id`, `model.components`, `model.connections`,
`model.observations`, `simulation` et les limites v1. Elle exige en plus
`model.definitions`, un tableau de 0 à 64 définitions autonomes.
`model` est la portée racine, sans ports externes. Une définition a la forme :

```json
{
  "id": "Sum2Block",
  "name": "Somme réutilisable",
  "inputs": [{"port": 0, "name": "in0"}, {"port": 1, "name": "in1"}],
  "outputs": [{"port": 0, "name": "out0"}],
  "components": [{"id": "sum", "type": "qss1_sum_2", "parameters": {}}],
  "connections": [
    {"from": {"component": "$input", "port": 0}, "to": {"component": "sum", "port": 0}},
    {"from": {"component": "$input", "port": 1}, "to": {"component": "sum", "port": 1}},
    {"from": {"component": "sum", "port": 0}, "to": {"component": "$output", "port": 0}}
  ]
}
```

Les enfants atomiques gardent la syntaxe v1. Une occurrence couplée s’écrit
`{"id":"sumA","type":"coupled","definition":"Sum2Block","parameters":{}}`.
Plusieurs occurrences référencent une définition commune ; la modification de
cette définition s’applique à toutes. Les états sont alloués séparément par
`project::set`. Il n’existe pas d’override de paramètres par occurrence dans
cette version : des entrées différentes permettent des comportements distincts.

Les connexions sont locales à leur portée. `$input` peut seulement être source,
`$output` seulement destination, à l’intérieur d’une définition. Les autres
extrémités désignent un enfant direct, jamais un chemin traversant une interface.
Un indice de port couplé doit apparaître dans `inputs`/`outputs` ; les indices
peuvent avoir des trous. Supprimer 0 ne transforme pas 1 en 0. Noms et indices
sont uniques pour une direction donnée. Pas de traversée directe `$input` vers
`$output` ; un modèle enfant doit porter les événements. Les ports déclarés
doivent atteindre un port atomique avant exécution. Un brouillon incomplet peut
rester dans l’éditeur et sa sauvegarde locale.

## Observations et identifiants

Une observation utilise un **chemin d’instances vers un modèle atomique** :
`{"component":"sumB/sum","samplingInterval":1}` ou
`{"component":"composite/right/sum","samplingInterval":1}`.
Ce chemin est indépendant des identifiants temporaires du moteur. Une sortie
couplée n’est pas elle-même un état observable : observer le modèle atomique
qui la produit. Le runner résout les chemins via les `tree_node::children`
produits par `project::set`, sans déduire un `model_id` d’un nom JSON.

Identifiants : 1 à 64 caractères ASCII `[A-Za-z0-9_-]`, uniques dans leur portée.
Les observations ont au plus neuf segments (huit niveaux couplés et un atome).
Les noms affichés peuvent différer des identifiants. Les positions, caméras,
mesures React Flow et navigation n’entrent jamais dans la requête scientifique.

## Limites et erreurs

Plafonds : 128 atomes exécutables, 512 connexions après résolution des interfaces,
512 occurrences au total, huit niveaux couplés au-delà de la racine, 16 ports par
direction, 32 observations, 100 000 appels `run`, 20 000 points potentiels,
1 Mio de JSON. `limits.maxDepth` et `limits.maxInstances` abaissent les plafonds ;
les variables serveur `ENGINE_MAX_DEPTH` et `ENGINE_MAX_INSTANCES` les abaissent
également. Les définitions inutilisées doivent elles aussi être valides et tenir
dans les budgets, pour que le document complet soit portable. Le calcul de
budget des connexions multiplie les nombres de sources et de destinations
atomiques lorsqu’une connexion traverse des interfaces avec fanout/fanin.

Les dépendances de définitions doivent former un DAG ; les cycles de connexions
DEVS sont acceptés et restent soumis au budget d’ordonnancement. Une définition
réutilisée est comptabilisée à chaque occurrence, avec ses descendants.

Erreurs v2 : `DEFINITION_NOT_FOUND`, `INVALID_EXTERNAL_PORT`, `INVALID_SCOPE`,
`RECURSIVE_DEFINITION`, `HIERARCHY_DEPTH`, `EXPANSION_LIMIT`,
`NATIVE_CONSTRUCTION_ERROR`, `OBSERVATION_ERROR`. La structure existante
`{schemaVersion:1,status:"failed",error:{code,message,...},requestId}` est conservée.
Le service rejette les erreurs de contrat en 400 ; les erreurs retournées par
le processus natif sont en 422, avec catégorie/code moteur lorsqu’ils existent.
Timeout et sortie trop volumineuse gardent leurs contrôles historiques.

Aucun code utilisateur, chemin de fichier, bibliothèque, import distant ni
référence de ressource externe n’est accepté. Le C++ répète les validations
avant toute allocation native, même lorsqu’il est lancé sans HTTP.

## Catalogue ajouté et résultats

| Type | Paramètres | Entrées | Sortie / observation |
|---|---|---|---|
| `qss2_integrator` | `X` fini dans ±1e12, `dQ` entre 1e-9 et 1e12 | dérivée 0, reset 1 | état X, port 0 |
| `qss1_multiplier` | aucun | facteurs 0 et 1, initialement nuls | produit, port 0 |

L’intégrateur est `abstract_integrator<2>` ; le multiplicateur est
`abstract_multiplier<1>`, les deux définis dans `lib/include/irritator/core.hpp`.
Le catalogue v1 accepte ces types supplémentaires sans changer ses graphes.
Les anciens exemples sont inchangés.

Exemples complets : `web/examples/hierarchy-sum.json`, `hierarchy-nested.json`,
`hierarchy-independent.json`. Les deux premières expériences publient
`(0,10),(1,110),(2,1110)`, exactement comme `sum3.json`. La troisième utilise
deux occurrences QSS2, X=5, dQ=.25, dérivées 2 et −3, horizon `[0,3[`, pas .1.
Les valeurs terminales sont 11 et −4 ; les trajectoires sont identiques à leurs
références plates natives. **QSS2 présente un écart initial de rééchantillonnage** :
pour la dérivée 2, à .1, 5.192 au lieu de 5.2. La tolérance analytique annoncée
pour ces essais est .01, puis 1e-9 aux instants de référence 1, 2 et 3. Aucun
point n’est corrigé. Voir `reports/hierarchy-test-6.md` pour l’analyse de Hermite.

Un document plat reste exporté en v1 tant qu’aucune définition couplée n’est
créée. Un document v2, même plat, conserve sa version à l’import/export.
Les exports scientifiques omettent les données graphiques ; les workspaces
navigateur v2 conservent chaque portée séparément et migrent le v1 sans le réécrire.

## Simulation imbriquée v3 (Test 7C)

`request-v3.schema.json` conserve les graphes v2 et ajoute un enfant
`{id,type:"simulation_wrapper",parameters:{},experiment:{...}}`. Exemple exécutable :
[`wrapper-affine-v3.json`](../../examples/wrapper-affine-v3.json).
`experiment` exige `definition` (référence locale, y compris déclarée plus loin),
`simulation:{start,end}`, `run:"complete"`, `factors`, `selections` et
`objective:{method:"simple",type:"maximize"|"minimize",primary}`.

Un facteur contient `id`, `target` (chemin d'instances relatif au prospectif),
`parameter`, `type` et exactement `value` pour `single`, ou `values` non vide pour
`fixed`. `name` est facultatif. Seuls `constant.value` et
`qss{1,2,3}_integrator.X` sont admis : tous écrivent `reals[0]`. Les valeurs
doivent respecter les bornes du paramètre du catalogue. `offset`, `dQ`, paramètres
entiers et autres types ne sont pas des cibles de facteurs validées.
Un seul facteur par cible ; identifiants uniques séparément pour facteurs et
sélections. Leurs identifiants ont au plus 31 caractères ASCII ; les identifiants
de composants/définitions gardent 64 caractères. Les noms affichés ont 64 caractères.

Une sélection contient `id`, `target`, `criteria` et éventuellement `name`.
Les critères sont `min`, `max`, `min-last`, `max-last`. La cible doit être un
atome observable du catalogue. Les réductions sont celles du moteur, au pas
interne 0,1 ; les deux critères terminaux lisent la même dernière valeur.
Le sens d'optimisation est celui de l'objectif. `primary` désigne une sélection.
Tous les autres modes, méthodes, familles de facteurs et critères sont rejetés
par le schéma. Les définitions prospectives peuvent être couplées ; un prospectif
contenant lui-même un wrapper est explicitement rejeté, même sans récursivité.
Le DAG des références comprend les liens couplés **et** prospectifs ; il ne
comprend pas les cycles de connexions DEVS.

Pour F facteurs et S sélections : `1<=F<=10`, `S>=1`, `3<=F+S<=12`.
Les entrées sont `init=0`, `run=1`, puis les F facteurs à partir de 2.
Les sorties sont les S sélections dans l'ordre JSON, puis les F facteurs dans
l'ordre JSON. Les facteurs émettent les trois réels du paramétrage natif ; par
exemple un facteur sur `X` produit `[X0,dQ,0]`. Les ports sont calculés par
occurrence et ne proviennent pas des tableaux du catalogue atomique.

Une occurrence couplée peut ajouter un plan privé sans modifier sa définition :

```json
{"id":"right","type":"coupled","definition":"Cell","parameters":{},
 "experimentOverrides":[{"target":"decision","factors":[
   {"id":"rate","type":"fixed","values":[-2,2]}
 ]}]}
```

`target` est relatif à l'occurrence couplée et doit atteindre un wrapper. Tous
ses facteurs sont fournis, avec les mêmes identifiants et le même ordre. Seuls
leur type `single`/`fixed` et leurs valeurs changent ; cibles, paramètres,
sélections, horizon, objectif et dimensions restent ceux de la définition.
Deux overrides au même niveau ne peuvent pas viser le même wrapper ; un override
du niveau englobant remplace le plan obtenu dans ses descendants. Les plans
effectifs sont validés avant la construction native. Chaque occurrence obtient
une ressource privée par `bind_wrapper`, même sans override.

Plafonds supplémentaires, abaissables par `limits` :

| Limite | Plafond |
|---|---:|
| `maxWrappers` (déclarations et occurrences, contrôlées séparément) | 8 |
| `maxScenarios` (produit cartésien par wrapper) | 128 |
| `maxTotalScenarios` (somme par graphe exécuté) | 256 |
| `maxTotalModels` (atomes cumulés des copies) | 8192 |
| `maxTotalConnections` (connexions cumulées des copies) | 32768 |
| `maxInternalPoints` (grilles d'observation prospectives cumulées) | 200000 |
| `maxResultEvents` (journal de sorties parent) | 20000 |

Les plafonds v2 restent applicables séparément au parent et à chaque définition.
Le cumul inclut deux prototypes par déclaration de wrapper (descripteur et copie
temporaire de `project::set`), puis un prototype privé et N scénarios par
occurrence, ainsi qu'un récepteur conservateur par sortie. Les connexions sont
comptées après expansion des interfaces. Les grilles internes sont estimées par
`N * nombre de cibles sélectionnées distinctes * (ceil((end-start)/0.1)+2)`.
Chaque définition inutilisée et chaque plan effectif sont également vérifiés.
Ce sont des budgets logiques, pas une mesure exacte des octets alloués ni du
nombre de sacs internes. Un timeout externe demeure nécessaire pour `complete`.
La profondeur combinée des références est bornée à 16 ; les graphes couplés
conservent leur plafond de huit niveaux.

## Résultat v2 du runner pour les requêtes v3

Une réussite scientifique v3 produit explicitement `schemaVersion:2` : mêmes
champs `status`, `modelId`, `simulation`, `observations`, `diagnostics`, plus :

```json
{"resultEvents":[{"component":"decision","time":1,"port":0,
                  "bag":3,"value":[3,0,0]}],
 "wrappers":[{"component":"decision","inputs":3,"scenarioCount":3,
              "outputs":[{"port":0,"kind":"selection","id":"terminal"},
                         {"port":1,"kind":"selection","id":"minimum"},
                         {"port":2,"kind":"factor","id":"rate"}]}]}
```

`bag` est le numéro de l'appel parent `run` collecté (depuis 1), une métadonnée
locale du collecteur. Dates répétées et triplets restent intacts. Les sorties
non connectées reçoivent un récepteur DEVS privé pour rendre leurs émissions
natives collectables. `collectorModelCount` dans les diagnostics compte ces
récepteurs. Aucun gagnant, identifiant de scénario sélectionné ou statut du
wrapper n'est inventé. `scenarioCount` décrit la cardinalité du plan, vérifiée
contre les scénarios natifs après initialisation. Sans commande, le journal
est vide. Les réponses à la borne finale parent sont exclues.

Les observations parent gardent leur collecte et rééchantillonnage historiques ;
le journal ne les remplace pas. Les erreurs gardent l'enveloppe d'échec v1 et les
codes natifs disponibles. Les réussites de requêtes v1/v2 restent en résultat v1.
Les codes supplémentaires de validation sont `INVALID_EXPERIMENT`,
`INVALID_FACTOR`, `INVALID_SELECTION` et `UNSUPPORTED_EXPERIMENT` ; les erreurs
de références, construction et limites réutilisent les codes de l'adaptateur.
`parseWrapperResult` valide la nouvelle enveloppe ; `parseResult` reste le parseur
v1 et refuse explicitement le résultat v2.

Depuis le Test 7D, Fastify accepte v1/v2/v3 sur
`POST /api/v1/simulations/run`. `ProcessEngine` applique les limites effectives
v3 et sélectionne `parseWrapperResult` uniquement pour une requête v3. Les
observations parent et le journal sont restitués sans changement ; seule
l'enveloppe HTTP ajoute `runId`. Les erreurs restent des enveloppes v1.

`runner-capabilities.json` est embarqué par CMake et exporté comme
`runnerCapabilities` en TypeScript. Le runner l'émet avec `--capabilities`,
séparément de `--describe`, qui conserve exactement les treize types historiques.
La description annonce les requêtes 1/2/3, les résultats correspondants 1/1/2,
le domaine natif 7C et ses plafonds. Le backend contrôle exactement catalogue
et capacités avant chaque exécution v3 ; toute différence produit
`RUNNER_INCOMPATIBLE` (502). La présence d'un nom de type ne prouve jamais ce
support. Le contrôle de santé expose les capacités seulement après vérification.
React Flow expose ces capacités depuis le Test 7E, puis les extensions ci-dessous depuis le Test 7F.

Reproduction : `npm --prefix web ci` si nécessaire, puis
`powershell -NoProfile -ExecutionPolicy Bypass -File web/engine/runner/tests-wrapper/run-v3.ps1 -Configuration Release`
(ou `Debug`). Le script réutilise les builds moteur/historiques 7B de même
configuration et reconstruit tous les clients du runner ; exécuter au préalable
`tests-wrapper/run.ps1` pour créer ces builds sur une machine neuve.
La campagne HTTP et de non-régression complète est
`powershell -NoProfile -ExecutionPolicy Bypass -File web/test-wrapper-http.ps1 -Configuration Release`
(ou `Debug`). Voir le README web pour le runner historique requis par le test
de compatibilité et les variables `ENGINE_MAX_*` supplémentaires.

## Extensions natives 7F (mêmes versions v3 / résultat v2)

`objective` accepte les trois configurations suivantes ; les tableaux suivent
l’ordre de `selections`, jamais celui des cibles distinctes :

```json
{"method":"simple","type":"maximize","primary":"terminal"}
{"method":"weighted-sum","type":"maximize","weights":[2,1],"types":["maximize","minimize"],"norm":"min-max"}
{"method":"epsilon-constrained","type":"maximize","primary":"terminal","epsilons":[1,1],"operations":["less-equal","greater-equal"]}
```

`weighted-sum` accepte aussi `z-score` (écart-type de population). Les poids
restent tels que fournis. Le moteur émet les critères **normalisés** ; les autres
méthodes émettent les critères bruts. `wrappers[].criteriaScale` indique `raw`
ou `normalized` ; les anciens résultats simples sans ce champ restent lisibles.
Les égalités epsilon sont exactes, la primaire est contrainte aussi, et un
ensemble admissible vide produit un journal vide, jamais une valeur zéro.

Les neuf `type` de facteurs sont `single`, `single-add`, `single-mult`,
`fixed`, `fixed-add`, `fixed-mult`, `random`, `random-add`, `random-mult`.
Single utilise `value`, fixed utilise `values`, random utilise :

```json
{"id":"rate","target":"u","parameter":"value","type":"random-add",
 "count":4,"distribution":"normal","reals":[0,1],"ints":[0,0]}
```

Les tableaux ont exactement deux cases. Les noms et positions des paramètres
réellement consommés sont exportés dans `distributionParameters` ; les 17 noms
pris en charge figurent dans `randomDistributions` et les capacités du runner.
`bernoulli` et `extreme-value` sont mappés explicitement vers les enums natifs
`bernouilli` et `exterme_value`. Les domaines sont validés dans TS et C++, sans
tirage côté web. Les valeurs natives générées ou transformées doivent rester
finies et dans les bornes du paramètre cible, sinon l’exécution échoue.

L’option `experiment.seed` contient **six chaînes décimales u64**, par exemple
`["18446744073709551615","9007199254740993","0","0","0","0"]`.
Ce sont clé, flux, compteur, position et deux cases de tampon de l’état natif.
`init` fait évoluer le générateur courant ; il ne restaure pas cet état initial.
Le moteur invalide son tampon à l’entrée de chaque génération. Une reproduction
est garantie par les tests pour le même binaire, les mêmes paramètres et le même
état initial ; aucune équivalence des distributions STL entre plateformes n’est promise.

`run` accepte `complete`, `bag`, `time`, `until`, `during`. Les ports restent
init=x[0], run=x[1], facteurs=x[2+i]. `bag` effectue un appel natif ; `time`
avance tant que la date enfant reste celle du début de commande, et peut traiter
le premier sac suivant. `until` vise une date enfant absolue ; `during` ajoute
une durée à la date courante de l’enfant. Les cibles entre sacs peuvent être
dépassées. Le scalaire run sert aussi de délai d’émission dans le parent.
Les horloges sont indépendantes. Les modes partiels appliquent un facteur modifié
après `init` ; complete le fait au prochain run. Les événements reçus, réponses
différées et sacs distincts restent gérés par `simulation_wrapper`.

Les overrides d’occurrences acceptent les neuf plans, sans changer cibles ni
dimensions. Les limites, les ports logiques, les formats v1/v2 et le rejet des
wrappers récursifs sont conservés. Campagne reproductible :
`web/engine/runner/tests-wrapper/run-7f.ps1 -Configuration Release` (ou Debug).
# Composants génériques de décision — Test 8A

Le catalogue comprend aussi `generator` (natif existant), `event_tag`,
`value_memory`, `event_operator`, `candidate_filter` et `candidate_select`.

Le Test 8C ajoute `campaign_aggregate` (min/max/somme/moyenne/count),
`campaign_broadcast` (jointure d'un agrégat avec chaque candidat) et
`selection_priority` (arbitrage de deux sélections réelles). Les fins sont
obligatoires ; les calculs restent dans libirritator. Le filtre peut transporter
un second score (entrée 5, sortie 4, bit required=8). Le sélecteur accepte
`requireSecondary` et `secondaryDirection`, optionnels et à 0 par défaut,
ainsi que l'entrée 4=secondary. Ses sorties supplémentaires 4/5/6 sont
taggedAction/secondary/end ; les indices historiques sont conservés.
L'arbitre reçoit les sorties 4/2/5/3 de chaque sélecteur et choisit la branche
non vide de plus petite priorité. Son repli conserve l'action, les deux scores
et l'identité du vrai candidat ; deux branches vides n'émettent aucune action.
Voir `reports/bstar-generic-components-test-8C.md` et les exemples `decision-8c-*-v3.json`.
Les paramètres numériques et entiers, leurs défauts et leurs descriptions
sont fournis par `catalog.json` et validés par TypeScript et C++.

Les flux identifiés utilisent `[valeur,candidat,campagne]`. Les fins d’ensemble
annoncent le nombre de lignes à recevoir ; les consommateurs attendent aussi
leurs champs requis, même si une branche arrive plus tard. Les masques requis
sont 1=a/score, 2=b/action, 4=condition pour le filtre. Les sorties sont drainées
à sigma=0, un message par sac. La sortie action du sélecteur est un scalaire
`[action,0,0]` ; les autres sorties conservent les identités.

Le champ v3 optionnel `experiment.scenarioResults: true` ajoute, après les
F+S sorties historiques du wrapper : le statut de chaque scénario, F facteurs
réellement appliqués, S critères bruts, puis une fin
`[nombre valide,nombre total,campagne]`. Les indices de scénarios sont locaux
au wrapper, comme les campagnes. Les instantanés sont émis à la date de réponse
par de vraies transitions DEVS du parent. L'enveloppe HTTP v2 conserve leur
journal ; elle ne calcule aucune décision.

Exemples portables : `web/examples/decision-*.json`.
Sémantique détaillée, cas limites et vérifications :
[`reports/bstar-generic-components-test-8A.md`](../../../reports/bstar-generic-components-test-8A.md).

## Boucle native 8D

`state_observer` expose `source`, `read`, `reset` → `value`, `missing`.
Relier une seule sortie d'intégrateur QSS1/2/3 à `source` : cette connexion lie
l'état natif ; ses messages quantifiés ne servent pas de données mémorisées.
Une commande read `[_,identité,campagne]` produit, après les transitions du sac
reçu, `[X(t),identité,campagne]`. Sans source, elle produit missing. Une source
ambiguë ou d'un autre type échoue à l'initialisation. La capacité 1–4096 borne
les commandes et réponses en attente ; reset les annule.

`zero_order_hold`, atome natif existant, conserve une commande entre les sacs
et émet seulement `[valeur,0,0]`, pour éviter qu'une identité devienne une
dérivée QSS3. Dans un même sac, sa règle native retient la valeur maximale.
L'exemple `decision-feedback-minimal-v3.json` assemble lecture, mémoire,
configuration prospective, commandes, décision couplée et action maintenue.
