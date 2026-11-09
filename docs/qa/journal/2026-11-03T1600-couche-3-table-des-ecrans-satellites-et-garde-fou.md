## 2026-11-03 16:00 — Couche 3 : table des écrans satellites et garde-fou

- **Quoi** : `client/src/lib/realtime-satellites.ts`, avec 14 groupes d'écrans et une table événement -> groupes. `useRealTimeSync.ts` appelle `invalidateSatellites` avant le `switch`, et `part_used_*` rafraîchit en plus la fiche de l'OT. Nouveau test `tests/unit/client/realtime-satellites.test.ts` (11 cas).
- **Comment** : le garde-fou balaie les émetteurs du serveur (premier argument littéral de `broadcast*`, `emit*` ou `diffuser`, et `'eventType'` SQL) et les `queryKey` du client, constantes `_PATH` des contrats comprises. Listes gelées :
  - `UNCOVERED_SATELLITES` : `/api/invoices/monthly-stats`, appel sans route, et `/api/workflows/stats`, sans événement ;
  - `TABLE_WITHOUT_EMITTER` : 4 événements.
- **Pourquoi** : les 14 écarts de l'audit 0a du 3 novembre 2026. L'oubli d'un écran satellite était l'erreur la plus fréquente de la règle des 3 couches.
- **Preuves** :
  - rouge par mutation : retirer `parts_delivered` fait échouer le test de famille, et `warehouse_stock_movement_recorded` sans groupe stock fait échouer le test de groupe et celui de l'audit ;
  - vert : unitaires 142 fichiers, tsc 0 ;
  - e2e en local : 23 + 21 (10/10), 06 + 14 + 15 (4 verts, 1 skip préexistant de 06 : aucun véhicule en base).

