# Lot 1.14 — Mode atelier et restitution visuelle des scénarios

Branche `anim-simu`, à partir du commit `31919de21da4821fc66caac9ce3f1ff9cad9dca7` (lot 1.13).

## Présenter une simulation

Dans **Niveau 2 — Lac de Guiers → Expérience logistique spatiale → Silhouette du lac**, activer **Mode atelier**. La carte affiche le nom du scénario, sa biomasse totale et l’évolution en tonnes depuis le mois 0. La lecture affiche le mois simulé. La légende indique la grandeur, ses unités et le sens des couleurs. La mention **Simulation expérimentale — données biologiques synthétiques** figure dans l’atelier, le plein écran et les exports.

1. Choisir **Biomasse initiale homogène** pour afficher la distribution de départ. Les raccourcis utilisent la grille 18 × 9 par défaut et conservent une grille 24 × 12 ou 48 × 24 déjà choisie.
2. Lancer **Lire**, puis utiliser **Pause**, le curseur temporel ou les pas d’observation pour choisir un mois. **Remettre au début** ramène au mois 0. La vitesse et la boucle restent réglables.
3. Cliquer sur une cellule ou rechercher son identifiant dans **Comparer les trajectoires**. **Consulter** synchronise sa sélection entre les deux cartes, les indicateurs et le graphique. **Ajouter** affiche jusqu’à trois courbes de cellules supplémentaires. Cliquer sur une sélection supplémentaire pour la retirer.
4. Choisir le gradient nord-sud à 0,3, le gradient pondéré par surface humide à 0,6 ou **Comparer homogène / gradient**. À grille identique, le mois, la sélection et le cadrage sont conservés. Les deux cartes utilisent la même légende.
5. Choisir **Exporter cette vue** pour télécharger le SVG ou sélectionner PNG. Désactiver **Mode atelier** pour retrouver les paramètres détaillés, les indicateurs du domaine, le tableau des mois 0, 10 et 20 et la trace JSON.

Les réglages de distribution et d’intensité deviennent actifs avec **Appliquer et simuler**. Chaque curseur distingue l’intensité proposée de l’intensité simulée. Un scénario déjà disponible en mémoire est réutilisé. La lecture, le cadrage, les palettes, le plein écran et le changement de mode fonctionnent sur les résultats existants.

## Captures

| Vue | Fichier |
| --- | --- |
| Atelier, distribution homogène au mois 0 | [Capture PNG](lot1-mode-atelier-captures/atelier-homogene-mois-0.png) |
| Atelier, comparaison au mois 10 en plein écran | [Capture PNG](lot1-mode-atelier-captures/atelier-comparaison-mois-10.png) |
| Export d’une carte homogène au mois 10 | [SVG autonome](lot1-mode-atelier-captures/export-homogene-mois-10.svg) |
| Export de la comparaison au mois 10 | [SVG avec zoom](lot1-mode-atelier-captures/export-comparaison-mois-10.svg), [PNG avec le cadrage entier](lot1-mode-atelier-captures/export-comparaison-mois-10.png) |
| Démonstration de la lecture, de la sélection, de la comparaison et de l’export (environ 10 s) | [Vidéo WebM](lot1-mode-atelier-captures/demonstration.webm) |

Le SVG reprend les observations validées ainsi que les totaux du mois affiché. La carte et le fichier partagent la projection, la découpe HydroLAKES, le cadrage et les fonctions de lecture et de couleur. Les attributs SVG conservent les valeurs numériques des cellules, des totaux et de l’échelle. Le PNG rasterise ce même SVG à deux fois sa taille.

## Vérifications

| Suite | Résultat |
| --- | --- |
| Build TypeScript de Fastify et build Next.js de production | Réussis |
| Vitest frontend | 648 tests réussis |
| Fastify, gestion des processus et intégration au runner | 52 tests réussis |
| Runner natif et campagnes logistiques des lots précédents | 130 tests réussis |
| Playwright sur Chrome 158, build de production | 17 parcours réussis, dont les 2 nouveaux parcours d’atelier |

La validation utilise Node.js 26.13.0 et le runner Release du lot 1.13 (SHA-256 `A919DFDFB99B83242E42FB7C023D4AFCCC94C53B0E0DDC7B308F59D40EEF902B`). Les changements concernent la restitution frontend. Les modèles, les plafonds du runner et le contour HydroLAKES sont ceux du commit de départ.

Les parcours d’atelier vérifient les requêtes de préparation et les appels natifs pendant les changements de présentation. Ils comparent un total, la valeur d’une cellule riveraine et sa couleur dans le SVG aux réponses natives et à la carte affichée. Ils vérifient aussi le mois commun au graphique et aux cartes, les unités des légendes, le téléchargement PNG à 2 720 × 1 880 px et la recherche parmi 296 cellules.

À ×4 sur deux cartes 48 × 24, le test a compté 100 mises à jour en 2,2 s, avec un intervalle maximal de 68,6 ms. Les deux cartes et le marqueur du graphique ont indiqué le même mois à chaque mise à jour.
