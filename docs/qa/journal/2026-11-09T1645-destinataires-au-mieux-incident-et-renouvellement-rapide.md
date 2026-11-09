## 2026-11-09T16:45:00+01:00 — Destinataires au mieux : incident et renouvellement rapide (relecture #615)

**Quoi** : la notification d'incident (`incident-service`, `notifyRoles`) et celle du renouvellement rapide (`POST /api/document-renewals/quick-renew`) lisent les destinataires par `usersByRolesBestEffort`. Un rôle illisible ne coupe plus la boucle : les autres rôles restent notifiés. Préventif : l'en-tête reste affiché au-dessus de l'erreur.

**Comment** : test rouge d'abord. `tests/unit/server/incident-notify-roles-best-effort.test.ts` (admin en échec, workshop_manager notifié) rouge sur l'ancienne boucle (« promise rejected… timeout »), vert après. Cas de contrat ajouté dans `document-quick-renew-proof-lifecycle.contract.test.ts` (admin en échec, logistique notifiée). Rendu préventif : assertion sur le titre.

**Pourquoi** : `getUsersByRole` lève désormais sur erreur. Avant, seul le rôle en panne était perdu ; sans le helper, toute la notification l'était.

**Preuve** : `npm run check` 0 erreur ; unitaires serveur 1919 verts (db-pool-options : environnement local) ; contrat rejoué par la CI.
