# Journal — API 2 (`api-2`)

Worktree : `../fm-api-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T16:13:02+01:00 — T-20 — Routes d'administration des sauvegardes

- **Agent** : api-2 · **Branche** : `lot/api/T-20-backups-routes` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `GET /api/admin/backups`, `GET /api/admin/backups/alerts`, `POST /api/admin/backups/run` (admin).
- **Comment** : `server/api/backups.routes.ts` sur le dépôt `backup_runs` et `runBackup` de be (T-19a/b, branche fusionnée avec T-08). Liste triée du plus récent, sans `location` (chemin) ; `durationMs` calculé. Alertes : dernière exécution échouée, aucune réussite depuis 24 h. `run` : 202 avec la ligne créée, déclenchement forcé en arrière-plan ; si une exécution tourne déjà (moins de 30 min), elle est renvoyée sans second dump ; le verrou consultatif de `runBackup` ferme la course.
- **Pourquoi** : P-05 / R-02.
- **Comment tester (QA)** :
  - Prérequis : compte admin ; `pg_dump` absent sur la recette : la ligne passe en `failed` et l'alerte part.
  - Étapes : 1. POST run. 2. GET liste puis alerts. 3. Rappeler POST run pendant l'exécution. 4. Compte non admin.
  - Attendu : 202 avec id ; ligne visible sans chemin ; même id renvoyé ; 403.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/backups.contract.test.ts` → 1 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert moindre privilège, idempotence du déclenchement, aucun chemin ni message technique exposé ; sans objet : migration.
- **Reste / risques** : le plan T-20 disait 409 sur double déclenchement ; le contrat figé dit « renvoie l'exécution en cours » : contrat suivi (202 avec la ligne en cours). Le chemin de démarrage réel (pg_dump) n'est pas lancé dans le contrat pour ne pas écrire un dump de la base de test.
