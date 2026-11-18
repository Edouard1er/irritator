# Panneau « Ma façon de pêcher » — intégration du 18 novembre 2026

La Simulation utilise toute la largeur disponible sur ordinateur. Le panneau de
280 px reprend la composition de la référence et les verts de l’application
(`--accent`, `--accent-dark`), avec l’ambre déjà utilisé pour les accents.
Il reste visible pendant la lecture et remplit la hauteur disponible jusqu’au
bas de la zone visible, y compris en plein écran, sans défilement interne.
Un espacement plus compact conserve tout le contenu sur les écrans de 768 px.
Les styles sont isolés et activés à partir de 1100 px.

Les boutons « Modifier mes pratiques » et « Modifier les conditions » utilisent
exactement le même gestionnaire `openConditions`, le même instant `editing` et
la même instance de `ConditionsEditor`. Réactiver un bouton pendant l’édition
conserve le brouillon et replace le focus dans le formulaire. Le focus revient
au bouton d’origine après fermeture.

Les cartes affichent les pratiques par défaut du formulaire dès l’ouverture,
puis les pratiques appliquées avec succès à l’instant consulté, ou celles
restaurées depuis une annexe selon le fonctionnement existant
(validation lors de l’application ; Annuler abandonne l’import). Le panneau
utilise `practiceAt` et l’effort natif `conditionsAt(...).E` ; il ne recalcule
aucun facteur scientifique. Les champs dépendent de l’engin actif.

Conformément à la précision de l’utilisateur, la pratique par défaut vient de
`initializePracticeHistory`, exactement comme dans le formulaire existant :
1 pirogue non motorisée, 4 sorties/semaine, 6 h/sortie, toutes les pirogues,
2 filets de 50 m, mailles de 46 mm et immersion de 4 h. Aucune copie de ces
constantes n’est ajoutée au composant. L’effort reste celui du modèle.
Après import, si un effort modifié n’a aucune pratique correspondante,
`practiceAt` retourne un état indisponible : « Pratique à renseigner ».
Une annexe validée restaure les pratiques correspondantes.

Fichiers de l’intégration :

- `components/simulation/fishing-practice-sidebar.tsx` : cartes, état indisponible,
  bouton commun et effort en lecture seule.
- `components/simulation/simulation-workspace.tsx` : raccordement aux pratiques,
  au temps de lecture, au gestionnaire commun et au focus.
- `app/workshop.css` : thème, grille et pleine largeur sur ordinateur.
- `tests/e2e/fishing-sidebar.spec.ts` : quatre scénarios navigateur dédiés.

Vérifications :

- `npm run typecheck -- --incremental false`.
- `npm test -- --reporter=dot` : 337 tests existants.
- `npx playwright test tests/e2e/fishing-sidebar.spec.ts tests/e2e/fishing-practice.spec.ts tests/e2e/interventions.spec.ts tests/e2e/workshop-v31.spec.ts` : 12 tests passés pour le panneau, les annexes V1/V2 et les suites existantes de non-régression.
- Après l’ajustement final de hauteur sans défilement, les 6 tests du panneau et
  de `workshop-v31.spec.ts` ont été relancés et passent, ainsi que les 337 tests unitaires.
- Les parcours couvrent l’identité du formulaire et le clavier, 150 → 300 à
  3,8 mois, le retour en arrière, les trois engins, Annuler, les validations,
  un échec API, les annexes V1/V2, les comparaisons et les alertes sonores.
- Les suites existantes vérifient l’égalité exacte avec le rejeu natif C++/DEVS.
- Aucun débordement horizontal à 1366 × 768 et 1920 × 1080 ; contrôle
  supplémentaire de la pleine largeur à 2560 × 1440. Le bas du panneau est
  aligné au bas de la zone visible, en vue normale et en plein écran, sans
  débordement de son contenu et sans défilement interne.
- `npm run build` : réussi après le rappel de sécurité de la version Next.js
  installée. La commande recommande une mise à jour ; les dépendances restent
  inchangées dans cette intégration.
- `git diff --check`.

Captures : `reports/sidebar-pecheur-evidence/simulation-1366x768.png`,
`simulation-1920x1080.png`, `simulation-plein-ecran.png` et
`simulation-apres-intervention.png` depuis la racine
du dépôt. Les captures montrent de vraies sorties du moteur local.

Le moteur, les contrats JSON, `q`, les facteurs d’effort et les calculs n’ont pas
été modifiés. Aucun commit, push, merge ou changement de branche n’a été effectué.
