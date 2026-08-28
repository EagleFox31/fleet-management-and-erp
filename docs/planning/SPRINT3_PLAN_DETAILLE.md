# 🚀 SPRINT 3 - PLANIFICATION DÉTAILLÉE
## Services Avancés & Enrichissement Dashboards

**Date:** 6 octobre 2025  
**Sprint:** Phase 2 - Sprint 3 (Semaines 5-6)  
**Durée:** 11 jours  
**Architecture:** Modulaire progressive (Backend API + Frontend avec visualisations)

---

## 🎯 OBJECTIFS DU SPRINT 3

### Vision globale
Développer les **services avancés** (Véhicules, CPC/Formations) et **enrichir les dashboards** avec des graphiques interactifs (histogrammes, courbes, charts) pour une visualisation métier complète.

### Résultats attendus
- ✅ Service Véhicules & Documentation opérationnel (27 véhicules)
- ✅ Service CPC & Formations complet (27 chauffeurs)
- ✅ Dashboards enrichis avec visualisations graphiques (comme dashboard original)
- ✅ Architecture modulaire respectée (API + Services + Frontend)
- ✅ Tests e2e et intégration continue

---

## 🏗️ ARCHITECTURE MODULAIRE

### **Backend - Structure API**
```
server/
├── api/
│   ├── index.ts                    # Router principal
│   ├── warehouse.routes.ts         # ✅ Existant Sprint 1
│   ├── fuel-card.routes.ts         # ✅ Existant Sprint 1
│   ├── vehicles.routes.ts          # 🆕 Sprint 3 - Routes véhicules
│   └── drivers.routes.ts           # 🆕 Sprint 3 - Routes chauffeurs/CPC
├── services/
│   ├── parts-service.ts            # ✅ Existant
│   ├── fuel-card-service.ts        # ✅ Existant
│   ├── vehicle-documentation-service.ts  # 🆕 Sprint 3
│   └── cpc-training-service.ts     # 🆕 Sprint 3
```

### **Frontend - Structure Dashboards**
```
client/src/
├── pages/
│   ├── warehouse/dashboard.tsx     # ✅ Existant - À enrichir avec charts
│   ├── logistics/dashboard.tsx     # ✅ Existant - À enrichir avec charts
│   ├── secretary/dashboard.tsx     # ✅ Existant - À enrichir avec charts
│   ├── workshop-manager/dashboard.tsx  # 🆕 À enrichir CPC charts
│   └── technician/dashboard.tsx    # 🆕 À enrichir disponibilité pièces
├── components/
│   ├── charts/                     # 🆕 Sprint 3
│   │   ├── vehicle-status-chart.tsx        # Histogramme statuts véhicules
│   │   ├── cpc-status-chart.tsx           # Chart statuts formations
│   │   ├── document-expiry-chart.tsx      # Timeline expirations
│   │   ├── parts-consumption-chart.tsx    # Consommation pièces
│   │   └── fuel-consumption-chart.tsx     # Courbe consommation carburant
│   └── vehicles/                   # 🆕 Sprint 3
│       ├── document-expiry-panel.tsx
│       ├── mileage-update-form.tsx
│       └── maintenance-position-tracker.tsx
```

---

## 📋 TÂCHES DÉTAILLÉES

### **JOUR 1-3 : Service Véhicules & Documentation** 🔴

#### **JOUR 1 : Backend Service + API**

**Tâche 1.1 : Créer Vehicle Documentation Service** (3h)
```typescript
// server/services/vehicle-documentation-service.ts

export class VehicleDocumentationService {
  /**
   * Récupère les documents expirant bientôt
   * Exploite: 22 véhicules avec dates documentaires
   */
  async getExpiringDocuments(daysBeforeExpiry: number = 30) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysBeforeExpiry);
    
    return {
      carteGrise: await db.select()
        .from(vehicles)
        .where(and(
          lte(vehicles.licensePlateExpiry, expiryDate),
          gte(vehicles.licensePlateExpiry, new Date())
        )),
      assurance: await db.select()
        .from(vehicles)
        .where(and(
          lte(vehicles.insuranceExpiry, expiryDate),
          gte(vehicles.insuranceExpiry, new Date())
        )),
      visiteTechnique: await db.select()
        .from(vehicles)
        .where(and(
          lte(vehicles.technicalInspectionDate, expiryDate),
          gte(vehicles.technicalInspectionDate, new Date())
        ))
    };
  }

  /**
   * Récupère les documents déjà expirés
   */
  async getExpiredDocuments() {
    const now = new Date();
    
    return await db.select()
      .from(vehicles)
      .where(or(
        lt(vehicles.licensePlateExpiry, now),
        lt(vehicles.insuranceExpiry, now),
        lt(vehicles.technicalInspectionDate, now)
      ));
  }

  /**
   * Mise à jour kilométrage temps réel
   * Exploite: currentKilometers (27 véhicules)
   */
  async updateMileage(vehicleId: number, kilometers: number) {
    return await db.update(vehicles)
      .set({ 
        currentKilometers: kilometers,
        mileage: kilometers 
      })
      .where(eq(vehicles.id, vehicleId))
      .returning();
  }

  /**
   * Suivi position maintenance
   * Exploite: maintenancePosition
   */
  async updateMaintenancePosition(vehicleId: number, position: string) {
    return await db.update(vehicles)
      .set({ maintenancePosition: position })
      .where(eq(vehicles.id, vehicleId))
      .returning();
  }

  /**
   * Statistiques documents par type
   */
  async getDocumentStats() {
    const vehicles = await db.select().from(vehicles);
    
    return {
      total: vehicles.length,
      withCarteGrise: vehicles.filter(v => v.licensePlateExpiry).length,
      withAssurance: vehicles.filter(v => v.insuranceExpiry).length,
      withVisiteTechnique: vehicles.filter(v => v.technicalInspectionDate).length,
      expiringCarteGrise: /* calcul */,
      expiringAssurance: /* calcul */,
      expiringVisiteTechnique: /* calcul */
    };
  }
}
```

**Tâche 1.2 : Créer API Routes Véhicules** (2h)
```typescript
// server/api/vehicles.routes.ts

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { vehicleDocumentationService } from "../services/vehicle-documentation-service";

const router = Router();

// Toutes les routes nécessitent authentification
router.use(authenticate);

// GET /api/vehicles/expiring-docs?days=30
router.get("/expiring-docs", async (req, res) => {
  const days = parseInt(req.query.days as string) || 30;
  const docs = await vehicleDocumentationService.getExpiringDocuments(days);
  res.json(docs);
});

// GET /api/vehicles/expired-docs
router.get("/expired-docs", async (req, res) => {
  const docs = await vehicleDocumentationService.getExpiredDocuments();
  res.json(docs);
});

// PUT /api/vehicles/:id/mileage
router.put("/:id/mileage", async (req, res) => {
  const { kilometers } = req.body;
  const vehicle = await vehicleDocumentationService.updateMileage(
    parseInt(req.params.id),
    kilometers
  );
  res.json(vehicle);
});

// PUT /api/vehicles/:id/maintenance-position
router.put("/:id/maintenance-position", async (req, res) => {
  const { position } = req.body;
  const vehicle = await vehicleDocumentationService.updateMaintenancePosition(
    parseInt(req.params.id),
    position
  );
  res.json(vehicle);
});

// GET /api/vehicles/document-stats
router.get("/document-stats", async (req, res) => {
  const stats = await vehicleDocumentationService.getDocumentStats();
  res.json(stats);
});

export default router;
```

**Tâche 1.3 : Monter les routes dans API principal** (30min)
```typescript
// server/api/index.ts

import vehiclesRoutes from "./vehicles.routes";

apiRouter.use("/vehicles", vehiclesRoutes);

// Update health check
services: {
  warehouse: "...",
  fuelCard: "...",
  vehicles: "Documentation & Maintenance (27 véhicules)"  // 🆕
}
```

#### **JOUR 2 : Frontend Components Véhicules** (6h)

**Tâche 2.1 : Document Expiry Panel** (2h)
```tsx
// client/src/components/vehicles/document-expiry-panel.tsx

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export function DocumentExpiryPanel() {
  const { data: expiringDocs } = useQuery({
    queryKey: ["/api/vehicles/expiring-docs"],
  });

  const { data: expiredDocs } = useQuery({
    queryKey: ["/api/vehicles/expired-docs"],
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center">
          🪪 Cartes Grises
        </h3>
        <div className="space-y-2">
          {expiringDocs?.carteGrise?.map(v => (
            <div key={v.id} className="flex justify-between items-center">
              <span className="text-sm">{v.registrationNumber}</span>
              <Badge variant="warning">
                {formatDate(v.licensePlateExpiry)}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center">
          🛡️ Assurances
        </h3>
        {/* Similar structure */}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center">
          🔧 Visites Techniques
        </h3>
        {/* Similar structure */}
      </Card>
    </div>
  );
}
```

**Tâche 2.2 : Mileage Update Form** (1.5h)
```tsx
// client/src/components/vehicles/mileage-update-form.tsx

export function MileageUpdateForm({ vehicleId }: { vehicleId: number }) {
  const mutation = useMutation({
    mutationFn: async (kilometers: number) => {
      return await apiRequest(`/api/vehicles/${vehicleId}/mileage`, {
        method: "PUT",
        body: JSON.stringify({ kilometers }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["/api/vehicles"]);
      toast({ title: "Kilométrage mis à jour" });
    },
  });

  return (
    <form onSubmit={handleSubmit}>
      {/* Input kilométrage avec validation */}
    </form>
  );
}
```

**Tâche 2.3 : Chart Timeline Expirations** (2.5h)
```tsx
// client/src/components/charts/document-expiry-chart.tsx

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export function DocumentExpiryChart() {
  const { data: stats } = useQuery({
    queryKey: ["/api/vehicles/document-stats"],
  });

  const chartData = [
    {
      name: "Carte Grise",
      valides: stats?.withCarteGrise - stats?.expiringCarteGrise,
      expirantBientot: stats?.expiringCarteGrise,
      expires: stats?.expiredCarteGrise,
    },
    {
      name: "Assurance",
      valides: stats?.withAssurance - stats?.expiringAssurance,
      expirantBientot: stats?.expiringAssurance,
      expires: stats?.expiredAssurance,
    },
    {
      name: "Visite Tech",
      valides: stats?.withVisiteTechnique - stats?.expiringVisiteTechnique,
      expirantBientot: stats?.expiringVisiteTechnique,
      expires: stats?.expiredVisiteTechnique,
    },
  ];

  return (
    <BarChart width={600} height={300} data={chartData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis />
      <Tooltip />
      <Legend />
      <Bar dataKey="valides" fill="#10b981" name="Valides" />
      <Bar dataKey="expirantBientot" fill="#f59e0b" name="Expirant bientôt" />
      <Bar dataKey="expires" fill="#ef4444" name="Expirés" />
    </BarChart>
  );
}
```

#### **JOUR 3 : Intégration Dashboard Secrétaire** (6h)

**Tâche 3.1 : Enrichir Secretary Dashboard** (4h)
```tsx
// client/src/pages/secretary/dashboard.tsx

import { DocumentExpiryPanel } from "@/components/vehicles/document-expiry-panel";
import { DocumentExpiryChart } from "@/components/charts/document-expiry-chart";
import { MileageUpdateForm } from "@/components/vehicles/mileage-update-form";

export default function SecretaryDashboard() {
  return (
    <div>
      <PageHeader
        title="Dashboard Secrétaire"
        subtitle="Gestion documentaire et administrative"
      />

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">📄 Documents</TabsTrigger>
          <TabsTrigger value="kilométrage">🛣️ Kilométrage</TabsTrigger>
          <TabsTrigger value="statistiques">📊 Statistiques</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <DocumentExpiryPanel />
        </TabsContent>

        <TabsContent value="kilométrage">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Liste véhicules avec mise à jour kilométrage */}
          </div>
        </TabsContent>

        <TabsContent value="statistiques">
          <div className="bg-white rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">
              État des Documents Véhicules
            </h3>
            <DocumentExpiryChart />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Tâche 3.2 : Tests e2e Dashboard Secrétaire** (2h)
- Test affichage documents expirants
- Test mise à jour kilométrage
- Test visualisation graphique

---

### **JOUR 4-6 : Service CPC & Formations** 🔴

#### **JOUR 4 : Backend Service CPC** (6h)

**Tâche 4.1 : Créer CPC Training Service** (4h)
```typescript
// server/services/cpc-training-service.ts

export class CPCTrainingService {
  /**
   * Calcul statut CPC selon formule:
   * - FORMÉ: date CPC + 731 jours > aujourd'hui + 59 jours
   * - À FORMER: date CPC + 731 jours <= aujourd'hui + 59 jours
   * - NON FORMÉ: pas de date CPC
   */
  calculateCPCStatus(cpcDate: Date | null): 'FORMÉ' | 'À FORMER' | 'NON FORMÉ' {
    if (!cpcDate) return 'NON FORMÉ';
    
    const now = new Date();
    const expiryDate = new Date(cpcDate);
    expiryDate.setDate(expiryDate.getDate() + 731);
    
    const alertDate = new Date(now);
    alertDate.setDate(alertDate.getDate() + 59);
    
    return expiryDate > alertDate ? 'FORMÉ' : 'À FORMER';
  }

  /**
   * Récupère tous les chauffeurs avec statut CPC
   * Exploite: 27 chauffeurs avec firstName, lastName
   */
  async getAllDriversStatus() {
    const drivers = await db.select().from(drivers);
    
    return drivers.map(driver => {
      const expiryDate = driver.cpcDate ? 
        new Date(driver.cpcDate.getTime() + 731 * 24 * 60 * 60 * 1000) : null;
      
      const daysRemaining = expiryDate ? 
        Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
      
      return {
        id: driver.id,
        firstName: driver.firstName,
        lastName: driver.lastName,
        cpcStatus: this.calculateCPCStatus(driver.cpcDate),
        cpcDate: driver.cpcDate,
        expiryDate,
        daysRemaining
      };
    });
  }

  /**
   * Alertes formations CPC (59 jours avant expiration)
   */
  async getExpiringCPCAlerts() {
    const statuses = await this.getAllDriversStatus();
    return statuses.filter(s => s.cpcStatus === 'À FORMER');
  }

  /**
   * Mise à jour certification CPC
   */
  async updateCPCCertification(driverId: number, newDate: Date) {
    return await db.update(drivers)
      .set({ cpcDate: newDate })
      .where(eq(drivers.id, driverId))
      .returning();
  }

  /**
   * Statistiques formations par statut
   */
  async getCPCStatistics() {
    const statuses = await this.getAllDriversStatus();
    
    return {
      total: statuses.length,
      forme: statuses.filter(s => s.cpcStatus === 'FORMÉ').length,
      aFormer: statuses.filter(s => s.cpcStatus === 'À FORMER').length,
      nonForme: statuses.filter(s => s.cpcStatus === 'NON FORMÉ').length
    };
  }
}
```

**Tâche 4.2 : Créer API Routes Drivers/CPC** (2h)
```typescript
// server/api/drivers.routes.ts

const router = Router();
router.use(authenticate);

// GET /api/drivers/cpc-status
router.get("/cpc-status", async (req, res) => {
  const statuses = await cpcTrainingService.getAllDriversStatus();
  res.json(statuses);
});

// GET /api/drivers/expiring-cpc
router.get("/expiring-cpc", async (req, res) => {
  const alerts = await cpcTrainingService.getExpiringCPCAlerts();
  res.json(alerts);
});

// POST /api/drivers/:id/update-cpc
router.post("/:id/update-cpc", async (req, res) => {
  const { cpcDate } = req.body;
  const driver = await cpcTrainingService.updateCPCCertification(
    parseInt(req.params.id),
    new Date(cpcDate)
  );
  res.json(driver);
});

// GET /api/drivers/cpc-statistics
router.get("/cpc-statistics", async (req, res) => {
  const stats = await cpcTrainingService.getCPCStatistics();
  res.json(stats);
});

export default router;
```

#### **JOUR 5 : Frontend Components CPC** (6h)

**Tâche 5.1 : CPC Status Chart** (2.5h)
```tsx
// client/src/components/charts/cpc-status-chart.tsx

import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

export function CPCStatusChart() {
  const { data: stats } = useQuery({
    queryKey: ["/api/drivers/cpc-statistics"],
  });

  const chartData = [
    { name: "FORMÉ", value: stats?.forme || 0, color: "#10b981" },
    { name: "À FORMER", value: stats?.aFormer || 0, color: "#f59e0b" },
    { name: "NON FORMÉ", value: stats?.nonForme || 0, color: "#ef4444" },
  ];

  return (
    <PieChart width={400} height={300}>
      <Pie
        data={chartData}
        cx={200}
        cy={150}
        labelLine={false}
        label={({ name, value }) => `${name}: ${value}`}
        outerRadius={80}
        fill="#8884d8"
        dataKey="value"
      >
        {chartData.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={entry.color} />
        ))}
      </Pie>
      <Tooltip />
      <Legend />
    </PieChart>
  );
}
```

**Tâche 5.2 : CPC Alerts Panel** (2h)
```tsx
// client/src/components/drivers/cpc-alerts-panel.tsx

export function CPCAlertsPanel() {
  const { data: alerts } = useQuery({
    queryKey: ["/api/drivers/expiring-cpc"],
  });

  return (
    <Card>
      <CardHeader>
        <h3 className="font-semibold">⚠️ Formations CPC à renouveler</h3>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {alerts?.map(driver => (
            <div key={driver.id} className="flex justify-between items-center p-3 bg-orange-50 rounded">
              <div>
                <p className="font-medium">
                  {driver.firstName} {driver.lastName}
                </p>
                <p className="text-sm text-gray-600">
                  Expire dans {driver.daysRemaining} jours
                </p>
              </div>
              <Badge variant="warning">{driver.cpcStatus}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

**Tâche 5.3 : CPC Update Form** (1.5h)
```tsx
// client/src/components/drivers/cpc-update-form.tsx

export function CPCUpdateForm({ driverId }: { driverId: number }) {
  const mutation = useMutation({
    mutationFn: async (cpcDate: Date) => {
      return await apiRequest(`/api/drivers/${driverId}/update-cpc`, {
        method: "POST",
        body: JSON.stringify({ cpcDate }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["/api/drivers"]);
      toast({ title: "Formation CPC mise à jour" });
    },
  });

  return (
    <form onSubmit={handleSubmit}>
      {/* Date picker + validation */}
    </form>
  );
}
```

#### **JOUR 6 : Intégration Dashboard Chef d'Atelier** (6h)

**Tâche 6.1 : Enrichir Workshop Manager Dashboard** (4h)
```tsx
// client/src/pages/workshop-manager/dashboard.tsx

import { CPCStatusChart } from "@/components/charts/cpc-status-chart";
import { CPCAlertsPanel } from "@/components/drivers/cpc-alerts-panel";

export default function WorkshopManagerDashboard() {
  return (
    <div>
      <PageHeader
        title="Dashboard Chef d'Atelier"
        subtitle="Équipe, formations CPC et maintenance"
      />

      <Tabs defaultValue="cpc">
        <TabsList>
          <TabsTrigger value="cpc">👨‍🎓 Formations CPC</TabsTrigger>
          <TabsTrigger value="equipe">👥 Équipe</TabsTrigger>
          <TabsTrigger value="maintenance">🔧 Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="cpc" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <KPICard
              title="Chauffeurs Formés"
              value={stats?.forme || 0}
              subValue={`/ ${stats?.total || 0} total`}
              icon="check-circle"
              iconColor="text-green-600"
            />
            <KPICard
              title="À Former"
              value={stats?.aFormer || 0}
              subValue="Alertes actives"
              icon="alert-triangle"
              iconColor="text-orange-600"
            />
            <KPICard
              title="Non Formés"
              value={stats?.nonForme || 0}
              subValue="Nécessite formation"
              icon="x-circle"
              iconColor="text-red-600"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-6">
              <h3 className="font-semibold mb-4">Répartition Statuts CPC</h3>
              <CPCStatusChart />
            </div>
            
            <CPCAlertsPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Tâche 6.2 : Tests e2e Workshop Manager** (2h)

---

### **JOUR 7-9 : Enrichissement Dashboards avec Graphiques** 🟡

#### **JOUR 7 : Graphiques Magasinier** (6h)

**Tâche 7.1 : Parts Consumption Chart** (2.5h)
```tsx
// client/src/components/charts/parts-consumption-chart.tsx

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export function PartsConsumptionChart() {
  const { data: topParts } = useQuery({
    queryKey: ["/api/parts/most-used"],
  });

  const chartData = topParts?.map(part => ({
    name: part.name,
    quantite: part.usageCount,
    valeur: part.usageValue,
  })) || [];

  return (
    <BarChart width={600} height={300} data={chartData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
      <YAxis yAxisId="left" />
      <YAxis yAxisId="right" orientation="right" />
      <Tooltip />
      <Legend />
      <Bar yAxisId="left" dataKey="quantite" fill="#3b82f6" name="Quantité" />
      <Bar yAxisId="right" dataKey="valeur" fill="#10b981" name="Valeur (FCFA)" />
    </BarChart>
  );
}
```

**Tâche 7.2 : Stock Value by Category Chart** (2h)
```tsx
// client/src/components/charts/stock-value-chart.tsx

import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

export function StockValueChart() {
  const { data: inventory } = useQuery({
    queryKey: ["/api/parts/inventory-value"],
  });

  const chartData = Object.entries(inventory?.byCategory || {}).map(([name, data]) => ({
    name,
    value: data.value,
    count: data.count,
  }));

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <PieChart width={500} height={300}>
      <Pie
        data={chartData}
        cx={250}
        cy={150}
        labelLine={false}
        label={({ name, value }) => `${name}: ${formatPrice(value)}`}
        outerRadius={100}
        fill="#8884d8"
        dataKey="value"
      >
        {chartData.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
        ))}
      </Pie>
      <Tooltip formatter={(value) => formatPrice(value as number)} />
      <Legend />
    </PieChart>
  );
}
```

**Tâche 7.3 : Intégrer dans Warehouse Dashboard** (1.5h)
```tsx
// Ajouter dans client/src/pages/warehouse/dashboard.tsx

<TabsContent value="statistiques">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    <Card className="p-6">
      <h3 className="font-semibold mb-4">Répartition Valeur Stock</h3>
      <StockValueChart />
    </Card>
    
    <Card className="p-6">
      <h3 className="font-semibold mb-4">Pièces les Plus Consommées</h3>
      <PartsConsumptionChart />
    </Card>
  </div>
</TabsContent>
```

#### **JOUR 8 : Graphiques Logisticien** (6h)

**Tâche 8.1 : Fuel Consumption Trend Chart** (2.5h)
```tsx
// client/src/components/charts/fuel-consumption-chart.tsx

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export function FuelConsumptionChart() {
  const { data: history } = useQuery({
    queryKey: ["/api/fuel-card/history", { year: 2025, month: 8 }],
  });

  const chartData = history?.map(record => ({
    date: formatDate(record.date),
    litres: record.quantity,
    montant: record.debitAmount || 0,
  })) || [];

  return (
    <LineChart width={700} height={300} data={chartData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="date" />
      <YAxis yAxisId="left" />
      <YAxis yAxisId="right" orientation="right" />
      <Tooltip />
      <Legend />
      <Line 
        yAxisId="left" 
        type="monotone" 
        dataKey="litres" 
        stroke="#3b82f6" 
        name="Litres"
        strokeWidth={2}
      />
      <Line 
        yAxisId="right" 
        type="monotone" 
        dataKey="montant" 
        stroke="#10b981" 
        name="Montant (FCFA)"
        strokeWidth={2}
      />
    </LineChart>
  );
}
```

**Tâche 8.2 : Vehicle Availability Chart** (2h)
```tsx
// client/src/components/charts/vehicle-status-chart.tsx

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export function VehicleStatusChart() {
  const { data: fleet } = useQuery({
    queryKey: ["/api/statistics/fleet"],
  });

  const chartData = [
    { 
      status: "Opérationnel", 
      count: parseInt(fleet?.operational || 0),
      color: "#10b981" 
    },
    { 
      status: "Maintenance", 
      count: parseInt(fleet?.maintenance || 0),
      color: "#f59e0b" 
    },
    { 
      status: "Hors Service", 
      count: parseInt(fleet?.outOfService || 0),
      color: "#ef4444" 
    },
  ];

  return (
    <BarChart width={500} height={300} data={chartData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="status" />
      <YAxis />
      <Tooltip />
      <Bar dataKey="count" fill="#3b82f6">
        {chartData.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={entry.color} />
        ))}
      </Bar>
    </BarChart>
  );
}
```

**Tâche 8.3 : Intégrer dans Logistics Dashboard** (1.5h)

#### **JOUR 9 : Graphiques Technicien** (6h)

**Tâche 9.1 : Work Orders Status Chart** (2h)
**Tâche 9.2 : Parts Availability Status** (2h)
**Tâche 9.3 : Intégration Dashboard** (2h)

---

### **JOUR 10-11 : Tests & Intégration Continue** ✅

#### **JOUR 10 : Tests e2e Complets** (6h)

**Tâche 10.1 : Tests Service Véhicules** (2h)
```typescript
// Tests à créer:
describe("Vehicle Documentation Service", () => {
  test("récupère documents expirants", async () => {
    const docs = await vehicleDocService.getExpiringDocuments(30);
    expect(docs.carteGrise).toBeDefined();
    expect(docs.assurance).toBeDefined();
  });

  test("met à jour kilométrage", async () => {
    const vehicle = await vehicleDocService.updateMileage(1, 150000);
    expect(vehicle.currentKilometers).toBe(150000);
  });
});
```

**Tâche 10.2 : Tests Service CPC** (2h)
**Tâche 10.3 : Tests Frontend Graphiques** (2h)

#### **JOUR 11 : Intégration & Documentation** (6h)

**Tâche 11.1 : Tests intégration complète** (3h)
- Test flux complet secrétaire
- Test flux complet chef d'atelier
- Test flux complet logisticien

**Tâche 11.2 : Documentation API** (2h)
```markdown
# API Documentation Sprint 3

## Véhicules & Documentation
- GET /api/vehicles/expiring-docs?days=30
- GET /api/vehicles/expired-docs
- PUT /api/vehicles/:id/mileage
- GET /api/vehicles/document-stats

## Chauffeurs & CPC
- GET /api/drivers/cpc-status
- GET /api/drivers/expiring-cpc
- POST /api/drivers/:id/update-cpc
- GET /api/drivers/cpc-statistics
```

**Tâche 11.3 : Revue code & corrections** (1h)

---

## 📊 COMPOSANTS GRAPHIQUES CRÉÉS

### **Charts Sprint 3** 📈
1. **DocumentExpiryChart** - Histogramme documents véhicules
2. **CPCStatusChart** - Pie chart statuts formations
3. **PartsConsumptionChart** - Barres consommation pièces
4. **StockValueChart** - Pie chart valeur par catégorie
5. **FuelConsumptionChart** - Courbe consommation carburant
6. **VehicleStatusChart** - Histogramme disponibilité véhicules

### **Panels Enrichis**
1. **DocumentExpiryPanel** - Alertes documents
2. **CPCAlertsPanel** - Alertes formations
3. **MileageUpdateForm** - Mise à jour kilométrage
4. **CPCUpdateForm** - Mise à jour CPC

---

## ✅ CRITÈRES DE SUCCÈS SPRINT 3

### **Backend**
- ✅ Service Vehicle Documentation opérationnel (27 véhicules)
- ✅ Service CPC Training complet (27 chauffeurs)
- ✅ APIs modulaires montées dans /api/vehicles et /api/drivers
- ✅ Tests unitaires services > 80% couverture

### **Frontend**
- ✅ 6 nouveaux composants graphiques (recharts)
- ✅ Dashboard secrétaire enrichi (documents + charts)
- ✅ Dashboard chef d'atelier enrichi (CPC + charts)
- ✅ Dashboards magasinier/logisticien avec graphiques
- ✅ Visualisations interactives et responsives

### **Architecture**
- ✅ Architecture modulaire respectée
- ✅ Séparation concerns (API/Services/Components)
- ✅ Hooks personnalisés pour data fetching
- ✅ Code réutilisable et maintenable

### **Tests**
- ✅ Tests e2e tous les dashboards
- ✅ Tests unitaires services backend
- ✅ Tests components graphiques
- ✅ Intégration continue validée

---

## 📈 MÉTRIQUES DE PERFORMANCE

### **Temps de réponse API**
- GET /api/vehicles/* : < 200ms
- GET /api/drivers/* : < 200ms
- Graphiques render : < 500ms

### **Données exploitées**
- ✅ 27 véhicules avec documentation
- ✅ 27 chauffeurs avec CPC
- ✅ Calculs temps réel statuts
- ✅ Alertes automatiques

---

## 🎯 LIVRABLES SPRINT 3

### **Code**
1. ✅ 2 nouveaux services backend
2. ✅ 2 nouveaux routers API
3. ✅ 6 composants graphiques
4. ✅ 4 dashboards enrichis

### **Documentation**
1. ✅ API documentation complète
2. ✅ Guide utilisation charts
3. ✅ Tests e2e documentation

### **Déploiement**
1. ✅ Migration schémas si nécessaire
2. ✅ Seed data CPC/Véhicules
3. ✅ Tests intégration continue

---

**Fin Sprint 3 - Prêt pour Sprint 4 (Opérations & Facturation Clients)**

*Document créé - 6 octobre 2025*  
*Sprint 3 : Services Avancés + Enrichissement Dashboards avec Graphiques*
