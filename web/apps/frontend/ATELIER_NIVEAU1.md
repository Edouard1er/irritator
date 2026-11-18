# Irritator — atelier participatif, niveau 1

## État actuel : itération 3.1 — lecture Pêcheur

Cette révision prolonge les modifications locales de l’itération 3 sur `two-modes`.
Elle concerne uniquement le frontend, ses tests et la documentation. Le moteur C++,
les équations de Schaefer, les contrats, le compilateur temporel, les JSON et les
valeurs scientifiques ne changent pas dans cette révision. Aucun commit ni push.

### Lac agrandi et lecture allégée

La jauge « Où en est la ressource ? » est retirée du tableau de bord. Une seule
grille place la biomasse et les captures à gauche, le lac sur leurs deux rangées
à droite. Le Canvas occupe la majorité de cette carte, avec une hauteur minimale
de 390 px pour son conteneur sur ordinateur, accrue en Grand écran. Sur mobile,
le lac précède les deux graphiques dans une colonne sans débordement horizontal.

Le rendu utilise désormais **un poisson pour 10 tonnes**, avec
`max(0, round(B/10))`. Exemples : 100 t → 10 poissons, 158,6 t → 16, 300 t → 30.
La biomasse native conserve toute sa précision : seules les quantités dessinées
sont arrondies. Les indicateurs et courbes ne sont pas recalculés. La pastille du
lac formate B en français jusqu’à six décimales ; l’attribut accessible et les
données conservent la valeur numérique native. Le Canvas unique garde ses positions
déterministes et ses transitions d’opacité ; pause et mouvement réduit figent
les pixels, hors changement explicite de données ou de taille.

Les paragraphes sous le lac et la légende de salinité ajoutée en CSS sont supprimés.
Restent le titre, la biomasse et, si connue, une petite pastille d’accessibilité.
Les précisions de provenance, les équations et les conventions restent dans la
lecture Scientifique et les métadonnées JSON. L’édition Pêcheur conserve les
contrôles et erreurs de validité, mais masque les explications techniques.
Le seuil porte toujours le nom « Seuil choisi pour l’atelier » : il n’est pas
présenté comme une mesure écologique officiellement établie.

### Captures mensuelles discrètes, présentées en courbe

« Poissons pêchés chaque mois » remplace l’histogramme. L’axe horizontal est
« Temps (mois) », le vertical « Quantité pêchée (tonnes) ». Le calcul inchangé est
**P(m) = C(m) − C(m−1)**, à partir des observations natives aux bornes mensuelles.
Aucun débit instantané, lissage ou nouvelle intégration. Les mois absents restent
indisponibles et interrompent le tracé.

Les segments droits et les points apparaissent aux fins de mois pendant la lecture.
Le dernier mois complet est mis en évidence ; le curseur vertical suit le temps
commun, y compris à l’intérieur d’un mois incomplet. Survol ou focus d’un point
affiche mois et quantité. Un clic ou Entrée/Espace sur un point rejoint cette
observation mensuelle et suspend la lecture. Le clavier du curseur principal
reste utilisable. La référence initiale, lorsqu’activée, est en pointillés bleus.
Après une intervention, les points utilisent le nouveau cumul du moteur.

### Audio préparé avant le seuil

La préférence est active par défaut. Une désactivation explicite est conservée
dans `localStorage['irritator-alert-sound']`, et respectée aux nouvelles sessions
ou situations. Une activation explicite rétablit la préférence.
Le premier clic de lecture ou d’activation sonore crée/reprend l’AudioContext
indépendamment du statut de biomasse ; Appliquer prépare aussi l’audio dans le
geste utilisateur avant le recalcul asynchrone.

Aucune voix ne joue au-dessus du seuil, y compris dans les états orange et jaune.
Pendant la lecture Pêcheur active et visible, la sirène rouge continue exige
son activé, contexte prêt et **B ≤ seuil configuré**. Le franchissement ne demande
aucun nouveau clic. Retour au-dessus du seuil, désactivation, pause, déplacement
manuel, changement de situation/public, sortie et onglet masqué arrêtent la voix.
Une seule voix et son oscillateur de modulation sont utilisés ; arrêt et démontage
déconnectent leurs nœuds. Les variations de volume ne relancent pas la sirène.
L’édition suspend le son ; un recalcul réussi conserve la préférence et reprend
la sirène si les conditions sont réunies à la reprise.

Un refus du navigateur ne change pas la préférence explicite : il affiche un
message compact et conserve les alertes visuelles. Un nouveau geste permet une
nouvelle tentative. Aucune tentative ne contourne la politique audio du navigateur.

### Saisons visibles et indépendantes de la pluie

Le repère météo de 40–64 px, adapté à la largeur du Canvas, comporte soleil et
rayons au printemps/été, nuages à l’automne/hiver, vent en hiver et végétation au
printemps. Pas de neige. Le nom de la saison reste lisible dans un badge.
Ciel et ambiance changent aux temps simulés 3, 6, 9, 12, puis le cycle recommence.
Le calendrier pédagogique existant reste celui de l’expérience, sans horloge réelle.
La pluie demeure indépendante, proportionnelle à P dans [0,10], et peut coexister
avec chaque saison. Eau selon S et pirogues selon la flotte restent synchronisées
avec le curseur, y compris après une intervention.

### Recette 3.1 et captures

Validation exécutée sous Node 24.22.1 :
- Vitest frontend complet : **296 tests passent dans 27 fichiers**.
- Typecheck TypeScript frontend : sans erreur.
- Build Next.js de production : sans erreur.
- Recette Chrome de production avec le runner C++ réel : **12 parcours passent**.
- Après le dernier ajustement des libellés, contre-vérification ciblée : 15 tests
  du graphique et du lac et les deux parcours Chrome 3.1 passent.
- Contrôle visuel des captures ordinateur, saisons, pluie, courbe, alerte et mobile.

Les tests ajoutés couvrent les proportions demandées, la valeur native préservée,
les points mensuels exacts, les lacunes, le curseur, le focus/clavier, le calendrier
et sa répétition. La recette audio instrumente le véritable AudioContext de Chrome :
activation au-dessus du seuil, franchissement automatique, égalité B=seuil, arrêt,
désactivation persistante et reprise après intervention sans superposition.
Les tests historiques de l’atelier sont adaptés à la nouvelle préférence et à
l’échelle de dix tonnes. Les suites API et les suites navigateur hors atelier ne
sont pas relancées pour cette révision frontend.

Preuves locales ignorées par Git dans `reports/iteration31-evidence/` :
`01-lac-agrandi.png`, `02-ete.png`, `03-pluie.png`,
`04-biomasse-critique.png`, `05-captures-mensuelles.png`,
`06-grand-ecran.png`, `07-hiver.png`, `08-mobile.png`,
`09-mobile-lac.png`, `10-mobile-captures.png`.
`native-and-layout.json` conserve la requête d’intervention, les résultats natifs
et les dimensions ; `web-audio.json`, `playwright.json` et
`playwright-final31.json` conservent les contrôles. Sur le parcours audio natif :
un seul contexte créé, au maximum deux oscillateurs simultanés (voix et modulation),
zéro oscillateur actif ou connecté après désactivation. Les tests unitaires audio
vérifient aussi la déconnexion des gains. À 1920×1080, le Canvas occupe environ
412 px de haut et les commandes sont visibles ; Grand écran agrandit encore le lac.
Le redimensionnement mobile attend la mise à jour des graphiques avant de contrôler
les largeurs. Le build ne laisse aucune modification de `next-env.d.ts`.

Fichiers concernés par la révision 3.1 :
- `components/simulation/{simulation-workspace,biomass-lake,monthly-catch-chart,conditions-editor}.tsx`.
- `lib/simulation/indicators.ts`, `app/workshop.css`.
- `tests/workshop-{components,v2,v2-components}.test.{ts,tsx}`,
  `tests/workshop-v31.test.tsx`, `tests/e2e/workshop{,-v2,-v31}.spec.ts`.
- Ce rapport et `README.md`.

Les sections suivantes sont les références historiques des itérations 3 et 2 ;
leurs anciennes proportions, jauge, barres et sons orange/jaune sont remplacés
par les comportements 3.1 décrits ci-dessus.

## Référence conservée — itération 3 : interventions temporelles

Sur `two-modes`, l’atelier possède maintenant une expérience v3 temporelle explicite :
`web/examples/atelier-interventions-month-v3.json`. Ouvrir ce fichier, exécuter,
parcourir le temps, puis **Modifier les conditions**. L’édition suspend immédiatement
la lecture et le son. **Appliquer à partir du mois X** recalcule depuis l’origine,
conserve les états N et C, puis reprend à la même observation X. Une erreur conserve
la trajectoire précédente, l’historique précédent et la pause.

Un scénario du modèle mensuel de l’itération 2 peut aussi être préparé avec
**Activer les interventions · nouveau départ**, dans les réglages du lecteur.
Cette action crée une nouvelle expérience à t=0 avec ses véritables facteurs E/q,
N0 et K ; elle ajoute explicitement le calendrier pédagogique. Elle n’applique pas
rétroactivement des saisons à l’ancienne exécution. Les anciennes versions sans
champ `temporal` conservent exactement leur chemin d’exécution.

### Modèle et conventions scientifiques

Les intégrateurs natifs conservent N′ = r(t) N (1−N/K) − q(t)a(t)E(t)N et
C′ = q(t)a(t)E(t)N, en tonnes et mois. Le compilateur calcule uniquement les signaux
de paramètres constants par morceaux ; aucune trajectoire N/C n’est intégrée dans
le navigateur ou l’API. Les courbes et les indicateurs proviennent du runner C++.

- r = r0 × f_saison × exp(−ks(S−Sopt)²) ; r0 = 0,35 mois⁻¹ initialement.
- q = q0 × exp(betaP × P/10) ; q0 = 0,001 (effort·mois)⁻¹ dans le nouvel exemple.
- S/P/Sopt sont des indices dans [0,10], a une fraction dans [0,1], E un effort
  dans [0,10000]. βp est accepté de −10 à 10 ; zéro neutralise l’effet de pluie.
- S=3, Sopt=3, ks=0,05, P=0, βp=0,3, a=1, E=150 constituent les valeurs initiales.
- Les coefficients printemps/été/automne/hiver valent 1,15 / 1 / 0,85 / 0,7.
  Ils sont configurables, ainsi que tous les coefficients environnementaux, dans
  l’édition en lecture Scientifique. Les limites numériques sont des garde-fous
  logiciels documentés, pas des bornes écologiques validées.

Le mois est 1+floor(t)%12. Printemps : mois 1–3 ; été : 4–6 ; automne : 7–9 ;
hiver : 10–12. Les événements sont à 3, 6, 9, 12, 15… dans l’horizon simulé.
Ce calendrier et les réponses environnementales sont **des hypothèses pédagogiques
non calibrées**, sans description climatique validée du lac de Guiers. Le ciel,
les particules saisonnières, la pluie et la palette bleu→ocre de salinité sont
illustratifs ; la légende le précise. La biomasse reste globale au lac.

### Nouvelle structure JSON v3 facultative

Le graphe Schaefer de départ reste inchangé. Une extension de l’expérience ajoute :

```json
{
  "temporal": {
    "target": "lake",
    "scenario": "atelier:lake",
    "parameters": {
      "r0": 0.35, "q0": 0.001, "S": 3, "Sopt": 3, "ks": 0.05,
      "P": 0, "betaP": 0.3, "a": 1, "E": 150,
      "spring": 1.15, "summer": 1, "autumn": 0.85, "winter": 0.7
    },
    "fleet": {
      "mode": "balanced", "shares": [0.6, 0.25, 0.15],
      "initial": {"counts": [2, 1, 1], "utilization": [1, 1, 1]}
    },
    "fleetHistory": [],
    "interventions": [{
      "time": 10, "parameter": "P", "oldValue": 0, "newValue": 8,
      "unit": "index", "scenario": "atelier:lake",
      "provenance": "atelier: saisie explicite, interface Simulation"
    }],
    "provenance": "Hypothèses pédagogiques, réponses non calibrées."
  }
}
```

Cet extrait complète le document v3, il n’est pas un modèle autonome. `target`
désigne une occurrence couplée racine du graphe Schaefer reconnu, en tonnes/mois.
`scenario` conserve l’identité de la situation source. Chaque ligne d’intervention
porte instant, paramètre, ancienne/nouvelle valeur, unité, cible et provenance.
Les listes sont chronologiques ; une seule ligne par paramètre et instant.
Les anciennes valeurs sont vérifiées. Dates hors horizon, NaN, indices hors domaine,
unités incorrectes, références ambiguës et flotte incohérente sont refusés avant
exécution. Le JSON est conservé dans l’éditeur et sa sauvegarde locale après succès ;
**Enregistrer** et **Exporter l’expérience avec historique** incluent l’extension.

À date égale, tous les nouveaux coefficients sont évalués comme un seul état de
conditions. L’interface ordonne les lignes selon r0, q0, S, Sopt, ks, P, betaP, a, E,
printemps, été, automne, hiver. Deux paramètres distincts commutent : l’ordre des
lignes simultanées ne modifie pas les signaux résultants. Une nouvelle décision au
même instant remplace l’ancienne pour le paramètre concerné. Insérer une décision
plus tôt conserve les décisions futures absolues et recalcule leurs anciennes
valeurs ; les flottes futures sont remises en cohérence avec leurs efforts.

### Architecture des événements et recalcul

L’audit de `constant`, `qss3_wsum_2`, `qss3_multiplier` et des intégrateurs existants
permet de réutiliser le catalogue natif, sans nouveau composant atomique C++.
`web/packages/contracts/temporal.ts` compile chaque signal r/q/a/E en somme de
constantes différées : valeur initiale à t=0, puis différences à chaque date utile.
Une constante native émet une seule fois à son `offset`, puis devient passive.
Chaque entrée des sommes vaut zéro avant son émission. La chaîne finit sur le nom
public r/q/a/E, déjà relié aux équations Schaefer. Les changements simultanés se
propagent par les sacs DEVS à temps logique égal ; aucun temps physique ne s’écoule
pendant ces transitions. Les intégrateurs N/C et leurs paramètres X/dQ restent
intacts. Aucun stock spatial supplémentaire n’est créé.

L’API valide le document original, compile les événements, retire les métadonnées
d’unités, revalide le graphe et transmet ce JSON natif au runner. Les limites du
serveur s’appliquent également au graphe développé. Le runner construit et exécute
une simulation fraîche complète depuis l’origine ; ses sorties sont annotées avec
les unités du document original. Le protocole natif/catalogue et les sources C++
ne changent pas. Le champ `temporal` est une extension du contrat de l’API v3 :
pour exécuter directement avec le CLI historique, utiliser **Exporter le graphe
DEVS compilé**, plutôt que passer le JSON étendu brut au CLI.

Après réponse valide, le lecteur recherche la même observation X dans N et remet
le curseur à cet index, sans interpolation. Son seuil, son volume et ses réglages
restent en place. La lecture reprend si l’espace est encore actif et l’onglet
visible. Sans point de reprise, la réponse est refusée et l’ancienne vue conservée.
La borne finale est exclue par la convention du simulateur : aucune intervention
n’y est proposée. Les transitions saisonnières à la borne finale n’affectent pas
l’intervalle simulé. Pour le calendrier affiché et les dates saisies à partir du
curseur, un entier voisin à 32 epsilon × échelle près est reconnu comme le mois
exact (ex. 5,999999999999995→6). Aucun temps d’observation exporté ni N/C n’est modifié.

### Flottes, captures et animation

E = 50G uG + 30M uM + 20P uP. La composition équilibrée recherche un effort exact,
préfère les solutions entièrement utilisées lorsqu’elles existent, puis minimise
la somme des écarts au carré des proportions de **contribution** demandées ; le
nombre de bateaux départage les égalités. À E=150 et 60/25/15 %, elle sélectionne
2 grandes, 1 moyenne et 1 petite. Sinon, une catégorie peut être partiellement
utilisée : par exemple E=157 est représenté exactement, sans arrondir la demande.
Le mode minimum emploie ceil(E/50) grandes avec leur taux d’utilisation exact.
Le mode manuel permet les trois nombres et taux ; une discordance avec E bloque
l’application. Les capacités 50/30/20 et proportions initiales sont illustratives.

Le Canvas dessine chaque pirogue, selon sa catégorie, et conserve 1 poisson-symbole
par tonne arrondie. Pluie proportionnelle à P, eau selon S, saison et flotte suivent
les conditions au curseur ; les métriques et alertes suivent N/C natifs. Pause et
mouvement réduit figent les pixels. Aucun lissage visuel ne change les sorties.

Le graphique mensuel montre C(m)−C(m−1), avec une barre par mois entier de l’horizon.
Les deux bornes doivent exister, à l’arrondi machine près ; aucune interpolation
ou intégration du débit. Une borne absente, une valeur non finie ou un cumul
décroissant donne une valeur indisponible. Les mois incomplets/futurs enregistrés
sont estompés. La courbe de biomasse porte des repères verticaux d’intervention.
La comparaison conserve la trajectoire initiale en bleu et les captures mensuelles
initiales en contour. Un projet chargé avec historique recalcule sa référence sans
interventions une fois, dans le moteur ; un échec de référence est signalé.
Les graphiques scientifiques, tableaux, événements et exports existants sont conservés.

### Étude séparée : restauration complète QSS3

Restaurer seulement N(X) et C(X) ne restaure pas les polynômes quantifiés, dérivées,
dates internes et sorties déjà planifiées. Cette itération **ne revendique aucune
restauration exacte à partir de ces deux valeurs** et ne les réinjecte pas comme X
dans une simulation partielle.

Il existe déjà `simulation_snapshot` (`lib/include/irritator/core.hpp`) et ses copies
dans `lib/src/timeline.cpp`, ainsi que `simulation::operator=(snapshot)`. Ils copient
les modèles/dynamiques, ordonnanceur, messages, connexions, états événementiels,
observateurs, sous-simulations et temps courant. En revanche, la structure snapshot
n’embarque pas explicitement paramètres, limites, sources externes et machines à
états hiérarchiques comme le fait une simulation complète. Ce mécanisme mémoire
constitue une piste, pas un format de checkpoint HTTP portable et validé.

Un chantier séparé devrait : fixer une frontière après tous les sacs d’une date,
inventorier et versionner toutes les ressources/identifiants, capturer les sources
et générateurs aléatoires éventuels, définir les règles de remplacement des futurs
événements, puis comparer une continuation à une exécution ininterrompue pour chaque
dynamique et pour les wrappers. Aucune nouvelle route de restauration n’est exposée.

### Validation, preuves et fichiers

Recette finale sous Node 24.22.1, avec le runner Release C++ réel :

| Vérification | Résultat |
| --- | --- |
| Vitest frontend complet | 274 tests passent, 26 fichiers |
| API : backend, processus, intégration, unités et interventions | 51 tests passent |
| Chrome de production : interventions + ateliers existants | 10 parcours passent en 53,2 s |
| TypeScript frontend (`--noEmit --incremental false`) | Sans erreur |
| Compilation API et build Next de production | Sans erreur |
| `git diff --check` | Sans erreur |

Les tests couvrent calendrier sur plusieurs cycles et frontières, formules r/q et
βp signé, domaines des indices, E=150, efforts non multiples de 10, utilisation et
proportions, composition manuelle incohérente, historique simultané/réordonné,
insertion dans le passé, import/export v3, isolation de la cible et anciens projets.
La recette Chrome vérifie l’application à t=10, la reprise, les observations avant X,
la flotte/pluie/salinité au curseur, les barres mensuelles, les repères et la référence,
l’export exact de l’historique, les coefficients scientifiques, le mobile et un refus
HTTP conservant la pause. Elle vérifie aussi la préparation d’un vrai scénario E=260,
q0=0,0008 sans inférer ses facteurs de son numéro, et les sept parcours des itérations
précédentes (lecture, densité, son, plein écran, exports et décisions natives).

Les suites navigateur historiques hors atelier ne sont pas toutes rejouées. Aucun
lint séparé n’est revendiqué : aucun script lint n’est défini. Les temporisations
du contrôle automatique au lancement de la recette ont été résolues par une relance ;
aucune validation requise ne reste bloquée. Le fichier `next-env.d.ts` généré pendant
le build a été remis à son état initial. Le code C++ et ses binaires ne sont pas modifiés.

La preuve native `reports/iteration3-evidence/engine-interventions.json`
contient requête, graphe développé, référence et résultat modifié. Pour l’intervention
à 10 mois (P=8, S=6, a=0,7, E=80, βp=0,4), le maximum des écarts sur tout le préfixe
N/C est **0** sur ce runner ; à X : N=156,00885297694796 t et C=246,09054322672847 t,
identiques avant/après. Les pentes discrètes autour de X changent de −5,09449 à
−0,31349 t/mois pour N, et de 23,43681 à 12,01180 t/mois pour C. Ce sont des différences
d’observations espacées de 0,1 mois, pas des valeurs prétendues des dérivées exactes.

Captures locales : `reports/iteration3-evidence/01-edit-conditions.png`,
`02-after-intervention.png`, `03-fullscreen-intervention.png`,
`04-scientific-conditions.png`, `05-mobile-interventions.png`. Les preuves restent
ignorées par Git ; aucun commit ni push n’est effectué.

Fichiers nouveaux ou modifiés pour cette itération :

- Contrats : `web/packages/contracts/{temporal.ts,index.ts,units.ts,request-v3.schema.json}`.
- API : `web/apps/api/src/services/engine.ts`, `web/apps/api/tests/interventions.test.ts`.
- Exemple : `web/examples/atelier-interventions-month-v3.json`.
- Frontend : `app/workshop.css`, `components/editor/model-editor.tsx`,
  `components/simulation/{simulation-workspace.tsx,conditions-editor.tsx,monthly-catch-chart.tsx,biomass-lake.tsx,workshop-chart.tsx}`,
  `lib/modeling/model.ts`, `lib/simulation/{interactive.ts,monthly.ts}`,
  `tests/interventions.test.ts`, `tests/e2e/interventions.spec.ts`.
- Documentation : ce rapport et `README.md` du frontend.

Périmètre de cette première version : une occurrence couplée Schaefer racine isolée
par expérience temporelle, début 0, horizon ≤120 mois, et budgets de graphe 128
composants/512 connexions. Le compilateur refuse un dépassement sans tronquer
l’historique. Une situation prospective peut être isolée depuis les six scénarios
existants ; l’édition simultanée de plusieurs branches prospectives avec des
historiques distincts n’est pas exposée. Aucune calibration écologique, météo réelle,
répartition spatiale des poissons ou restauration QSS3 n’est revendiquée.

## Référence conservée — itération 2

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
