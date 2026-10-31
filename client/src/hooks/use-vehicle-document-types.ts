import { useQuery } from "@tanstack/react-query";
import {
  VEHICLE_DOCUMENT_TYPES_PATH,
  vehicleDocumentTypeListResponseSchema,
  type VehicleDocumentType,
} from "@shared/contracts/vehicle-document-types";

/** Referentiel des types de document, trie par `sortOrder`. `activeOnly` pour les selecteurs de saisie. */
export function useVehicleDocumentTypes(options: { activeOnly?: boolean } = {}) {
  const { activeOnly = false } = options;
  return useQuery({
    queryKey: [VEHICLE_DOCUMENT_TYPES_PATH],
    staleTime: 5 * 60 * 1000,
    select: (data): VehicleDocumentType[] => {
      const list = vehicleDocumentTypeListResponseSchema.parse(data);
      return [...list].filter((t) => !activeOnly || t.active).sort((a, b) => a.sortOrder - b.sortOrder);
    },
  });
}
