# Ajustement 2.1.1 — Lecture Pêcheur du territoire

Travail effectué sur `anim-simu`, sans commit ni push. Les modifications préexistantes de l'incrément 2.1 ont été conservées.

## Présentation livrée

- Le chargement GeoJSON et les commandes de préparation de la démonstration sont accessibles uniquement en lecture Scientifique. Ils ne figurent plus dans le DOM ni dans le parcours clavier de la lecture Pêcheur.
- La lecture Pêcheur conserve la carte sélectionnable, les trois informations principales et leurs valeurs/unités : poissons dans tout le lac, accès aux poissons et poissons accessibles dans cette zone.
- Un seul bandeau avertit : **« Carte de démonstration — zones fictives. »** Aucun avertissement supplémentaire n'est ajouté dans la légende ou le panneau latéral. Les noms des zones fictives restent ceux des données existantes.
- Les messages utilisent des formulations courtes : « Zone à confirmer », « Zone confirmée », « Valeurs illustratives ». L'état sans carte ne demande plus aux pêcheurs de sélectionner des fichiers.
- Les coordonnées WGS84, sources, identifiants, coefficients exacts, formules, paramètres et diagnostics détaillés restent dans la lecture Scientifique. Une erreur de chargement y conserve son détail ; la lecture Pêcheur affiche un message simple et garde le choix précédent.
- Les valeurs après calcul restent datées. Un choix différent des résultats disponibles est signalé sans jargon.

## Périmètre inchangé

La modification porte sur le rendu des deux composants territoriaux. Les données de démonstration, calculs de biomasse accessible, contrats JSON, validations, paramètres appliqués, équations, composants DEVS, moteur C++ et observations natives n'ont pas été modifiés par cet ajustement.

Le menu des niveaux, les espaces Modélisation/Simulation, les deux lecteurs, la confirmation de zone et l'exécution conservent leur fonctionnement. Changer de lecture ne remplace pas la carte et ne réinitialise ni sélection ni modèle. Le niveau 1 et ses composants n'ont pas été modifiés par cet ajustement.

## Fichiers de l'ajustement

- `components/territory/territory-workspace.tsx` : visibilité des commandes, textes et détails selon le public.
- `components/territory/territory-map.tsx` : légende adaptée, suppression des avertissements redondants.
- `tests/territory-components.test.tsx` : absence des commandes techniques côté Pêcheur, disponibilité côté Scientifique, valeurs inchangées et conservation de la sélection.
- `tests/e2e/levels-territory.spec.ts` : parcours adapté à la préparation scientifique, vérifications tactiles et nouvelles captures.
- Le présent compte rendu.

## Vérifications exécutées

- `npm run typecheck` : réussi.
- `npm test -- --reporter=dot` : **332 tests frontend réussis**, 29 fichiers ; inclut les tests scientifiques existants et les nouveaux contrôles de présentation.
- `npm run build` : build de production réussi.
- Playwright `workshop.spec.ts` et `workshop-v31.spec.ts` : **5 tests de non-régression du niveau 1 réussis**, avec moteur réel, animation, audio, grand écran, saisons, pluie, captures, export et lecture scientifique.
- Playwright `levels-territory.spec.ts` : **1 test réussi**, couvrant préparation scientifique, lecture Pêcheur simplifiée, sélection unique au clavier et au toucher, confirmations, conservation des modèles/scénarios/résultats/curseurs entre niveaux, export/réimport et rechargement.
- Formats **1024 × 900** et **390 × 900** : absence de débordement horizontal, passage entre les lectures, commandes géographiques réservées aux scientifiques et sélection tactile des deux zones vérifiés dans Chrome.

Le premier lancement du test territorial a reçu `503 ENGINE_BUSY` lors de la simulation initiale du niveau 1. Sa relance a réussi sans modification du moteur ou de sa configuration. Les cinq autres tests navigateur avaient réussi dès le premier passage. Les serveurs locaux existants sur 3100/3002 ont été réutilisés. Aucun changement scientifique n'a été nécessaire.

## Nouvelles captures

Les captures sont dans `reports/niveau2-2.1.1/` à la racine du dépôt. Les captures de l'incrément 2.1 sont conservées séparément.

- `territoire-pecheur.png` : navigation globale et lecture Pêcheur.
- `territoire-pecheur-complet.png` : carte et panneau Pêcheur complets, sans commandes techniques.
- `territoire-scientifique.png` et `territoire-scientifique-complet.png` : commandes GeoJSON/démonstration, détails de provenance et paramètres scientifiques.
- `territoire-pecheur-1024-complet.png`, `territoire-scientifique-1024-complet.png` : tablette.
- `territoire-pecheur-390-complet.png`, `territoire-scientifique-390-complet.png` : mobile.
- `zone-confirmee.json` : export effectivement réimporté par le parcours de test.

Les captures complètes déroulent temporairement les conteneurs pour montrer le contenu entier et masquent l'indicateur de développement de Next.js. Les données et les contrôles affichés sont ceux de l'application testée. Les valeurs de la démonstration restent 150 t, 10 % et 15 t ; elles n'estiment pas la biomasse réelle du lac de Guiers.
