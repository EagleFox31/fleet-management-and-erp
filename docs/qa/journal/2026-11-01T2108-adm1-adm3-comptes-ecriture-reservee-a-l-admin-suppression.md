## ADM1, ADM3 - comptes : écriture réservée à l'admin, suppression qui coupe l'accès

**Quoi**
- Contrat `users-admin-soft-delete` (9 cas) : 403 non-admin et 401 anonyme sur POST/PATCH/DELETE
  `/api/users`, auto-suppression refusée, 204 puis 404, ligne conservée, absent de `GET /api/users`.
- Correctif : la connexion refuse un compte `deletedAt` ; `authorize`, `isAdmin` et `GET /api/auth/me`
  aussi ; `DELETE /api/users/:id` et `PATCH /api/admin/users/:id/toggle` (désactivation) effacent les
  sessions du compte et ferment ses connexions temps réel (`server/lib/user-sessions.ts`).

**Pourquoi**
- Trois cas rouges sur main (écrits d'abord en `it.fails`) : un compte supprimé se reconnectait, et
  une session ouverte avant la suppression restait valide sur toutes les routes.

**Preuve**
- Contrat 16/16 (`users-admin-soft-delete`, `api-auth-sessions`, `auth-lockout-admin`), unitaire
  848/848, `tsc` 0 erreur.

