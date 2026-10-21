# Décision de représentation — Test 4

Décision prise avant le développement du runner, le 21 octobre 2026.

Le moteur observé est libirritator 0.1.0, branche for-web-ui, commit
58cf7fd4, avec les corrections locales du Test 3 dans core.hpp et simulation.cpp.

## Option A : format natif

`generic_component` contient des enfants atomiques (`dynamics_type`) ou couplés
(`component_id`), leurs `children_parameters`, des connexions internes et des
connexions aux ports du composant. `modeling` gère ces composants et leur catalogue
de fichiers. Les exemples `examples/diffusion/cell.irt` et `grid.irt` sont du JSON
natif : enfants, identifiants numériques, unique-id, dynamics, ports et références
aux fichiers du catalogue. `json_dearchiver` (io.hpp/json.cpp) sait charger un
composant ou un projet en mémoire, mais exige `file_access` et `component_access`.
`project::set`/`rebuild` (project.cpp) déplie la hiérarchie, remappe les identifiants,
copie les paramètres et construit les connexions de `project::sim`. Cela sera
utile pour importer des bibliothèques/projets existants. Le format n'est pas
directement un document HTTP autonome, borné et limité au catalogue autorisé.
Un composant simple plat peut toutefois être chargé en mémoire avec un catalogue
vide, puis converti par project::set : cette option est techniquement possible.
Elle imposerait ici de filtrer aussi les sources externes et les autres types
natifs, et de transporter les métadonnées et identifiants propres au format natif.
Le choix B réduit ce contrat public ; il ne remédie pas à une impossibilité du
chargeur natif. Construire un generic_component en mémoire serait également une
étape possible pour ajouter ensuite des compositions hiérarchiques.

## Option B retenue pour v1

Un graphe atomique autonome avec identifiants stables, paramètres nommés,
connexions orientées et observations, versionné par schemaVersion=1.
Le runner réutilise RapidJSON du dépôt et les véritables objets du moteur :
alloc<T>, parameters.set_constant/set_integrator, simulation.connect (la même
implémentation appelée par connect_dynamics), observe, initialize, run, finalize,
tick_resamplers, read_history. Aucun algorithme DEVS n'est réécrit.
Le format ne dépend d'aucun cas scientifique ; le catalogue de constructeurs est
explicitement limité. Pas d'import .irt/.pirt, de hiérarchie ni de wrapper annoncé
en v1. Les cycles ne sont pas interdits ; le budget d'appels et le timeout
protègent les graphes ne progressant pas.

Le schéma et le catalogue applicatifs sont partagés et embarqués dans le runner
par CMake. Les deux frontières valident les données ; les erreurs natives de
connexion/initialisation/exécution sont conservées (catégorie et code).

## Suite : simulation_wrapper

L'infrastructure native n'est pas un chargeur autonome de JSON imbriqué :
simulation_component référence un projet .pirt via file_path_id. Ses facteurs et
sélections utilisent unique_id_path. assign(project&&) prépare les références ;
copy_to(embedded_simulation&) copie le moteur, résout les chemins en model_id et
copie le plan et l'objectif. project.cpp make_tree_simulation_leaf remappe le
component_id en embedded_simulation_id et dimensionne x=F+2 et y=S+F.
json.cpp write_simulation_component sérialise path/directory/file, factors,
selections et objective. Réutiliser ce chemin exige un catalogue serveur maîtrisé
et des références validées ; accepter des chemins locaux HTTP serait inadéquat.

Une prochaine version devra définir un document autonome de modèles nommés,
références imbriquées, facteurs (single/fixed/random et variantes add/mult),
sélections (min/max/min_last/max_last), objectif (simple/weighted_sum/epsilon),
mode (complete/bag/time/until/during) et connexions parent-wrapper. Traduire ces
données vers simulation_component/embedded_simulation existants, avec budgets de
produit cartésien, profondeur, mémoire et calcul enfant. Les ports actuels et le
double rôle temporel du message x1 doivent être conservés. Ne pas confondre une
condition initiale et un checkpoint vivant. Les limites du Test 3 (plan sans
candidat silencieux, indices de critères creux, pas d'observation du wrapper
inutilisé) devront être explicites dans le contrat. Aucune modification du wrapper
ni nouvelle orchestration scientifique Node n'est nécessaire dans le Test 4.
