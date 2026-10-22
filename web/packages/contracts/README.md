# Contrats scientifiques v1 et v2

Les schémas JSON draft-04 sont exécutés par RapidJSON dans le runner et par Ajv
dans le service et l’éditeur. `request.schema.json` reste le schéma v1.
`request-v2.schema.json` ajoute la composition. Le catalogue global reste une
liste de **types atomiques natifs** ; les définitions couplées appartiennent
uniquement au document. Les enveloppes HTTP et résultats restent en version 1,
y compris pour une requête scientifique v2.

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
