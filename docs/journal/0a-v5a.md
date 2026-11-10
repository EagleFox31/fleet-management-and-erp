# Journal 0a-v5a - automatisations (lot V5a)

## 2026-11-10 - Préventif par date et papiers chauffeur dans le cycle périodique
- **Statut** : fait
- **Quoi** : (1) `checkDateBasedMaintenance` rejoué par l'ordonnanceur ; (2) alertes J-30, J-7 et échu sur le permis, la CNI et la CPC des chauffeurs actifs, adressées à les rôles de DRIVER_MANAGER_ROLES.
- **Comment** : `server/jobs/preventive-date-check.ts` (au plus un passage toutes les 6 h, appelé dans `runAlertCycle` après `runAllAlertChecks`, ne lève jamais) ; `server/services/driver-document-expiry.ts` (règle pure) et `AlertService.checkDriverDocumentAlerts`, ajouté à `runAllAlertChecks` ; clé de dédoublonnage `driver_doc:<papier>:<palier>:<chauffeur>:<échéance>`, index unique `(user_id, dedupe_key)` existant, aucune colonne ni contrainte ajoutée.
- **Faille trouvée** : le garde anti-doublon de `createDateBasedWorkOrder` ne regardait que les OT « en attente ». `vehicles.nextMaintenanceDate` n'avance pas à la clôture : un OT démarré, en attente de pièces ou clos aurait été recréé à chaque passage. Garde alignée sur celle des plans : OT ouvert, ou clos pour une échéance égale ou postérieure (`work_orders.due_date`), bloque ; annulé ne bloque pas (`isDateBasedDueAlreadyHandled`, `server/lib/preventive-due.ts`).
- **Pourquoi** : audit du 10/11, contrôles lancés à la main ou jamais. Les titres des paliers diffèrent : l'émission écarte une alerte non lue de même titre et même lien, un titre commun aurait fait taire J-7 derrière un J-30 non lu.
- **Alerte de seuil de stock** : déjà corrigée (`notifyLowStock` cible admin et magasinier par rôle) ; plus d'utilisateur 1 en dur hors des variantes mortes `vehicle-activation-service-*`.
- **Route manuelle** `POST /api/check-all-maintenance` conservée (écran Maintenance l'appelle encore, `routes.ts` gelé).
- **Preuve automatisée** : unitaires `driver-document-expiry`, `preventive-date-check` ; intégration `driver-document-alerts`, `preventive-date-background` (rouge/vert : garde réduite à « en attente », 1 échec sur 3 ; restaurée, 3/3).
- **RAIDER** : couvert idempotence, non-régression, moindre privilège (alertes aux seuls lecteurs des données chauffeur) ; sans objet : migration.
- **Reste / risques** : instance unique supposée (comme le cycle d'alertes) ; contrainte d'unicité en base sur les OT préventifs ouverts à signaler à fleet-db.

## 2026-11-10 - Correctifs de relecture (V5a)
- **Quoi** : véhicules `out_of_service` écartés du préventif par date (constante `VEHICLE_OUT_OF_SERVICE_STATUSES`) ; lecture des échéances de papiers chauffeur déplacée dans `server/lib/driver-scope.ts` (`readActiveDriverDocumentExpiries`), l'entrée ajoutée à la liste gelée d'hygiène est retirée ; verrou consultatif : `release(true)` si `pg_advisory_unlock` échoue (préventif et purge d'idempotence) ; `preventiveDateCheckTick` ne lève plus ; journaux d'échec d'émission d'alerte : `dedupeKey` au lieu de `title` (nom du chauffeur dans le titre).
- **Preuve** : `preventive-date-tick` (rouge sans le try/catch, vert avec), `preventive-date-background` (réformé), `alert-emit-fallback-relink` (échantillon sans titre), `driver-personal-data-hygiene` sans entrée ajoutée.
- **Documenté** : premier passage en production et procédure d'activation dans `docs/deploiement/vps.md` ; near miss dans `LESSONS_LEARNED.md`.

