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