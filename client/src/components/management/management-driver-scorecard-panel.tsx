import { AlertCircle, Info, ShieldCheck, Star, Timer, Zap } from "lucide-react";
import { CardShell, KpiGrid, KpiTile, SectionLabel } from "@/components/design-system";
import { ManagementRankingPanel } from "@/components/management/management-ranking-panel";
import type { ManagementDriverScorecard } from "@shared/constants/management-dashboard";

type ManagementDriverScorecardPanelProps = {
  data: ManagementDriverScorecard;
};

function formatScore(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value)}/100`;
}

function formatConsumption(value: number | null): string {
  if (value == null) return "Non calculable";
  return `${value.toFixed(1).replace(".", ",")} L/100 km`;
}

function formatPunctuality(rate: number | null): string {
  if (rate == null) return "Non calculable";
  return `${Math.round(rate * 100)} % à l'heure`;
}

export function ManagementDriverScorecardPanel({ data }: ManagementDriverScorecardPanelProps) {
  const { summary } = data;

  return (
    <div className="space-y-4">
      <KpiGrid columns={4}>
        <KpiTile
          label="Chauffeurs actifs"
          value={summary.driverCount}
          subValue="Au moins une mission sur la période"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <KpiTile
          label="Note moyenne flotte"
          value={formatScore(summary.averageOverallScore)}
          subValue="Consommation · ponctualité · incidents"
          icon={<Star className="h-4 w-4" />}
          iconWrapperClassName="bg-emerald-50 text-emerald-700"
        />
        <KpiTile
          label="Médiane consommation"
          value={
            summary.fleetMedianConsumptionL100 != null
              ? formatConsumption(summary.fleetMedianConsumptionL100)
              : "—"
          }
          subValue="Référence L/100 km missions"
          icon={<Zap className="h-4 w-4" />}
          iconWrapperClassName="bg-amber-50 text-amber-700"
        />
        <KpiTile
          label="Chauffeurs avec incident"
          value={summary.driversWithIncidents}
          subValue="Signalements mission sur la période"
          icon={<AlertCircle className="h-4 w-4" />}
          iconWrapperClassName={
            summary.driversWithIncidents > 0 ? "bg-red-50 text-red-600" : undefined
          }
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ManagementRankingPanel
          title="Top chauffeurs — note globale"
          emptyLabel="Aucun chauffeur noté sur la période."
          amountLabel="Note /100"
          items={data.topPerformers.map((driver) => ({
            label: driver.driverName,
            primary: `${driver.missionCount} mission(s)`,
            secondary: `Conso ${formatConsumption(driver.averageConsumptionL100)} · ${formatPunctuality(driver.punctualityRate)}`,
            amount: driver.overallScore ?? 0,
          }))}
        />
        <ManagementRankingPanel
          title="À surveiller — éco-conduite & incidents"
          emptyLabel="Aucun chauffeur à signaler sur la période."
          amountLabel="Note /100"
          amountTone="deficit"
          items={data.needsAttention.map((driver) => ({
            label: driver.driverName,
            primary: driver.incompleteData
              ? "Données consommation ou livraison incomplètes"
              : `${driver.incidentCount} incident(s) · ${formatPunctuality(driver.punctualityRate)}`,
            secondary: `Conso ${formatConsumption(driver.averageConsumptionL100)} · ${driver.missionCount} mission(s)`,
            amount: driver.overallScore ?? 0,
          }))}
        />
      </div>

      <CardShell>
        <div className="px-5 py-4 flex gap-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-2">
            <SectionLabel>Méthode de notation</SectionLabel>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Note composite sur 100 :{" "}
              <strong className="font-medium text-foreground">40 % consommation</strong> (L/100 km
              mission vs médiane flotte),{" "}
              <strong className="font-medium text-foreground">40 % ponctualité</strong> (livraison
              réelle vs date prévue, tolérance 4 h corridor),{" "}
              <strong className="font-medium text-foreground">20 % incidents</strong> (−25 pts par
              signalement mission).
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5 shrink-0" />
              La consommation repose sur les litres et km réels saisis à la clôture mission. Les
              incidents proviennent des alertes « [Mission …] » enregistrées sur la période.
            </p>
          </div>
        </div>
      </CardShell>
    </div>
  );
}
