# Matrice des onglets `PremiumTabsNav`

Référence de couverture : **24 pages**, **~85 onglets**, tous avec icône via prop `icon` + helper `TabIcon`.

> **Convention :** prop `icon={<TabIcon icon={LucideIcon} />}` + `label` texte seul. Badges/compteurs dynamiques restent dans `label`.

## Récapitulatif par profil

| Profil | Pages avec onglets | Onglets |
|--------|-------------------|---------|
| **admin** | Dashboard, Détail véhicule, Documents flotte, Détail mission, Détail OT, GMAO, Interventions, Utilisateurs, Techniciens, Chauffeurs, Détail chauffeur, Rapports, Profil | 40+ |
| **warehouse** | Dashboard magasinier, Détail OT | 5 |
| **workshop_manager** | Dashboard chef d'atelier, Détail véhicule, Détail OT, GMAO, Interventions, Techniciens, Rapports | 25+ |
| **technician** | Dashboard, Mes OT, Carburant, Profil technicien, Détail véhicule, Détail OT, GMAO, Interventions, Profil | 20+ |
| **secretary** | Dashboard, Détail véhicule, Documents flotte, Détail mission, Chauffeurs, Détail chauffeur, Rapports, Profil | 20+ |
| **logistics** | Dashboard, Détail véhicule, Documents flotte, Détail mission, Chauffeurs, Détail chauffeur | 15+ |
| **client** | Dashboard client, Profil | 4 |
| **fallback** | Dashboard générique, Profil | 4 |

---

## Détail complet (page → profil → onglets)

| Page | Route | Profil(s) | Onglet (value) | Label | Icône | Statut |
|------|-------|-----------|----------------|-------|-------|--------|
| **Dashboard magasinier** | `/dashboard` | `warehouse` | stock | Stock | `Package` | OK |
| | | | inventory | Inventaire | `ClipboardList` | OK |
| | | | alerts | Alertes | `AlertTriangle` | OK |
| | | | movements | Mouvements | `ArrowLeftRight` | OK |
| **Dashboard admin** | `/dashboard` | `admin` | overview | Vue d'ensemble | `LayoutDashboard` | OK |
| | | | financials | Financier | `Wallet` | OK |
| | | | users | Utilisateurs | `Users` | OK |
| **Dashboard chef d'atelier** | `/dashboard` | `workshop_manager` | workshop | Atelier | `Wrench` | OK |
| | | | inventory | Inventaire | `ClipboardList` | OK |
| | | | team | Équipe | `Users` | OK |
| | | | cpc | CPC | `GraduationCap` | OK |
| **Dashboard technicien** | `/dashboard` | `technician` | work | Ordres de travail | `Wrench` | OK |
| | | | fleet | État de la flotte | `Truck` | OK |
| **Dashboard secrétaire** | `/dashboard` | `secretary` | overview | Vue d'ensemble | `LayoutDashboard` | OK |
| | | | operations | Opérations | `Briefcase` | OK |
| | | | billing | Facturation clients | `Receipt` | OK |
| | | | documents | Documents | `FileText` | OK |
| | | | mileage | Kilométrage | `Gauge` | OK |
| | | | cpc | CPC | `GraduationCap` | OK |
| **Dashboard logistique** | `/dashboard` | `logistics` | missions | Missions | `MapPin` | OK |
| | | | documents | Documents & Chauffeurs | `FileText` | OK |
| | | | fleet | Flotte | `Truck` | OK |
| | | | fuel | Carburant | `Fuel` | OK |
| **Dashboard client** | `/dashboard` | `client` | overview | Vue d'ensemble | `LayoutDashboard` | OK |
| | | | fuel | Carburant | `Fuel` | OK |
| | | | vehicles | Véhicules | `Car` | OK |
| **Dashboard générique** | `/dashboard` | fallback | overview | Aperçu général | `LayoutDashboard` | OK |
| | | | fuel | Carburant | `Fuel` | OK |
| | | | alerts | Alertes | `Bell` | OK |
| **Détail véhicule** | `/vehicles/:id` | admin, workshop_manager, technician, secretary, logistics | details | Détails | `FileText` | OK |
| | | | maintenance | Planifications | `Calendar` | OK |
| | | | work-orders | Ordres de travail | `Wrench` | OK |
| | | | fuel | Carburant | `Fuel` | OK |
| | | | status-history | Santé du véhicule | `Activity` | OK |
| | | | documents | Documents | `FolderOpen` | OK |
| **Documents flotte** | `/vehicles/documents` | admin, secretary, logistics | documents | Documents véhicules | `FileText` | OK |
| | | | requests | Demandes de renouvellement | `FileWarning` | OK |
| **Détail mission** | `/missions/:id` | admin, logistics, secretary | details | Détails | `FileText` | OK |
| | | | fuel | Carburant | `Fuel` | OK |
| | | | invoices | Factures | `Receipt` | OK |
| | | | print | Imprimer | `Printer` | OK |
| **Détail OT** | `/maintenance/work-orders/:id` | admin, workshop_manager, technician, warehouse | details | Détails | `Wrench` | OK |
| | | | parts | Pièces | `Package` | OK |
| | | | tires | Pneus | `Circle` | OK |
| | | | report | Rapport | `FileText` | OK |
| **Centre GMAO** | `/maintenance/gmao-dashboard` | admin, workshop_manager, technician | overview | Vue d'ensemble | `Gauge` | OK |
| | | | calendar | Calendrier | `CalendarDays` | OK |
| | | | assignments | Affectations | `Users` | OK |
| | | | analytics | Analyses | `TrendingUp` | OK |
| **Interventions** | `/maintenance/interventions` | admin, workshop_manager, technician | pending | En attente | `Clock` | OK |
| | | | in_progress | En cours | `PlayCircle` | OK |
| | | | awaiting_parts | Attente pièces | `Package` | OK |
| | | | completed | Terminées | `CheckCircle2` | OK |
| | | | cancelled | Annulées | `XCircle` | OK |
| | | | all | Tous | `Wrench` | OK |
| **Mes OT (technicien)** | `/technician/my-work-orders` | `technician` | pending | En attente | `Clock` | OK |
| | | | in_progress | En cours | `PlayCircle` | OK |
| | | | completed | Terminés | `CheckCircle2` | OK |
| | | | recent | Cette semaine | `Calendar` | OK |
| **Profil technicien** | `/technician/profile` | `technician` | overview | Vue d'ensemble | `User` | OK |
| | | | performance | Performance | `TrendingUp` | OK |
| | | | costs | Coûts & Budget | `Euro` | OK |
| | | | activity | Activité | `Activity` | OK |
| **Profil général** | `/profile` | tous | info | Informations | `User` | OK |
| | | | security | Sécurité | `Key` | OK |
| **Utilisateurs admin** | `/admin/users` | `admin` | users | Utilisateurs | `Users` | OK |
| | | | employees | Chauffeurs | `Briefcase` | OK |
| **Techniciens** | `/technicians` | admin, workshop_manager | technicians | Techniciens | `HardHat` | OK |
| | | | managers | Chefs d'atelier | `Users` | OK |
| **Chauffeurs** | `/drivers` | admin, logistics, secretary | list | Liste des Chauffeurs | `Users` | OK |
| | | | stats | Statistiques CPC | `GraduationCap` | OK |
| **Détail chauffeur** | `/drivers/:id` | admin, logistics, secretary | info | Informations | `IdCard` | OK |
| | | | missions | Missions | `Truck` | OK |
| **Rapports** | `/reports` | admin, workshop_manager (+ rôles filtrés) | reports | Rapports | `FileText` | OK |
| | | | exports | Exports | `Download` | OK |
| | | | documentation | Documentation | `BookOpen` | OK (admin, secretary) |

---

## Fichiers source (24 pages)

| Fichier | Route |
|---------|-------|
| `client/src/pages/warehouse/dashboard.tsx` | `/dashboard` (warehouse) |
| `client/src/pages/admin/dashboard.tsx` | `/dashboard` (admin) |
| `client/src/pages/workshop-manager/dashboard.tsx` | `/dashboard` (workshop_manager) |
| `client/src/pages/technician/dashboard.tsx` | `/dashboard` (technician) |
| `client/src/pages/secretary/dashboard.tsx` | `/dashboard` (secretary) |
| `client/src/pages/logistics/dashboard.tsx` | `/dashboard` (logistics) |
| `client/src/pages/client/dashboard.tsx` | `/dashboard` (client) |
| `client/src/pages/dashboard.tsx` | `/dashboard` (fallback) |
| `client/src/pages/vehicles/[id].tsx` | `/vehicles/:id` |
| `client/src/pages/vehicles/documents.tsx` | `/vehicles/documents` |
| `client/src/pages/missions/[id].tsx` | `/missions/:id` |
| `client/src/pages/maintenance/work-orders/[id].tsx` | `/maintenance/work-orders/:id` |
| `client/src/pages/maintenance/gmao-dashboard.tsx` | `/maintenance/gmao-dashboard` |
| `client/src/pages/maintenance/interventions.tsx` | `/maintenance/interventions` |
| `client/src/pages/technician/my-work-orders.tsx` | `/technician/my-work-orders` |
| `client/src/pages/technician/profile.tsx` | `/technician/profile` |
| `client/src/pages/profile.tsx` | `/profile` |
| `client/src/pages/admin/users.tsx` | `/admin/users` |
| `client/src/pages/technicians/index.tsx` | `/technicians` |
| `client/src/pages/drivers/index.tsx` | `/drivers` |
| `client/src/pages/drivers/[id].tsx` | `/drivers/:id` |
| `client/src/pages/reports/index.tsx` | `/reports` |

## Légende statut

- **OK** — icône via prop `icon` + `TabIcon` (badges dynamiques dans `label` uniquement)
- Mettre à jour ce tableau si un nouvel écran ajoute des onglets

## Helper

```tsx
import { TabIcon } from "@/lib/premium-tab-icons";
import { Package } from "lucide-react";

{ value: "stock", label: "Stock", icon: <TabIcon icon={Package} /> }
```
