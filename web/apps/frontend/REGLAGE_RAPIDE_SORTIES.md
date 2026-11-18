# Réglage rapide des sorties — ordinateur

Implémentation des deux fichiers lus intégralement dans l’archive `IRRITATOR_REGLAGE_RAPIDE_SORTIES_DESKTOP.zip`.

## Comportement

La carte « Ajuster mes sorties de pêche » se trouve dans la colonne centrale, après le résumé des conditions et avant les indicateurs. Elle distingue le choix préparé de l’effort appliqué dans le panneau gauche. Le panneau gauche et les graphiques existants sont conservés.

Conformément à la précision demandée pendant l’implémentation, le début d’une manipulation de la jauge met d’abord l’animation et le son en pause : appui du pointeur, modification au clavier, changement de valeur ou bouton « Habitude ». La préparation ne lance aucun calcul moteur. « Appliquer » utilise le temps natif consulté, puis reprend l’animation après le succès du recalcul. Une erreur conserve la simulation précédente et le brouillon, en pause.

L’aperçu passe par `normalizeFishingEffort`, le calcul V2 déjà utilisé par `ConditionsEditor`. Le projet copie `practiceAt(t)` et remplace seulement `tripsPerWeek`. Les deux parcours partagent le même traitement `applyIntervention`, qui utilise `applyFishingPractice`, `intervene`, les validations natives et l’API existante. Aucune nouvelle formule d’effort ou de biologie n’est introduite.

Les trois accès (« Personnaliser » de la carte, « Personnaliser » du résumé et « Modifier mes pratiques » du panneau gauche) appellent exactement `openConditions` et ouvrent une seule instance du formulaire existant « Modifier les conditions ». L’ouverture du formulaire abandonne explicitement le brouillon rapide. Un changement de temps le réhydrate depuis la pratique applicable et signale l’abandon de l’aperçu précédent.

## Pratique habituelle et sauvegarde

`PracticeHistory.habitualPractice` est une métadonnée d’interface facultative, distincte de `reference` et de l’effort scientifique de normalisation. Elle est confirmée par une case explicite dans le formulaire complet et retenue seulement après succès moteur. Une habitude positive n’est remplacée ni par une intervention rapide, ni par une autre décision, ni par un retour dans le temps. Une habitude à zéro désactive le réglage rapide ; le formulaire permet de confirmer une pratique positive pour l’établir.

Avant cette confirmation, la pratique technique explicite du scénario sert de **repère proposé**, sans être présentée comme une déclaration du participant. Une intervention rapide ne la confirme jamais automatiquement. Une pratique absente ne se déduit pas de E.

La métadonnée est conservée dans l’annexe V2 existante, sans nouvelle version d’enveloppe et sans ajout au JSON scientifique v3. Les annexes V1/V2 sans ce champ restent acceptées ; elles retrouvent un repère proposé. Il faut conserver l’annexe des pratiques avec le JSON de l’expérience pour retrouver l’habitude après import, comme pour les autres champs de pratique V2.

Le centre est fixe, de zéro à deux fois la fréquence habituelle. Une référence fractionnaire conserve sa valeur exacte et autorise des écarts entiers depuis cette valeur, ainsi que les bornes exactes. Le clavier prend en charge les flèches, Début et Fin. Les valeurs affichées sont formatées ; les données transmises et les temps natifs ne sont pas arrondis.

## Vérifications

- 356 tests unitaires frontend réussis, dont les cas de calcul, fréquence fractionnaire, zéro, configuration invalide, limites moteur, absence de pratique, abandon et échec.
- TypeScript réussi avec `npm run typecheck -- --incremental false`.
- 101 tests API réussis contre le runner C++ existant.
- Build de production réussi après relance : la version Next.js déjà installée a émis son avertissement de sécurité. Les dépendances et fichiers de verrouillage n’ont pas été modifiés.
- 17 scénarios navigateur validés : scénario 4 sorties/E150 → 8 sorties/E300 à l’instant natif proche de 3,8 ; retour à 4/E150 à l’instant proche de 10,3 ; remplacement au même instant ; maintien des décisions futures absolues ; retour dans le temps ; absence de requêtes et de modification des courbes pendant l’aperçu ; pause avant manipulation et reprise après application ; erreurs API ; formulaire partagé ; sauvegarde/restauration ; filets, lignes et sennes ; alertes et son.
- La première exécution groupée a validé 15 scénarios sur 17. Les deux autres ont réussi à la relance : le scénario historique E150→E300→E100 avait reçu une réponse temporaire `ENGINE_BUSY` ; le test plein écran a été adapté pour faire défiler les commandes sonores avant de vérifier leur présence à l’écran, puisque la carte supplémentaire allonge la page. Les commandes et les dimensions des graphiques sont conservées. Journaux : `quick-trips-browser-final.log` et `quick-trips-browser-recheck.log`.
- Pour chaque engin, les requêtes rapides et celles du formulaire complet identique produisent les mêmes observations C++, comparées avec une tolérance de zéro.
- Largeurs 1366×768 et 1920×1080 vérifiées sans débordement horizontal ; aucune adaptation mobile/tablette ajoutée.

Journaux dans `reports/quick-trips-*.log`. Captures et preuve numérique dans `reports/quick-trips-evidence/` :

- `01-apercu-1920x1080.png`, `02-apercu-1366x768.png` : préparation de 8 sorties/E300, état appliqué encore à 4/E150.
- `03-applique-1920x1080.png`, `04-applique-1366x768.png` : intervention appliquée, panneau gauche à 8/E300, habitude toujours à 4.
- `native-equivalence-and-history.json` : requêtes, réponses, référence habituelle et historique.

## Fichiers concernés

- `components/simulation/quick-fishing-trips.tsx` : carte de préparation et interactions.
- `components/simulation/simulation-workspace.tsx` : intégration, pause et application commune V2.
- `components/simulation/conditions-editor.tsx` : confirmation de la pratique habituelle dans le formulaire existant.
- `lib/simulation/fishing-effort.ts` : conservation et validation de la métadonnée habituelle, calculs V2 inchangés.
- `app/workshop.css` : styles de la carte et de la confirmation.
- `tests/quick-fishing-trips.test.tsx`, `tests/e2e/quick-fishing-trips.spec.ts` : nouveaux tests.
- `tests/e2e/fishing-practice.spec.ts`, `fishing-sidebar.spec.ts`, `interventions.spec.ts`, `workshop-v31.spec.ts` : sélecteurs adaptés au libellé « Personnaliser » et défilement du test plein écran, scénarios de non-régression conservés.

Les modifications locales préexistantes du panneau gauche sont conservées. Aucun changement au C++/DEVS/QSS3, aux coefficients V2, au contrat v3, aux graphiques ou aux alertes. Aucune branche, aucun commit, push ou merge créé.
