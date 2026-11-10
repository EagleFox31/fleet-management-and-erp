import { Switch, Route, useLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { VehicleProvider } from "@/context/vehicle-context";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { OnboardingProvider } from "@/hooks/use-onboarding";
import { PARTS_INVENTORY_ROLES } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { setupOfflinePersistence } from "@/lib/offline-storage";
import {
  isNativePlatform,
  setupHardwareBackButton,
  setupNotificationClickListener,
} from "@/lib/native-mobile";

// Components
import NotFound from "@/pages/not-found";
import AppLayout from "@/components/layout/app-layout";
import { renderLotRoutes } from "@/components/lot-routes";
import { OfflineShellGate } from "@/components/offline/offline-shell";

// Pages
import Login from "@/pages/auth/login";
import LandingPage from "@/pages/landing";
import Dashboard from "@/pages/dashboard";

// Dashboards par rôle
import DriverDashboard from "@/pages/driver/dashboard";
import AdminDashboard from "@/pages/admin/dashboard";
import WorkshopManagerDashboard from "@/pages/workshop-manager/dashboard";
import TechnicianDashboard from "@/pages/technician/dashboard";
import SecretaryDashboard from "@/pages/secretary/dashboard";
import AccountantDashboard from "@/pages/accountant/dashboard";
import LogisticsDashboard from "@/pages/logistics/dashboard";
import WarehouseDashboard from "@/pages/warehouse/dashboard";
import ManagementDashboard from "@/pages/management/dashboard";
import ManagementReportsPage from "@/pages/management/reports";
import ManagementCorridorMapPage from "@/pages/management/corridor-map";
import ManagementTeamPage from "@/pages/management/team";
import ClientDashboard from "@/pages/client/dashboard";
import ViewerDashboard from "@/pages/viewer/dashboard";

import VehiclesIndex from "@/pages/vehicles/index";
import VehicleDetails from "@/pages/vehicles/[id]";
import VehicleDetailsByRegistration from "@/pages/vehicles/immatriculation/[registration]";
import VehicleNew from "@/pages/vehicles/new";
import VehicleDocumentsPage from "@/pages/vehicles/documents";
import VehicleDocumentRenewPage from "@/pages/vehicles/document-renew";
import MaintenanceIndex from "@/pages/maintenance/index";
import InterventionsIndex from "@/pages/maintenance/interventions";
import FaultCatalogIndex from "@/pages/maintenance/fault-catalog";
import MaintenancePlanner from "@/pages/maintenance-planner";
import MaintenanceSchedules from "@/pages/maintenance-simple";
import WorkOrdersIndex from "@/pages/maintenance/work-orders";
import WorkOrderNew from "@/pages/maintenance/work-orders/new";
import WorkOrderDetails from "@/pages/maintenance/work-orders/[id]";
import InventoryIndex from "@/pages/inventory/index";
import InventoryNew from "@/pages/inventory/new";
import InventoryDetails from "@/pages/inventory/[id]";
import PartRequestsIndex from "@/pages/inventory/requests";
import InventoryMovements from "@/pages/inventory/movements";
import TiresInventoryIndex from "@/pages/inventory/tires/index";
import FuelIndex from "@/pages/fuel/index";
import FuelNew from "@/pages/fuel/new";
import FuelRecordDetail from "@/pages/fuel/[id]";
import TechniciansIndex from "@/pages/technicians/index";
import ReportsIndex from "@/pages/reports/index";
import Settings from "@/pages/settings";
import ProfilePage from "@/pages/profile";
import UsersIndex from "@/pages/users/index";
import AdminUsersPage from "@/pages/admin/users";
import RetiredVehiclesPage from "@/pages/admin/retired-vehicles";
import DocumentationPage from "@/pages/admin/documentation";
import { SUPPLIER_READ_ROLES,
  DRIVER_MANAGER_ROLES,
  FUEL_READ_ROLES,
  MISSION_MANAGER_ROLES,
  PENDING_INVOICE_ROLES,
  PROCUREMENT_ROLES,
  SUPPLIER_INVOICE_READ_ROLES,
} from "@shared/constants/roles";
import ImportBackup from "@/pages/admin/import-backup";
import { WorkflowsIndex } from "@/pages/workflows/index";
import { VehicleAcquisitionWorkflow } from "@/pages/workflows/vehicle-acquisition";
import AlertsPage from "@/pages/alerts";
import PreventiveMaintenancePage from "@/pages/maintenance/preventive";
import DateBasedAlertsPage from "@/pages/maintenance/date-based-alerts";

// Pages Technicien
import FleetStatusPage from "@/pages/technician/fleet-status";
import TechnicianVehiclesPage from "@/pages/technician/vehicles";
import MyWorkOrdersPage from "@/pages/technician/my-work-orders";
import TechnicianProfilePage from "@/pages/technician/profile";

// Dev Pages
import ProfilesDevPage from "@/pages/dev/profiles";

// Drivers Pages
import DriversIndex from "@/pages/drivers/index";
import DriverDetail from "@/pages/drivers/[id]";

// Missions Pages
import MissionsIndex from "@/pages/missions/index";
import MissionNew from "@/pages/missions/new";
import MissionDetails from "@/pages/missions/[id]";

// Operations Pages
import OperationsDashboard from "@/pages/operations/dashboard";
import ClientInvoicesListPage from "@/pages/operations/invoices/index";
import ClientInvoiceDetailsPage from "@/pages/operations/invoices/[id]";

// Procurement Pages
import SuppliersListPage from "@/pages/procurement/suppliers/index";
import NewSupplierPage from "@/pages/procurement/suppliers/new";
import EditSupplierPage from "@/pages/procurement/suppliers/edit";
import SupplierDetailsPage from "@/pages/procurement/suppliers/[id]";
import PurchaseOrdersListPage from "@/pages/procurement/orders/index";
import NewPurchaseOrderPage from "@/pages/procurement/orders/new";
import PurchaseOrderDetailsPage from "@/pages/procurement/orders/[id]";
import GroupPurchaseOrdersPage from "@/pages/procurement/orders/group";
import SupplierInvoicesListPage from "@/pages/procurement/invoices/index";
import NewSupplierInvoicePage from "@/pages/procurement/invoices/new";
import SupplierInvoiceDetailsPage from "@/pages/procurement/invoices/[id]";
import InvoiceDiscrepanciesPage from "@/pages/procurement/invoices/discrepancies";

function PrivateRoute({ component: Component, ...rest }: { component: React.ComponentType<any>, [key: string]: any }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);
  
  if (isLoading && !user) {
    return null;
  }
  
  if (!isAuthenticated) {
    return null;
  }
  
  return <Component {...rest} />;
}

function AccessDeniedRoute() {
  const [, setLocation] = useLocation();

  return (
    <div className="p-6">
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-6 text-center space-y-3">
          <h2 className="text-lg font-semibold text-destructive-text">Accès refusé</h2>
          <p className="text-sm text-destructive-text/90">
            Vous n&apos;avez pas les droits nécessaires pour accéder à cette section.
          </p>
          <Button variant="destructive" onClick={() => setLocation("/dashboard")}>
            Retour au dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function RoleRoute({
  component: Component,
  allowedRoles,
  ...rest
}: {
  component: React.ComponentType<any>;
  allowedRoles: readonly string[];
  [key: string]: any;
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isLoading, isAuthenticated, setLocation]);

  if (isLoading && !user) {
    return null;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return <AccessDeniedRoute />;
  }

  return <Component {...rest} />;
}

function SmartDashboardRoute() {
  const { user, isLoading } = useAuth();
  
  if (isLoading && !user) {
    return null;
  }

  if (!user) {
    return null;
  }

  // Driver role gets its own standalone layout (no sidebar/topnav)
  if (user?.role === "driver") {
    return <DriverDashboard />;
  }

  // Redirection intelligente selon le rôle vers dashboard personnalisé
  const renderDashboard = () => {
    switch (user?.role) {
      case "admin":
        return <AdminDashboard />;
      case "workshop_manager":
        return <WorkshopManagerDashboard />;
      case "technician":
        return <TechnicianDashboard />;
      case "secretary":
        return <SecretaryDashboard />;
      case "accountant":
        return <AccountantDashboard />;
      case "logistics":
        return <LogisticsDashboard />;
      case "warehouse":
        return <WarehouseDashboard />;
      case "management":
        return <ManagementDashboard />;
      case "viewer":
        return <ViewerDashboard />;
      case "client":
        return <ClientDashboard />;
      default:
        return <Dashboard />;
    }
  };
  
  return (
    <AppLayout>
      {renderDashboard()}
    </AppLayout>
  );
}

function RootRoute() {
  const { isAuthenticated, isAuthenticating } = useAuth();

  // Sur l'application native Android APK (Capacitor) : jamais de landing page marketing
  if (isNativePlatform()) {
    if (isAuthenticating) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
            <p className="text-xs text-slate-400 font-semibold">Chargement de FleetOS...</p>
          </div>
        </div>
      );
    }
    if (isAuthenticated) {
      return <SmartDashboardRoute />;
    }
    return <Login />;
  }

  // Sur le Web desktop : si déjà connecté, aller directement au dashboard
  if (isAuthenticated) {
    return <SmartDashboardRoute />;
  }

  // Si visiteur web public non connecté : afficher la vitrine
  return <LandingPage />;
}

function App() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    // 1. Initialisation de la persistance IndexedDB & Rejeu hors-ligne
    const cleanupOffline = setupOfflinePersistence(queryClient);

    // 2. Gestion du bouton retour matériel Android (évite la fermeture de l'app)
    const cleanupBack = setupHardwareBackButton(setLocation, location);

    // 3. Navigation sur clic de notification native Android
    const cleanupNotifications = setupNotificationClickListener(setLocation);

    return () => {
      cleanupOffline();
      cleanupBack();
      cleanupNotifications();
    };
  }, [location, setLocation]);
  
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <AuthProvider>
          <OnboardingProvider>
            <VehicleProvider>
              <Toaster />
            <OfflineShellGate>
            <Switch>
            {/* Public routes */}
            <Route path="/login" component={Login} />
            <Route path="/landing" component={LandingPage} />
            
            {/* Dev routes - Only in development mode */}
            {import.meta.env.DEV && (
              <Route path="/dev/profiles" component={ProfilesDevPage} />
            )}
            
            {/* Écrans du lot recette (config/lot-screens.ts), avant les routes à :id */}
            {renderLotRoutes()}

            {/* Smart root routing (APK -> Login/Dashboard, Web -> Landing/Dashboard) */}
            <Route path="/" component={RootRoute} />
            
            {/* Protected routes - Smart dashboard routing */}
            {/* AppLayout obligatoire: sans lui la page s'ouvre sans barre
                latérale ni en-tête, et le DG perd toute navigation — il n'a
                plus que le bouton retour du navigateur. `/dashboard` échappait
                au problème parce que `SmartDashboardRoute` enveloppe lui-même. */}
            <Route path="/management/dashboard">
              <AppLayout>
                <RoleRoute component={ManagementDashboard} allowedRoles={["management", "admin"]} />
              </AppLayout>
            </Route>
            <Route path="/management/reports">
              <AppLayout>
                <RoleRoute component={ManagementReportsPage} allowedRoles={["management", "admin"]} />
              </AppLayout>
            </Route>
            <Route path="/management/reports/:subpage*">
              <AppLayout>
                <RoleRoute component={ManagementReportsPage} allowedRoles={["management", "admin"]} />
              </AppLayout>
            </Route>
            <Route path="/management/corridor-map">
              <AppLayout>
                <RoleRoute component={ManagementCorridorMapPage} allowedRoles={["management", "admin"]} />
              </AppLayout>
            </Route>
            <Route path="/management/team">
              <AppLayout>
                <RoleRoute component={ManagementTeamPage} allowedRoles={["management", "admin"]} />
              </AppLayout>
            </Route>

            <Route path="/dashboard">
              <PrivateRoute component={SmartDashboardRoute} />
            </Route>
            
            <Route path="/vehicles">
              <AppLayout>
                <PrivateRoute component={VehiclesIndex} />
              </AppLayout>
            </Route>
            
            <Route path="/vehicles/new">
              <AppLayout>
                <RoleRoute component={VehicleNew} allowedRoles={["admin", "workshop_manager"]} />
              </AppLayout>
            </Route>

            <Route path="/vehicles/documents">
              <AppLayout>
                <PrivateRoute component={VehicleDocumentsPage} />
              </AppLayout>
            </Route>

            <Route path="/vehicles/documents/renew">
              <AppLayout>
                <PrivateRoute component={VehicleDocumentRenewPage} />
              </AppLayout>
            </Route>

            <Route path="/vehicles/:id">
              {(params) => (
                <AppLayout>
                  <PrivateRoute component={VehicleDetails} params={params} />
                </AppLayout>
              )}
            </Route>
            
            <Route path="/maintenance">
              <AppLayout>
                <RoleRoute component={MaintenanceIndex} allowedRoles={["admin", "workshop_manager"]} />
              </AppLayout>
            </Route>

            <Route path="/maintenance/interventions">
              <AppLayout>
                <PrivateRoute component={InterventionsIndex} />
              </AppLayout>
            </Route>

            <Route path="/maintenance/planner">
              <AppLayout>
                <PrivateRoute component={MaintenancePlanner} />
              </AppLayout>
            </Route>

            <Route path="/maintenance/schedules">
              <AppLayout>
                <PrivateRoute component={MaintenanceSchedules} />
              </AppLayout>
            </Route>

            <Route path="/maintenance/preventive">
              <AppLayout>
                <RoleRoute component={PreventiveMaintenancePage} allowedRoles={["admin", "workshop_manager"]} />
              </AppLayout>
            </Route>

            <Route path="/maintenance/date-alerts">
              <AppLayout>
                <PrivateRoute component={DateBasedAlertsPage} />
              </AppLayout>
            </Route>
            

            
            <Route path="/maintenance/work-orders">
              <AppLayout>
                <PrivateRoute component={WorkOrdersIndex} />
              </AppLayout>
            </Route>
            
            <Route path="/maintenance/work-orders/new">
              <AppLayout>
                <RoleRoute component={WorkOrderNew} allowedRoles={["admin", "workshop_manager"]} />
              </AppLayout>
            </Route>
            
            <Route path="/maintenance/work-orders/:id">
              {(params) => (
                <AppLayout>
                  <PrivateRoute component={WorkOrderDetails} params={params} />
                </AppLayout>
              )}
            </Route>
            
            <Route path="/maintenance/fault-catalog">
              <AppLayout>
                <PrivateRoute component={FaultCatalogIndex} />
              </AppLayout>
            </Route>
            
            <Route path="/inventory">
              <AppLayout>
                <RoleRoute
                  component={InventoryIndex}
                  allowedRoles={[...PARTS_INVENTORY_ROLES]}
                />
              </AppLayout>
            </Route>
            
            <Route path="/inventory/parts">
              <AppLayout>
                <RoleRoute
                  component={InventoryIndex}
                  allowedRoles={[...PARTS_INVENTORY_ROLES]}
                />
              </AppLayout>
            </Route>
            
            <Route path="/inventory/new">
              <AppLayout>
                <RoleRoute
                  component={InventoryNew}
                  allowedRoles={[...PARTS_INVENTORY_ROLES]}
                />
              </AppLayout>
            </Route>
            
            <Route path="/inventory/tires">
              <AppLayout>
                <RoleRoute component={TiresInventoryIndex} allowedRoles={["admin", "workshop_manager", "warehouse", "secretary", "logistics", "technician"]} />
              </AppLayout>
            </Route>
            
            <Route path="/inventory/movements">
              <AppLayout>
                <RoleRoute
                  component={InventoryMovements}
                  allowedRoles={[...PARTS_INVENTORY_ROLES]}
                />
              </AppLayout>
            </Route>
            
            <Route path="/inventory/:id">
              {(params) => (
                <AppLayout>
                  <RoleRoute
                    component={InventoryDetails}
                    allowedRoles={[...PARTS_INVENTORY_ROLES]}
                    params={params}
                  />
                </AppLayout>
              )}
            </Route>
            
            <Route path="/inventory-requests">
              <AppLayout>
                <RoleRoute
                  component={PartRequestsIndex}
                  allowedRoles={[...PARTS_INVENTORY_ROLES]}
                />
              </AppLayout>
            </Route>
            
            <Route path="/fuel">
              <AppLayout>
                <RoleRoute component={FuelIndex} allowedRoles={FUEL_READ_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/fuel/new">
              <AppLayout>
                <PrivateRoute component={FuelNew} />
              </AppLayout>
            </Route>
            
            <Route path="/fuel/:id">
              {(params) => (
                <AppLayout>
                  <PrivateRoute component={FuelRecordDetail} params={params} />
                </AppLayout>
              )}
            </Route>
            
            <Route path="/technicians">
              <AppLayout>
                <RoleRoute component={TechniciansIndex} allowedRoles={["admin", "workshop_manager"]} />
              </AppLayout>
            </Route>
            
            <Route path="/drivers/:id">
              <AppLayout>
                <RoleRoute component={DriverDetail} allowedRoles={DRIVER_MANAGER_ROLES} />
              </AppLayout>
            </Route>

            <Route path="/drivers">
              <AppLayout>
                <RoleRoute component={DriversIndex} allowedRoles={DRIVER_MANAGER_ROLES} />
              </AppLayout>
            </Route>
            
            {/* Missions routes */}
            <Route path="/missions">
              <AppLayout>
                <RoleRoute component={MissionsIndex} allowedRoles={MISSION_MANAGER_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/missions/new">
              <AppLayout>
                <RoleRoute component={MissionNew} allowedRoles={MISSION_MANAGER_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/missions/:id">
              {(params) => (
                <AppLayout>
                  <PrivateRoute component={MissionDetails} params={params} />
                </AppLayout>
              )}
            </Route>
            
            {/* Operations routes */}
            <Route path="/operations">
              <AppLayout>
                <RoleRoute component={OperationsDashboard} allowedRoles={PENDING_INVOICE_ROLES} />
              </AppLayout>
            </Route>

            <Route path="/operations/invoices">
              <AppLayout>
                <PrivateRoute component={ClientInvoicesListPage} />
              </AppLayout>
            </Route>

            <Route path="/operations/invoices/:id">
              {(params) => (
                <AppLayout>
                  <PrivateRoute component={ClientInvoiceDetailsPage} params={params} />
                </AppLayout>
              )}
            </Route>

            {/* Procurement routes */}
            <Route path="/procurement/suppliers">
              <AppLayout>
                <RoleRoute component={SuppliersListPage} allowedRoles={SUPPLIER_READ_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/procurement/suppliers/new">
              <AppLayout>
                <RoleRoute component={NewSupplierPage} allowedRoles={PROCUREMENT_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/procurement/suppliers/:id/edit">
              {(params) => (
                <AppLayout>
                  <RoleRoute component={EditSupplierPage} params={params} allowedRoles={PROCUREMENT_ROLES} />
                </AppLayout>
              )}
            </Route>
            
            <Route path="/procurement/suppliers/:id">
              {(params) => (
                <AppLayout>
                  <RoleRoute component={SupplierDetailsPage} params={params} allowedRoles={SUPPLIER_READ_ROLES} />
                </AppLayout>
              )}
            </Route>

            {/* Purchase Orders routes */}
            <Route path="/procurement/orders">
              <AppLayout>
                <RoleRoute component={PurchaseOrdersListPage} allowedRoles={PROCUREMENT_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/procurement/orders/new">
              <AppLayout>
                <RoleRoute component={NewPurchaseOrderPage} allowedRoles={PROCUREMENT_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/procurement/orders/group">
              <AppLayout>
                <RoleRoute component={GroupPurchaseOrdersPage} allowedRoles={PROCUREMENT_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/procurement/orders/:id">
              {(params) => (
                <AppLayout>
                  <RoleRoute component={PurchaseOrderDetailsPage} params={params} allowedRoles={PROCUREMENT_ROLES} />
                </AppLayout>
              )}
            </Route>

            {/* Supplier Invoices routes */}
            <Route path="/procurement/supplier-invoices">
              <AppLayout>
                <RoleRoute component={SupplierInvoicesListPage} allowedRoles={SUPPLIER_INVOICE_READ_ROLES} />
              </AppLayout>
            </Route>

            <Route path="/procurement/invoices">
              <AppLayout>
                <RoleRoute component={SupplierInvoicesListPage} allowedRoles={SUPPLIER_INVOICE_READ_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/procurement/invoices/new">
              <AppLayout>
                <RoleRoute component={NewSupplierInvoicePage} allowedRoles={SUPPLIER_INVOICE_READ_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/procurement/invoices/discrepancies">
              <AppLayout>
                <RoleRoute component={InvoiceDiscrepanciesPage} allowedRoles={SUPPLIER_INVOICE_READ_ROLES} />
              </AppLayout>
            </Route>
            
            <Route path="/procurement/invoices/:id">
              {(params) => (
                <AppLayout>
                  <RoleRoute component={SupplierInvoiceDetailsPage} params={params} allowedRoles={SUPPLIER_INVOICE_READ_ROLES} />
                </AppLayout>
              )}
            </Route>

            {/* Redirect /exports to /reports for backward compatibility */}
            <Route path="/exports">
              <AppLayout>
                <PrivateRoute component={ReportsIndex} />
              </AppLayout>
            </Route>
            
            <Route path="/reports">
              <AppLayout>
                <PrivateRoute component={ReportsIndex} />
              </AppLayout>
            </Route>
            
            <Route path="/settings">
              <AppLayout>
                <PrivateRoute component={Settings} />
              </AppLayout>
            </Route>

            <Route path="/profile">
              <AppLayout>
                <PrivateRoute component={ProfilePage} />
              </AppLayout>
            </Route>

            <Route path="/admin/dashboard">
              <AppLayout>
                <RoleRoute component={AdminDashboard} allowedRoles={["admin"]} />
              </AppLayout>
            </Route>

            <Route path="/admin/users">
              <AppLayout>
                <RoleRoute component={AdminUsersPage} allowedRoles={["admin"]} />
              </AppLayout>
            </Route>

            <Route path="/admin/retired-vehicles">
              <AppLayout>
                <RoleRoute component={RetiredVehiclesPage} allowedRoles={["admin"]} />
              </AppLayout>
            </Route>

            <Route path="/admin/documentation">
              <AppLayout>
                <RoleRoute component={DocumentationPage} allowedRoles={["admin"]} />
              </AppLayout>
            </Route>

            <Route path="/users">
              <AppLayout>
                <PrivateRoute component={UsersIndex} />
              </AppLayout>
            </Route>

            {/* Routes Technicien */}
            <Route path="/technician/dashboard">
              <AppLayout>
                <PrivateRoute component={TechnicianDashboard} />
              </AppLayout>
            </Route>

            <Route path="/technician/fleet-status">
              <AppLayout>
                <PrivateRoute component={FleetStatusPage} />
              </AppLayout>
            </Route>
            
            <Route path="/technician/vehicles">
              <AppLayout>
                <PrivateRoute component={TechnicianVehiclesPage} />
              </AppLayout>
            </Route>
            
            <Route path="/technician/my-work-orders">
              <AppLayout>
                <PrivateRoute component={MyWorkOrdersPage} />
              </AppLayout>
            </Route>
            
            <Route path="/technician/profile">
              <AppLayout>
                <PrivateRoute component={TechnicianProfilePage} />
              </AppLayout>
            </Route>
            
            <Route path="/admin/import-backup">
              <AppLayout>
                <RoleRoute component={ImportBackup} allowedRoles={["admin"]} />
              </AppLayout>
            </Route>
            
            {/* Workflows routes */}
            <Route path="/workflows">
              <AppLayout>
                <PrivateRoute component={WorkflowsIndex} />
              </AppLayout>
            </Route>
            
            <Route path="/workflows/vehicle-acquisition">
              <AppLayout>
                <RoleRoute
                  component={VehicleAcquisitionWorkflow}
                  allowedRoles={["admin", "workshop_manager"]}
                />
              </AppLayout>
            </Route>
            
            <Route path="/alerts">
              <AppLayout>
                <PrivateRoute component={AlertsPage} />
              </AppLayout>
            </Route>
            
            {/* Driver PWA route — standalone layout, no sidebar */}
            <Route path="/driver">
              <PrivateRoute component={DriverDashboard} />
            </Route>

            {/* Fallback to 404 */}
            <Route component={NotFound} />
            </Switch>
            </OfflineShellGate>
            </VehicleProvider>
          </OnboardingProvider>
        </AuthProvider>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
