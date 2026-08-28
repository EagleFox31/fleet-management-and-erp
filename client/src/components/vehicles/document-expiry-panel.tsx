import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";
import { CheckCircle2, IdCard, Shield, Wrench } from "lucide-react";

interface Vehicle {
  id: number;
  registrationNumber: string;
  brand: string;
  model: string;
  licensePlateExpiry: string | null;
  insuranceExpiry: string | null;
  technicalInspectionDate: string | null;
}

interface ExpiringDocuments {
  carteGrise: Vehicle[];
  assurance: Vehicle[];
  visiteTechnique: Vehicle[];
  totalExpiring: number;
}

type ExpiredDocumentType = "carte_grise" | "assurance" | "visite_technique";

interface ExpiredDocument {
  type: ExpiredDocumentType;
  expiryDate: string;
}

interface ExpiredVehicle extends Vehicle {
  expiredDocuments?: ExpiredDocument[];
}

export function DocumentExpiryPanel() {
  const { data: expiringDocs, isLoading } = useQuery<ExpiringDocuments>({
    queryKey: ["/api/vehicles/expiring-docs"],
  });

  const { data: expiredDocs = [] } = useQuery<ExpiredVehicle[]>({
    queryKey: ["/api/vehicles/expired-docs"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const getDaysUntilExpiry = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getBadgeVariant = (days: number | null) => {
    if (days === null) return "secondary";
    if (days < 0) return "destructive";
    if (days <= 7) return "destructive";
    if (days <= 15) return "destructive";
    if (days <= 30) return "warning";
    return "secondary";
  };

  const mergeExpiringAndExpiredByType = (
    expiring: Vehicle[] | undefined,
    docType: ExpiredDocumentType,
  ): Vehicle[] => {
    const mergedById = new Map<number, Vehicle>();

    (expiring ?? []).forEach((vehicle) => {
      mergedById.set(vehicle.id, vehicle);
    });

    expiredDocs
      .filter((vehicle) =>
        Array.isArray(vehicle.expiredDocuments) &&
        vehicle.expiredDocuments.some((document) => document.type === docType),
      )
      .forEach((vehicle) => {
        mergedById.set(vehicle.id, vehicle);
      });

    return Array.from(mergedById.values());
  };

  const carteGriseAlerts = mergeExpiringAndExpiredByType(expiringDocs?.carteGrise, "carte_grise");
  const assuranceAlerts = mergeExpiringAndExpiredByType(expiringDocs?.assurance, "assurance");
  const visiteTechniqueAlerts = mergeExpiringAndExpiredByType(
    expiringDocs?.visiteTechnique,
    "visite_technique",
  );

  return (
    <div className="space-y-6">
      {/* Panneaux documents expirant bientôt */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Cartes Grises */}
        <Card data-testid="card-expiring-carte-grise">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <IdCard className="w-5 h-5 text-blue-600" />
              Cartes Grises
            </CardTitle>
          </CardHeader>
          <CardContent>
            {carteGriseAlerts.length > 0 ? (
              <div className="space-y-3">
                {carteGriseAlerts.map((vehicle) => {
                  const days = getDaysUntilExpiry(vehicle.licensePlateExpiry);
                  return (
                    <div
                      key={vehicle.id}
                      className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      data-testid={`vehicle-carte-grise-${vehicle.id}`}
                    >
                      <div>
                        <p className="font-medium text-sm">{vehicle.registrationNumber}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {vehicle.brand} {vehicle.model}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant={getBadgeVariant(days)}>
                          {days !== null && days > 0 ? `${days}j` : "Expiré"}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {vehicle.licensePlateExpiry && formatDate(vehicle.licensePlateExpiry)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Aucune carte grise à renouveler
              </p>
            )}
          </CardContent>
        </Card>

        {/* Assurances */}
        <Card data-testid="card-expiring-assurance">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-600" />
              Assurances
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assuranceAlerts.length > 0 ? (
              <div className="space-y-3">
                {assuranceAlerts.map((vehicle) => {
                  const days = getDaysUntilExpiry(vehicle.insuranceExpiry);
                  return (
                    <div
                      key={vehicle.id}
                      className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      data-testid={`vehicle-assurance-${vehicle.id}`}
                    >
                      <div>
                        <p className="font-medium text-sm">{vehicle.registrationNumber}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {vehicle.brand} {vehicle.model}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant={getBadgeVariant(days)}>
                          {days !== null && days > 0 ? `${days}j` : "Expiré"}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {vehicle.insuranceExpiry && formatDate(vehicle.insuranceExpiry)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Aucune assurance à renouveler
              </p>
            )}
          </CardContent>
        </Card>

        {/* Visites Techniques */}
        <Card data-testid="card-expiring-visite-technique">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Wrench className="w-5 h-5 text-orange-600" />
              Visites Techniques
            </CardTitle>
          </CardHeader>
          <CardContent>
            {visiteTechniqueAlerts.length > 0 ? (
              <div className="space-y-3">
                {visiteTechniqueAlerts.map((vehicle) => {
                  const days = getDaysUntilExpiry(vehicle.technicalInspectionDate);
                  return (
                    <div
                      key={vehicle.id}
                      className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                      data-testid={`vehicle-visite-technique-${vehicle.id}`}
                    >
                      <div>
                        <p className="font-medium text-sm">{vehicle.registrationNumber}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {vehicle.brand} {vehicle.model}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant={getBadgeVariant(days)}>
                          {days !== null && days > 0 ? `${days}j` : "Expiré"}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {vehicle.technicalInspectionDate && formatDate(vehicle.technicalInspectionDate)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Aucune visite technique à planifier
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
