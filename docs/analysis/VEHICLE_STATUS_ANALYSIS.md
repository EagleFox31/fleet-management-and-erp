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

**Retour arrière.** `DROP TRIGGER IF EXISTS trg_work_orders_release_vehicle ON work_orders;`
puis `DROP FUNCTION IF EXISTS fn_work_orders_release_vehicle();` et retrait des deux fichiers.
Les lignes `status_history` déjà écrites restent (historique réel).
