# Journal — API 2 (`api-2`)

Worktree : `../fm-api-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T15:57:44+01:00 — T-23b — Garde de double affectation sur les OT

- **Agent** : api-2 · **Branche** : `lot/api/T-23b-booking-guard` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : créer ou déplacer un OT sur le créneau d'un technicien ou d'un véhicule déjà pris répond 409 `CONFLICT` avec la liste des chevauchements, sans écriture.
- **Comment** : `server/middleware/booking-guard.ts` (corps fusionné avec la ligne existante, appel de `bookingGuard` de T-23a), monté dans `server/api/index.ts` (3 lignes, fichier SOL, prévu par le plan T-23b) avant les autres routeurs `/work-orders`. Sans session ou PATCH sans changement de ressource, créneau ou statut : passe la main. Branche basée sur T-23a, T-08 fusionné.
- **Pourquoi** : P-08, double affectation.
- **Comment tester (QA)** :
  - Prérequis : compte chef d'atelier, un OT actif avec technicien et créneau.
  - Étapes : 1. Créer un OT pour le même technicien sur un créneau qui chevauche. 2. Déplacer un autre OT sur ce créneau. 3. Modifier la description d'un OT.
  - Attendu : 409 avec `conflicts[]`, rien d'écrit ; 409 ; 200.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/work-order-booking-guard.contract.test.ts` → 1 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert non-régression (PATCH neutre intact), idempotence ; sans objet : migration.
- **Reste / risques** : le plan parle de `errors[]`, le contrat figé porte `conflicts` : contrat suivi. Course résiduelle lecture/écriture actée en ADR.
