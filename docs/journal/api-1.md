# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## T-15 - Lecture du journal d'audit

- Quoi : `GET /api/audit-logs`, admin seul, dans `server/api/audit-logs.routes.ts`.
- Comment : requete sur `activity_logs` jointe a `users`, filtres userId, entityType, entityId (numerique ou reference), plage par defaut 31 jours, page bornee a 100, tri recent d'abord. Les `details` repassent par `maskSecrets` a la lecture ; une action historique hors enum (ex. majuscules) est ramenee en minuscules, a defaut `update`.
- Pourquoi : consulter qui a fait quoi (P-04) sans acces base.
- Preuve : `tests/contract/audit-logs.contract.test.ts` (3 verts : 401/403, filtres, masque, plage, pagination) ; tsc global a zero.
- Reste : l'intercepteur `auditWrites` n'est pas monte ici (sol) ; le test insere ses lignes directement.
