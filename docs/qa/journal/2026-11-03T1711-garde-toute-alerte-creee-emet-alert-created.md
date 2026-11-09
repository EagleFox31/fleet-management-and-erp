## 2026-11-03 17:11 — Garde : toute alerte créée émet alert_created

- **Quoi** : `tests/unit/server/alert-emission-hygiene.test.ts` et le scanner `tests/support/alert-emission-scan.ts` (API TypeScript).
  - Le scanner recense les écritures d'alerte sous server/ : `insert(alerts)`, `createAlert(…)` et `INSERT INTO alerts`.
  - Pour chacune, il exige dans la fonction englobante (ou le gestionnaire `METHODE /chemin`) `broadcastAlertCreated`, la chaîne `alert_created` ou un helper local qui émet.
- **Résultat sur main** : 15 écritures, dont 10 qui émettent.
  - Deux exceptions justifiées : la primitive `storage.createAlert` et la restauration de sauvegarde.
  - Trois défauts gelés en égalité stricte : `POST /api/alerts`, `POST /api/test-date-maintenance`, `storage.checkAndCreateStockAlerts` (stock bas).
- **Pourquoi** : section « Émetteurs non traités » de l'audit temps réel ; la réception de pièces est corrigée par #180 (b7). Cette garde complète `alerts-write-hygiene`, qui couvre UPDATE et DELETE.
- **Preuves** :
  - rouge quand l'émission de `procurement-service` est retirée : 1 échec ;
  - unitaires 1862/1862 ;

