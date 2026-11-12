# Test 8P bis — correction des instantanés et observation événementielle

Verdict : **correctif appliqué et validation demandée réussie en Release et Debug : 121/121 cas historiques et 13/13 CTest 8P bis par configuration, sans échec, test ignoré ou désactivé.** Les deux acceptations 8P intactes passent. Les garanties portent sur le protocole et le domaine binaire64 explicités ci-dessous ; aucune restauration universelle de ressources externes arbitraires n’est revendiquée.

Branche conservée : `for-web-ui`. HEAD conservé : `75fe2c8776ee2ff06d3626aa36f03dde7877428d`. Aucun commit, push, reset, changement de branche ou changement d’index.

## Protection de l’existant

L’inventaire initial contient 308 fichiers : 300 fichiers suivis, les six sources/outils du premier diagnostic 8P, son rapport et le CSV. Voir `build-web-test8p-bis/audit/before.json` et `integrity.json`. Les sept fichiers du diagnostic précédent restent intacts ; son dossier CMake n’a pas été réutilisé pour compiler le correctif.

Le corps de `zero_order_hold`, normalisé LF, conserve son SHA256 `25a1546c052715a5034a86a4de964b092b4eedb85ab634bd123ef320a0fe5c6d`. Tous les fichiers suivis de tests/exemples natifs contenant `zero_order_hold` restent identiques après normalisation LF ; leurs hashes avant/après sont dans `integrity.json/holdTestFiles`. Les corps des tests et les assertions scientifiques restent identiques aussi dans les deux fichiers de capture adaptés ci-dessous. Le CSV garde `e694acc2d26efb44811dd0cfd30d1fc634e1470775e2a6c4b73ec2c8119de51c`.

Cinq fichiers moteur suivis sont modifiés : `lib/CMakeLists.txt`, `lib/include/irritator/core.hpp`, `lib/include/irritator/event.hpp`, `lib/src/event.cpp`, `lib/src/timeline.cpp`. Deux collecteurs de tests natifs sont adaptés à l’extension des ports : `web/engine/runner/event-native-tests.cpp` et `schaefer-feedback-native.cpp`. Trois compagnons C++ sont ajoutés : `qss-probe.hpp`, `observer-couplings.hpp`, `state-observer-protocol.hpp`. Les autres ajouts sont les diagnostics natifs et ce rapport. Aucun fichier React, Next.js, API Web, Dear ImGui ou graphique n’est modifié.

## Constats et corrections

| Constat | Correction C++ | Invariant formel | Témoin | Résultat réel |
|---|---|---|---|---|
| Les indices des ports survivent, mais le tampon réutilisé fournit un message futur. | Copie possédée de `message_buffer` dans capture, affectation, copie de snapshot et restauration. | Chaque indice de sac restauré désigne les mêmes trois réels que lors de sa capture. | `requires-exact-inflight-snapshot`, `snapshot-lifecycle` | Passe dans les deux campagnes finales 13/13. |
| Les frontières publiques restaurent des sorties/modèles actifs et un dernier temps issus du futur. | Capture/restauration de `active_output_ports`, `immediate_models`, `last_valid_t` ; copie complète du dernier temps aussi dans `simulation`. | Même frontière observable, puis même trace future. | `snapshot-lifecycle` ; échec antérieur enregistré dans `phase-ab-debug-witnesses.log`. | Passe Release et Debug. |
| Un enfant conserve sa progression future après restauration du parent. | Copie possédée de `sims`, récursive via les copies de simulations et de leurs ressources. | Les sacs et états enfants appartiennent à l’instantané du parent. | `nested-snapshot`, après correction de la réservation du banc d’essai. | Passe Release et Debug. |
| `t + (d-t)` ne permet pas de restituer certaines échéances binaires. | Champ opt-in `model::absolute_tn` et publication d’une échéance absolue par `next_event_time`. Le chemin relatif des autres modèles reste inchangé. | Une transition de contrôle conserve `d` bit pour bit. | `requires-exact-physical-deadline`, source 8P inchangée ; comparaison différentielle historique. | Passe Release et Debug : `tn=1.0000000000000002`, multiplicité 1/1, QSS1/2/3. |
| L’observateur lisait directement la dynamique d’un autre atome. | Deux couplages statiques ; requête identifiée et réponse possédée par le QSS. Suppression du `try_to_get(s.source)` de calcul et de son dispatch d’observation. | Aucun état physique inter-atome n’est lu par une transition d’observateur. | Diff ciblé ; tests différentiels et de protocole. | 13/13 8P bis, Release et Debug. |
| Deux demandes peuvent partager candidat/campagne, et un reset laisse des réponses en transit. | Ticket monotone propre à l’observateur, propriétaire exact, FIFO de lectures et filtrage des réponses inconnues/annulées. | Corrélation `(propriétaire,ticket)` injective pendant une initialisation ; aucun recyclage au reset. | `protocol-cancellation`, deux observateurs dans le différentiel. | Passe Release et Debug. |
| Un clone perdait l’état stocké sous l’ancien identifiant. | Copie possédée de l’état de protocole, du tampon entrant, des origines et échéances ; réémission immédiate des attentes d’un observateur sous son nouveau propriétaire. | Les copies n’aliasent pas les files et un propriétaire distinct ne consomme pas la réponse de l’original. | `protocol-clones`, `protocol-snapshots`, témoin d’échéance du clone. | Passe Release et Debug, sans date forcée. |
| Des captures natives prenaient le nouveau port 2 pour une valeur scientifique. | Adaptation de deux collecteurs C++ aux ports historiques 0/1 ; le nouveau transport est testé séparément. | Chaque ancienne assertion et chaque ancien port scientifique restent vérifiés. | Hashes des oracles, trois reprises ciblées, deux campagnes runner complètes. | 71/71 runner par configuration après adaptation. |

Les défauts historiques restent reproduits par les exécutables 8P figés, liés statiquement avant toute modification, dans deux CTest `historical-reproduces-*`. Les deux acceptations sont recompilées depuis leurs sources 8P intactes contre le moteur corrigé. Il n’y a aucun `WILL_FAIL`, test désactivé ou oracle ancien modifié.

## Contrat PDEVS réalisé

### QSS1, QSS2 et QSS3

`X` conserve `x0=x_dot`, `x1=reset` et ajoute `x2=probe`. `Y` conserve `y0` et ajoute `y1=reply`. Une requête transporte `[ticket, propriétaire, 0]` ; la réponse transporte `[X(t), ticket, propriétaire]`. Les identifiants sont des entiers exactement représentables dans le transport à trois réels ; l’épuisement est une erreur explicite.

`S` comprend les variables physiques historiques (`X,q,u,...,sigma_p`), une origine physique `tau`, l’échéance physique absolue `d` et une FIFO possédée de réponses. La FIFO est stockée dans l’entrée `event_states` de l’atome appelant, jamais dans l’observateur et jamais dans un pointeur vers une autre dynamique.

`ta(S)` correspond à la date absolue `d`, ou à zéro si une réponse attend. `sigma_p` conserve le temps physique utilisé par les formules historiques et n’est jamais remplacé par zéro pour répondre. Le coordinateur prend la date publiée directement ; il ne reconstruit pas `d` par une soustraction suivie d’une addition.

`lambda` publie `y0` si et seulement si l’échéance physique est atteinte, et la tête déjà calculée de la FIFO sur `y1` lorsqu’elle existe. Cette fonction ne retire aucun élément, n’évalue aucune nouvelle lecture et ne modifie aucun état physique ou état de réponse. Elle peut publier les deux ports à la même micro-étape.

`delta_ext` traite le sac physique selon les règles historiques : reset prioritaire sur dérivée ; la sélection d’un message QSS dans un sac reste historique. L’évolution utilise `t-tau`, et non `t-model.tl`. Si le sac ne contient que des probes, aucune variable physique ni échéance physique n’est modifiée. Ensuite, chaque probe valide acquiert la valeur de la propre observation polynomiale du QSS après ce sac physique.

`delta_int` consomme la tête publiée ; il réalise la transition physique uniquement à `d`. L’intégration interne utilise `sigma_p` sauvegardé, conservant exactement les opérations et arrondis historiques. Une réponse seule ne provoque aucune requantification. `observation(t,e)` utilise sa propre origine physique `tau` pour les QSS, indépendamment des transitions de contrôle supplémentaires.

`delta_con` applique d’abord la sortie DEVS de l’état antérieur, puis la consommation de la réponse publiée, puis les mêmes priorités physiques reset/dérivée/interne, puis l’évaluation des nouveaux probes. Une demande à `t=d` ne crée pas une deuxième sortie physique. Une entrée arrivée à une micro-étape ultérieure à la même date est un autre sac, conformément au coordinateur existant.

Sans probe, `tau` suit exactement l’ancien `model.tl`, chaque échéance physique est calculée une fois par la même addition historique, y compris son ajustement `nextafter` si une durée positive s’arrondit à zéro. Le champ générique absolu est désactivé par NaN pour les modèles sans opt-in. L’ancien témoin passif peut conserver le champ absolu du modèle sans modifier un seul octet de sa dynamique QSS.

### `state_observer`

`X` conserve `x0=source`, `x1=read`, `x2=reset` et ajoute `x3=response`. `Y` conserve `y0=value`, `y1=missing` et ajoute `y2=request`. `x0` est une déclaration de provenance ; ses notifications quantifiées ne servent pas à calculer l’observation.

`S` contient la liaison structurelle comme métadonnée, le prochain ticket, les lectures en attente (ticket, identité métier et éventuelle réponse), une FIFO de sorties possédée et la dernière valeur valide. La transition ne déréférence jamais l’identifiant de source. Les réponses du propriétaire d’un autre observateur sont ignorées ; les réponses dupliquées, inconnues ou annulées aussi.

`delta_ext` applique le reset, corrèle les réponses, libère les résultats prêts dans l’ordre FIFO des lectures, puis accepte les nouvelles lectures. Un reset efface les attentes et sorties non encore publiées, en conservant le compteur de tickets ; une lecture du même sac reçoit donc un nouveau ticket. Sans source, chaque lecture produit `missing` avec son identité métier conservée. Une réponse non finie produit aussi `missing`.

`lambda` publie uniquement la tête possédée. `delta_int` la consomme sans dépendre d’un effet de bord de `lambda`. `delta_con` suit la sortie antérieure, cette consommation, puis les règles externes ci-dessus. Une sortie déjà publiée avant une confluence reset ne peut pas être retirée ; les réponses arrivant après l’annulation sont écartées. `ta=0` s’il existe une sortie, sinon l’infini, y compris pendant l’attente d’une réponse : aucune attente active à temps nul.

Une lecture répétée avec les mêmes candidat/campagne reste une occurrence distincte. Le ticket est monotone jusqu’à `2^53-1`. Le propriétaire est l’identifiant de modèle complet, validé dans le même domaine exact. Une réinitialisation réinitialise le protocole après vidage du transport de toute la simulation. Un clone d’observateur garde ses tickets, reçoit un autre propriétaire, et réémet ses attentes une fois sous ce propriétaire.

### Couplages et cycle de vie

`validate_structure` reste une inspection const. Il vérifie la déclaration unique issue de `qss.y0`, le type, le domaine d’identité et les connexions réservées existantes. L’absence de déclaration reste le contrat historique `missing`. Les liaisons incompatibles, multiples ou contradictoires échouent avant initialisation des atomes, y compris dans les prototypes enfants.

`materialize_observer_couplings` prépare avant initialisation `observer.y2 -> qss.x2` et `qss.y1 -> observer.x3`. Il accepte les liaisons exactes déjà présentes, sans les dupliquer. Il s’applique aussi aux ressources imbriquées. Aucun appel de connexion ou modification de dynamique distante n’est exécuté dans une transition.

Le clone de modèle reste détaché et non ordonnancé, comme dans l’API existante. Le test prépare ses connexions avant activation native, puis vérifie la reprise d’une demande en transit en utilisant **l’échéance du clone**, sans date forcée. Les clones sont préparés et activés avant de reprendre `run()`, puisque les sacs entrants génériques ont une durée de vie d’un pas de routage. Les clones de QSS vérifient séparément le sac probe, les variables physiques et la copie profonde de la FIFO de réponse. Les copies de simulation complètes gardent les identifiants locaux et reprennent sans nouvelle traduction.

Le témoin complémentaire `audit/clone-deadline-witness.log` a révélé qu’une requête réémise sous un nouveau propriétaire pouvait conserver `sigma=inf` et `tn=inf` de l’attente originale. Le correctif programme `sigma=0` et `tn=current_time()` lorsque le clone d’observateur possède une sortie. Le test exige ces deux propriétés avant activation. La copie des horloges de clone est limitée aux QSS et à l’observateur ; le comportement des clones des autres dynamiques est conservé.

## Ownership et coût des instantanés

Le candidat fourni a d’abord passé `git apply --check`, puis a été appliqué aux trois opérations capture/affectation/restauration. `vector<message>` réalise une copie de valeurs et non une vue ; les ports gardent des indices, donc aucun pointeur à rebinder. La construction copie `24*N` octets de messages ; une affectation peut réutiliser sa capacité. Les états imbriqués ajoutés ont un coût proportionnel à leur mémoire possédée totale, prototypes et campagnes compris : ce coût est nécessaire à leur restauration, et aucun coût constant n’est prétendu.

Les autres champs ont été inspectés : `parameters` et `limits` du parent sont la configuration fixe du scénario testé ; ils ne sont pas édités entre capture et restauration. `immediate_observers` est une notification de drainage remise à zéro à l’entrée de `run()`, et reste vide dans les scénarios QSS de protocole testés. `srcs` contient notamment des ressources et curseurs externes : ce travail ne prétend pas restaurer des fichiers externes arbitraires. Les QSS et ce protocole n’y accèdent pas. Les `sims` imbriqués, en revanche, possèdent un état dynamique nécessaire et le témoin établit la nécessité de leur copie complète, avec paramètres et limites enfants. Aucun autre champ n’est ajouté sur la seule base d’une supposition.

Le QSS impose 4096 réponses simultanées au maximum, avec erreur de capacité explicite. La capacité configurée de l’observateur borne les lectures actives et les valeurs en attente ; une requête non émise et son attente ne sont pas comptées deux fois. Les FIFO se vident à raison d’un message par port et par micro-étape. Pour un sac fini et en l’absence de nouveau retour métier, le protocole ajoute un nombre fini de micro-étapes ; les tests imposent aussi une borne de progression.

## Exécution et preuves brutes

Plateforme : Windows x64, MSVC 19.51, CMake/Ninja, `real=double`, GUI et architecture native désactivées. Pas de validation GCC/Clang/Linux ou F32 revendiquée. Le refus d’écriture sandbox sur `event.cpp` a été résolu par l’escalade autorisée pour ce seul script de correction ; aucune demande de permission utilisateur n’est restée en suspens. Les CTest runner, qui préparent aussi leurs sorties TypeScript générées, ont été exécutés avec les permissions nécessaires, successivement pour éviter des écritures concurrentes.

Les premiers témoins ont révélé les omissions supplémentaires avant leur correction. Une première version du banc imbriqué avait omis de réserver sa ressource ; cette erreur de banc a été corrigée avant le constat réel. Des objets diagnostics périmés après changement de disposition des structures ont ensuite causé des erreurs ABI ; les dépendances d’en-têtes ont été explicitées, tous les exécutables concernés recompilés, et seuls les runs frais sont retenus. Le premier protocole a passé 13/13 tests par configuration, puis le témoin renforcé de date du clone a révélé l’omission ci-dessus. Les compilations alors actives ont été interrompues volontairement pour cette correction ; les processus descendants identifiés et les logs sont conservés dans `audit/interrupted-final-*`. Une reconstruction `--clean-first` a été exécutée ensuite pour les deux moteurs. Les traces intermédiaires sont conservées dans `build-web-test8p-bis/audit/`.

Contrôle initial du candidat : `git apply --check C:\Users\cedouard\Downloads\SNAPSHOT_IN_FLIGHT_CANDIDATE.patch`, résultat 0 sur le worktree initial. Il est maintenant appliqué ; cette commande n’est pas à réappliquer sur le résultat final.

Commandes reproductibles de validation depuis `D:\these\irritator`, avec les artefacts de référence 8P préservés :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/state-observer-8p-bis/build.ps1 -Configuration Release -CleanFirst -SkipRunnerTests
powershell -NoProfile -ExecutionPolicy Bypass -File test/state-observer-8p-bis/build.ps1 -Configuration Debug -CleanFirst -SkipRunnerTests
powershell -NoProfile -ExecutionPolicy Bypass -File test/state-observer-8p-bis/runner-tests.ps1 -Configuration Both
node test/state-observer-8p-bis/audit.mjs
node test/state-observer-8p-bis/summarize.mjs
```

Les deux exécutables historiques et l’archive de comparaison proviennent de `build-web-test8p/<configuration>/`. Les en-têtes HEAD figés se trouvent dans `build-web-test8p-bis/baseline/include/irritator/`. Le différentiel compile **le même driver** contre cet ancien moteur et contre le nouveau, compare les sorties physiques et observations en notation hexadécimale exacte, et teste dans chaque driver l’instrumentation activée/désactivée. Les 36 scénarios finaux couvrent les trois ordres, deux ordres d’allocation, des polynômes et une dérivée constante, sans reset, avec reset/dérivée avant l’échéance et exactement à `nextafter(1,2)`. Chaque exécution instrumentée comporte deux observateurs et neuf dates de lecture dont zéro et `2^-53`. Cela représente 144 simulations différentielles par configuration. Les résultats A/B intermédiaires portaient sur les 24 premiers scénarios.

Les fichiers `proof.xml`, `proof-tests.log`, `proof/Testing/Temporary/LastTest.log`, `differential-before.txt` et `differential-after.txt` sont sous `build-web-test8p-bis/<configuration>/` (les deux derniers dans `proof/`). Les résultats A/B antérieurs à l’intégration du protocole sont archivés dans `audit/phase-ab-final-*`. Le diff suivi final est `audit/final.patch` ; les nouveaux compagnons C++ sont à lire en complément de ce diff Git non indexé.

## Résultats finaux

Les premières campagnes runner ont réellement échoué sur trois cas dans chaque configuration : `native-schaefer-feedback`, `native-tstar-composition` et `feedback-observer`. Leurs logs et XML complets sont conservés sous `audit/runner-first-*` ; ils ne sont pas transformés en succès.

Le collecteur générique `execute` ajoutait un compteur à chaque sortie de l’observateur, y compris son nouveau port de requête réservé. Cela créait une liaison contradictoire, justement rejetée par le validateur. La capture Schaefer appliquait son assertion de valeur scientifique à cette même requête `[ticket,propriétaire,0]`. La pile `audit/schaefer-diag.log` situe le rejet dans `near` appelé par la capture de `event_dynamics<8>` ; l’exception traversait le dispatch `noexcept`, d’où l’arrêt et les timeouts Debug. Ce diagnostic utilise une copie du collecteur antérieur conservée dans `audit/schaefer-embedded.inc`, sans modification du moteur.

Deux adaptations C++ de capture sont donc nécessaires à l’extension des ports : le collecteur d’observateur conserve ses ports historiques 0/1 ; la capture Schaefer continue à tracer tous les ports, mais n’applique ses contrôles de valeur qu’aux ports historiques 0/1. Le port 2 est vérifié par les nouveaux tests de protocole. Aucun ancien port ni aucune assertion de résultat n’est supprimé ; nombres, tolérances et campagnes restent identiques. Le chemin du collecteur pour `zero_order_hold` demeure celui d’avant.

Les corps de tests après les inclusions de `event-native-tests.cpp` conservent le SHA256 `ecbe7689f756f8e978a938ed6ea43958243d6f88399a2a5c8d1a21f03825cb04`. Les lignes d’appels `require/near` de Schaefer conservent `b01f5b8c0960539a628bfffa774c433ca1136c308338a986c439274a936cb7ba`. Tous les fichiers suivis référençant `zero_order_hold` dans les tests/démos/runner ont aussi un hash avant/après identique. Les trois reprises ciblées sont à 3/3 dans chaque configuration (`collector-tests.log/xml`). Les deux nouvelles campagnes complètes runner sont maintenant à 71/71, sans modification d’attente.

| Suite finale | Release | Debug |
|---|---:|---:|
| Moteur historique | 10/10 — 8,56 s | 10/10 — 17,01 s |
| Démonstrations historiques | 40/40 — 15,75 s | 40/40 — 24,26 s |
| Runner historique complet 8D–8O | 71/71 — 445,10 s | 71/71 — 612,60 s |
| **Total historique** | **121/121** | **121/121** |
| CTest 8P bis, témoins historiques séparés compris | **13/13 — 7,09 s** | **13/13 — 9,17 s** |
| Ignorés / désactivés / échecs finaux | **0 / 0 / 0** | **0 / 0 / 0** |

Les 13 CTest comprennent les deux acceptations originales, les deux anciens exécutables de reproduction figés, l’arbitrage de cohorte fermé, les cycles de vie des instantanés et enfants, le différentiel exact, et cinq cas de protocole (annulation, capacité, instantanés, structure, clones). Aucun cas historique n’a été retranché. `feedback-audit` confirme encore `last emitted=10.01; current X=12` ; les suites de feedback et de trajectoires réelles passent.

Preuves finales et diffs :

- [Résumé des huit campagnes et hashes des sources](D:/these/irritator/build-web-test8p-bis/audit/validation-summary.json) ; `allRequiredPass=true`.
- [Intégrité avant/après et hashes des oracles](D:/these/irritator/build-web-test8p-bis/audit/integrity.json) ; aucune modification inattendue, sept fichiers 8P antérieurs préservés.
- [Diff suivi ciblé](D:/these/irritator/build-web-test8p-bis/audit/final.patch), à compléter par les trois nouveaux compagnons C++ nommés plus haut.
- [Logs bruts 8P bis Release](D:/these/irritator/build-web-test8p-bis/Release/proof/Testing/Temporary/LastTest.log) et [Debug](D:/these/irritator/build-web-test8p-bis/Debug/proof/Testing/Temporary/LastTest.log), avec les dates exactes, identités de messages et témoins de clone.
- [Logs bruts runner Release](D:/these/irritator/build-web-test8p-bis/Release/runner/Testing/Temporary/LastTest.log) et [Debug](D:/these/irritator/build-web-test8p-bis/Debug/runner/Testing/Temporary/LastTest.log).
- [Journal complet runner Release](D:/these/irritator/build-web-test8p-bis/Release/runner-tests.log) et [Debug](D:/these/irritator/build-web-test8p-bis/Debug/runner-tests.log). Les XML `engine.xml`, `historical.xml`, `runner.xml` et `proof.xml` voisins enregistrent les comptes sans skips.

Le rapport et le CSV restent ignorés par les règles Git préexistantes, mais sont présents localement. Les nouveaux diagnostics et compagnons sont non indexés. L’index est inchangé et `git diff --check` passe. Aucune livraison Git n’a été créée.
