## 2026-11-03 17:17 — Couche 3 : work_order_item_changed rafraîchit les KPI de coût

- **Quoi** : `work_order_item_changed` rejoint `EVENT_SATELLITES` avec les groupes `workOrderCost` et `workOrderLists`. Une famille « coût OT » (`^work_order_item`) est suivie par la garde, qui exige `workOrderCost`.
- **Pourquoi** : les heures réelles d'une tâche sont valorisées dans `loadCostRows` (`kpi-service`), qui alimente `/api/kpi/maintenance-costs` et `avg-cost-per-intervention`. Le case client n'invalidait que l'OT et les listes.
- **Preuves** :
  - rouge sur main : 2 échecs ;
  - unitaires 1855/1855 ;
  - tsc 0.

