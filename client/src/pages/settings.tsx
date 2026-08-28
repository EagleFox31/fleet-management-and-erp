import React, { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { DataTable } from "@/components/ui/data-table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

// Format date and time for user creation date
function formatCreatedDate(date: string | undefined): string {
  console.log("🕒 Formatage de la date:", date, "Type:", typeof date);
  
  if (!date) {
    console.log("❌ Date vide ou undefined");
    return "N/A";
  }

  const dateObj = new Date(date);
  console.log("📅 Objet Date:", dateObj, "isValid:", !isNaN(dateObj.getTime()));
  
  const formattedDate = dateObj.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }) + " " + dateObj.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  
  console.log("✅ Date formatée:", formattedDate);
  return formattedDate;
}
import { UserForm } from "@/components/users/user-form";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2, Shield, Eye, Users, Settings as SettingsIcon } from "lucide-react";

// Données des contrôles d'accès pour toutes les pages de l'application
const accessControlData = [
  { page: "Tableau de bord", route: "/dashboard", description: "Vue d'ensemble des activités", roles: ["admin", "workshop_manager", "technician", "client"] },
  { page: "Véhicules", route: "/vehicles", description: "Gestion de la flotte de véhicules", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Maintenances Correctives", route: "/maintenance/interventions", description: "Interventions non planifiées", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Maintenances Préventives", route: "/maintenance/schedules", description: "Planifications de maintenance", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Maintenance & conformité documentaire", route: "/maintenance/date-alerts", description: "OT atelier pour maintenance, demandes administratives pour documents", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Ordres de travail", route: "/maintenance/work-orders", description: "Gestion des ordres de travail", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Catalogue d'interventions", route: "/maintenance/fault-catalog", description: "Catalogue des pannes", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Centre GMAO", route: "/maintenance/gmao-dashboard", description: "Dashboard de maintenance", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Stock des pièces", route: "/inventory/parts", description: "Gestion du stock de pièces", roles: ["admin", "workshop_manager", "warehouse"] },
  { page: "Demandes de pièces", route: "/inventory-requests", description: "Demandes de pièces détachées", roles: ["admin", "workshop_manager", "warehouse", "secretary"] },
  { page: "Suivi des pneus", route: "/inventory/tires", description: "Inventaire des pneumatiques", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Carburant", route: "/fuel", description: "Suivi de la consommation", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Workflows", route: "/workflows", description: "Configuration des workflows", roles: ["admin"] },
  { page: "Processus d'acquisition", route: "/workflows/vehicle-acquisition/*", description: "Exécution du processus d'acquisition", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Autres processus métier", route: "/workflows/*/execution", description: "Exécution des workflows configurés", roles: ["admin", "workshop_manager", "technician"] },
  { page: "Techniciens", route: "/technicians", description: "Gestion des techniciens", roles: ["admin", "workshop_manager"] },
  { page: "Rapports", route: "/reports", description: "Génération de rapports", roles: ["admin", "workshop_manager"] },
  { page: "Paramètres", route: "/settings", description: "Configuration du système", roles: ["admin", "workshop_manager"] },
  { page: "Gestion utilisateurs", route: "/settings?tab=users", description: "Administration des comptes", roles: ["admin"] },
  { page: "Contrôles d'accès", route: "/settings?tab=access-control", description: "Permissions par page", roles: ["admin"] },
  { page: "Configuration entreprise", route: "/settings?tab=company", description: "Informations de l'entreprise", roles: ["admin"] },
  { page: "Paramètres système", route: "/settings?tab=system", description: "Configuration technique", roles: ["admin"] }
];

// Fonction pour formater les rôles avec des badges colorés
const formatRoles = (roles: string[]) => {
  const roleLabels: { [key: string]: { label: string; color: string } } = {
    admin: { label: "Administrateur", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" },
    workshop_manager: { label: "Chef d'atelier", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" },
    warehouse: { label: "Magasinier", color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300" },
    logistics: { label: "Logisticien", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300" },
    secretary: { label: "Secrétaire", color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300" },
    technician: { label: "Technicien", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" },
    client: { label: "Client", color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300" }
  };

  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge 
          key={role} 
          className={`text-xs ${roleLabels[role]?.color || "bg-gray-100 text-gray-800"}`}
        >
          {roleLabels[role]?.label || role}
        </Badge>
      ))}
    </div>
  );
};

// Colonnes pour le tableau des contrôles d'accès
const accessControlColumns = [
  {
    header: "Page",
    accessorKey: "page",
    cell: (value: string, row: any) => (
      <div className="font-medium">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          {value}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{row.route}</div>
      </div>
    ),
  },
  {
    header: "Description",
    accessorKey: "description",
    cell: (value: string) => <div className="text-sm text-muted-foreground">{value}</div>,
  },
  {
    header: "Rôles autorisés",
    accessorKey: "roles",
    cell: (value: string[]) => formatRoles(value),
  },
  {
    header: "Niveau d'accès",
    accessorKey: "roles",
    cell: (value: string[]) => {
      const accessLevel = value.includes('client') ? 'Public' : 
                         value.includes('technician') ? 'Équipe' : 
                         value.includes('workshop_manager') ? 'Gestion' : 'Administration';
      const levelColors = {
        'Public': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        'Équipe': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        'Gestion': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
        'Administration': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
      };
      return (
        <Badge className={levelColors[accessLevel as keyof typeof levelColors]}>
          {accessLevel}
        </Badge>
      );
    },
  }
];

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("users");
  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);
  const [isEditUserDialogOpen, setIsEditUserDialogOpen] = useState(false);
  const [isDeleteUserDialogOpen, setIsDeleteUserDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  // Fetch users
  const usersQuery = useQuery<any[]>({
    queryKey: ["/api/users", "with-created-at"], // Changed key to force fresh request
    enabled: user?.role === "admin",
    staleTime: 0, // Force fresh data
    gcTime: 0, // Don't cache
  });
  const users = (usersQuery.data ?? []) as any[];
  const { isLoading: isLoadingUsers, refetch } = usersQuery;

  // Log des données reçues
  React.useEffect(() => {
    if (users && users.length > 0) {
      console.log("🔍 Données reçues côté client:", users);
      console.log("📋 Premier utilisateur:", users[0]);
      console.log("🕒 CreatedAt du premier utilisateur:", users[0].createdAt);
    }
  }, [users]);

  // Columns for users table
  const userColumns = [
    {
      header: "Nom",
      accessorKey: "name",
      cell: (value: string) => <div className="font-medium">{value}</div>,
    },
    {
      header: "Utilisateur",
      accessorKey: "username",
      cell: (value: string) => <div>{value}</div>,
    },
    {
      header: "Email",
      accessorKey: "email",
      cell: (value: string) => <div>{value}</div>,
    },
    {
      header: "Rôle",
      accessorKey: "role",
      cell: (value: string) => (
        <Badge variant={          value === "admin" ? "destructive" :
          value === "workshop_manager" ? "default" :
          value === "technician" ? "warning" : "secondary"
        }>
          {value === "admin" ? "Administrateur" :
           value === "workshop_manager" ? "Chef d'atelier" :
           value === "technician" ? "Technicien" : "Utilisateur"}
        </Badge>
      ),
    },
    {
      header: "Créé le",
      accessorKey: "createdAt",
      cell: (value: string) => <div>{formatCreatedDate(value)}</div>,
    },
    {
      header: "Actions",
      accessorKey: "id",
      cell: (value: number, row: any) => (
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedUser(row);
              setIsEditUserDialogOpen(true);
            }}
          >
            <Pencil className="h-4 w-4 mr-1" />
            Modifier
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedUser(row);
              setIsDeleteUserDialogOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Supprimer
          </Button>
        </div>
      ),
    },
  ];

  if (user?.role !== "admin" && user?.role !== "workshop_manager") {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-semibold">Accès non autorisé</h2>
        <p className="text-muted-foreground mt-2">
          Vous n'avez pas les permissions nécessaires pour accéder aux paramètres.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader 
        title="Paramètres" 
        subtitle="Configuration du système et gestion des utilisateurs"
      />

      {/* Dialogue pour ajouter un utilisateur */}
      <Dialog open={isAddUserDialogOpen} onOpenChange={setIsAddUserDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Ajouter un utilisateur</DialogTitle>
            <DialogDescription>
              Créez un nouvel utilisateur dans le système. Vous pourrez définir son nom, rôle et autres informations.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <UserForm
              onSuccess={() => {
                setIsAddUserDialogOpen(false);
                refetch();
                toast({
                  title: "Utilisateur créé",
                  description: "Le nouvel utilisateur a été créé avec succès",
                });
              }}
              onCancel={() => setIsAddUserDialogOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="users" value={activeTab} onValueChange={setActiveTab}>
        <div className="flex justify-between items-center mb-6">
          <TabsList>
            <TabsTrigger value="users">Utilisateurs</TabsTrigger>
            {user?.role === "admin" && (
              <>
                <TabsTrigger value="company">Entreprise</TabsTrigger>
                <TabsTrigger value="system">Système</TabsTrigger>
                <TabsTrigger value="access-control">Contrôles d'accès</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
              </>
            )}
          </TabsList>

          {activeTab === "users" && user?.role === "admin" && (
            <Button onClick={() => setIsAddUserDialogOpen(true)}>
              <i className="fas fa-user-plus mr-2"></i>
              Ajouter un utilisateur
            </Button>
          )}
        </div>

        <TabsContent value="users">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Gestion des utilisateurs</CardTitle>
                <CardDescription>Gérer les utilisateurs et leurs permissions</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                data={users}
                columns={userColumns}
                searchPlaceholder="Rechercher un utilisateur..."
                isLoading={isLoadingUsers}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle>Informations de l'entreprise</CardTitle>
              <CardDescription>Informations générales sur votre entreprise</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Nom de l'entreprise</Label>
                  <Input id="company-name" defaultValue="Société Transport XYZ" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-address">Adresse</Label>
                  <Input id="company-address" defaultValue="123 Rue du Transport, 75000 Paris" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-phone">Téléphone</Label>
                  <Input id="company-phone" defaultValue="+33 1 23 45 67 89" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-email">Email</Label>
                  <Input id="company-email" defaultValue="contact@transport-xyz.fr" type="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-siret">SIRET</Label>
                  <Input id="company-siret" defaultValue="123 456 789 00012" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-vat">Numéro de TVA</Label>
                  <Input id="company-vat" defaultValue="FR12345678900" />
                </div>
              </div>

              <div className="flex justify-end">
                <Button>Enregistrer les modifications</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system">
          <Card>
            <CardHeader>
              <CardTitle>Paramètres système</CardTitle>
              <CardDescription>Configuration générale du système</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="system-language">Langue par défaut</Label>
                  <Select defaultValue="fr">
                    <SelectTrigger id="system-language">
                      <SelectValue placeholder="Sélectionner une langue" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="en">Anglais</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="system-timezone">Fuseau horaire</Label>
                  <Select defaultValue="europe-paris">
                    <SelectTrigger id="system-timezone">
                      <SelectValue placeholder="Sélectionner un fuseau horaire" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="europe-paris">Europe/Paris (UTC+1)</SelectItem>
                      <SelectItem value="europe-london">Europe/London (UTC+0)</SelectItem>
                      <SelectItem value="america-new_york">America/New_York (UTC-5)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="system-currency">Devise</Label>
                  <Select defaultValue="eur">
                    <SelectTrigger id="system-currency">
                      <SelectValue placeholder="Sélectionner une devise" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eur">Euro (€)</SelectItem>
                      <SelectItem value="usd">Dollar US ($)</SelectItem>
                      <SelectItem value="gbp">Livre Sterling (£)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="system-distance">Unité de distance</Label>
                  <Select defaultValue="km">
                    <SelectTrigger id="system-distance">
                      <SelectValue placeholder="Sélectionner une unité" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="km">Kilomètres (km)</SelectItem>
                      <SelectItem value="miles">Miles (mi)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="system-date-format">Format de date</Label>
                  <Select defaultValue="dd-mm-yyyy">
                    <SelectTrigger id="system-date-format">
                      <SelectValue placeholder="Sélectionner un format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd-mm-yyyy">JJ/MM/AAAA</SelectItem>
                      <SelectItem value="mm-dd-yyyy">MM/JJ/AAAA</SelectItem>
                      <SelectItem value="yyyy-mm-dd">AAAA/MM/JJ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="system-backup">Sauvegarde automatique</Label>
                  <Select defaultValue="daily">
                    <SelectTrigger id="system-backup">
                      <SelectValue placeholder="Sélectionner une fréquence" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Quotidienne</SelectItem>
                      <SelectItem value="weekly">Hebdomadaire</SelectItem>
                      <SelectItem value="monthly">Mensuelle</SelectItem>
                      <SelectItem value="never">Désactivée</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end">
                <Button>Enregistrer les modifications</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access-control">
          <Card>
            <CardHeader>
              <CardTitle>Contrôles d'accès par page</CardTitle>
              <CardDescription>Liste des pages de l'application et des rôles autorisés à y accéder</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                data={accessControlData}
                columns={accessControlColumns}
                searchPlaceholder="Rechercher une page..."
                isLoading={false}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Paramètres de notification</CardTitle>
              <CardDescription>Configurer quand et comment les utilisateurs sont notifiés</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-medium">Maintenance préventive</h3>
                    <p className="text-sm text-muted-foreground">
                      Notifications pour les maintenances préventives à venir
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-medium">Stock de pièces</h3>
                    <p className="text-sm text-muted-foreground">
                      Alertes lorsque le stock atteint le seuil minimal
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-medium">Ordres de travail</h3>
                    <p className="text-sm text-muted-foreground">
                      Notifications pour les ordres de travail assignés ou modifiés
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-medium">Alertes de sécurité</h3>
                    <p className="text-sm text-muted-foreground">
                      Notifications pour les tentatives de connexion suspectes
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-medium">Emails récapitulatifs</h3>
                    <p className="text-sm text-muted-foreground">
                      Rapports hebdomadaires envoyés par email
                    </p>
                  </div>
                  <Switch />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-medium">Notifications push</h3>
                    <p className="text-sm text-muted-foreground">
                      Notifications push sur les appareils mobiles
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-medium">SMS</h3>
                    <p className="text-sm text-muted-foreground">
                      Notifications par SMS pour les alertes critiques
                    </p>
                  </div>
                  <Switch />
                </div>
              </div>

              <div className="flex justify-end">
                <Button>Enregistrer les modifications</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
