import { Link } from "wouter";
import { ArrowRight, Eye, FileText, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardShell, HeaderCard } from "@/components/design-system";
import { useAuth } from "@/hooks/useAuth";

/**
 * Tableau de bord du lecteur : consultation seule. Aucune saisie n'est proposée ici et le
 * serveur refuse toute écriture de ce profil (garde `viewerReadOnlyGuard`).
 */
export default function ViewerDashboard() {
  const { user } = useAuth();

  const links = [
    { href: "/vehicles", label: "Véhicules", hint: "Parc, documents et historique de chaque véhicule", icon: Truck },
    { href: "/reports", label: "Rapports", hint: "Indicateurs et rapports d'activité", icon: FileText },
  ];

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Tableau de bord · Lecteur"
        title={user?.name ? `Bienvenue, ${user.name}` : "Tableau de bord"}
        subtitle="Consultation seule : aucune saisie n'est possible avec ce profil"
        icon={<Eye className="h-5 w-5" />}
      />

      <CardShell>
        <div className="px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Consulter</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {links.map(({ href, label, hint, icon: Icon }) => (
              <Link key={href} href={href}>
                <Button variant="outline" className="w-full h-auto justify-between gap-3 px-3 py-2.5 text-left" data-testid={`viewer-link-${href.replace(/\//g, "-").replace(/^-/, "")}`}>
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs font-normal text-gray-500 truncate">{hint}</span>
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </CardShell>
    </div>
  );
}
