import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Truck, Fuel, Droplets, ArrowRight, LayoutDashboard, Car } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { HeaderCard, KpiGrid, KpiTile, CardShell, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { formatPrice } from "@/lib/utils";
import { useFuelCard } from "@/hooks/useFuelCard";
import { useAuth } from "@/hooks/useAuth";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { userMessageOf } from "@/lib/api-error";

export default function ClientDashboard() {
  const { user } = useAuth();
  const fuelCard = useFuelCard();

  const { data: vehicles } = useQuery<any>({ queryKey: ["/api/vehicles"] });
  const { data: fuelStats } = useQuery<any>({
    queryKey: ["/api/fuel-records/statistics", { period: "month" }],
  });

  const vehiclesCount = Array.isArray(vehicles) ? vehicles.length : 0;
  const totalDebits = Number(fuelCard.balance.data?.totalDebits || 0);
  const totalFuelLiters = Number(fuelStats?.totalFuel || 0);

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Tableau de bord · Client"
        title={user?.name ? `Bienvenue, ${user.name}` : "Tableau de bord"}
        subtitle="Vue d'ensemble de votre flotte et consommations du mois"
        icon={<Truck className="h-5 w-5" />}
      >
        <KpiGrid columns={3}>
          <KpiTile
            data-testid="client-kpi-vehicles"
            label="Mes véhicules"
            featured // son parc, la raison de sa connexion
            value={vehiclesCount}
            subValue="Total flotte"
            icon={<Truck className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          {fuelCard.balance.isLoading ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-3 w-24 mt-1" />
              <Skeleton className="h-5 w-20" />
            </div>
          ) : (
            <KpiTile
              data-testid="client-kpi-fuel"
              label="Dépense carburant"
              value={fuelCard.balance.failed ? UNAVAILABLE : formatPrice(totalDebits)}
              subValue={
                fuelCard.balance.failed
                  ? userMessageOf(fuelCard.balance.error, "Le solde de la carte carburant est momentanément indisponible.")
                  : "Total consommé ce mois"
              }
              icon={<Fuel className="h-4 w-4" />}
              iconWrapperClassName="bg-red-50 text-red-600"
            />
          )}
          <KpiTile
            data-testid="client-kpi-liters"
            label="Volume carburant"
            value={`${totalFuelLiters.toFixed(0)} L`}
            subValue="Litres consommés ce mois"
            icon={<Droplets className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
          />
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="overview">
        <PremiumTabsNav tabs={[
          { value: "overview", label: "Vue d'ensemble", icon: <TabIcon icon={LayoutDashboard} /> },
          { value: "fuel", label: "Carburant", icon: <TabIcon icon={Fuel} /> },
          { value: "vehicles", label: "Véhicules", icon: <TabIcon icon={Car} /> },
        ]} />

        <TabsContent value="overview" className="space-y-4">
          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Informations</p>
              <p className="text-sm text-gray-600">
                Contactez votre gestionnaire de flotte pour plus de détails sur vos véhicules et consommations.
              </p>
            </div>
          </CardShell>
        </TabsContent>

        <TabsContent value="fuel" className="space-y-4">
          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Statistiques Carburant — Ce mois</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-500">Consommation totale</span>
                  <span className="text-sm font-semibold text-gray-800">
                    {totalDebits > 0 ? formatPrice(totalDebits) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Litres consommés</span>
                  <span className="text-sm font-semibold text-gray-800">
                    {totalFuelLiters > 0 ? `${totalFuelLiters.toFixed(0)} L` : "—"}
                  </span>
                </div>
              </div>
            </div>
          </CardShell>
        </TabsContent>

        <TabsContent value="vehicles" className="space-y-4">
          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Ma Flotte</p>
              <p className="text-sm text-gray-600 mb-4">
                {vehiclesCount} véhicule{vehiclesCount > 1 ? "s" : ""} enregistré{vehiclesCount > 1 ? "s" : ""} à votre compte.
              </p>
              <Link href="/vehicles">
                <Button size="sm" variant="outline" className="gap-2" data-testid="btn-view-vehicles">
                  Voir mes véhicules <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardShell>
        </TabsContent>
      </Tabs>
    </div>
  );
}
