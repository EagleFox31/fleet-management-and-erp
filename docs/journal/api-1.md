# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T20:00:00+01:00 — T-42 — Route de traitement des anomalies carburant

- **Agent** : api-1 · **Branche** : `lot/api/T-42-routes` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `PATCH /api/fuel-card/anomalies/:id` et diffusion de `fuel_anomaly_resolved`.
- **Comment** : `server/api/fuel-anomalies.routes.ts` derriere le drapeau `fuel-anomalies` et `isFuelCardManager`, cle validee par zod, `fuelAnomalyResolutionService.resolve`, puis `broadcastUpdate` avec la portee declaree dans `REALTIME_EVENTS`.
- **Pourquoi** : P-18 ; la derniere decision l'emporte, le PATCH est rejouable.
- **Comment tester (QA)** : traiter une anomalie en logistique, la rouvrir ; technicien, 403.
- **Preuve** : contrat `fuel-anomalies` 4 verts ; `tsc` global 0 erreur. Le nettoyage global `cleanupOrphanTestRows` a signale une violation de cle etrangere sur `parts_stock_movements` (lignes d'un autre agent sur la base partagee), sans lien avec ce test.
