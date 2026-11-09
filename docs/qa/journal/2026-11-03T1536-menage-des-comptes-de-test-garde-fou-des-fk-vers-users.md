## 2026-11-03 15:36 — Ménage des comptes de test : garde-fou des FK vers users

- **Quoi** : `tests/integration/cleanup-users-fk-coverage.test.ts` lit `pg_constraint` et y relève les FK vers `users` sans `ON DELETE` (59). Chacune doit être traitée de l'une de ces façons :
  - par compte, `inArray(<table>.<colonne>, testUsers)` dans `deleteOrphanTestRows` ;
  - par préfixe, `orphan(<table>.…)` ;
  - par la liste gelée `NOT_YET_HANDLED` (36), comparée en égalité stricte.
- **Pourquoi** : une FK oubliée fait échouer le hook global de tous les fichiers. C'est déjà arrivé avec alerts, missions, document_renewal_centers et status_history. Le traitement de status_history existait déjà sur main (`test-cleanup-status-history.test.ts`). Il restait le garde-fou.
- **Preuves** : rouge si la ligne `statusHistory.updatedById` du nettoyage d'orphelins est retirée (3 échecs, dont le test existant). Vert 5/5 sur Postgres local, tsc 0.

