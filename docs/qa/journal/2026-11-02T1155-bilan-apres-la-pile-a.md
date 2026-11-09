## Bilan après la pile #81 à #86

**Quoi**
- `PLAN_COUVERTURE_MODULES.md` : T6, WO1, WO6, WO7, DIR2 passent OK (lignes encore en « Partiel » ou en `it.fails` après #86).
- `couverture-tests.html` : 62 testés, 7 partiels, 2 non testés (ADM2, DRV2), 2 à construire (DOC1, FUEL3), sur 73 ; PR #82 à #86 ajoutées, « Ce qui reste » et « Points ouverts » réécrits.

**Comment**
- Plus aucun `it.fails(` ni `test.fail(` sous `tests/` et `e2e/` sur `main` (hors le test d'hygiène qui les décrit).

**Preuve**
- Décompte du tableau `mods` de la page : `{ OK: 62, P: 7, F: 2, X: 2 }`.

