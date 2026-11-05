import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, Lock, Lightbulb } from "lucide-react";
import { 
  User, 
  Wrench, 
  ClipboardList, 
  FileText, 
  Truck, 
  Package, 
  Users 
} from "lucide-react";

interface Profile {
  username: string;
  password: string;
  displayName: string;
  role: string;
  description: string;
  icon: any;
  color: string;
}

const profiles: Profile[] = [
  {
    username: "admin",
    password: "pwd_admin_123",
    displayName: "Administrateur",
    role: "admin",
    description: "Accès complet au système, gestion globale",
    icon: User,
    color: "bg-purple-500"
  },
  {
    username: "workshop_manager",
    password: "pwd_workshop_manager_123",
    displayName: "Chef d'Atelier",
    role: "workshop_manager",
    description: "Gestion de l'atelier et des ordres de travail",
    icon: Wrench,
    color: "bg-blue-500"
  },
  {
    username: "technician",
    password: "pwd_technician_123",
    displayName: "Technicien",
    role: "technician",
    description: "Exécution des interventions de maintenance",
    icon: ClipboardList,
    color: "bg-green-500"
  },
  {
    username: "secretary",
    password: "pwd_secretary_123",
    displayName: "Secrétaire",
    role: "secretary",
    description: "Gestion documentaire et administrative",
    icon: FileText,
    color: "bg-pink-500"
  },
  {
    username: "logistics",
    password: "pwd_logistics_123",
    displayName: "Logistique",
    role: "logistics",
    description: "Gestion carburant et missions",
    icon: Truck,
    color: "bg-orange-500"
  },
  {
    username: "warehouse",
    password: "pwd_warehouse_123",
    displayName: "Magasinier",
    role: "warehouse",
    description: "Gestion du stock de pièces détachées",
    icon: Package,
    color: "bg-yellow-600"
  },
  {
    username: "client",
    password: "pwd_client_123",
    displayName: "Client",
    role: "client",
    description: "Vue client sur la flotte",
    icon: Users,
    color: "bg-indigo-500"
  }
];

export default function ProfilesDevPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);

  const handleLogin = async (profile: Profile) => {
    setLoading(profile.username);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: profile.username,
          password: profile.password
        }),
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error("Échec de connexion");
      }

      toast({
        title: "Connexion réussie",
        description: `Connecté en tant que ${profile.displayName}`,
      });

      // Rediriger avec rechargement complet pour mettre à jour le contexte d'auth
      setTimeout(() => {
        window.location.href = "/";
      }, 500);
    } catch (error) {
      toast({
        title: "Erreur de connexion",
        description: "Impossible de se connecter avec ce profil",
        variant: "destructive"
      });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
            <FlaskConical className="inline h-8 w-8 mr-2 align-text-bottom" aria-hidden />Interface de Test - Profils
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Sélectionnez un profil pour vous connecter instantanément
          </p>
          <Badge variant="outline" className="mt-4">
            Développement uniquement
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {profiles.map((profile) => {
            const Icon = profile.icon;
            const isLoading = loading === profile.username;

            return (
              <Card 
                key={profile.username} 
                className="hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-primary"
                data-testid={`profile-card-${profile.role}`}
              >
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`${profile.color} p-3 rounded-lg text-white`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{profile.displayName}</CardTitle>
                      <Badge variant="secondary" className="text-xs mt-1">
                        {profile.role}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="text-sm">
                    {profile.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded text-xs font-mono">
                      <div className="text-slate-600 dark:text-slate-400">
                        Username: <span className="text-slate-900 dark:text-white">{profile.username}</span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 text-[10px] mt-1">
                        <Lock className="inline h-3 w-3 mr-1" aria-hidden />Auto-login configuré
                      </div>
                    </div>
                    <Button 
                      onClick={() => handleLogin(profile)}
                      disabled={isLoading}
                      className="w-full"
                      data-testid={`button-login-${profile.role}`}
                    >
                      {isLoading ? (
                        <>
                          <span className="animate-spin mr-2">⏳</span>
                          Connexion...
                        </>
                      ) : (
                        <>
                          <Icon className="w-4 h-4 mr-2" />
                          Se connecter
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-8 p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
            <Lightbulb className="inline h-4 w-4 mr-1 align-text-bottom" aria-hidden />Instructions
          </h3>
          <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
            <li>• Cliquez sur un profil pour vous connecter automatiquement</li>
            <li>• Vous serez redirigé vers le dashboard correspondant à votre rôle</li>
            <li>• Passwords sécurisés : pwd_{'{'}username{'}_123'}</li>
            <li>• Cette page est accessible uniquement en dev : <code className="bg-blue-100 dark:bg-blue-900 px-2 py-0.5 rounded">/dev/profiles</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
