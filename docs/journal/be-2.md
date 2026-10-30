# Journal — Backend 2 (`be-2`)

Worktree : `../fm-be-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T14:00:00+01:00 — T-23a — Règle de double affectation

- **Agent** : be-2 · **Branche** : `lot/be/T-23a-double-affectation` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : un technicien ou un véhicule ne peut plus être sur deux OT actifs qui se chevauchent ; la règle est prête, le branchement sur les routes OT reste T-23b.
- **Comment** : `server/services/work-order-booking.ts`. `findBookingConflicts(candidate, existing[])` (pure, réutilise `bookingsOverlap`, `[from, to)`, fin absente = ouvert, exclusion de soi par `id`, statuts `BOOKING_ACTIVE_STATUSES`), `loadActiveOrders(executor, technicianId, vehicleId)` (colonnes `start_date`/`end_date`, filtré en base), `bookingGuard(candidate, deps?)` qui lève `BookingConflictError` (409, code `CONFLICT`). Build (règle métier propre, rien à adopter).
- **Pourquoi** : P-08 / PR-10, plan 04-backend T-23a.
- **API pour T-23b (api-2)** : `await bookingGuard({ id, technicianId, vehicleId, from: startDate, to: endDate }, { executor: tx })` avec le corps fusionné à la ligne existante, avant l'écriture. L'erreur porte `conflicts` et `details: { conflicts }`. `AppError.details` (T-08) n'est pas encore poussé (seule `origin/lot/sol/T-02-contrats` existe) : le gestionnaire central ne renvoie donc pas encore `conflicts` ; en attendant, l'intercepteur répond avec `conflictResponseBody(err, req.requestId)` (conforme à `bookingConflictResponseSchema`). Un OT sans `startDate` n'occupe aucun créneau.
- **Comment tester (QA)** :
  - Prérequis : aucun (unitaire).
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/work-order-booking.test.ts` → `12 passed`. `tsc --noEmit` : 0 erreur.
- **RAIDER** : R/A règle pure indépendante du routeur ; I lecture seule ; D aucun fichier existant modifié ; E contrat figé respecté. Failure memory : sans objet.
- **Reste / risques** : course lecture-avant-écriture actée en ADR ; branchement T-23b ; `details` dépend de T-08.
