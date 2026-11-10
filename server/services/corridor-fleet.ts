import {
  findCorridorByDestination,
  type LiveCorridorVehicle,
  type TransitStatus,
} from "@shared/constants/cemac-corridors";

/**
 * Dérivation honnête de la ligne « flotte sur les corridors » de la carte Direction.
 * Fonction pure (aucun accès base) : testable sans DATABASE_URL.
 *
 * Règles (lot GPS-FE-4) :
 * - le statut se déduit uniquement de l'état du véhicule et de sa mission réelle ;
 * - aucune coordonnée ni progression n'est fabriquée : sans source de position réelle,
 *   `positionSource` vaut "none" et `currentLat` / `currentLng` / `progressPercent` sont absents ;
 * - un véhicule sans mission en cours n'est jamais « en transit ».
 */

export type CorridorVehicleRow = {
  id: number;
  registrationNumber: string;
  brand: string;
  model: string;
  status: string;
  locationCode?: string | null;
};

export type CorridorActiveMission = {
  missionId: number;
  orderNumber?: string | null;
  missionStatus: string;
  assignmentStatus?: string | null;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
  weight?: string | number | null;
  actualDistance?: string | number | null;
  actualFuelQuantity?: string | number | null;
  clientName?: string | null;
  driverName?: string;
  cargoLabel?: string;
};

/** Dernier point réel connu d'un véhicule (source téléphone ou balise), quand elle existera. */
export type CorridorRealPosition = {
  lat: number;
  lng: number;
  source: "phone" | "tracker";
  recordedAt: Date;
};

export function deriveTransitStatus(
  vehicleStatus: string,
  missionStatus: string | undefined,
  assignmentStatus?: string | null,
): TransitStatus {
  if (vehicleStatus === "out_of_service" || vehicleStatus === "maintenance") return "alert";
  if (missionStatus === "in_progress") {
    // Le chauffeur doit avoir accepté : une affectation encore en attente n'a pas pris la route.
    return assignmentStatus === "accepted" || assignmentStatus === "in_progress" ? "in_transit" : "loading";
  }
  if (missionStatus === "assigned" || missionStatus === "planned") return "loading";
  return "stopped";
}

function positiveNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function buildCorridorVehicle(
  vehicle: CorridorVehicleRow,
  active: CorridorActiveMission | undefined,
  position?: CorridorRealPosition,
): LiveCorridorVehicle {
  const transitStatus = deriveTransitStatus(vehicle.status, active?.missionStatus, active?.assignmentStatus);
  const corridor = active?.deliveryAddress
    ? findCorridorByDestination(active.deliveryAddress)
    : undefined;

  const weightTonnes = positiveNumber(active?.weight);
  const distance = positiveNumber(active?.actualDistance);
  const fuel = positiveNumber(active?.actualFuelQuantity);

  return {
    vehicleId: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    brand: vehicle.brand,
    model: vehicle.model,
    vehicleStatus: vehicle.status as LiveCorridorVehicle["vehicleStatus"],
    missionId: active?.missionId,
    orderNumber: active?.orderNumber ?? undefined,
    clientName: active?.clientName || undefined,
    driverName: active?.driverName,
    origin: active?.pickupAddress || undefined,
    destination: active?.deliveryAddress || undefined,
    cargoLabel: active?.cargoLabel,
    weightTonnes,
    ...(position
      ? {
          currentLat: position.lat,
          currentLng: position.lng,
          positionSource: position.source,
          positionAt: position.recordedAt.toISOString(),
        }
      : { positionSource: "none" as const }),
    corridorId: corridor?.id,
    transitStatus,
    fuelConsumptionAvg: distance && fuel ? Number(((fuel / distance) * 100).toFixed(1)) : undefined,
  };
}
