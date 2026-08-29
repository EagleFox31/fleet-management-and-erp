import { Link } from "wouter";
import { ArrowLeft, Map, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertBannerCard, HeaderCard } from "@/components/design-system";

export default function ManagementCorridorMapPage() {
  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Direction · Cartographie"
        title="Corridors CEMAC"
        icon={<Map className="h-5 w-5" />}
      >
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour au tableau de bord
          </Link>
        </Button>
      </HeaderCard>

      <AlertBannerCard
        variant="info"
        title="Bientôt disponible"
        icon={<Route className="h-4 w-4" />}
      />
    </div>
  );
}
