import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOperations } from "@/hooks/useOperations";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck, Calendar, MapPin } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  planned: "Planifiée",
  assigned: "Assignée",
  in_progress: "En cours",
  delivered: "Livrée",
  completed: "Terminée",
  cancelled: "Annulée",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  planned: "bg-yellow-100 text-yellow-800",
  assigned: "bg-blue-100 text-blue-800",
  in_progress: "bg-green-100 text-green-800",
  delivered: "bg-emerald-100 text-emerald-800",
  completed: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-700",
};

export function MissionsList() {
  const { activeMissions, upcomingMissions } = useOperations();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Missions en cours
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeMissions.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : activeMissions.data && activeMissions.data.length > 0 ? (
            <div className="space-y-3">
              {activeMissions.data.map((mission) => (
                <div
                  key={mission.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  data-testid={`active-mission-${mission.id}`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold">{mission.clientName ?? mission.orderNumber}</h4>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {mission.deliveryAddress}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[mission.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {STATUS_LABELS[mission.status] ?? mission.status}
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm">
                    {mission.pickupDate && (
                      <span className="text-muted-foreground">
                        <Calendar className="h-3 w-3 inline mr-1" />
                        Départ: {format(new Date(mission.pickupDate), "dd MMM yyyy HH:mm", { locale: fr })}
                      </span>
                    )}
                    {mission.deliveryDate && (
                      <span className="text-muted-foreground">
                        Livraison: {format(new Date(mission.deliveryDate), "dd MMM yyyy HH:mm", { locale: fr })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              Aucune mission en cours
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Missions à venir
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingMissions.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : upcomingMissions.data && upcomingMissions.data.length > 0 ? (
            <div className="space-y-3">
              {upcomingMissions.data.map((mission) => (
                <div
                  key={mission.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  data-testid={`upcoming-mission-${mission.id}`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold">{mission.clientName ?? mission.orderNumber}</h4>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {mission.deliveryAddress}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[mission.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {STATUS_LABELS[mission.status] ?? mission.status}
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm">
                    {mission.pickupDate && (
                      <span className="text-muted-foreground">
                        <Calendar className="h-3 w-3 inline mr-1" />
                        Départ: {format(new Date(mission.pickupDate), "dd MMM yyyy HH:mm", { locale: fr })}
                      </span>
                    )}
                    {mission.deliveryDate && (
                      <span className="text-muted-foreground">
                        Livraison: {format(new Date(mission.deliveryDate), "dd MMM yyyy HH:mm", { locale: fr })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              Aucune mission planifiée
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
