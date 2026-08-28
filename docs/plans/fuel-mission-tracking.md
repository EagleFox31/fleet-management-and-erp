# Plan : Suivi Carburant lié aux Missions

**Statut** : À implémenter
**Date** : 2026-03-23
**Priorité** : Haute — intégrité données financières

---

## Problème actuel

Les champs `estimatedFuelCost`, `actualFuelCost`, `actualFuelQuantity` de la table `missions` sont saisis **manuellement** et totalement déconnectés de la table `fuelRecords` (vraies transactions carte carburant). Un camion peut clôturer une mission sans jamais avoir enregistré un plein — le système ne le détecte pas.

---

## Règle métier centrale

> **Le plein d'une mission = une transaction sur la carte carburant du véhicule.**
> Le budget mission reste **prévisionnel**. Le **réel** vient uniquement des transactions de la carte carburant. Quand le chauffeur enregistre un plein, le montant est débité de la carte et alimente les coûts réels mission.

---

## Qui peut enregistrer un plein ?

| Acteur | Quand | Comment |
|---|---|---|
| Chauffeur | Pendant la mission (temps réel) | Bottom-sheet dans son dashboard — date/heure auto |
| Chauffeur | Après la mission | Même bottom-sheet — date/heure saisie manuellement |
| Admin / Logisticien | Avant le départ | Dialog dans la page détail mission — flag `isPreDeparture = true` |
| Admin / Logisticien | À tout moment | Dialog dans la page détail mission |

---

## Architecture technique

### Principe anti double-déduction

```
POST /api/missions/:id/fuel-records
        ↓
FuelCardService.recordConsumption({ ...data, missionId })
        ↓
INSERT INTO fuel_records (mission_id = ...)
        ↓ (automatique via TRIGGER PostgreSQL)
UPDATE missions SET actual_fuel_quantity, actual_fuel_cost
```

**Le `FuelCardService` est le seul point de débit carte. Jamais d'INSERT direct dans `fuel_records` depuis une route mission.**

---

## Sprint 1 — Backend

### 1.1 Migration SQL

```sql
-- Lier les pleins aux missions
ALTER TABLE fuel_records
  ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fuel_records_mission_id ON fuel_records(mission_id);

-- Trigger : synchroniser les totaux carburant de la mission à chaque changement
CREATE OR REPLACE FUNCTION recalc_mission_fuel_totals(p_mission_id INTEGER)
RETURNS VOID AS $$
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE missions
  SET
    actual_fuel_quantity = (
      SELECT COALESCE(SUM(quantity), 0)
      FROM fuel_records
      WHERE mission_id = p_mission_id
        AND debit_amount > 0
    ),
    actual_fuel_cost = (
      SELECT COALESCE(SUM(debit_amount), 0)
      FROM fuel_records
      WHERE mission_id = p_mission_id
        AND debit_amount > 0
    ),
    updated_at = NOW()
  WHERE id = p_mission_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_mission_fuel_totals()
RETURNS TRIGGER AS $$
BEGIN
  -- INSERT
  IF TG_OP = 'INSERT' THEN
    PERFORM recalc_mission_fuel_totals(NEW.mission_id);
    RETURN NEW;
  END IF;

  -- DELETE
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_mission_fuel_totals(OLD.mission_id);
    RETURN OLD;
  END IF;

  -- UPDATE
  -- Cas normal : même mission -> recalcul une fois
  -- Cas correction : mission_id OLD -> NEW -> recalcul des deux missions
  IF OLD.mission_id IS DISTINCT FROM NEW.mission_id THEN
    PERFORM recalc_mission_fuel_totals(OLD.mission_id);
    PERFORM recalc_mission_fuel_totals(NEW.mission_id);
  ELSE
    PERFORM recalc_mission_fuel_totals(NEW.mission_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_mission_fuel ON fuel_records;
CREATE TRIGGER trigger_sync_mission_fuel
  AFTER INSERT OR UPDATE OR DELETE ON fuel_records
  FOR EACH ROW EXECUTE FUNCTION sync_mission_fuel_totals();
```

> **Avantage du trigger :** la synchro est atomique (même transaction que l'INSERT), résistante aux race conditions, et s'applique même à un INSERT SQL direct en dehors du code applicatif.

### 1.2 Schéma Drizzle (`shared/schema.ts`)

```ts
// Dans fuelRecords — ajouter :
missionId: integer("mission_id").references(() => missions.id),

// Dans fuelRecordsRelations — ajouter :
mission: one(missions, {
  fields: [fuelRecords.missionId],
  references: [missions.id],
}),

// Dans missionsRelations — ajouter :
fuelRecords: many(fuelRecords),
```

### 1.3 Extension FuelCardService (`server/services/fuel-card-service.ts`)

Ajouter `missionId?: number` et `isPreDeparture?: boolean` dans le type du paramètre de `recordConsumption()`. L'insérer dans le `values({...})` existant.

Ajouter deux méthodes :

```ts
// Retourne les pleins d'une mission + agrégats
async getFuelRecordsByMission(missionId: number): Promise<{
  records: FuelRecord[];
  totalQuantity: number;
  totalCost: number;
}>

// Vrai si au moins un débit lié à cette mission existe
async hasFuelRecordsForMission(missionId: number): Promise<boolean>
```

### 1.4 Nouveaux endpoints dans `server/api/missions.routes.ts`

#### `GET /api/missions/:id/fuel-records`

Retourne la liste des `fuelRecords` liés + agrégats (totalLitres, totalCost, budgetEstimé, delta).
Accès : tous les rôles authentifiés ayant accès à la mission.

#### `POST /api/missions/:id/fuel-records`

Payload :
```ts
{
  vehicleId: number          // obligatoire
  quantity: number           // litres, obligatoire
  unitPrice: number          // FCFA/L, obligatoire
  date: string               // ISO datetime — now() si temps réel, manuel si rétroactif
  stationName?: string
  notes?: string
  isPreDeparture?: boolean   // true si plein fait avant le départ
}
```

Logique :
1. Vérifier que la mission existe
2. Vérifier le statut : `["planned", "assigned", "in_progress", "delivered"]` (pas `completed` ni `cancelled`)
3. Vérifier que `payload.vehicleId` correspond bien au véhicule affecté à la mission (sinon 400)
4. Si rôle `driver` : vérifier via `assignments → drivers → users` que ce chauffeur est bien assigné à cette mission
5. Appeler `fuelCardService.recordConsumption({ ...payload, missionId })`
6. Intercepter l'erreur `INSUFFICIENT_BALANCE` → HTTP 422 avec message clair
7. Broadcaster `mission_fuel_recorded`
8. Retourner le fuelRecord créé + nouveaux totaux mission (lus depuis la DB post-trigger)

#### Modification `PUT /:id/status` pour clôture

Dans le bloc `targetStatus === "completed"` :
```ts
const hasFuel = await fuelCardService.hasFuelRecordsForMission(missionId);
// Avertissement non-bloquant — l'admin peut forcer la clôture
const warnings = hasFuel ? [] : ["no_fuel_records"];
return res.json({ ...updatedMission, warnings });
```

---

## Sprint 2 — UI Admin (`client/src/pages/missions/[id].tsx`)

### Onglet "Carburant" (nouveau tab dans PremiumTabsNav)

**KPI tiles :**
- Litres enregistrés (total réel)
- Coût total réel (FCFA)
- Budget estimé (depuis `mission.estimatedFuelCost`)
- Delta budget vs réel (vert si dans les clous, rouge si dépassement)
- Nombre de pleins

**Table des pleins (`PremiumDataTable`) :**

| Date | Quantité (L) | Prix/L | Coût total | Station | Enregistré par | Pre-départ |

**Bouton "Ajouter un plein"** (rôles : `admin`, `logistics`, `secretary`) → dialog standard.

**Alerte si aucun plein :**
```tsx
{fuelRecords.length === 0 && !["draft","cancelled"].includes(mission.status) && (
  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
    <AlertTriangle className="h-4 w-4 text-amber-600" />
    <p className="text-sm text-amber-800 font-medium">
      Aucun plein enregistré. Ajoutez les pleins réalisés pour ce véhicule.
    </p>
  </div>
)}
```

**Confirmation à la clôture** (si `response.warnings?.includes("no_fuel_records")`) :
```tsx
// AlertModal de confirmation avant de finaliser
"Aucun plein n'a été enregistré pour cette mission. Voulez-vous quand même la clôturer ?"
[Annuler] [Clôturer quand même]
```

---

## Sprint 3 — UI Chauffeur (`client/src/pages/driver/dashboard.tsx`)

### Bouton "Enregistrer un plein"

Ajouter dans la grille d'actions de la mission active (à côté de "Feuille de route" et "Signaler un problème").
Icône : `Fuel` ou `Droplets` (lucide-react).
Condition : `activeMission.status === "assigned" || activeMission.status === "in_progress"`.

### FuelSheet (bottom-sheet, même pattern que ProblemSheet)

Champs :
- **Litres** — number input, clavier numérique
- **Prix/litre** — pré-rempli avec le prix moyen récent (optionnel, récupéré depuis `/api/fuel-card/balance`)
- **Coût calculé** — affiché dynamiquement : `litres × prix`, non éditable
- **Station** — text input, optionnel
- **Date et heure** — `datetime-local`, défaut = `new Date().toISOString()` (modifiable si rétroactif)
- **Notes** — optionnel

Mutation : `POST /api/missions/:id/fuel-records`
Erreur 422 (solde insuffisant) : afficher le montant disponible vs requis.

---

## Points de vigilance

### 1. Anti double-déduction (critique)
`POST /api/missions/:id/fuel-records` doit **toujours** passer par `FuelCardService.recordConsumption()`.
Ne jamais faire d'INSERT direct dans `fuel_records` depuis la route mission.

### 2. Solde insuffisant
Intercepter l'exception levée par le service → HTTP 422 → message explicite dans l'UI chauffeur.

### 3. Trigger + code applicatif
Le trigger PostgreSQL met à jour `missions.actual_fuel_cost` et `missions.actual_fuel_quantity` **automatiquement**. Ne pas rappeler `syncMissionFuelTotals()` côté applicatif — ce serait redondant et source de confusion.
Le code applicatif lit simplement les totaux depuis la mission après commit.

### 4. Protection des champs calculés
Le `PATCH /api/missions/:id` (édition manuelle) doit **ignorer** `actualFuelCost` et `actualFuelQuantity` pour ne pas écraser les totaux calculés par le trigger.

### 5. Autorisation chauffeur
Le chauffeur (rôle `driver`) ne peut enregistrer un plein que pour la mission qui lui est assignée.
Jointure : `assignments → drivers` où `drivers.userId = req.session.userId`.

### 6. Date rétroactive
Pas de contrainte stricte sur la date saisie — un plein peut être déclaré après la mission. Accepter toute date passée dans les 90 jours.

### 7. Race condition solde (futur)
`getCurrentBalance()` + `INSERT` ne sont pas dans une transaction explicite. Volume faible = risque acceptable pour le MVP. À sécuriser en V2 avec `BEGIN/COMMIT` autour du SELECT + INSERT dans le service.

### 8. Changement de mission d'un plein (cas correction)
Si un `fuel_record` passe de `mission_id = A` à `mission_id = B`, recalculer **A et B** dans le trigger.
Sinon, la mission source garde un coût/litrage fantôme.

---

## Invalidation cache React Query

Après chaque mutation carburant, invalider :
```ts
queryClient.invalidateQueries({ queryKey: [`/api/missions/${id}/fuel-records`] });
queryClient.invalidateQueries({ queryKey: [`/api/missions/${id}`] }); // totaux recalculés
queryClient.invalidateQueries({ queryKey: ["/api/drivers/me"] }); // dashboard chauffeur
queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] }); // page /fuel
queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/statistics"] }); // KPI carte
```

## Temps réel (WebSocket) — vues à rafraîchir immédiatement

Événement émis après création d'un plein mission : `mission_fuel_recorded`

Vues concernées :
- Détail mission (`/missions/:id`) : onglet détails + onglet carburant + KPI budget/réel
- Dashboard chauffeur (`/driver/dashboard`) : mission active + alertes
- Module carburant (`/fuel`) : solde carte + historique carte + statistiques
- Dashboards KPI (admin/logistique) qui affichent des données carburant

Règle :
- À la réception WS, invalider les query keys ci-dessus (pas seulement polling).

---

## Fichiers à modifier

| Fichier | Action |
|---|---|
| `shared/schema.ts` | Ajouter `missionId` dans fuelRecords + relations |
| `server/init-database.ts` | Ajouter migration SQL + trigger |
| `server/services/fuel-card-service.ts` | Étendre `recordConsumption` + 2 nouvelles méthodes |
| `server/api/missions.routes.ts` | GET + POST fuel-records + warning clôture |
| `client/src/pages/missions/[id].tsx` | Onglet Carburant |
| `client/src/pages/driver/dashboard.tsx` | FuelSheet + bouton |
| `client/src/hooks/useRealTimeSync.ts` | Invalider sur `mission_fuel_recorded` |
