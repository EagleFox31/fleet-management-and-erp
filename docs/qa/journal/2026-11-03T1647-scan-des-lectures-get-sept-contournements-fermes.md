## 2026-11-03 16:47 — Scan des lectures GET : sept contournements fermés (#176)

- **Quoi** : `tests/support/route-guard-scan.ts` refuse désormais sept formes qui le trompaient. Chaque refus reste en échec fermé.
  - A : un alias d'import (`authenticate as isStaff`) vaut la garde d'origine.
  - B : une garde connue redéclarée localement (`const`, `function`) sans être reclassée devient permissive.
  - C : un `router.use(garde)` ne couvre que les routes déclarées après lui.
  - D : un répartiteur `sessionGuard` qui appelle `next()` en direct est permissif.
  - E : un marqueur de cloison placé dans une chaîne ou un gabarit ne compte pas.
  - F : une réponse 4xx ou 5xx dont le corps n'est pas un message littéral compte comme un envoi de donnée.
  - G : `ownerScopeOf` ou `canAccessOwned` dont le résultat est jeté ne compte pas.
- **Où** : fixtures dans `tests/unit/server/route-guard-scan-bypass.test.ts`, avec 11 contournements refusés et 8 formes saines acceptées.
- **Pourquoi** : la poc #176 montrait qu'une route ouverte au client pouvait passer le garde-fou sans aucune cloison.
- **Preuves** :
  - sur le code réel, les offenders sont identiques à `OPEN_GET_READS_FROZEN` (aucun ajout, aucun retrait) ;
  - avec le scanner de main, le test échoue sur 11 cas (les 10 contournements et l'alias sain) ;
  - tsc 0.

