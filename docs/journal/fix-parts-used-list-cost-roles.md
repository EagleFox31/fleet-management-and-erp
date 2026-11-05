# Journal — fix-parts-used-list-cost-roles

Branche : `fix/parts-used-list-cost-roles`. Modèle d'entrée : `README.md`.

## 2026-11-05 — Lecture des pièces posées réservée aux rôles coût

- **Quoi** : `GET /api/parts-used` (prix unitaire de toutes les pièces posées) passe de `isStaff` à `WORK_ORDER_COST_READ_ROLES` ; chauffeur et client reçoivent 403.
- **Comment** : la route quitte `server/routes.ts` (suppression seule) pour `server/api/parts-used.routes.ts`, avec `authorize([...WORK_ORDER_COST_READ_ROLES])`. Contrat `tests/contract/parts-used-list.contract.test.ts` (401, 403 chauffeur et client, 200 avec prix, tous les rôles).
- **Pourquoi** : les coûts d'OT sont réservés aux rôles coût ; la liste devait suivre la même règle.
- **Écran** : `/technicians` appelle cette liste ; il est limité à admin et workshop_manager, tous deux rôles coût.
