# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T18:00:00+01:00 — T-25 — Routes KPI de la direction

- **Agent** : api-1 · **Branche** : `lot/api/T-25-kpi-routes` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/kpi/incidents-per-month`, `/preventive-compliance`, `/avg-cost-per-intervention`.
- **Comment** : `server/api/kpi.routes.ts` branche `kpiService` (db-2) derriere `isManagementOrAdmin` ; periode validee par le contrat zod (400 si inversee).
- **Pourquoi** : P-10, indicateurs de la direction ; technicien et client refuses.
- **Comment tester (QA)** : connecte direction, ouvrir les indicateurs ; technicien, 403.
- **Preuve** : contrat `kpi` 5 verts ; `tsc` global 0 erreur.
