# Roadmap Dashboard Administrateur

## ✅ Phase 1 — Graphiques (done)
- [x] Courbe consommation carburant mensuelle (`FuelConsumptionChart` → `/api/fuel-card/history`)
- [x] Camembert statut véhicules (`VehicleStatusPieChart` → `/api/statistics/fleet`)
- [x] Bar chart top pièces consommées (`TopPartsChart` → `/api/warehouse/top-consumed-parts`)
- [x] Bar chart CA par client (`ClientRevenueChart` → `/api/billing/statistics`)

---

## ✅ Phase 2 — Widgets d'alerte / urgence (done)

- [x] **Documents véhicules expirant** — `ExpiringDocsAlert` → `/api/vehicles/expiring-docs?days=30`
- [x] **CPC chauffeurs à renouveler** — `ExpiringCPCAlert` → `/api/drivers/expiring-cpc`
- [x] **Factures fournisseurs en retard** — `OverdueInvoicesAlert` → `/api/supplier-invoices/overdue`
- [x] **Commandes d'achat en retard** — `OverdueOrdersAlert` → `/api/purchase-orders/overdue`

---

## ✅ Phase 3 — Panel utilisateurs enrichi (done)

- [x] Tableau des users — `UsersTable` : nom, rôle coloré, date création, action désactiver
- [x] Répartition des rôles — `RolesPieChart` : donut avec couleur par rôle

---

## ✅ Phase 4 — Feed activité récente (done)

- [x] **Derniers work orders** — liste des 5 derniers créés/mis à jour (`RecentActivityFeed` → `/api/work-orders?limit=5`)
- [x] **Dernières missions** — 5 dernières missions (`RecentActivityFeed` → `/api/operations/missions`)
- [x] **Derniers mouvements stock** — pièces entrées/sorties récemment (`RecentActivityFeed` → `/api/parts/stock-movements`)

---

## ✅ Phase 5 — Vague 2 (métriques avancées) (done)

- [x] **Scorecard fournisseurs** — top 5 fournisseurs par volume (`SupplierScorecard` → `/api/suppliers/top`)
- [x] **Taux de matching 3-way** — % de factures validées vs avec écarts (`ThreeWayMatchingStats` → `/api/supplier-invoices/statistics`)
- [x] **Bouton export rapport mensuel** depuis le dashboard (`MonthlyReportExport` → `/api/exports/monthly-report?year=YYYY&month=MM`)

---

## Notes techniques
- Recharts déjà installé, pas de nouvelle dépendance nécessaire
- Patterns à suivre : voir `fleet-status-chart.tsx` et les nouveaux composants Phase 1
- Toutes les APIs nécessitent auth (cookie session)
