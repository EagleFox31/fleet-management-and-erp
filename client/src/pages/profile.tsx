import { useAuth } from "@/hooks/useAuth";
import { NotificationPreferences } from "@/components/profile/notification-preferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { User, Mail, Shield, Calendar, Key, CheckCircle, Lock, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function ProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      admin: "Administrateur",
      workshop_manager: "Chef d'Atelier",
      secretary: "Secrétaire",
      technician: "Technicien",
      logistics: "Logistique",
      warehouse: "Magasinier",
      client: "Client",
    };
    return labels[role] || role;
  };

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      admin: "bg-red-100 text-red-700",
      workshop_manager: "bg-blue-100 text-blue-700",
      secretary: "bg-purple-100 text-purple-700",
      technician: "bg-orange-100 text-orange-700",
      logistics: "bg-cyan-100 text-cyan-700",
      warehouse: "bg-amber-100 text-amber-700",
      client: "bg-gray-100 text-gray-600",
    };
    return colors[role] || "bg-gray-100 text-gray-600";
  };

  const getPermissions = (role: string) => {
    const perms: Record<string, string[]> = {
      admin: ["Gestion complète du système", "Administration des utilisateurs", "Configuration des workflows", "Accès à tous les rapports"],
      workshop_manager: ["Gestion de l'atelier et des techniciens", "Ordres de travail et maintenance", "Gestion de l'inventaire", "Rapports d'atelier"],
      secretary: ["Gestion administrative", "Gestion des documents", "Suivi des opérations", "Facturation clients"],
      technician: ["Mes ordres de travail", "Interventions et maintenances", "Demandes de pièces", "Suivi carburant"],
      logistics: ["Gestion du carburant", "Suivi des missions", "Gestion des chauffeurs", "Documents véhicules"],
      warehouse: ["Gestion du stock de pièces", "Inventaire et mouvements", "Alertes de réapprovisionnement", "Approvisionnement"],
      client: ["Suivi de mes véhicules", "Historique des maintenances", "Factures et paiements"],
    };
    return perms[role] || [];
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({ title: "Erreur", description: "Les nouveaux mots de passe ne correspondent pas", variant: "destructive" });
      return;
    }
    if (passwordData.newPassword.length < 6) {
      toast({ title: "Erreur", description: "Le mot de passe doit contenir au moins 6 caractères", variant: "destructive" });
      return;
    }

    setIsChangingPassword(true);
    try {
      await apiRequest("POST", "/api/users/change-password", {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });
      toast({ title: "Succès", description: "Mot de passe modifié avec succès" });
      setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error: any) {
      toast({ title: "Erreur", description: error.message || "Impossible de modifier le mot de passe", variant: "destructive" });
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    );
  }

  const initials = (user.name || user.username || "?")
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-6 py-6 md:px-8">
          {/* Avatar + identité */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-400 flex items-center justify-center shadow-sm">
              <span className="text-xl font-bold text-white">{initials}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Mon profil</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${getRoleColor(user.role)}`}>
                  {getRoleLabel(user.role)}
                </span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">{user.name || user.username}</h1>
              <p className="text-[11px] text-gray-400 mt-0.5 font-mono">@{user.username}</p>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-5 border-t border-gray-100">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Identifiant</p>
              <p className="text-sm font-bold text-gray-800 font-mono">{user.username}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                <Mail className="h-3.5 w-3.5 text-purple-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Email</p>
              <p className="text-sm font-bold text-gray-800 truncate">{user.email || "—"}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                <Shield className="h-3.5 w-3.5 text-green-600" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Rôle</p>
              <p className="text-sm font-bold text-gray-800">{getRoleLabel(user.role)}</p>
            </div>
            {(user as any).createdAt && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Calendar className="h-3.5 w-3.5 text-amber-600" />
                </div>
                <p className="text-[11px] font-medium text-gray-500 mt-1">Membre depuis</p>
                <p className="text-sm font-bold text-gray-800">
                  {new Date((user as any).createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info">
        <PremiumTabsNav tabs={[
          { value: "info", label: "Informations", icon: <TabIcon icon={User} /> },
          { value: "security", label: "Sécurité", icon: <TabIcon icon={Key} /> },
        ]} />

        {/* Onglet Informations */}
        <TabsContent value="info" className="space-y-4 mt-0">
          {/* Informations personnelles */}
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <span className="text-sm font-semibold text-gray-800">Informations personnelles</span>
            </div>
            <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Nom complet</p>
                <p className="text-sm font-semibold text-gray-800">{user.name || "Non renseigné"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Nom d'utilisateur</p>
                <p className="text-sm font-semibold text-gray-800 font-mono">@{user.username}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Email</p>
                <p className="text-sm font-semibold text-gray-800">{user.email || "Non renseigné"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Rôle</p>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${getRoleColor(user.role)}`}>
                  {getRoleLabel(user.role)}
                </span>
              </div>
            </div>
          </div>

          {/* Accès et permissions */}
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                <Shield className="h-3.5 w-3.5 text-green-600" />
              </div>
              <span className="text-sm font-semibold text-gray-800">Accès et permissions</span>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-gray-500 mb-3">
                Votre rôle <span className={`font-semibold px-2 py-0.5 rounded-full text-xs ${getRoleColor(user.role)}`}>{getRoleLabel(user.role)}</span> vous donne accès aux fonctionnalités suivantes :
              </p>
              <ul className="space-y-2">
                {getPermissions(user.role).map((perm, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <NotificationPreferences />
        </TabsContent>

        {/* Onglet Sécurité */}
        <TabsContent value="security" className="space-y-4 mt-0">
          {/* Changer mot de passe */}
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
                <Key className="h-3.5 w-3.5 text-orange-500" />
              </div>
              <span className="text-sm font-semibold text-gray-800">Modifier le mot de passe</span>
            </div>
            <div className="px-5 py-5">
              <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Mot de passe actuel</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    className="rounded-xl border-gray-200"
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    required
                    data-testid="input-current-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Nouveau mot de passe</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    className="rounded-xl border-gray-200"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    required
                    minLength={6}
                    data-testid="input-new-password"
                  />
                  <p className="text-[11px] text-gray-400">Minimum 6 caractères</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Confirmer le nouveau mot de passe</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    className="rounded-xl border-gray-200"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    required
                    minLength={6}
                    data-testid="input-confirm-password"
                  />
                </div>
                <Button
                  type="submit"
                  className="rounded-xl bg-green-600 hover:bg-green-700 text-white"
                  disabled={isChangingPassword}
                  data-testid="button-change-password"
                >
                  <Lock className="h-3.5 w-3.5 mr-1.5" />
                  {isChangingPassword ? "Modification..." : "Modifier le mot de passe"}
                </Button>
              </form>
            </div>
          </div>

          {/* Conseils sécurité */}
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                <Shield className="h-3.5 w-3.5 text-green-600" />
              </div>
              <span className="text-sm font-semibold text-gray-800">Sécurité du compte</span>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-green-50 border border-green-100">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-800">Votre compte est sécurisé</p>
                  <p className="text-xs text-green-700 mt-0.5">Utilisez un mot de passe fort et ne le partagez jamais.</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Recommandations</p>
                <ul className="space-y-1.5">
                  {[
                    "Utilisez un mot de passe unique pour FleetMaster",
                    "Ne partagez pas vos identifiants",
                    "Déconnectez-vous après chaque session",
                    "Signalez toute activité suspecte à l'administrateur",
                  ].map((tip, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-gray-600">
                      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
