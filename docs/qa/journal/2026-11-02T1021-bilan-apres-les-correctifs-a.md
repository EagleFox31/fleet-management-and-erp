## Bilan après les correctifs #76 à #80

**Quoi**
- `PLAN_COUVERTURE_MODULES.md` : 16 lignes mises à jour. Passent OK : T8, VEH1, VEH2, VEH4, MNT1, MNT2, CAT1, PRT5, SUP1, SUP2, DRV1, FUEL1, FUEL2, MIS2 (déjà OK, mention du défaut retirée). Restent partiels avec défauts levés : PRT1 (variante et spécification sans route), DIR3 (exports hors carburant).
- `couverture-tests.html` versionnée : bilan 52 testés, 16 partiels, 3 non testés (ADM2, DRV2, P5), 2 à construire (DOC1, FUEL3), sur 73.

**Comment**
- Statuts déduits des `it.fails` retirés par commit (`git show <pr> -- tests`) : plus aucun `it.fails(` sous `tests/` ni `e2e/` sur `main` (67b1588), seul le garde-fou `it-fails-hygiene` cite le mot.
- PRT5 était couvert depuis #65 (`part-requirement-labels-hygiene`) sans que le plan soit mis à jour.

**Pourquoi**
- Le plan disait encore « Partiel, `it.fails` » pour des défauts corrigés : le bilan sous-estimait la couverture de 14 éléments.

**Preuve**
- Décompte du tableau `mods` de la page : `{ OK: 52, P: 16, F: 3, X: 2 }`. Preuves d'exécution des tests convertis : celles des PR #76 à #80 (unitaires 869/869, contrats rejoués, logs `scratchpad/logs/final80-*.log`).

