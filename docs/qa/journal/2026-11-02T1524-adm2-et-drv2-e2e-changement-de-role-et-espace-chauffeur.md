## 2026-11-02 15:24 — ADM2 et DRV2 : e2e changement de rôle et espace chauffeur

- **Quoi** : `e2e/18-admin-role-change.spec.ts` (8 tests) et `e2e/19-driver-space.spec.ts` (9 tests), dont un témoin par bloc de défauts. Run complet sur la base de test `tests-piste-c`, sous `db-lock`, Edge, un worker, port 5056 : **17 passed (17,3 min)**.
- **Vert** :
  - ADM2 : un admin passe un magasinier en technicien au navigateur ; après reconnexion, « Mes interventions » apparaît, « Inventaire des pièces » disparaît, `GET /api/purchase-orders` répond 403 et `GET /api/technician/work-orders/:selfId` 200.
  - ADM2, session ouverte avant le changement : les gardes de `server/middleware/auth.ts` (l.79, 106, 152) relisent le rôle en base à chaque requête, la session suit le nouveau rôle sans reconnexion.
  - DRV2 : chaque chauffeur voit sa mission sur son tableau de bord, pas celle de l'autre (`/api/drivers/me`).
- **Défauts figés** (`test.fail`, non corrigés ici) :
  - ADM2-1 : sur `/admin/users`, « Modifier » n'affiche que « bientôt » (`client/src/pages/admin/users.tsx:327`) ; le seul formulaire d'édition est sur `/users`, sans entrée de menu.
  - ADM2-2 : sur `/users`, changer le rôle sans retaper le mot de passe est refusé par le formulaire (`client/src/components/users/user-form.tsx:48` et `:75`, `partial` ne fait pas tomber `min(6)` sur une chaîne vide).
  - ADM2-3 : `server/api/purchase-orders.routes.ts:101` réécrit `req.user.role` depuis la session : un magasinier passé logistique garde sur sa session ouverte les suggestions de regroupement (l.201) et la réception des livraisons (l.367).
  - DRV2-1 : la déclaration de panne envoie `POST /api/alerts` (`client/src/pages/driver/dashboard.tsx:241`), réservé à `isWorkshopManager` (`server/routes.ts:4286`) : 403 et toast « Impossible d'envoyer le signalement ».
  - DRV2-2 : aucune voie ne crée d'OT à la panne ; `POST /api/incidents` est derrière le drapeau `incidents` désactivé (`shared/feature-flags.ts:34`) et ne crée pas d'OT (`server/services/incident-service.ts:135-151`).
  - DRV2-3 : `GET /api/missions`, `GET /api/missions/:id` (`server/api/missions.routes.ts:589`, `:692`) et `GET /api/drivers/:id/missions` (`drivers-management.routes.ts:164`) ne filtrent pas pour le rôle `driver` : un chauffeur lit les missions des autres (AGENTS.md §11).
- **Comment** : comptes et données préfixés `E2E-ADM2-` / `E2E-DRV2-`, supprimés en fin de spec et à l'ouverture si un run a planté. Mise en place hors des `test.fail` (garde `it-fails-hygiene`). Chaque défaut a été rejoué en `test` simple pour vérifier qu'il échoue sur l'assertion visée et non sur la mise en place. Un `test.fail` passe aussi quand son hook échoue (vu ici sur des coupures Neon, WebSocket 1006) : chaque bloc de défauts a donc un test ordinaire témoin qui partage ses hooks. DRV2-2 reconnaît la trame à son `vehicleId` (format des payloads `work_order_created`), pas à l'immatriculation.
- **Pourquoi** : ADM2 et DRV2 étaient « À faire ». DRV2 reste partiel : il n'existe pas de vue « missions du jour » (le tableau de bord n'affiche que la mission active), et la panne → OT n'existe pas encore côté produit.
- **Hors périmètre** : la boîte « Signaler un problème » affiche des emojis (`client/src/pages/driver/dashboard.tsx:103-106`), contraire à AGENTS.md §4.

