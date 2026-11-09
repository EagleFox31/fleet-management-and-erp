## 2026-11-02 22:47 — PRT1 et CAT2 : routes enfants du catalogue pièces et pannes

- **Quoi** : routes `/api/parts/:id/specifications|variants` (PRT1) et `/api/fault-catalog/:id/parts` (CAT2), qui n'existaient pas ; l'écran base de pièces appelait des URL inexistantes. Lignes PRT1 et CAT2 du plan mises à jour.
- **Comment** : migration `20261102_parts_catalog_children.sql` (tables idempotentes, clés étrangères en cascade, dédoublonnage de `fault_catalog_parts`, index uniques), schémas Zod partagés, services `part-catalog-children-service` et `fault-catalog-service`, tests de contrat étendus.
- **Pourquoi** : fermer les derniers « Partiel » de ces deux modules (variantes, spécifications, pièces associées).
- **Preuves** : contrats `parts-catalog-crud` et `fault-catalog-lifecycle` : 68 tests, sur le Postgres local ; test unitaire de dérive migration / constante.

