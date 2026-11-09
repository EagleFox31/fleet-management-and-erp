## 2026-11-02 21:51 — DRV2 : seuls une panne ou un accident ouvrent un OT

- **Quoi** : `POST /api/driver/breakdowns` accepte `type` (`breakdown`, `accident`, `delay`, `other`, défaut `breakdown`). Seuls une panne et un accident ouvrent un OT. Un retard ou un autre signalement reste un incident qui alerte le chef d'atelier et l'admin.
- **Comment** : `driverReportRequestSchema` et `driverReportOpensWorkOrder` (`shared/contracts/incidents.ts`) sont partagés par la route et par l'écran chauffeur. L'écran envoie le type choisi et explique pourquoi le bouton est désactivé quand la mission n'a pas de véhicule.
- **Pourquoi** : la relecture de #107 a relevé qu'un « Retard prévu » ouvrait un OT à l'atelier. L'utilisateur a choisi qu'un OT ne s'ouvre que pour une panne ou un accident.
- **Preuves** : contrat `adm2-drv2-mis1-server-defects` 21/21 sur le Postgres local (accident → OT ; delay/other → incident sans OT ; type inconnu → 400). `tsc` : 0 erreur. `tests/unit` : 1010/1010.

