## 2026-11-03 15:03 — P6 : couche 3 sur la réception de commande fournisseur (défaut corrigé)

- **Quoi** : `client/src/hooks/useRealTimeSync.ts`, cases `purchase_order_*` : invalidation de `/api/warehouse/reorder-alerts`, `/api/parts/low-on-stock`, `/api/part-requirements` et `/api/parts`. `e2e/23` : le `test.fail` de la levée d'alerte sans rechargement devient un test normal.
- **Comment** : correctif dans le case client existant ; les événements de commande ne sont pas au registre `REALTIME_EVENTS` (les y inscrire toucherait la portée serveur, fermée par défaut depuis #153). Autres événements de stock relus : `part_requirement_*` invalide déjà pièces, stock bas et alertes ; l'ajustement passe par `part_catalog_changed` et `WAREHOUSE_QUERY_KEYS`. Pas d'autre trou.
- **Pourquoi** : défaut trouvé par P6, l'alerte restait affichée chez le chef d'atelier jusqu'au rechargement.
- **Preuves** : spec 23 deux passes 7/7 (dont la levée sans rechargement) ; rouge démontré à la PR #175 (sans les invalidations, le test échoue). tsc 0, unitaires 1768/1768.

