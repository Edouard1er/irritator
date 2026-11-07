# Test 8G — Regroupement générique des scénarios

7–8 novembre 2026. Travail sans commit ni push.

## Audit préalable (avant modification native)

Rapports 8A à 8F et exemples correspondants examinés, ainsi que event.hpp,
event.cpp, campaign-event.hpp, simulation_wrapper, les adaptateurs hiérarchiques,
le catalogue et les inspecteurs React Flow.

`campaign_aggregate` réduit une campagne entière ; `campaign_broadcast` joint
son résultat aux identités de cette campagne. Aucun des deux ne partitionne
une campagne selon une valeur de facteur. `event_operator` joint par identité,
pas par valeur. `candidate_filter` et `candidate_select` peuvent ensuite
filtrer et comparer des actions ; `selection_priority` suffit pour un repli
sur une seconde sélection réelle. Les couplés permettent d'encapsuler ces
assemblages sans ajouter de politique native.

La convention existante est [valeur,scénario,campagne], les identifiants étant
des entiers exacts en double. La clôture du wrapper est [valides,total,campagne] :
le regroupement doit attendre **total**, et non supposer que les seuls valides
constituent l'ensemble complet. Les statuts invalides du wrapper n'ont pas
nécessairement de facteur numérique ; une clôture ordinaire ne permet pas
d'inventer leur groupe. Une commande explicite de scellement sera nécessaire
pour conclure une campagne dont des champs ou scénarios manquent.

Extension minimale retenue : un atome `group_aggregate` qui joint clé, action,
valeur, validité et poids explicites par scénario, partitionne par égalité
numérique exacte, puis réduit chaque groupe. Répliquer cet atome pour plusieurs
indicateurs conserve les mêmes identités (minimum des identités des membres).
Min/max/somme/moyenne/count existants ne suffisent pas car ils perdent cette
partition et la campagne d'origine. Les sélections et contraintes resteront
des compositions des atomes existants. Aucun changement des équations, des
algorithmes QSS, du wrapper ou du mécanisme de rétroaction 8F n'est nécessaire.

Les résultats et les preuves d'exécution sont détaillés ci-dessous.

## Interface DEVS et identités

L'atome `group_aggregate` a les entrées key/action/value/valid/weight/end/seal/reset
et les sorties aggregate/action/end/status/validCount/totalCount/member/invalid/
campaignStatus/key. Les trois réels transportent toujours valeur, identité,
campagne. Les paramètres ordinaires sont operation, validation, required,
endCount et capacity. Le catalogue fournit les listes et explications aux
inspecteurs React Flow ; aucun calcul scientifique n'est ajouté au frontend.

La clé est choisie par connexion d'un facteur à key ; action est indépendante
et doit être identique dans un même groupe. L'identité du groupe est le minimum
des identités de ses membres dans la campagne. Les groupes restent distincts
même si leurs indicateurs sont égaux. Les sorties member=[scénario,groupe,campagne]
et key=[clé,groupe,campagne] rendent la filiation explicite. Les membres 0/3,
1/4, 2/5 du plan livré produisent donc les groupes 0,1,2, reliés à E=80,150,260.
Une nouvelle composition utilisant un autre ordre de scénarios peut changer
ces identités ; elles sont locales à la campagne et au manifeste partagé.
Il ne s'agit pas d'un identifiant global permanent d'une action.

Les clés utilisent l'égalité numérique exacte, sans epsilon, arrondi ni chaîne
formatée. Deux doubles adjacents forment deux groupes. +0 et -0 sont une même
valeur numérique. Les clés non finies ne sont pas des groupes ; la campagne
reçoit un statut dégradé, sans groupe ou scénario inventé.

Le masque required utilise 1=valeur, 2=validité, 4=poids, 8=action. Clé toujours
requise, valeur requise sauf pour count ; poids requis par une opération
pondérée. Le défaut 11 exige valeur, validité et action. Une validité explicite
0 ne nécessite pas de valeur ni de poids numérique fabriqués. Son manifeste
clé/action reste nécessaire pour attribuer ce scénario à un groupe.

## Clôture, validation et ressources

endCount=1 consomme [valides,total,campagne] du wrapper ; 0 consomme le nombre
dans le premier réel d'une clôture ordinaire. End mémorise la cardinalité,
attend les champs requis, accepte les champs tardifs et publie campaignStatus=3
si la campagne reste en attente. Aucun résultat complet n'est alors émis.
Seal, après end, conclut explicitement les absences : il ne représente pas
un timeout automatique. Un scénario entièrement absent n'a pas de valeur
inventée et ne reçoit pas artificiellement un groupe.

Validation stricte (0) : un groupe contenant un membre invalide n'émet aucun
agrégat ; un manifeste de campagne incomplet empêche de déclarer les groupes
complets. Validation disponible (1) : réduction des membres disponibles,
avec status=2. Status=1 signifie complet et status=0 invalide. Un groupe sans
aucun membre valide n'émet aucun agrégat, y compris count ; validCount=0 et
son statut restent émis. End compte uniquement les groupes ayant réellement
émis agrégat/action. CampaignStatus vaut 1 complet, 2 dégradé avec des groupes
utilisables, 0 sans groupe utilisable, 3 en attente. Invalid indique 1=absence,
2=membre invalide, 3=résultat numérique inutilisable.

Un champ dupliqué, une action contradictoire dans un groupe, un compte excessif,
un scellement avant end ou une réponse après clôture effective est une erreur
explicite. Les campagnes chevauchantes restent indépendantes et peuvent finir
dans l'ordre inverse. Les campagnes closes sont mémorisées en plages fusionnées,
bornées par capacity : cela empêche un scénario retardé de rouvrir une campagne
après libération des lignes. Les campagnes consécutives ne consomment qu'une
plage. Une longue suite d'identités dispersées peut atteindre cette capacité
et nécessite un reset explicite ; aucun ancien identifiant n'est oublié
silencieusement pour libérer de la place.

Lignes, campagnes et plages sont bornées entre 1 et 4096. La FIFO possède ses
messages et est bornée à 16*capacity+16. Son drainage ne répète pas les tris
et réductions. Les lignes et barrières sont libérées à l'émission de end ;
reset annule lignes, plages et réponses restantes, puis accepte les entrées
du même sac. Le stockage appartient à simulation::event_states, avec copies,
snapshots, redémarrage et désallocation natifs. Aucun pointeur vers un autre
modèle ni registre global n'est créé. Les budgets moteur/runner sont conservés.

## Agrégations et décisions composées

Operation 0/1/2/3/4 = min/max/somme/moyenne descriptive/nombre valide ; 5/6 =
somme pondérée/moyenne pondérée. L'ordre des réductions est déterministe par
identité de scénario. Les poids sont explicites, finis et non négatifs ;
une moyenne pondérée exige un total de poids positif. Les valeurs non finies
et les dépassements arithmétiques ne produisent aucun agrégat valide.

La moyenne descriptive ne justifie aucune interprétation probabiliste des
hypothèses q. Le cas C utilise les poids d'essai 1 et 3 : l'action 80 possède
les valeurs 10 et 30, sa moyenne pondérée vaut 25, contre 24 pour l'action 150.
Une moyenne descriptive donne 20 contre 24 et change donc la sélection. Ces
poids constituent une configuration de démonstration, pas des probabilités
scientifiquement établies pour les hypothèses Schaefer.

GroupedDecision contient quatre instances génériques minCH/maxCH/minN/count,
trois opérateurs event_operator pour la validité commune de CH/Nmin, deux
opérateurs pour joindre les métriques des groupes effectivement utilisables,
une comparaison event_operator et le couplé ConditionalDecision existant.
Ses entrées comprennent aussi weight et seal. Les sorties des groupes passent
aux sélecteurs existants avec leurs identités et leur campagne ; leurs actions
proviennent de la sortie action de l'agrégateur. A maximise minCH sans branche
de contrainte (constrained=false, masque du filtre 11), B applique minN>=140
puis maximise minCH, D utilise la seconde
sélection réelle si la première est vide. La seconde branche maximise minN,
puis minCH en cas d'égalité ; les égalités restantes utilisent le plus petit
identifiant de groupe. Aucune règle Schaefer ou politique robuste prédéfinie
n'existe dans le nouveau C++.

Les quatre instances partagent le manifeste d'action et la validité jointe.
L'absence de Nmin ne permet pas à la branche CH de conclure seule. Un seal
commun reconnaît les branches déjà terminées sans les rouvrir ni réémettre.
Le flux secondaire est également joint aux seules identités ayant un score
principal réel : des poids tous nuls rendent une moyenne pondérée indisponible
et ferment alors les deux branches sans action. La preuve avant/après
`weighted-groups-{before,after}.json` conserve le défaut de composition initial
(EXECUTION_ERROR) et sa correction par scoreReady/joinGroups. Le jeton zéro
sert uniquement à la jointure ; required=3 exige la vraie métrique secondaire,
et aucune valeur scientifique manquante n'est remplacée.
Si des
branches de métriques reçoivent des données asymétriques, il faut composer
une jointure des champs obligatoires et une validité commune, ou conserver
la validation stricte : une branche incomplète ne vaut jamais une contrainte
satisfaite. Les exemples complets Schaefer reçoivent tous les critères bruts
validés du même wrapper. Les politiques de repli et de pondération sont des
assemblages, pas des modes métier de group_aggregate.

## Architecture T*

A*c=plant:SchaeferPlant, B*=observer:ObserverDecision et A**=forecast:simulation_wrapper.
SchaeferPlant, SchaeferProspect et SynchronizePair sont conservés à l'identique
de 8F. B* remplace seulement son sous-modèle de décision par GroupedDecision ;
un relais événementiel conserve l'entrée C0 de son interface et libère ses
lignes à chaque clôture. Aucun changement
d'équation ni de rétroaction. Le plan ajoute qHypothesis=[0.0008,0.001] à
E=[80,150,260]. N0/C0 restent les observations courantes, requiredInputs reste
initialN/initialC et H=20, dQ=0.01. Le Plant conserve q=0.001.

Le wrapper prospectif à F=4 et S=2 émet valid en y6, N0/C0 en y7/y8, E/q en
y9/y10, Nmin/CH en y11/y12 et end en y13. Le facteur q n'est connecté à aucun
port d'action du système principal. B* transmet uniquement l'effort retenu
sur son port d'action ; les autres sorties de B* préparent/commandent A** ou
portent les preuves identifiées. Le maintien reçoit [E,0,0].

## Résultats numériques du regroupement

État fixe : N0=150, C0=0, r=0.35, K=300, a=1, H=20, dQ=0.01.
Les valeurs de référence natives des six simulations individuelles sont :

| Groupe (membres) | E | min CH | max CH | min Nmin | Valides |
|---|---:|---:|---:|---:|---:|
| 0 (0,3) | 80 | 286.944250556813 | 340.707560226347 | 150 | 2 |
| 1 (1,4) | 150 | 445.312497501596 | 497.451213012496 | 150 | 2 |
| 2 (2,5) | 260 | 530.667969259608 | 541.603785129742 | 83.8739608595944 | 2 |

Les contrôles 8G comparent les sorties agrégées natives à six simulations
plates natives distinctes (tolérance 1e-8), puis aux oracles indicatifs à
0.02 pour minCH/minNmin. Un oracle analytique indépendant, seulement dans
les tests, utilise alpha=0.35-qE, beta=0.35/300,
D=1+beta*N0*expm1(alpha*H)/alpha,
N(H)=N0*exp(alpha*H)/D et C(H)=C0+qE*log(D)/beta. Les tolérances analytiques
sont 0.05 sur N et 0.25 à 0.30 sur C ; aucun résultat natif n'est remplacé.

| Configuration fixe | Règle assemblée | Action |
|---|---|---:|
| A | Max minCH sans contrainte | 260 |
| B | minN>=140 puis max minCH | 150 |
| D | minN>=1000 : première branche vide, seconde sélection réelle | 150 |
| C synthétique | Moyenne pondérée explicite 25 contre 24 | 80 |
| Comparaison descriptive de C | Moyenne descriptive 20 contre 24 | 150 |

### Deux campagnes T* sous incertitude

| Campagne | Date | N0 des six enfants | C0 des six enfants | Branche | E appliqué |
|---|---:|---:|---:|---|---:|
| 1 | 1 | 138.72279747766177 | 37.474201388034722 | Secondaire (aucun minN>=140) | 150 |
| 2 | 3 | 148.0329563662178 | 80.549582911628249 | Principale | 150 |

| Campagne | E | min CH | max CH | min Nmin | Valides |
|---|---:|---:|---:|---:|---:|
| 1 | 80 | 319.944905666701 | 372.695377103688 | 138.722797477662 | 2 |
| 1 | 150 | 474.839064801333 | 525.092425401785 | 138.722797477662 | 2 |
| 1 | 260 | 552.393434572261 | 565.838984697367 | 83.2481877905553 | 2 |
| 2 | 80 | 366.730668801802 | 420.305768537023 | 148.032956366218 | 2 |
| 2 | 150 | 524.548294348346 | 576.338327037997 | 148.032956366218 | 2 |
| 2 | 260 | 608.549943482022 | 619.914440243930 | 83.7707293915020 | 2 |

CH inclut ici le C0 observé de la campagne. Comparer ses minima dans une
campagne revient à comparer les captures futures après soustraction de ce
même C0 ; aucune fusion de scores entre campagnes n'est effectuée.

La trace `native-uncertainty.log` est prise sur les ports actifs et dans les
vrais enfants avant sérialisation HTTP et rééchantillonnage. Le test contrôle
12 initialisations (N/C/dQ/E/q), les six agrégats de groupes et les comptes,
l'ordre lecture < init < run < application, le q inchangé du Plant et les
valeurs finales. Extraits des actions réellement émises par le maintien :

```text
EVENT 3   0 plant/effort:0 [260,0,0]
EVENT 179 1 plant/effort:0 [150,0,0]
EVENT 358 3 plant/effort:0 [150,0,0]
FINAL plant/N 155.00709547863144
FINAL plant/C 126.05837650688633
NATIVE_GROUPED_FEEDBACK_PASS bags=394
```

La seconde initialisation dépend donc de l'action du premier cycle, comme
en 8F. Une variante A sans contrainte applique 260 et change le second état
prospectif ; les tests comparent ces états sans changer le mécanisme de
rétroaction. Les variantes différées vérifient l'annulation par init et la
conservation de deux réponses chevauchantes sans init, à t=4 et t=6.

## Parcours React Flow

Le composant est proposé dans « Contrôle et décision ». Les inspecteurs
ordinaires exposent operation (sept choix), validation, required, endCount
et capacity. Le choix du facteur de regroupement se fait par le raccordement
au port key ; une autre connexion conserve action. Aucun calcul n'est fait
par React ou TypeScript.

Les trois nouveaux parcours navigateur :

1. Importer le démonstrateur fixe, obtenir 150 avec minN>=140, modifier le seuil
   à zéro (tous les groupes présents sont alors admissibles), obtenir 260,
   passer à une moyenne descriptive, puis exporter/réimporter.
2. Créer UiGroups et ses huit entrées/neuf sorties, ajouter/configurer les
   quatre agrégateurs, les cinq jointures génériques, la comparaison et le
   sélecteur couplé ; relier les ports dans React Flow, remplacer l'instance,
   exécuter et réimporter. La capture group-definition-react-flow.png est
   inspectée visuellement.
3. Importer T* sous incertitude, observer N/C au pas 1, vérifier deux campagnes
   de six scénarios et l'effort 150, puis exporter/réimporter.

Toutes les réponses de ces parcours sont comparées à une exécution directe
du même runner C++. Les deux exemples et les nouveaux paramètres sont aussi
conservés exactement par le format scientifique et le format workspace dans
Vitest. Une configuration A entièrement sans contrainte est testée séparément,
y compris avec un second indicateur négatif : le choix principal reste fondé
sur minCH, sans supposer que cet autre indicateur est positif.

## Limites conservées et limites explicites

- Les clés sont des réels scalaires finis ; pas de clé chaîne, tuple ou égalité
  approchée implicite. Les identités sont locales à la campagne et à l'espace
  d'identification du producteur. Elles ne constituent pas un identifiant
  global permanent d'action entre des plans de scénarios différents.
- Une clôture ordinaire ne devine pas quand une donnée est définitivement
  absente. Il faut un seal explicite pour conclure malgré une absence. Si le
  wrapper ne publie pas le facteur d'un scénario invalide, son groupe est
  inconnu : validation stricte de la campagne, ou résultat disponible signalé
  partiel après seal. Aucune hypothèse manquante n'est créée.
- Les jointures événementielles incomplètes et les mémoires héritées de 8F
  restent bornées ; un reset explicite est nécessaire pour les purger si des
  cycles incomplets s'accumulent. Le reset d'un agrégateur annule ses propres
  réponses ; l'annulation des réponses prospectives relève toujours de init
  du wrapper. Le reset local de B* n'ajoute pas d'expiration métier d'une
  action ancienne.
- Un graphique scalaire représente une dernière valeur, pas une table de
  groupes. Les tests utilisent des mémoires identifiées, des récepteurs de
  lecture et les ports natifs pour vérifier chaque groupe/campagne. End et
  status distinguent une valeur reçue d'une valeur initiale de récepteur.
- B* ne restructure pas un plan Pk arbitraire : la définition prospective, les
  domaines des facteurs, l'horizon et les critères restent configurés dans
  le wrapper. Son optimiseur historique est conservé mais ne pilote pas le
  Plant. Les enfants restent calculés synchroniquement ; le chevauchement
  concerne les réponses différées.
- Aucune probabilité scientifique des hypothèses q n'est postulée. Les poids
  du cas C sont des données d'essai explicites. La validation concerne Windows
  x64/MSVC, WITH_GUI=OFF et Chrome ; aucune autre plateforme n'est annoncée.
- Le CSV original 7G reste absent. Les trois tests qui en dépendent gardent
  leur échec ; les simulations plates et les contrôles analytiques ne sont
  pas transformés en CSV de substitution.

## Diagnostics et corrections de validation conservés

La première campagne HTTP 8G a donné 6/11, puis 9/11 après une première
correction du banc. Les journaux initiaux restent dans Debug/logs/. Les
récepteurs lisaient trop tôt ou observaient le dernier write d'une mémoire
au lieu de sa réponse read ; l'instrumentation dépassait aussi 32 observations
et le budget de modèles développés. Les preuves finales utilisent des
récepteurs distincts et six commandes de lecture partagées par les quatre
métriques : aucune limite du moteur ou du runner n'a été relevée.
Le scellement d'essai est placé après la clôture réelle du wrapper, pas dans
un sac antérieur à celle-ci. Les tests natifs attendent les champs effectifs
avant de copier un état, et distinguent le statut d'attente du premier agrégat.

Deux défauts de composition ont été reproduits et corrigés exclusivement par
câblage d'opérateurs existants :

- Les groupes sans moyenne pondérée définie alimentaient encore la branche
  secondaire. scoreReady/joinGroups alignent maintenant les ensembles de
  candidats ; des poids tous nuls ferment les deux sélections sans action.
- Un statut 0 sans résultat numérique était compté à tort par la jointure
  alors que la première valeur de end compte les seuls résultats valides.
  chReady émet un jeton de présence pour chaque CH réellement transmis,
  joinCH le joint au statut et joinN attend Nmin. Les jointures suivent ainsi
  la cardinalité des champs numériques ; les agrégateurs attendent toujours
  le **total** de la campagne et peuvent conclure explicitement avec seal.
  invalid-frame-before.json et le cas HTTP invalid-raw-frame conservent la
  reproduction et sa correction. Le relais C0 est borné par campagne et le
  cas c0-relay-capacity vérifie deux cycles avec une capacité de six lignes.

Le CTest Release runner-contract a atteint 60 s dans la suite, puis à vide.
Ce point d'entrée réimportait aussi hierarchy-tests et qss-catalog-tests,
déjà exécutés séparément par CTest. Les assertions de contrat sont extraites
sans changement dans contract-tests.mjs ; tests.mjs reste l'entrée npm complète
et réexporte reference. CTest garde ses trois points d'entrée et ses limites
**60/120/120 s**, sans suppression d'assertion. contract-split-proof.json
vérifie l'égalité SHA-256 du corps des assertions avant/après extraction.
Le contrat isolé passe alors en **17.68 s** en Release ; le contrat Debug
complet passe en **17.94 s**. Les deux timeouts initiaux et le JUnit original
ne sont pas réécrits en succès.

Le catalogue courant passe de 24 à 25 atomes ; seules les assertions de taille
correspondantes sont actualisées dans les tests historiques. Le nouvel état
événementiel impose des dépendances explicites de core.hpp/event.hpp dans
CMake pour éviter des objets compilés avec des définitions différentes lorsque
MSVC localisé omet des en-têtes dans /showIncludes. Les bibliothèques et les
clients sont reconstruits avec leurs options respectives. Les corrections du
rééchantillonneur 8F, des diagnostics Debug 8C, de heap::remove 8B et des
transactions requiredInputs 8E restent en place et sont rejouées par les
suites dédiées. Aucun intégrateur ni mécanisme de rétroaction n'est modifié.

## Validation finale

| Vérification | Release | Debug |
|---|---:|---:|
| Moteur, runner et clients historiques reconstruits | réussi | réussi |
| Nouveaux groupes C++ : protocole de groupe et T* sous incertitude | 2/2 | 2/2 |
| CTest runner / JSON / wrappers / 8A–8G | 41/45 initialement ; contrat repris 1/1 après extraction | 42/45 |
| Tests officiels du moteur | 10/10 | 10/10 |
| Historique 7A–7C | 40/40 | 40/40 |
| API / processus / HTTP historiques | 94/94 | 94/94 |
| HTTP 8B | 12/12 | 12/12 |
| HTTP 8C | 13/13 | 13/13 |
| HTTP 8D | 13/13 | 13/13 |
| HTTP 8E | 23/23 | 23/23 |
| HTTP 8F | 20/20 | 20/20 |
| JSON + HTTP 8G finaux | 11/11, 55 requêtes/résultats | 11/11, 55 requêtes/résultats |
| Diagnostics scientifiques séparés et destination invalide | 2/2 | 2/2 |
| Playwright complet | 69/69 | 69/69 |
| Reprise des trois parcours 8G sur les exemples finaux | 3/3 | 3/3 |

Frontend : **142/142 Vitest**, contrôle TypeScript final et construction Next.js
finale de production réussis. Aucun retry, flaky ou test navigateur ignoré.
Les captures historiques suivies ne sont pas remplacées. La capture de la
définition finale est conservée sous Release/browser-8g-final/ et Debug/browser-8g/.
Les serveurs de test 3400/3401 sont arrêtés ; le fichier mémoire suivi produit
par les tests est restauré à son contenu initial. Aucun commit ni push.

Les trois échecs CTest restants sont exactement runner-wrapper-7g,
native-wrapper-schaefer-trajectories et native-wrapper-schaefer-pair. Les
scripts globaux conservent leur code **1**, avec runner-tests=8 et les autres
étapes à zéro. Les échecs initiaux et les reprises sont conservés séparément.
Aucun CSV n'est créé, aucun test 7G n'est ignoré et aucune assertion scientifique
n'est remplacée par une tolérance plus permissive.

`decision-8g-proof.mjs` réussit : **55/55 cas strictement identiques** entre
Release et Debug, chacun égal à son résultat HTTP. Les exécutions valides ont
stderr vide. La trace native est identique octet pour octet, avec 12 enfants,
six groupes agrégés et les trois commandes réellement appliquées. Les options
Debug IRRITATOR_ENABLE_DEBUG et l'absence de NDEBUG sont vérifiées dans les
deux DAG de compilation. cross-configuration.json conserve les empreintes
SHA-256 des bibliothèques/exécutables, les résultats réels, les états initiaux,
les agrégats, les actions et les statistiques navigateur.

### Fichiers et reproduction

Livrables :

- web/examples/decision-grouped-schaefer-v3.json
- web/examples/tstar-schaefer-uncertainty-v3.json
- reports/bstar-generic-components-test-8G.md

Les sources génériques sont dans lib/include/irritator/event.hpp et
lib/src/group-event.hpp, intégrées par event.cpp. Catalogue, registre natif,
paramètres et capacités exposent le même contrat. Les scripts d'exemples
construisent uniquement les graphes ; les oracles JavaScript appartiennent
exclusivement à la validation.

```powershell
node web/engine/runner/decision-8g-fixture.mjs --write
./web/engine/runner/tests-wrapper/run-8g.ps1 -Configuration Release
./web/engine/runner/tests-wrapper/run-8g.ps1 -Configuration Debug
node web/engine/runner/decision-8g-proof.mjs
```

BuildOnly/TestsOnly permettent de séparer compilation et tests. Les scripts
rejouent les tests C++, JSON et HTTP historiques ainsi que 8G, avec les mêmes
budgets. Les preuves se trouvent dans build-web-test8g/{Release,Debug}/logs/ :
JUnit runner/officiel/historique, HTTP 8B–8G, diagnostics et traces natives.
http-8g-current.log conserve les dernières campagnes scientifiques ; les
journaux de développement et de timeouts restent séparés. La reprise Release
du contrat est dans contract-isolated.log/xml.

Pour le navigateur, compiler Next.js avec IRRITATOR_API_URL pointant sur
l'API locale, lancer Fastify avec IRRITATOR_RUNNER sur le binaire choisi,
puis Next.js. Définir FRONTEND_URL, IRRITATOR_RUNNER,
IRRITATOR_BROWSER_EVIDENCE, IRRITATOR_BROWSER_SCREENSHOTS et
IRRITATOR_PLAYWRIGHT_REPORT, puis exécuter npm run test:e2e dans
web/apps/frontend. Les deux rapports complets sont playwright-release.json et
playwright-debug.json ; les reprises finales de decision-8g.spec.ts sont
playwright-release-final-8g.json et playwright-debug-final-8g.json.

Pour la configuration A, groupedSchaefer({constrained:false}) et
uncertaintyTstar({constrained:false}) retirent la comparaison et n'exigent plus
le champ condition du filtre. La configuration B garde threshold=140.
Ces différences décrivent des assemblages DEVS et des paramètres, sans code
scientifique supplémentaire dans le moteur ou dans React.
