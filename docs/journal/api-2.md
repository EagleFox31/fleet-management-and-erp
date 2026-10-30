# Journal — API 2 (`api-2`)

Worktree : `../fm-api-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T15:53:27+01:00 — T-24 — Export Word d'un OT

- **Agent** : api-2 · **Branche** : `lot/api/T-24-work-order-export` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `GET /api/work-orders/:id/export?doc=ot|bon-sortie` renvoie le .docx de l'ordre de travail ou du bon de sortie.
- **Comment** : `server/api/work-order-export.routes.ts` branché sur `buildWorkOrderDocx` (T-22, branche fusionnée ici). Garde `isTechnician` pour `ot`, `isStockIssuer` pour `bon-sortie`, coupe-circuit `exports`. Un technicien ne télécharge que ses OT. 404 OT absent, 400 `doc` inconnu, `Content-Length` posé, nom de fichier fixe (id numérique validé par zod).
- **Pourquoi** : P-06 / R-07, export Word cité au CDC.
- **Comment tester (QA)** :
  - Prérequis : OT existant assigné à un technicien, comptes technicien, magasinier, client.
  - Étapes : 1. Technicien assigné : GET ?doc=ot. 2. Magasinier : ?doc=bon-sortie. 3. Technicien : ?doc=bon-sortie. 4. Autre technicien : ?doc=ot.
  - Attendu : 200 + fichier Word ouvrable ; 200 ; 403 ; 403. OT inconnu 404, ?doc=x 400.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/work-order-export.contract.test.ts` → 1 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert moindre privilège, contrat figé, nettoyage des données de test ; sans objet : migration.
- **Reste / risques** : dépend de T-22 (PR be) et T-08 ; libellés d'état d'OT définis localement faute de table partagée.
