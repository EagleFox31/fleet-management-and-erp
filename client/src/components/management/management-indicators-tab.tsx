import { ManagementIndicatorsBento } from "@/components/management/management-indicators-bento";
import type { ManagementDashboardResponse } from "@shared/constants/management-dashboard";

type ManagementIndicatorsTabProps = {
  data: ManagementDashboardResponse;
};

export function ManagementIndicatorsTab({ data }: ManagementIndicatorsTabProps) {
  return (
    <ManagementIndicatorsBento
      executiveKpis={data.executiveKpis}
      vehicleTco={data.vehicleTco}
      driverScorecard={data.driverScorecard}
      vehicleObsolescence={data.vehicleObsolescence}
    />
  );
}
