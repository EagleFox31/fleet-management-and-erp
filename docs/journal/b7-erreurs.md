# Journal b7 — chantier erreurs et logs

Modèle et règles : `docs/journal/README.md`.

## 2026-11-03T14:35:07+01:00 — Réserves de #172 — 500 locaux et garde-fou

- **Agent** : b7 · **Branche** : `fix/error-log-500-reserves`
- **Statut** : fait
- **Quoi** : les 5 réponses 500 restantes (client créé, mis à jour, archivé ou restauré « mais introuvable » ; renouvellement rapide non finalisé) passent par le gestionnaire central. Elles tracent une ligne avec `requestId` et renvoient le corps commun `{ message, code, requestId }`.
- **Comment** :
  - `server/api/clients.routes.ts` : `throw new AppError(500, …)` dans le try. Le catch relaie l'AppError telle quelle. Aucune garde de rôle touchée (lot 3 de aa).
  - `server/api/document-renewals.routes.ts:1198` : `return next(new AppError(500, …))` et non `throw`. Le catch supprimerait le justificatif alors que le document le référence déjà, puisqu'il a été mis à jour avant.
  - 10 ternaires `x instanceof AppError ? x : …` retirés parce que la ligne précédente relaie déjà l'AppError. Ceux qui restent sont utiles : leur catch n'a pas cette garde.
  - Garde-fou : `tests/unit/server/error-500-relay-hygiene.test.ts`. Adopt du modèle de `routes-hygiene.test.ts`.
- **Pourquoi** : réserves du relecteur sur #172 (AGENTS.md §10 : une erreur, une trace, jamais de détail technique dans la réponse).
- **Comment tester (QA)** :
  - Prérequis : aucun.
  - Étapes : lancer le test unitaire ci-dessous.
  - Attendu : 20 tests passés. Sans le correctif, 5 tests échouent.
  - Preuve automatisée : `npx vitest run tests/unit/server/error-500-relay-hygiene.test.ts` → `20 passed`.
- **RAIDER** :
  - couvert : D (statuts HTTP inchangés, contrats verts), E (§10) et Failure memory (garde-fou exécutable) ;
  - ne s'applique pas : A, I et R (rétroactif), car rien ne change en base ou à distance.
- **Reste / risques** : les sites « log puis 500 » de `missions.routes.ts` attendent la fin du travail de c7.

## 2026-11-03T14:41:20+01:00 — Correction de l'entrée précédente — renouvellement rapide

- **Agent** : b7 · **Branche** : `fix/error-log-500-reserves`
- **Statut** : fait
- **Quoi** : dans l'entrée précédente, la justification donnée pour `document-renewals.routes.ts:1198` est **fausse**. `vehicleDocuments` ne stocke que l'échéance (`expiryDate`). Quand `finalizedRequest` est vide, aucune demande ne référence `proofFilePath`, et le justificatif restait orphelin.
- **Comment** : `return next(…)` devient `throw new AppError(500, …)`. Le catch supprime alors le justificatif puis relaie l'AppError.
- **Pourquoi** : réserve du relecteur sur #173.
- **Comment tester (QA)** : `npx vitest run tests/unit/server/error-500-relay-hygiene.test.ts` → `20 passed`. Contrats `document-renewals` verts.
- **Reste / risques** : suivi de sécurité sur les fichiers téléversés de ce handler, dans un lot à part :
  - les 404 et 400 en 1032, 1037-1047, 1092 et 1098 laissent le fichier orphelin ;
  - 1092 et 1098 arrivent après la mise à jour de l'échéance, hors transaction ;
  - un échec de `createAlert` supprime un justificatif déjà référencé par la demande.
