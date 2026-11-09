## 2026-11-03 14:00 — Garde base de test : rupture documentée, périmètre prouvé

- **Quoi** : AGENTS.md §8 et tests/README.md : `DATABASE_URL_TEST` s'exporte, `unset DATABASE_URL` avant intégration ou contrat, message d'erreur attendu. Preuve que e2e, `backfill:*` et `benchmark:*` sont hors garde.
- **Pourquoi** : revue de #159 (rupture à documenter).

