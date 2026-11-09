## 2026-11-07T16:43:49+01:00 — Pneus : les lectures lèvent une erreur au lieu de renvoyer du vide, garde d'hygiène

- **Agent** : de (fleet-testeur) · **Branche** : `fix/tire-reads-swallowed-errors` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : suite de #591. Huit lectures pneus attrapaient l'erreur de base et renvoyaient `[]`, `{ tires: [], total: 0 }` ou des zéros :
  - dans `tires-service-simplified` : `getTires`, `getAllVehicleTires`, `getVehicleTires`, `getTireInspections`, `getTireRotations`, `getTireStatistics`, `getLowStockTires` ;
  - dans `storage` : `getTireRotationsForWorkOrder`.

  La route répondait 200 et l'écran affichait « aucun pneu ». Le bouchon `getTireAlerts` (`return []`, sans appelant) est retiré.
- **Comment** :
  - chaque lecture journalise par `moduleLogger` et relance `AppError(500, …, { cause })`. Les `console.*` de ces méthodes sont migrés, aucun n'est supprimé ;
  - consommateurs vérifiés : toutes les routes appelantes ont un catch qui répond 500 (`next(error)` pour les rotations d'un OT) ;
  - écrans : un repli `= []` ou `?? 0` changeait le 500 en faux vide. Le tableau de bord magasin, /inventory/tires (montés, inspections, rotations) et le dialogue de montage passent par `queryView` : « Indisponible » et « Réessayer » en échec sans données, cache conservé, montage bloqué tant que les positions occupées sont inconnues. Les autres écrans pneus relèvent d'un lot séparé ;
  - nouvelle garde AST `tests/unit/server/swallowed-read-catch-hygiene.test.ts`, sur le modèle de `swallowed-write-catch-hygiene`. Elle vise un catch sans `throw` qui renvoie `[]`, `{}`, `0` ou un objet de vides. Les 48 cas existants hors pneus sont gelés (cliquet) et aucune entrée pneus n'est admise.
- **Comment tester (QA)** :
  - `tests/unit/server/tire-reads-error.test.ts` : rouge avant le correctif (les 7 du service en un passage, puis le cas `storage`) ; 8 sur 8 verts après ;
  - garde rejouée sur le code d'avant : rouge sur exactement les 8 lectures pneus ; verte après ;
  - `tests/unit/client/tire-reads-error-states.test.ts` : branchement des trois écrans rouge avant, vert après ; Playwright sur /warehouse/dashboard avec low-stock forcé en 500 ;
  - contrats pneus sur Postgres local (8 fichiers, 165 tests) : verts ;
  - campagnes : tsc 0, check:tests 0, unitaires 307/307 fichiers.
- **RAIDER** :
  - R : `AppError` et `moduleLogger` existants, garde calquée sur celle des écritures ;
  - D : réponse inchangée en cas de succès, contrats verts ;
  - E : aucun détail technique dans les messages ;
  - failure memory : leçon du 2026-11-07 dans `LESSONS_LEARNED.md`.

  Ne s'appliquent pas : A, I, Retroactive.
- **Reste / risques** : 48 cas gelés hors pneus, dont 29 dans `storage.ts`. Certains écrans affichent encore une liste vide sur un 500 (comportement déjà présent avant ce lot) ; seule /inventory/tires a un état d'erreur.

