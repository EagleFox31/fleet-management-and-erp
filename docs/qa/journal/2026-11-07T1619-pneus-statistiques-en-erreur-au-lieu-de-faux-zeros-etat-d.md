## 2026-11-07T16:19:50+01:00 — Pneus : statistiques en erreur au lieu de faux zéros, état d'erreur de la page

- **Agent** : de (fleet-testeur) · **Branche** : `fix/tire-stats-error-state` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : sur `/inventory/tires` (compte magasinier), `getTireStatisticsAdvanced` avalait toute erreur de base et renvoyait 200 avec des zéros. Après 10 s d'attente d'une place dans le pool, la page affichait « 0 pneu, valeur 0 » sans message. La page n'avait pas non plus d'état d'erreur.
- **Comment** : le service journalise par `moduleLogger` et relance `AppError(500, …, { cause })`. Le catch de la route existante (`routes.ts:3498-3505`, non modifié) répond lui-même 500 : l'utilisateur voit le message générique et la référence, pas le message de l'AppError. La requête des statistiques passe par la queryFn par défaut, qui produit une ApiError avec ce message et la référence. `tiresPageState` (`client/src/lib/tires-page-state.ts`) choisit entre chargement, erreur et prêt :
  - seule une requête **sans données** est en erreur : une relance qui échoue (temps réel, pool saturé) garde la liste et ses dialogues ouverts ;
  - si la liste est en échec, toute la page affiche `LoadingError` (`userMessageOf` et « Réessayer ») ;
  - si seules les statistiques sont en échec, un encart remplace les tuiles et la liste reste visible ;
  - « Réessayer » est désactivé pendant un nouvel essai (`isRetrying`, prop optionnelle de `LoadingError` et `AnimatedError`).
- **Comment tester (QA)** :
  - `tests/unit/server/tire-statistics-advanced-error.test.ts` : rouge avant le correctif, deux échecs (« expected { Object (totalTires, …) } to be an instance of AppError »), vert après ;
  - `tests/unit/client/tires-page-state.test.ts` : après la relecture, 6 échecs sur 7 avant le correctif, dont « liste en cache et relance en échec » (la page passait en erreur) ; 7 sur 7 verts après ;
  - Playwright local, compte warehouse : page normale, puis statistiques forcées en 500, où l'encart d'erreur affiche la référence et le bouton « Réessayer ».
  - Campagnes : tsc 0, check:tests 0, unitaires 305/305 fichiers (3178 tests). prefix-middleware-guardrail est instable sous charge (un échec à la première campagne, vert seul et à la seconde).
- **RAIDER** : R (`LoadingError` et queryFn existants) ; D (réponse inchangée en cas de succès) ; E (pas de détail technique dans le message, log migré, non supprimé). Ne s'applique pas : A, I, Retroactive.
- **Reste / risques** : d'autres méthodes du même service renvoient du vide en cas d'erreur (`getTires`, `getAllVehicleTires`, `getVehicleTires`, `getTireInspections`, `getTireRotations`, `getTireStatistics`, `getLowStockTires`, `getTireAlerts`). Elles sont signalées pour un lot séparé. Les 5 requêtes parallèles de statistics-advanced pèsent sur le pool : un regroupement en une seule requête SQL est prévu après la fusion.

