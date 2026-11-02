# Analyse des Mécanismes de Mise à Jour du Statut des Véhicules

## Tables Impliquées dans les Changements de Statut

### 1. **vehicles** (Table Principale)
- **Champ**: `status` enum: ["operational", "maintenance", "out_of_service"]
- **Déclencheurs**: Mise à jour directe via formulaires, API, ou automatisation

### 2. **work_orders** (Ordres de Travail)
- **Impact**: Changement automatique du statut véhicule selon l'état de l'OT
- **Mécanismes**:
  - Création d'OT → véhicule passe en "maintenance"
  - OT "in_progress" → véhicule reste en "maintenance" 
  - OT "completed" → véhicule revient en "operational"
  - OT "cancelled" → véhicule revient en "operational"

### 3. **status_history** (Historique)
- **Rôle**: Enregistrement automatique de tous les changements
- **Déclencheurs**: 
  - Appels via `vehicleStatusService.recordStatusChange()`
  - Changements manuels de statut
  - Automatisation par work_orders

### 4. **maintenance_schedules** (Planification)
- **Impact Potentiel**: Peut déclencher des OT automatiques
- **Statut**: Non implémenté actuellement dans les triggers

## Mécanismes Automatiques Existants

### A. Service VehicleStatusService
```typescript
// Méthodes de changement automatique:
- setVehicleToMaintenance()
- setVehicleToOperational() 
- updateVehicleStatus()
- recordStatusChange()
```

### B. Automatisations Work Orders
```typescript
// Dans storage.ts:
if (workOrder.status === 'completed') {
  await this.setVehicleToOperational(vehicleId, workOrderId);
} else if (workOrder.status === 'in_progress') {
  await this.setVehicleToMaintenance(vehicleId, workOrderId);
}
```

### C. Triggers PostgreSQL Actuels
- `update_fleet_kpi_on_vehicles` → Met à jour les KPI cache
- **MANQUANT**: Trigger pour status_history automatique

## Problèmes Identifiés

### 1. Pas de Trigger Automatique
- Les changements de statut ne sont PAS automatiquement enregistrés dans status_history
- Dépendance aux appels manuels du service

### 2. Données Historiques Incomplètes
- Véhicules créés sans entrée status_history initiale
- Changements de statut potentiellement non trackés

### 3. Synchronisation Manuelle
- Besoin d'appeler explicitement `recordStatusChange()` partout

## Solution Recommandée

### Créer un Trigger PostgreSQL pour status_history

```sql
CREATE OR REPLACE FUNCTION update_status_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Si le statut change ou nouveau véhicule
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
    INSERT INTO status_history (vehicle_id, status, date, notes, updated_by_id)
    VALUES (
      NEW.id,
      NEW.status,
      CURRENT_DATE,
      CASE 
        WHEN TG_OP = 'INSERT' THEN 'Véhicule créé'
        ELSE 'Statut mis à jour automatiquement'
      END,
      NULL
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehicle_status_history_trigger
  AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_status_history();
```

### Avantages
- Garantit l'enregistrement de TOUS les changements
- Pas de dépendance aux appels manuels
- Données historiques complètes et fiables
- Graphiques de statut précis automatiquement

### Tables à Auditer pour Triggers Supplémentaires
1. **fuel_records** → Peut affecter le kilométrage
2. **work_order_parts** → Coûts et inventaire  
3. **maintenance_schedules** → Planification automatique
## Mise à jour du 2 novembre 2026 : libération du véhicule en base

**Quoi.** Trigger `trg_work_orders_release_vehicle` (fonction `fn_work_orders_release_vehicle()`),
`AFTER UPDATE OF status ON work_orders`, déclenché seulement quand un OT **quitte** l'état ouvert
(`pending`, `in_progress`, `awaiting_parts` vers `completed` ou `cancelled`). Si le véhicule est en
`maintenance` et ne porte plus aucun OT ouvert, il passe `operational`, une ligne `status_history` est
écrite (« Véhicule remis en service - Ordre de travail #N terminé|annulé (aucun OT ouvert restant) »)
et un `vehicle_status_changed` part sur `fleet_events` (relayé en WebSocket par `server/index.ts`,
qui invalide fiche, liste et historique du véhicule côté client).

**Pourquoi en base.** C'est un invariant inter-tables qui ne doit dépendre d'aucun appelant. Avant :
seul `storage.updateWorkOrder` le tenait, et seulement pour `completed` ; l'annulation laissait le
véhicule immobilisé, et les écritures directes (`technician-work-orders-service`, contrôle qualité)
ne libéraient jamais le véhicule. `server/storage.ts` est gelé (AGENTS.md §9).

**Ce qui ne change pas.**
- `storage.setVehicleToOperational` lit le statut après le trigger et s'arrête (`operational`) : pas de
  double écriture, pas de seconde ligne d'historique (test « clôturer deux fois » et « ouvrir puis clôturer »).
- Ouverture d'OT, réouverture, suppression : toujours côté serveur (`vehicleStatusService`).
- Un véhicule `out_of_service` n'est jamais remis en service par le trigger ; un véhicule supprimé
  (`deleted_at`) est ignoré.
- Aucun rattrapage des données existantes : `POST /api/check-all-maintenance` reste l'outil.

**Concurrence.** `SELECT … FOR UPDATE` sur le véhicule avant le décompte : deux clôtures simultanées
des deux derniers OT sont sérialisées, la seconde voit la première validée et libère le véhicule.

**Où.** `server/db/migrations/20261102_work_orders_release_vehicle.sql` et sa jumelle
`WORK_ORDER_VEHICLE_RELEASE_SQL` dans `server/init-database.ts` (dérive contrôlée par
`tests/unit/server/work-orders-release-vehicle-drift.test.ts`). Preuve d'invariant :
`tests/integration/vehicle-status-sync.test.ts` (annulation, OT restant ouvert, UPDATE direct, hors service).

**Retour arrière.** Corrigé le 2 novembre 2026 (suivi) : voir l'ordre ci-dessous. Le premier texte
donnait le `DROP` avant le retrait des fichiers, ce qui ne tient pas : le démarrage suivant rejoue la
migration et la constante, et recrée le trigger.

## Mise à jour du 2 novembre 2026 (suivi) : ré-immobilisation, hors service, retour arrière

**Trigger miroir.** `trg_work_orders_hold_vehicle` (fonction `fn_work_orders_hold_vehicle()`),
`AFTER UPDATE OF status ON work_orders`, déclenché seulement quand un OT **redevient** ouvert
(`completed`/`cancelled` vers `pending`, `in_progress` ou `awaiting_parts`). Cas réel : le refus du
contrôle qualité (`server/api/quality-check.routes.ts`) repasse l'OT en `in_progress` par un UPDATE
direct, sans passer par `storage`. Si le véhicule (non supprimé, verrouillé `FOR UPDATE`) est
`operational`, il passe `maintenance`, une ligne `status_history` est écrite (« Véhicule passé en
maintenance - Ordre de travail #N rouvert ») et un `vehicle_status_changed` part sur `fleet_events`.
Un véhicule `out_of_service` ou déjà en `maintenance` n'est pas touché (pas de ligne en double).
La réouverture par `storage.updateWorkOrder` reste correcte : le trigger pose `maintenance`, puis
`vehicleStatusService.setVehicleToMaintenance` voit le statut déjà posé et s'arrête.

**Hors service côté serveur.** `vehicleStatusService.setVehicleToOperational` (appelé par
`storage.updateWorkOrder` à la clôture `completed`) ne remet plus en service qu'un véhicule en
`maintenance`. Avant, un véhicule `out_of_service` (décision manuelle) repassait `operational`.
Reste ouvert, hors périmètre : `setVehicleToMaintenance` fait encore passer un véhicule
`out_of_service` en `maintenance` à la création ou à la réouverture d'un OT par `storage`.

**Où.** `server/db/migrations/20261102_work_orders_hold_vehicle.sql` et sa jumelle
`WORK_ORDER_VEHICLE_HOLD_SQL` dans `server/init-database.ts` (même test de dérive, paramétré sur les
deux triggers). Preuves : `tests/integration/vehicle-status-sync.test.ts` (réouverture par UPDATE
direct, réouverture sur hors service, clôture `completed` sur hors service) et
`tests/contract/work-order-quality-check.contract.test.ts` (refus qualité puis véhicule en maintenance).

**Données existantes.** Aucun rattrapage. Au 2 novembre 2026, la base de dev compte 4 véhicules
`operational` portant un OT ouvert, antérieurs au trigger : le trigger n'agit que sur une transition.

**Retour arrière, pour chacun des deux triggers, dans cet ordre :**
1. retirer de `server/init-database.ts` la constante (`WORK_ORDER_VEHICLE_RELEASE_SQL` ou
   `WORK_ORDER_VEHICLE_HOLD_SQL`) et sa ligne dans `applyWorkOrderVehicleStatusTriggers()`, et le
   fichier de migration correspondant (sinon le démarrage suivant recrée le trigger) ;
2. déployer, puis `DROP TRIGGER IF EXISTS trg_work_orders_<release|hold>_vehicle ON work_orders;`
   et `DROP FUNCTION IF EXISTS fn_work_orders_<release|hold>_vehicle();`.

Les lignes `status_history` déjà écrites restent (historique réel).
