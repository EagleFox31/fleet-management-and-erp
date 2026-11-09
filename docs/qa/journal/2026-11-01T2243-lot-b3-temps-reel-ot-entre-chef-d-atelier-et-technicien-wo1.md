## Lot B3 - Temps réel OT entre chef d'atelier et technicien (WO1, WO7, T6)

**Quoi**
- `e2e/14-realtime-work-order-roles.spec.ts` : trois comptes créés par la spec (chef d'atelier, deux
  techniciens). Le chef crée un OT affecté au technicien : trame `work_order_created` reçue par le
  technicien et alerte d'affectation lisible par `/api/alerts`. Un autre technicien est refusé (403) ;
  le technicien affecté démarre l'OT : trame `work_order_updated` reçue par le chef, statut en base.
  OT, véhicule et comptes supprimés en fin de spec.

**Comment**
- Trames lues sur `/ws` de chaque session (`page.on("websocket")`) après `auth_success`, jamais l'écran :
  le polling de 7 s ne peut pas produire une trame.

**Pourquoi**
- La spec 06 dépend de comptes déjà en base et ne couvre que la création, dans un seul sens.

**Preuve**
- Vert 1/1 (2,9 min). Rouge : diffusion du démarrage renommée (`technician-work-orders.routes.ts`,
  `work_order_updated` -> `wo_changed`, code rétabli) : échec « trame work_order_updated non reçue par le
  chef d'atelier », 1 failed.

**Limites**
- ADM2 (changement de rôle), DRV2 (déclaration de panne du chauffeur) et l'invalidation des KPI à
  l'écran ne sont pas couverts : budget de tours épuisé. Aucun défaut produit constaté.


