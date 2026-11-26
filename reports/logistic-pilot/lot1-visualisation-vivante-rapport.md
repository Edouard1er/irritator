# Lot 1.13 — Visualisation vivante du lac de Guiers

Branche `anim-simu`, à partir du lot 1.12 (`a9427314`).

## Parcours d’atelier

Dans **Niveau 2 — Lac de Guiers → Expérience logistique spatiale → Silhouette du lac**, choisir la grille et la distribution, puis lancer la simulation. Le mois affiché pilote la carte, les indicateurs et les trajectoires. L’intervalle de lecture nominal entre deux observations de 0,1 mois est de 90 ms à ×1, 45 ms à ×2 et 22,5 ms à ×4. Si le navigateur prend du retard, la lecture rejoint une observation native plus récente. Les commandes permettent de parcourir les observations une par une, de revenir au début et de boucler après le dernier mois. Quitter le mode met la lecture en pause. Les changements de carte et de cadrage sont instantanés, y compris avec la préférence de mouvement réduit.

**Comparer deux scénarios** ajoute une carte sur la même grille. La résolution, le mois, le cadrage et la cellule sélectionnée sont communs. Chaque carte indique sa biomasse totale. L’interface calcule l’écart signé en soustrayant le total de gauche à celui de droite. Le scénario comparé peut choisir sa propre distribution et sa propre intensité. Pour une cellule riveraine très petite, le sélecteur par identifiant et le repère au centroïde humide facilitent le repérage.

Au survol ou à la sélection, la carte indique la surface humide, la biomasse initiale, la biomasse observée, ses gains en tonnes et en pourcentage, sa densité et le rapport à sa capacité. Les indicateurs pour l’ensemble du lac affichent le total, son gain depuis le mois 0 et la part de la capacité atteinte. Le graphique utilise deux axes en tonnes pour rendre lisibles à la fois le total et les trajectoires locales. Il met en évidence la cellule sélectionnée et accepte jusqu’à trois cellules supplémentaires.

## Grandeurs et échelles

| Affichage | Calcul à partir des observations | Échelle commune aux cartes |
| --- | --- | --- |
| Biomasse / capacité | `100 × Bᵢ(t) / Kᵢ` | 0 à 100 % |
| Densité de biomasse | `Bᵢ(t) / Aᵢ`, avec `Aᵢ` la surface humide | 0 à 300 t/km² |
| Écart au scénario homogène | `100 × [Bᵢ(t)/Kᵢ − Bᵢ,hom(t)/Kᵢ,hom]` | Échelle divergente symétrique en points de pourcentage |

L’échelle fixe des écarts utilise le maximum absolu des scénarios affichés sur leurs 201 dates. L’option ajustée au mois recalcule ce maximum sur l’instant consulté et améliore la lisibilité près de la capacité. La légende indique l’option active, les bornes et la référence. Si la série homogène de la grille manque, l’interface demande de la simuler et marque les écarts comme indisponibles.

Le curseur et les marqueurs du graphique se placent sur les observations natives. Les traits des courbes relient ces observations et le survol du graphique affiche une date observée. Les détails scientifiques et les diagnostics de validation restent accessibles dans le panneau de cellule et la trace JSON.

## Réutilisation des simulations

Le navigateur conserve au plus trois jeux complets validés, identifiés par résolution, distribution et intensité. Lorsqu’un nouveau jeu prend la place d’un ancien, le cache privilégie les deux scénarios affichés et leur référence homogène. Les trois totaux historiques à 0, 10 et 20 mois restent disponibles dans le tableau récapitulatif. Un jeu complet évincé peut être simulé à nouveau. Changer de carte, d’échelle ou de mois réutilise les observations présentes en mémoire.

Un scénario manquant peut être lancé explicitement. Une erreur de préparation ou de calcul affiche le diagnostic et permet de réessayer. Un lot natif incomplet ou incohérent est rejeté avant publication des séries.

## Vérifications

| Suite | Résultat |
| --- | --- |
| Build TypeScript de Fastify et build Next.js de production | Réussis |
| Vitest frontend | 646 tests |
| API Fastify, gestion des processus et intégration avec le runner | 52 tests |
| CLI et campagnes logistiques, dont la référence continue du lot 1.12 | 130 tests |
| Playwright Chrome 158, parcours logistiques | 15 parcours réussis sur le build de production |

Les vérifications ont utilisé Node.js 26.13.0 et le runner Release `build-web-test8p-bis/Release/runner/irritator-runner.exe` (SHA-256 `A919DFDFB99B83242E42FB7C023D4AFCCC94C53B0E0DDC7B308F59D40EEF902B`). Les builds ont été exécutés dans des copies locales isolées pour contourner les permissions des anciens répertoires générés.

Le parcours Playwright de comparaison vérifie les deux séries de 296 cellules à partir de 34 réponses natives, les valeurs et unités des trois cartes, les échelles fixe et ajustée, la sélection par identifiant, les totaux et l’état en plein écran. Il a compté 101 mises à jour du mois en 2,2 s à ×4, avec un intervalle maximal de 25,8 ms entre deux mises à jour. Les deux cartes et le marqueur du graphique ont affiché le même mois à chaque mise à jour. Les tests de lecture sur horloge contrôlée couvrent les trois vitesses, la pause, la boucle et la désactivation du mode.

## Captures

Les cartes montrent la distribution homogène à gauche et le gradient pondéré par surface humide à droite, avec α = 0,6, sur la grille 48 × 24. L’écart initial de l’ordre de 10⁻¹¹ t correspond à l’arrondi de la somme des observations natives. Les deux cartes affichent 45 000 t au mois 0.

| Mois | Affichage | Capture |
| ---: | --- | --- |
| 0 | Biomasse / capacité | [Voir la capture](lot1-visualisation-vivante-captures/48x24-ratio-t0.png) |
| 10 | Densité de biomasse | [Voir la capture](lot1-visualisation-vivante-captures/48x24-density-t10.png) |
| 20 | Écart au scénario homogène, échelle ajustée | [Voir la capture](lot1-visualisation-vivante-captures/48x24-difference-t20.png) |
| 10 | Trajectoires du lac et de la cellule sélectionnée | [Voir la capture](lot1-visualisation-vivante-captures/48x24-trajectoires-t10.png) |

La démonstration de 7 s montre la lecture à ×4 et le passage entre les trois affichages en plein écran. [Voir la vidéo WebM](lot1-visualisation-vivante-captures/demonstration.webm)
