# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## T-13 - Liste des comptes verrouilles et deverrouillage admin

- Quoi : `GET /api/admin/users/locked` et `POST /api/admin/users/:id/unlock`, admin seul, dans `server/api/auth-lockout.routes.ts`.
- Comment : lecture de `users.locked_until > now()` mappee sur `lockedUsersResponseSchema` (sans mot de passe) ; le deverrouillage passe par `DbLockoutStore.unlockUser`, qui remet les compteurs a zero, supprime la ligne par identifiant et ecrit l'audit. 404 si l'id est inconnu, 400 si invalide. Rejouable.
- Pourquoi : un administrateur doit pouvoir lever un verrou sans attendre l'expiration (P-03).
- Preuve : `tests/contract/auth-lockout-admin.contract.test.ts` (3 verts) ; tsc global a zero.
- Reste : le scenario 5 echecs puis 429 depend du montage de `loginLockoutGuard` par sol ; le verrou est ici pose par `registerFailure`.
