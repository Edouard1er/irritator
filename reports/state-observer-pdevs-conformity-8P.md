# Test 8P — audit et blocage de conformité PDEVS

12 novembre 2026, dépôt `D:\these\irritator`, branche locale `for-web-ui`.

**Verdict : non conforme ; correctif de production non réalisé.** La clause 7
du prompt est appliquée : les conditions 1–6 ne sont pas démontrées sans changer
le simulateur générique. La lecture directe du HEAD reste présente ; ce rapport
ne la présente ni comme un protocole DEVS ni comme une correction acquise.

## État audité et préservation

- HEAD initial : `75fe2c8776ee2ff06d3626aa36f03dde7877428d` (`Test 8O`).
- `master` local : `c6fdfd3d88447312bb22a094b18eaaf5d56083dc`.
- Worktree initial propre lors du premier `git status --short`. Des avertissements
  Git concernent un fichier d'exclusion utilisateur inaccessible en lecture.
- Aucun commit, push, reset, changement de branche ni modification de l'index.
- Aucun changement des sources de production, de React, de Dear ImGui,
  de `zero_order_hold`, du catalogue ou des anciens tests.
- Builds et journaux nouveaux sous `build-web-test8p/`. Les répertoires 8O
  existants n'ont pas été réutilisés pour compiler. Une tentative initiale de
  CTest dans 8O a échoué à ouvrir son journal temporaire ; les campagnes
  définitives utilisent des répertoires 8P nouveaux.
- Une compilation d'amorçage des nouveaux témoins contre l'archive 8O précède
  leur validation contre les archives 8P recompilées. Ses résultats sont
  séparés sous `bootstrap-proof/` et `audit/bootstrap-*`.
- Les deux premières constructions 8P à un seul job ont été interrompues
  volontairement, puis reprises à deux jobs par configuration. Leurs codes -1
  et sorties sont conservés dans `engine-build-interrupted.log` et
  `exit-codes-interrupted.json` ; ce ne sont pas des diagnostics du compilateur.
- Même reprise du runner à deux jobs : `runner-build-interrupted.log` et
  `exit-codes-runner-interrupted.json` conservent la passe interrompue. Les
  constructions moteur terminées avant cette reprise sont conservées dans
  `engine-build-completed.log` ; la nouvelle invocation moteur est incrémentale.

L'audit reproductible `test/state-observer-8p/audit.mjs` conserve les empreintes
SHA256 de 300 fichiers suivis ainsi que les différences avec `master` dans
`build-web-test8p/audit/`. Il ne modifie aucun fichier source existant.

## Diagnostic du HEAD

`lib/src/event.cpp:130` recherche la liaison historique entrante et place son
identifiant de modèle dans `event_state::source`. À partir de la ligne 213,
la transition de `state_observer` utilise `sim.models.try_to_get(s.source)`,
dispatch la dynamique source et appelle `dyn.observation(t, t-source->tl)`.
Le décalage d'une transition interne ordonne certaines lectures après un sac ;
il ne transforme pas l'accès à l'état d'un autre atome en échange de messages.

QSS1/2/3 ont actuellement deux entrées (`x_dot=0`, `reset=1`) et une sortie
`y0`. `state_observer` possède `source=0`, `read=1`, `reset=2`, puis
`value=0`, `missing=1`. Il n'existe pas de ports probe/request/reply/response.
La validation native interdit une source ambiguë ou non QSS et autorise
l'absence de source. Les compilateurs statiques du runner inspectent déjà
les liaisons, y compris dans les définitions hiérarchiques et prospectives.

Les sorties QSS quantifiées et l'état continu restent distincts. Le test
historique `feedback-audit` constitue un contrôle indépendant du dernier
événement : à t=1, 10,01 est la dernière valeur émise, X=12 est l'état continu.
La réussite de ce test ou de `feedback-observer` ne prouve pas l'encapsulation.

## Blocage 1 : snapshot entre routage et transition externe

`simulation::run` route les sorties dans `simulation::message_buffer`, puis
réveille les destinataires pour un prochain appel à la même date. Les ports
d'entrée contiennent des positions et tailles dans ce tampon. Cette frontière
est observable par les snapshots, puisqu'un appel `run()` est terminé.

`simulation_snapshot` (`core.hpp:1914`) contient `models`, `event_states`,
`output_ports`, etc., mais pas `message_buffer`. `timeline.cpp:10` et `:22`
ne le capturent pas. L'affectation `simulation::operator=(snapshot)` à partir
de `core.hpp:11829` ne le restaure pas non plus. En revanche, la copie complète
de `simulation` copie bien ce tampon : c'est le contrôle positif du témoin.

Le témoin `test/state-observer-8p/snapshot-proof.cpp` construit réellement deux
commandes par constantes et `event_tag`, sans injection manuelle dans les
tampons :

1. À t=1, une lecture `[0,3,7]` vient d'être routée vers un observateur sans
   source. Prise d'un snapshot avant sa transition externe.
2. Avancement normal jusqu'à la livraison de `[0,9,11]` à t=2.
3. Restauration du snapshot de t=1.
4. Lecture du sac restauré et exécution normale jusqu'au statut `missing`.

Le résultat attendu est `[0,3,7]` à t=1. En Debug et Release, le témoin expose un sac
et une sortie `[0,9,11]` à t=1 : identité et campagne du futur à la date passée.
Il n'exerce aucun accès à un intégrateur, puisque la source est absente.

Cela concerne aussi les futurs messages request/reply avant leur réception :
des FIFO possédées par les atomes ne suffisent pas à conserver un message
encore dans le transport générique. Garantir la condition 6 à toutes les
frontières de `run()` requiert de transporter ce tampon dans le snapshot,
ou de redéfinir explicitement les frontières légales des snapshots et leur
drainage. Cette seconde solution n'est pas démontrée et restreindrait le
contrat de copie demandé. La correction directe touche les structures et
fonctions génériques du simulateur.

Autre point à traiter avant une conformité de cycle de vie :
`simulation::clone`, `core.hpp:12996`, copie la dynamique et les paramètres
mais n'associe pas une copie de `event_states` au nouvel identifiant. Les
tests historiques de copie complète des simulations ne couvrent pas ce clone
d'atome en cours de protocole. Ce constat est statique, pas un test exécuté.

## Blocage 2 : réarmement relatif et date physique exacte

`simulation::make_transition`, à partir de `core.hpp:12517`, met systématiquement
`mdl.tl=t` et `mdl.tn=t+dyn.sigma`. Le coordinateur ne propose pas de réarmement
par échéance absolue conservée séparément d'une transition de contrôle.

Le témoin C++ `scheduler-proof.cpp` utilise le vrai ordonnanceur et le vrai
template `make_transition`. Il installe une transition de contrôle de test
qui ne modifie **aucun octet** de la dynamique QSS et rend seulement la durée
résiduelle jusqu'à l'échéance physique originale. Ce témoin n'est pas une
implémentation de probe, ni une comparaison avec un observateur corrigé.

En IEEE 754 binary64, arrondi au plus proche pair :

```
d = nextafter(1,2) = 1 + 2^-52
t = 2^-53
fl(d - t) = 1
fl(t + 1) = 1 != d
fl(t + nextafter(1,2)) = 1 + 2^-51 > d
```

Les deux durées résiduelles voisines encadrent d sans produire d ; par
monotonie, aucune durée binary64 passée à cette addition ne donne d.
Le scénario QSS1/2/3 produit effectivement une quantification à d sans
transition de contrôle et montre le déplacement à 1 après réarmement,
avec mêmes valeurs et même multiplicité. Le test d'acceptation exige l'égalité
exacte des dates, et non une tolérance : une modification de date change
l'appartenance à un sac simultané, donc potentiellement la confluence.

**Portée de la preuve :** elle réfute le réarmement relatif direct, même avec
état physique parfaitement conservé. Ce n'est pas une preuve d'impossibilité
de toute architecture concevable. Des transitions silencieuses de pont à des
dates physiques intermédiaires pourraient être étudiées, mais leur terminaison,
leur confluence et leur compatibilité avec l'exigence de micro-étapes à temps
physique constant ne sont pas établies ici. Une interface générique d'échéance
absolue rendrait le contrat explicite. Le blocage snapshot subsiste même si
une tolérance des dates est acceptée.

## Contrat PDEVS restant à implémenter

Cette section décrit les obligations, **pas une réalisation certifiée**.
Avec la notation `(X,S,Y,delta_int,delta_ext,delta_con,lambda,ta)` :

- Intégrateur : X contient les sacs dérivée/reset historiques et les demandes
  optionnelles sur `x2=probe`. Y contient `y0` historique et `y1=reply`.
  S doit distinguer l'état physique QSS, son origine temporelle et son échéance
  de quantification, des instantanés de réponse possédés et de leur FIFO.
- `delta_ext` doit appliquer les entrées physiques selon la priorité historique
  (reset avant dérivée), puis capturer son propre X(t) après la transition
  de ce sac pour chaque demande. Une transition de lecture seule ne doit
  réintégrer ni requantifier l'état physique.
- `delta_int` doit distinguer une quantification d'un drainage de réponse.
  `delta_con` doit préserver la confluence physique originale à échéance égale.
  `lambda` publie seulement les instantanés déjà possédés ; aucune allocation
  ni consultation d'un autre modèle. `ta` choisit zéro pour le drainage et
  conserve l'échéance physique indépendante.
- Observateur : X conserve les trois indices historiques et ajoute
  `x3=response`. Y conserve value/missing et ajoute `y2=request`.
  S contient les commandes FIFO, les réponses corrélées, les générations
  d'annulation, les statuts en attente et la valeur observée locale.
- Son `delta_ext` doit traiter reset, réponses puis nouvelles lectures, avec
  politique explicite d'annulation des anciennes réponses. `delta_int`
  consomme une émission ; `lambda` publie un seul élément prêt ; `ta` vaut
  zéro uniquement si une émission est prête et l'infini quand on attend
  une réponse. La présence d'une requête en vol ne doit pas créer une boucle.
- La corrélation devra distinguer les commandes répétées de même clé/campagne,
  les observateurs partageant une source et les réponses antérieures à un
  reset. La sérialisation de ce protocole dans les messages à trois réels
  n'est pas implémentée dans cette livraison.

La traduction structurale requise est `qss.y0 -> observer.x0` comme liaison
déclarative, puis `observer.y2 -> qss.x2` et `qss.y1 -> observer.x3` dans un
précompilateur de graphe, avant toute initialisation d'atome. Cardinalité,
type observable, connexions dérivées déjà présentes, provenance et source
absente doivent être validés. Aucune transition ni lambda ne doit modifier
les connexions. **Cette traduction n'est pas ajoutée tant que les deux
blocages génériques ne sont pas résolus.**

## `zero_order_hold` et arbitrage en amont

Le bloc de définition complet normalisé LF est identique entre `master`,
le HEAD initial et les sources finales :
`25a1546c052715a5034a86a4de964b092b4eedb85ab634bd123ef320a0fe5c6d`.
Les anciens tests sont également inchangés ; le manifeste et le diff vide
des sources de production le vérifient. Le maximum de `get_qss_message<1>`
n'est pas modifié.

Le nouveau test isolé `candidate-arbitration.cpp` modélise une cohorte
explicitement close de deux candidats simultanés, actions 150 et 260,
score égal 9. La politique native de `candidate_select` est le score maximal,
puis la plus petite identité numérique. Le candidat d'identité 1 porte
l'action 150 : c'est donc 150 qui doit être appliqué, malgré 260 supérieur.
Le test inverse l'ordre d'allocation, compte les sorties du sélecteur et
du hold et mesure la taille maximale du sac d'entrée de l'actionneur.
L'attendu est une seule commande et une seule application à t=1, sac <=1.
Résultat confirmé en Debug et Release, dans les deux ordres d'allocation :
deux commandes dans le même sac du sélecteur, une sortie de sélection, une
sortie de l'actionneur et un sac d'actionneur de taille maximale 1, valeur 150.

Portée : une cohorte unique via un seul `candidate_select`. Ce test ne prouve
pas une politique globale entre plusieurs campagnes ou plusieurs sélecteurs
indépendants partageant un actionneur. Aucun arbitre multicampagne nouveau
n'est livré ; cette partie du contrat 8P reste ouverte.

## Fixture historique

Source indépendante :
`C:\Users\cedouard\Downloads\modelhalieutiquetest-points.csv`, 1473 octets.
SHA256 requis :
`e694acc2d26efb44811dd0cfd30d1fc634e1470775e2a6c4b73ec2c8119de51c`.
La copie cible est `web/model-test/modelhalieutiquetest-points.csv`.
Aucun résultat du moteur n'est utilisé pour créer ou modifier cette référence.
Le script vérifie l'empreinte avant copie et refuse de supprimer une fixture
existante pour simuler artificiellement l'état initial.

Ce fichier et le rapport restent ignorés par les règles Git existantes.
Ils sont présents localement, sans mise en index. Une livraison ultérieure
dans une branche nécessitera leur ajout explicite avec `git add -f`.

La première tentative en sandbox échoue aussi sur la fixture CTest
`runner-contracts-build` : TS5033/EPERM dans `web/dist`, puis refus de copier
le CSV dans `web/model-test`. Ces journaux sont conservés sous
`Release/fixture-before-sandbox.*`. Une reprise hors sandbox des seules
opérations autorisées (CTest et copie du CSV vérifié) permet la vraie mesure
initiale : préparation des contrats réussie, trois échecs CSV. Après copie,
les trois tests et leur préparation réussissent. Aucun droit ACL n'est modifié.

## Campagnes et résultats

Toutes les constructions moteur, runner, historiques et témoins ont terminé
avec un code 0, en Debug et Release. Après restauration de la fixture :

| Configuration | Runner complet | Moteur complet | Historiques complets | Total historique | Diagnostics 8P |
|---|---:|---:|---:|---:|---:|
| Release | 71/71 | 10/10 | 40/40 | **121/121** | **3/5, 2 échecs** |
| Debug | 71/71 | 10/10 | 40/40 | **121/121** | **3/5, 2 échecs** |

Ces comptages sont des cas CTest ; les sous-tests Node et assertions C++
restent dans les journaux. Aucun cas final n'est désactivé ou ignoré.
Les trois réussites 8P sont la reproduction du défaut de snapshot, celle du
défaut de réarmement et l'arbitrage à cohorte unique. **Reproduire un défaut
avec succès ne satisfait pas l'exigence correspondante.** Les deux échecs
d'acceptation, présents dans chaque configuration, sont :

- `requires-exact-inflight-snapshot` : identité/campagne restaurées incorrectes ;
- `requires-exact-physical-deadline` : dates de quantification non identiques.

Les tests de reproduction et d'acceptation ont des verdicts distincts : le
mode d'acceptation peut rendre 0 si l'exigence est satisfaite. Les témoins ont
été recompilés après séparation complète de ces verdicts ; les journaux
définitifs sont `proof-build-acceptance.log`, `proof-tests.log` et `proof.xml`.
Les premières exécutions sont conservées sous `proof-tests-initial.log` et
`proof-initial.xml`.

Contrôle de fixture avant restauration, sur le HEAD recompilé Release :
1/4 réussite (préparation des contrats), 3/4 échecs (les trois références CSV).
Après restauration : 4/4 réussites en Release et 4/4 en Debug, soit les trois
tests demandés plus leur préparation. Les trois tests repassent aussi dans
les suites complètes ci-dessus. Durée du runner complet : 390,57 s en Release,
482,80 s en Debug. La trace native confirme bien
`audit t=1: last emitted=10.01; current X=12`.

Les journaux bruts se trouvent sous `build-web-test8p/{Release,Debug}/` ; les codes de sortie
sont dans `exit-codes.json` et les cas CTest dans les fichiers XML JUnit.
Les sorties de tous les cas, y compris ceux qui passent sans affichage en
console, sont aussi conservées dans les `Testing/Temporary/LastTest.log` de
chaque répertoire CTest. Les rapports racines `*-tests.log` contiennent les
comptages et les sorties des cas en échec.

Les deux tests `requires-exact-*` du projet autonome sont de vrais tests
d'acceptation : ils ne sont ni désactivés, ni déclarés `WILL_FAIL`. Une
reproduction réussie d'un défaut est comptée séparément de la réussite de
ces exigences. La suite historique principale n'est pas modifiée.

Depuis la racine du dépôt, dans PowerShell :

```powershell
& ./test/state-observer-8p/run.ps1 -Configuration Release
& ./test/state-observer-8p/run.ps1 -Configuration Debug
ctest --test-dir ./build-web-test8p/Release/proof --output-on-failure
```

Le script configure l'environnement MSVC x64 et choisit Node 24. La variante
`-FixtureBefore` n'est applicable qu'à l'état initial où le CSV manque : elle
refuse de supprimer un CSV existant. Le script complet retourne un échec si
une exigence échoue ; une reproduction réussie du défaut ne masque donc pas
les acceptations `requires-exact-*` en échec.

Les journaux 8O conservés indiquaient 68/71 tests runner réussis en Release et
Debug, avec les trois échecs de fixture mentionnés dans le prompt. Cela reste
une comparaison avec les rapports antérieurs, distincte de la campagne
initiale 8P et des exécutions finales 8P. `master` est comparé par sources et
empreintes ; il n'est ni extrait par remplacement du worktree ni recompilé.

La vérification finale conserve le même HEAD et la même branche. Les 300
fichiers suivis du manifeste initial ont les mêmes empreintes ; aucun fichier
suivi du dépôt n'apparaît dans `git diff HEAD`. Le SHA256 du CSV cible est
toujours celui demandé. Les résultats structurés se trouvent dans
`build-web-test8p/audit/validation-summary.json` et `source-audit.json`.

## Couverture et limites explicites

| Exigence | État de cette livraison |
|---|---|
| A — lectures continues, dont X(1)=12 | Régression des tests historiques ; aucun nouveau protocole de lecture |
| B — confluence, reset, FIFO, invalides, copies | Régressions historiques ; témoin nouveau du snapshot en transit ; protocole nouveau non testé |
| C — non-interférence différentielle observateur actif/inactif | Non satisfaite pour un observateur corrigé ; témoin différent sur le réarmement QSS1/2/3 |
| D — suites 8D–8O et CTest complet | 121/121 cas historiques dans chaque configuration, comptages ci-dessus |
| E — arbitrage | Test natif de cohorte unique ; multicampagne et multisélecteur non couverts |
| F — builds | MSVC Debug/Release réussis, sans GUI ; autres plateformes non exécutées, outils indisponibles |
| 1–3 — ports, relais et traduction | Non implémentés, suite au blocage de la clause 7 |
| 4–6 — temps, invariance et cycle de vie | Défauts génériques reproduits ; conformité non démontrée |

Les réponses tardives et annulées, les nouvelles FIFO de probe/reply et leur
saturation, les lectures par plusieurs observateurs et le clone d'un protocole
en cours ne sont pas validés pour un observateur corrigé : ce protocole n'est
pas implémenté. Les anciennes régressions sur des mécanismes proches ne les
remplacent pas.

Le changement nécessaire suivant doit d'abord préciser le snapshot des sacs
en transit et le réarmement physique, puis implémenter les ports/FIFO et
exécuter l'ensemble des tests 8P avec un observateur réellement corrigé.
La correction de fixture et les témoins C++ ne remplacent pas ce correctif.

La validation effectuée utilise MSVC `19.51.36260.0`, Ninja, x64, GUI désactivée
et `WITH_NATIVE_ARCH=OFF`. Aucun GCC/Clang utilisable n'a été trouvé sur PATH ;
le dossier LLVM de Visual Studio contient clang-format/clang-tidy, pas le
compilateur. `wsl --list --quiet` échoue dans cette session (journal
`audit/wsl.log`). Aucune compilation Linux/macOS n'est donc revendiquée.

## Fichiers ajoutés

| Fichier | Ligne de départ | Rôle |
|---|---:|---|
| `test/state-observer-8p/CMakeLists.txt` | 1 | Projet natif autonome, témoins et acceptations non masquées |
| `test/state-observer-8p/scheduler-proof.cpp` | 1 | Contre-exemple du réarmement relatif, trois ordres QSS |
| `test/state-observer-8p/snapshot-proof.cpp` | 1 | Snapshot d'une lecture réellement routée et identité restaurée |
| `test/state-observer-8p/candidate-arbitration.cpp` | 1 | Cohorte fermée, deux commandes simultanées avant hold |
| `test/state-observer-8p/run.ps1` | 1 | Reconstructions et campagnes, logs et codes bruts |
| `test/state-observer-8p/audit.mjs` | 1 | Manifestes de sources et comparaison à master |
| `web/model-test/modelhalieutiquetest-points.csv` | 1 | Fixture indépendante restaurée à l'identique |
| `reports/state-observer-pdevs-conformity-8P.md` | 1 | Présent rapport et limites |

Aucune ligne des implémentations historiques QSS, de `state_observer` ou de
`zero_order_hold` n'est modifiée. Aucun correctif moteur conforme n'est revendiqué.
