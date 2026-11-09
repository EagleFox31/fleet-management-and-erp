## 2026-11-03 14:05 — Cloison OT : logs migrés, commentaire du helper (suite de 51dfdef)

- **Quoi** : dans les catch des GET touchés, les `console.*` passent à `moduleLogger` sans rien supprimer. `GET /api/work-orders/:id/parts` : le `console.log` du contenu des lignes devient un `log.debug` (`workOrderId`, `count`, `requestId`, sans le contenu), et le `console.error` un `log.error({ err, requestId })`. `GET /:id/items` : `console.error` migré vers `log.error`. Le commentaire de `assertWorkOrderReadable` dit qu'il applique la cloison client seulement ; l'écart technicien (OT d'un autre technicien, bloqué par `GET /api/work-orders/:id`) est noté comme connu.
- **Pourquoi** : AGENTS.md §10, un log se migre, il ne se supprime pas. Le contenu des lignes (prix) n'a pas à finir dans les journaux.
- **Preuves** : tsc 0, unitaires 1687/1687 ; contrats `work-order*` et `vehicle-documents-client-scope` 67/67 sur 10 fichiers, lancés sans `.env` ni `DATABASE_URL` (seulement `DATABASE_URL_TEST` et `DATABASE_WS_PROXY`).

