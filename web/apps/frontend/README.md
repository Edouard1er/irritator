# Irritator Web — éditeur graphique et hiérarchique (Tests 5–7F)

Éditeur local Next.js / React Flow connecté au **véritable runner C++ Irritator**.
Les composants, paramètres et ports viennent de `GET /api/v1/components`.
React édite et sérialise le modèle ; seuls Fastify et libirritator l’exécutent.

## Installer et démarrer (PowerShell, Node.js 24)

Premier terminal, depuis la racine du dépôt :

```powershell
Set-Location D:\these\irritator
# Pour les wrappers : construire le runner 7F selon web/engine/runner/tests-wrapper/README.md.
$env:IRRITATOR_RUNNER=(Resolve-Path build-web-test7f/Release/runner/irritator-runner.exe).Path
Set-Location web
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Deuxième terminal :

```powershell
Set-Location D:\these\irritator\web\apps\frontend
npm.cmd ci
npm.cmd run dev
```

Ouvrir [l’éditeur](http://127.0.0.1:3000). Fastify écoute sur
`http://127.0.0.1:3001`. Les rewrites Next.js transmettent `/api/v1/*` à Fastify
sans CORS ni nouvelle route de calcul. `IRRITATOR_API_URL` permet de modifier
la destination, dans `.env.local` ou l’environnement **avant la compilation**.
En cas de port occupé : `npm.cmd run dev -- --port 3002`.

Les packages API et frontend sont indépendants : pas de workspaces ni de
changement aux commandes, dépendances ou verrou npm du Test 4. Le frontend
importe le contrat partagé par l’alias TypeScript `@contracts` ; le schéma,
les types, validations et parseurs de résultats sont communs aux contrats v1/v2/v3.
Le catalogue partagé sert à vérifier le protocole ; la bibliothèque atomique affiche
seulement les métadonnées effectivement reçues de l’API, sans repli fictif.

## Construire et exécuter un modèle

1. Cliquer **Nouveau**, puis nommer le modèle dans l’en-tête (lettres ASCII,
   chiffres, `_` et `-`, 64 caractères maximum).
2. Ajouter les composants par clic dans la bibliothèque ou glisser-déposer.
3. Sélectionner un nœud. Dans l’inspecteur, éditer son identifiant et les
   paramètres numériques. Les valeurs invalides bloquent l’exécution/export.
4. Cliquer une sortie puis une entrée, ou utiliser **Relier des ports** et ses
   sélecteurs accessibles au clavier. Les indices affichés sont les indices natifs.
5. Activer **Observer ce composant** et choisir son pas. Le contrat impose
   un pas >= `1e-6`, <= `1e9`, et une grille potentielle dans le budget de points.
6. Régler **Début** / **Fin**, puis **Exécuter la simulation**.

Pour reproduire l’oracle : trois constantes `c1` (`value=10, offset=0`), `c2`
(`100,1`), `c3` (`1000,2`) et `sum` de type `qss1_sum_3`. Relier les sorties 0
aux entrées 0, 1 et 2 de sum ; observer sum avec un pas de 1 sur `[0,3[`.
Les points réels sont `(0,10), (1,110), (2,1110)`. Modifier les valeurs en
`-2,7,40` donne `-2,5,45`, sans recompiler.

Pour les intégrateurs, relier une constante de valeur 2 à l’entrée 0 d’un
`qss1_integrator` ou `qss3_integrator`, `X=5`, `dQ=0.25` ; observer avec un pas
de 0.1, bornes 0 et 3. Les sorties de cette expérience affine suivent `5+2t`,
avec un état terminal de 11. Cela ne valide pas les modèles QSS3 non linéaires.

Déplacer les nœuds, zoomer avec la molette et ajuster la vue avec les commandes
du canevas. Sélectionner un nœud ou une arête et utiliser **Suppr** pour le
supprimer ; l’inspecteur fournit aussi un bouton. Supprimer un composant retire
ses connexions et observations. Les cycles entre composants sont autorisés ;
les auto-connexions et doublons exacts sont refusés.

## Résultats, import et sauvegarde

- **Trajectoires** : Plotly, survol, zoom, déplacement et réinitialisation.
  Les cases affichent/masquent les observations. Les segments relient les points
  uniquement pour leur représentation ; aucun échantillon n’est créé.
- **Données** : points exacts du moteur, pagination à 100 lignes.
- **Exécution** : modèle, runId, bornes, temps atteint, appels à `run()`, pas et
  nombre de points. Un appel à `run()` n’est pas un événement physique.
- **CSV** : tous les points de la réponse, indépendamment des séries masquées,
  sous la forme `component,time,value`. La conversion des nombres préserve
  leur valeur JavaScript double précision ; les dates ne sont pas arrondies.
- **Ouvrir** : sélectionner par exemple `D:\these\irritator\web\examples\sum3.json`.
  Les positions sont reconstruites de façon déterministe. Les fichiers sont
  limités à 1 Mio et vérifiés avec le schéma partagé ; aucun import `.irt/.pirt`.
- **Enregistrer** : télécharger un JSON scientifique v1, v2 ou v3 directement accepté
  par le backend. Les paramètres, observations et limites facultatives importées
  sont conservés. Aucun champ graphique n’est ajouté à ce fichier.
- La sauvegarde automatique du navigateur stocke séparément modèle, positions
  et caméra de chaque portée, sous `irritator.workspace.v2`. Elle est restaurée au
  rechargement, avec migration non destructive de `irritator.workspace.v1`.
  La clé historique est conservée. Une restauration impossible bloque toute
  réécriture automatique jusqu’à Nouveau ou l’import réussi d’un document.
  Les erreurs de quota ou de saisie sont signalées ; la dernière sauvegarde valide
  est conservée. Elle ne remplace pas un export de fichier durable.
- Nouveau/Ouvrir et la fermeture de page avertissent en présence de modifications
  non exportées. Un document vide peut être ouvert et sauvegardé localement ; le
  contrat d’exécution/export exige au moins un composant.

Modifier le modèle scientifique conserve les anciens résultats avec un avertissement
explicite. Déplacer les nœuds ou la caméra ne rend pas les trajectoires obsolètes.
Une erreur de simulation conserve la dernière réponse réussie. Aucun pourcentage
d’avancement n’est inventé. Le backend sait tuer un calcul après déconnexion HTTP,
mais il n’existe pas d’accusé de réception d’annulation à travers le proxy : aucun
bouton ni statut d’annulation confirmée n’est annoncé dans cette interface.

## Tests et production

Depuis `web/apps/frontend` :

```powershell
npm.cmd run typecheck
npm.cmd test
# Avec Fastify et Next.js déjà démarrés, et Google Chrome installé :
npm.cmd run test:e2e
# Autre port pour les tests :
# $env:FRONTEND_URL='http://127.0.0.1:3002'

npm.cmd run build
# Arrêter le serveur de développement avant de lancer sur le même port :
npm.cmd start
```

Vitest couvre la sérialisation, les connexions, la sauvegarde, les composants
React et le client API (réponses mockées explicitement). Playwright utilise Chrome
installé (`channel: chrome`), un contexte vierge par test, et les vrais serveurs
pour les expériences scientifiques. Les cas d’indisponibilité interceptent
explicitement HTTP et ne sont pas des expériences moteur. Aucun navigateur n’est
téléchargé implicitement. Les résultats et requêtes sont enregistrés dans
`build-web-test5/logs/browser/`, les journaux dans `build-web-test5/logs/`, les
captures réelles dans `reports/frontend-test-5/`.

Non-régression et hiérarchie, depuis `web` : `npm.cmd run test:all`.
Voir le [rapport Test 5](../../../reports/frontend-test-5.md) pour le détail des
exécutions, y compris les tests natifs Release/Debug et les limites de validation.

Next.js utilise webpack avec `experimental.extensionAlias` pour résoudre les imports
NodeNext `.js` des sources TypeScript partagées (`index.ts` / `wrapper-v3.ts`).
Cela évite de modifier les contrats exécutés par Node et le runner. `predev` et `prebuild` copient le bundle et la licence
Plotly installés dans `public/vendor` (généré et ignoré). L’adaptateur React le
charge uniquement côté client et depuis cette origine locale. Après installation
et compilation, aucun CDN, police distante ou service Internet n’est requis.
Les dépendances sont verrouillées dans `package-lock.json`.

## Créer et réutiliser un composant couplé

1. Dans **Mes composants**, saisir identifiant et nom, puis **Créer le composant
   couplé**. Cela active le contrat v2 pour ce document.
2. Ajouter les ports externes. Leurs indices restent stables ; le nom peut être
   édité dans la barre d’interface.
3. Ajouter les enfants depuis le catalogue atomique ou insérer une autre
   définition depuis **Mes composants**. Une référence récursive est rejetée.
4. Dans **Relier des ports**, connecter les sorties du nœud `$input` aux entrées
   des enfants (EIC), les enfants entre eux (IC) et leurs sorties au nœud `$output`
   (EOC). Les handles React Flow représentent exactement les mêmes couplages.
5. Cliquer **Enregistrer la définition**, puis insérer autant d’instances que
   nécessaire dans le modèle principal. Renommer chaque instance via l’inspecteur.
6. Ouvrir une instance avec **Ouvrir le contenu**. Le fil d’Ariane permet de
   revenir au parent ou à la racine ; les positions et caméras sont propres aux
   définitions. Modifier une définition modifie tous ses usages : il n’existe pas
   de copie cachée ni d’override de paramètres par instance.
7. Dans **Observations hiérarchiques**, sélectionner un chemin tel que
   `sumB/sum` et cliquer **Observer ce chemin**. Les observations portent sur
   un état atomique natif ; une sortie couplée transmet des événements mais n’est
   pas elle-même un état observable. Les renommages remappent les chemins.
8. Simuler, exporter, réimporter et simuler à nouveau. Les exemples
   `web/examples/hierarchy-sum.json` et `hierarchy-nested.json` publient
   exactement `10,110,1110` aux dates `0,1,2` sur `[0,3[`.

Une définition vide/incomplète peut être éditée et sauvegardée localement.
Un port déclaré sans couplage atomique bloque l’exécution/export scientifique.
Supprimer un port retire ses connexions internes et celles de toutes ses
instances ; le message indique leur nombre. Les autres indices ne changent pas.

Le catalogue atomique comporte treize types, dont `qss2_integrator`,
`qss1_multiplier` et les six opérateurs QSS3 du Test 6.1 : `qss3_multiplier`,
`qss3_wsum_2`, `qss3_power`, `qss3_inverse`, `qss3_square`, `qss3_sqrt`.
Leurs ports et paramètres passent par les mêmes nœuds et inspecteur génériques.
Les nouveaux coefficients et l’exposant sont initialisés à 1. Les exemples
`qss3-operators.json` et `qss3-operators-coupled.json` sont importables.
Pour QSS2 (X=5,dQ=.25,dérivée 2,pas .1), l’interpolation native initiale publie
5.192 à .1 au lieu de 5.2 ; la réponse reste intacte. Tolérance analytique .01
dans ces tests ; les références plates et hiérarchiques sont identiques.
Voir le [contrat](../../packages/contracts/README.md) et le
[rapport Test 6](../../../reports/hierarchy-test-6.md).

Pour conserver les preuves du Test 5 lors des non-régressions :

```powershell
$env:IRRITATOR_BROWSER_EVIDENCE='../../../build-web-test6/logs/browser-regression'
$env:IRRITATOR_BROWSER_SCREENSHOTS='../../../build-web-test6/logs/screenshots-regression'
npm.cmd run test:e2e
```

## Simulation imbriquée — Test 7E

Le catalogue natif reste à treize composants. La catégorie **Expérimental · JSON v3**
propose `simulation_wrapper` après vérification exacte des capacités annoncées par
le health 7D. L’ajout à un document v1/v2 demande sa conversion explicite en v3 ;
les composants, connexions, limites et définitions sont conservés. Créer ensuite
une définition conserve v3. Un wrapper peut être ajouté dans le modèle principal
ou une définition couplée.

Pour reproduire 3/1/1 sans JSON :

1. Créer la définition `Prospectif`. Ajouter `constant` nommée `u`, puis
   `qss3_integrator` nommé `X`, avec X=1 et dQ=.01. Relier u:0 à X:0.
2. Revenir au modèle principal. Ajouter le wrapper et choisir `Prospectif`.
3. Ajouter un facteur ciblant `u.value`, type fixed, valeurs `-1,0,1`.
4. Ajouter deux sélections sur X : `terminal` / max-last et `minimum` / min.
   Choisir simple, maximize, primaire terminal, complete, horizon enfant [0,2[.
5. Ajouter une constante parent, value=0 et offset=1, et connecter sa sortie à
   l’entrée **run** (1) du wrapper. Garder l’horizon parent [0,3[ et simuler.
6. **Décisions natives** affiche les trois émissions à t=1 : terminal=3,
   minimum=1, facteur=1, pour trois scénarios. Enregistrer, ouvrir le JSON exporté
   et relancer reproduit les mêmes événements.

`web/examples/wrapper-affine-v3.json` fournit également ce modèle avec trois
récepteurs observés dans Plotly. Les observations parent rééchantillonnées et les
émissions réelles du wrapper sont présentées dans des vues distinctes. Le journal
conserve l’ordre, les temps répétés, le port, le triplet entier et le sac local
`bag`. Il ne déduit ni gagnant ni score global. Sans commande run, l’état vide
est explicite. React ne simule pas les scénarios et ne calcule aucun critère.

L’inspecteur expérimental propose les chemins atomiques, uniquement
constant.value et qss1/2/3_integrator.X pour les facteurs, les quatre critères,
les horizons et la navigation vers le prospectif. Réordonner ou renommer des
facteurs/sélections remappe les connexions par identité. Un port connecté ne peut
pas être supprimé avant le retrait explicite de ses connexions. Le renommage des
enfants/instances prospectifs remappe les chemins ; leur suppression est bloquée
s’ils restent ciblés. Les références récursives et wrappers prospectifs imbriqués
sont rejetés. Les brouillons incomplets sont sauvegardés localement, signalés dans
l’inspecteur et refusés à l’export scientifique et à l’exécution.

Une occurrence couplée contenant un wrapper expose **Plans de cette occurrence** :
cocher Personnaliser permet de modifier seulement single/fixed et les valeurs.
Les `experimentOverrides` restent privés à l’occurrence ; le nombre et l’ordre des
facteurs suivent la définition. Les renommages/réorganisations partagés mettent
également à jour les overrides. Toutes les données scientifiques v3 sont conservées
à l’import/export et dans le workspace v2 existant, avec les dispositions par portée.

Tests spécifiques et preuves, après démarrage des vrais serveurs :

```powershell
$env:IRRITATOR_BROWSER_EVIDENCE='../../../build-web-test7e/logs/browser-regression'
$env:IRRITATOR_BROWSER_SCREENSHOTS='../../../build-web-test7e/logs/screenshots-regression'
$env:IRRITATOR_PLAYWRIGHT_REPORT='../../../build-web-test7e/logs/playwright.json'
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:e2e
```

Les parcours wrapper enregistrent requêtes/réponses et captures sous
`build-web-test7e/logs/browser/`. La création manuelle compare aussi la réponse HTTP
à l’exécution directe du runner 7D et enregistre son SHA-256. Arrêter l’API de test
avant les régressions backend, dont l’oracle HTTP réserve le port 3001.
Voir le [rapport 7E](../../../reports/simulation-wrapper-test-7E.md).

## Périmètre

Treize types atomiques et hiérarchie native jusqu’à huit niveaux, wrapper natif
simple/complete avec facteurs single/fixed, sans facteurs aléatoires, méthodes
multicritères supplémentaires, B*, modèle halieutique, base de données, authentification ou calcul
distribué. Interface prioritairement desktop (largeur minimale 1000 px), panneau
de résultats redimensionnable verticalement. Pas encore d’annuler/rétablir ni de
sauvegarde de workspace dans un fichier portable. Le serveur reste local.

## Inspecteur natif complet (Test 7F)

L’inspecteur propose simple, weighted-sum (poids, sens locaux, min-max/z-score)
et epsilon-constrained (primaire et contraintes sur toutes les sélections).
Les critères normalisés sont explicitement signalés dans les décisions natives.

Les neuf plans single/fixed/random avec remplacement, addition et multiplication
sont disponibles. Les distributions et leurs paramètres natifs sont conditionnels.
La graine optionnelle est un état de six chaînes u64 ; sa sauvegarde ne passe
jamais par Number. Réordonner les sélections remappe aussi poids et contraintes.
Les imports, exports et workspaces conservent tous ces champs.

Les cinq modes complete/bag/time/until/during utilisent les commandes DEVS du
graphe. L’inspecteur décrit les horloges indépendantes, dépassements entre sacs,
délai parent du scalaire run et réinitialisations nécessaires aux modes partiels.
Aucun bouton de mutation d’état courant ni optimiseur JavaScript n’est ajouté.

Les parcours réels 7F sont dans tests/e2e/wrapper-7f.spec.ts. Ils comparent chaque
réponse Fastify à l’exécution directe du même binaire C++ et couvrent les trois
méthodes, les trois familles et les cinq modes. FRONTEND_URL et IRRITATOR_RUNNER
permettent de choisir les serveurs et le binaire testés ; les preuves sont dans
build-web-test7f/logs/browser. Pour isoler une campagne des serveurs existants,
IRRITATOR_API_URL doit être défini avant le build ou le démarrage dev de Next.js.

## Atelier participatif — niveau 1

Voir [l’intégration, le mapping scientifique et la recette](./ATELIER_NIVEAU1.md).

Itération 2 : ouvrir [`atelier-schaefer-month-v3.json`](../../examples/atelier-schaefer-month-v3.json)
pour l’atelier explicitement défini en tonnes et mois. Cette nouvelle convention
pédagogique ne calibre pas les anciens modèles, dont les unités restent inconnues.
Le rapport décrit les fenêtres de 12 mois, les symboles proportionnels, les alarmes,
la jauge et le mode Grand écran.

## Interventions temporelles (itération 3)

Ouvrir `web/examples/atelier-interventions-month-v3.json` depuis la racine du dépôt,
exécuter, parcourir le temps et choisir **Modifier les conditions**. L’application
recalcule avec Irritator C++ depuis l’origine, puis reprend au même instant sans
réinitialiser la biomasse ou la capture cumulée. Pluie, salinité, accessibilité,
effort exact et composition des pirogues sont éditables ; les coefficients des
réponses environnementales et des saisons sont accessibles en lecture Scientifique.

Une situation du modèle mensuel existant peut être isolée avec **Activer les
interventions · nouveau départ** dans les réglages du lecteur. Cette préparation
crée un nouveau calcul à t=0 avec un calendrier pédagogique explicite.

La sauvegarde inclut l’historique. Le panneau d’historique exporte aussi le graphe
DEVS compilé, exécutable par le runner historique. Les courbes N/C restent natives.
Le calendrier, les indices environnementaux et les capacités des pirogues sont
illustratifs, sans calibration écologique du lac de Guiers.

Voir [ATELIER_NIVEAU1.md](ATELIER_NIVEAU1.md) pour le contrat JSON, l’architecture
des événements, les tests, les captures et l’étude de restauration complète QSS3.
