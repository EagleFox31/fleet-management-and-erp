# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T17:00:00+01:00 — T-16 — Referentiel des types de document vehicule

- **Agent** : api-1 · **Branche** : `lot/api/T-16-document-types` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET/POST /api/vehicle-document-types` et `PATCH /api/vehicle-document-types/:code`, a la place du squelette 501.
- **Comment** : routeur dans `server/api/vehicle-document-types.routes.ts` (drizzle, zod du contrat, `AppError`, `moduleLogger`) ; GET pour tout connecte, types inactifs reserves a l'admin (`?includeInactive=true`) ; POST/PATCH admin ; doublon 409 ; aucune route de suppression.
- **Pourquoi** : P-05, un type se desactive, `vehicle_documents.type` reste du texte libre. Branche issue de T-08 avec T-07 fusionnee (table et graine).
- **Comment tester (QA)** : admin, creer un type, le desactiver ; un technicien ne le voit plus ; POST en technicien, 403.
- **Preuve** : contrat `vehicle-document-types` 5 verts ; `tsc` global sans erreur.
## T-15 - Lecture du journal d'audit

- Quoi : `GET /api/audit-logs`, admin seul, dans `server/api/audit-logs.routes.ts`.
- Comment : requete sur `activity_logs` jointe a `users`, filtres userId, entityType, entityId (numerique ou reference), plage par defaut 31 jours, page bornee a 100, tri recent d'abord. Les `details` repassent par `maskSecrets` a la lecture ; une action historique hors enum (ex. majuscules) est ramenee en minuscules, a defaut `update`.
- Pourquoi : consulter qui a fait quoi (P-04) sans acces base.
- Preuve : `tests/contract/audit-logs.contract.test.ts` (3 verts : 401/403, filtres, masque, plage, pagination) ; tsc global a zero.
- Reste : l'intercepteur `auditWrites` n'est pas monte ici (sol) ; le test insere ses lignes directement.

## 2026-10-30T18:40:00+01:00 - T-39 - Historique d'un ordre de travail

- **Agent** : api-3 (journal api-1) · **Branche** : `lot/api/T-39-audit-trail` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/work-orders/:id/audit-trail` a la place du squelette 501, conforme a `work-order-audit-trail.ts` (contrat inchange).
- **Comment** : lecture de `activity_logs` (`entity_type = 'work_order'`, `entity_id = :id`), jointure `users`, tri ancien vers recent, 1000 lignes au plus. Le mappage ligne vers contrat (`toAuditLogRow`, `server/lib/audit-log-row.ts`) est extrait de T-15 et partage. Gardes : drapeau (404), session, `isStaff` (client 403). Id non numerique, nul ou hors `integer` : 400 ; OT inconnu : 404 par `AppError`. Il n'existe pas de table d'historique de statut d'OT (`status_history` est celle des vehicules) : les changements de statut ressortent des ecritures auditees.
- **Pourquoi** : P-13, tracer qui a modifie l'OT sans acces base ; reutilisation (Adapt) de la logique T-15 plutot que copie.
- **Comment tester (QA)** : activer `FEATURE_FLAGS=work-order-audit-trail=on`, ouvrir `/api/work-orders/62/audit-trail` en personnel (liste chronologique), en client (403), avec `/abc` (400) et `/2000000000` (404).
- **Preuve** : contrat `work-order-audit-trail` 5 verts + `audit-logs` 3 verts (non-regression) ; `tsc` global a zero.
