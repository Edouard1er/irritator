# Irritator Web — éditeur graphique (Test 5)

Éditeur local Next.js / React Flow connecté au **véritable runner C++ du Test 4**.
Les composants, paramètres et ports viennent de `GET /api/v1/components`.
React édite et sérialise le modèle ; seuls Fastify et libirritator l’exécutent.

## Installer et démarrer (PowerShell, Node.js 24)

Premier terminal, depuis la racine du dépôt :

```powershell
Set-Location D:\these\irritator
# Si le runner n’est pas déjà construit :
powershell -NoProfile -ExecutionPolicy Bypass -File web/build-runner.ps1
# Sur ce poste, variante avec l’archive stabilisée existante :
# powershell -NoProfile -ExecutionPolicy Bypass -File web/build-runner.ps1 -SkipEngineBuild -EngineBuildDir build-wrapper-test3
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
les types, les validations et le parseur de résultats restent ceux du Test 4.
Le catalogue partagé sert à vérifier le protocole ; la bibliothèque affiche
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
- **Enregistrer** : télécharger un JSON scientifique v1 directement accepté
  par le backend. Les paramètres, observations et limites facultatives importées
  sont conservés. Aucun champ graphique n’est ajouté à ce fichier.
- La sauvegarde automatique du navigateur stocke séparément modèle, positions
  et caméra, sous `irritator.workspace.v1`. Elle est restaurée au rechargement.
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

Non-régression Test 4, depuis `web` : `npm.cmd run test:all` (73 tests).
Voir le [rapport Test 5](../../../reports/frontend-test-5.md) pour le détail des
exécutions, y compris les tests natifs Release/Debug et les limites de validation.

Next.js utilise Turbopack. `predev` et `prebuild` copient le bundle et la licence
Plotly installés dans `public/vendor` (généré et ignoré). L’adaptateur React le
charge uniquement côté client et depuis cette origine locale. Après installation
et compilation, aucun CDN, police distante ou service Internet n’est requis.
Les dépendances sont verrouillées dans `package-lock.json`.

## Périmètre

Cinq types atomiques du Test 4, sans hiérarchie, wrapper graphique, plans
d’expériences, modèle halieutique, base de données, authentification ou calcul
distribué. Interface prioritairement desktop (largeur minimale 1000 px), panneau
de résultats redimensionnable verticalement. Pas encore d’annuler/rétablir ni de
sauvegarde de workspace dans un fichier portable. Le serveur reste local.
