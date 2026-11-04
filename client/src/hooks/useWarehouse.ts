import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { warehouseService } from "@/services/warehouseService";

export function useWarehouse() {
  const toNumber = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  // Using /api/warehouse/reorder-alerts for complete reorder information
  const reorderAlertsQuery = useQuery<any>({
    queryKey: ['/api/warehouse/reorder-alerts'],
    enabled: true,
  });

  // Low stock source of truth (quantity <= minQuantity), includes true ruptures
  const lowStockPartsQuery = useQuery<any[]>({
    queryKey: ['/api/parts/low-on-stock'],
    enabled: true,
  });

  // OT/atelier demand signal (pièces demandées mais pas encore totalement servies)
  const partRequirementsQuery = useQuery<any[]>({
    queryKey: ['/api/part-requirements'],
    enabled: true,
  });

  // Parts statistics for KPIs
  const partsStatsQuery = useQuery<any>({
    queryKey: ['/api/parts/statistics'],
    enabled: true,
  });

  // Inventory value from parts statistics
  // `totalParts` = références distinctes, `totalQuantity` = unités physiques.
  // Ne pas repasser par `totalItems`: ce champ vaut la somme des quantités
  // malgré son nom, ce qui faisait afficher des unités là où on annonçait des
  // pièces. `totalQuantity` n'existait pas côté API et retombait donc à 0.
  const inventoryValueQuery = useQuery<any>({
    queryKey: ['/api/parts/statistics'],
    enabled: true,
    select: (data: any) => ({
      totalValue: parseInt(data?.totalValue || '0'),
      totalParts: parseInt(data?.totalParts || '0'),
      totalQuantity: parseInt(data?.totalQuantity || '0'),
    }),
  });

  // Statistics for warehouse dashboard
  const statisticsQuery = useQuery<any>({
    queryKey: ['/api/parts/statistics'],
    enabled: true,
    select: (data: any) => ({
      totalParts: parseInt(data?.totalParts || '0'),
      totalQuantity: parseInt(data?.totalQuantity || '0'),
      lowStockCount: parseInt(data?.lowStockCount || '0'),
      outOfStockCount: parseInt(data?.outOfStockCount || '0'),
    }),
  });


  const derivedReorderAlerts = Array.isArray(lowStockPartsQuery.data)
    ? (() => {
        const toDemandStatus = (statusRaw: unknown) => String(statusRaw || "").toLowerCase();
        const demandStatuses = new Set([
          "pending",
          "approved",
          "ordered",
          "partially_received",
          "partial",
        ]);

        const demandByPart = new Map<
          number,
          {
            quantityNeeded: number;
            quantity: number;
            minQuantity: number;
            unitPrice: number;
            name: string;
            reference: string;
            category: string;
            supplier: string;
          }
        >();

        if (Array.isArray(partRequirementsQuery.data)) {
          for (const req of partRequirementsQuery.data) {
            const status = toDemandStatus(req?.status);
            if (!demandStatuses.has(status)) continue;

            const partId = Number(req?.partId);
            if (!Number.isFinite(partId) || partId <= 0) continue;

            const neededQty = Math.max(0, Math.floor(toNumber(req?.quantityNeeded)));
            if (neededQty <= 0) continue;

            const existing = demandByPart.get(partId);
            if (existing) {
              existing.quantityNeeded += neededQty;
              continue;
            }

            demandByPart.set(partId, {
              quantityNeeded: neededQty,
              quantity: toNumber(req?.partQuantity),
              minQuantity: toNumber(req?.partMinQuantity),
              unitPrice: toNumber(req?.partUnitPrice),
              name: req?.partName || "Pièce",
              reference: req?.partReference || "",
              category: req?.partCategory || "",
              supplier: req?.partSupplier || "—",
            });
          }
        }

        const mappedParts = lowStockPartsQuery.data.map((part: any) => {
          const quantity = toNumber(part?.quantity);
          const minQuantity = toNumber(part?.minQuantity);
          const unitPrice = toNumber(part?.unitPrice);
          const thresholdShortage = Math.max(0, minQuantity - quantity);
          const demand = demandByPart.get(Number(part?.id));
          const demandQty = toNumber(demand?.quantityNeeded);
          const demandShortage = Math.max(0, demandQty - quantity);
          const shortage = Math.max(thresholdShortage, demandShortage);

          if (demand) {
            demandByPart.delete(Number(part?.id));
          }

          return {
            id: part?.id,
            name: part?.name || "Pièce",
            reference: part?.reference || "",
            category: part?.category || "",
            quantity,
            realStock: part?.realStock ?? quantity,
            minQuantity,
            unitPrice,
            supplier: part?.supplier || "—",
            reorderAlert: quantity <= minQuantity,
            demandQuantity: demandQty,
            demandShortage,
            thresholdShortage,
            shortage,
          };
        });

        // Inclure aussi les pièces demandées par OT avec manque réel, même si elles ne sont pas (encore) sous le seuil min
        for (const [partId, demand] of demandByPart.entries()) {
          const quantity = toNumber(demand.quantity);
          const minQuantity = toNumber(demand.minQuantity);
          const unitPrice = toNumber(demand.unitPrice);
          const demandQty = toNumber(demand.quantityNeeded);
          const demandShortage = Math.max(0, demandQty - quantity);
          const thresholdShortage = Math.max(0, minQuantity - quantity);
          const shortage = Math.max(thresholdShortage, demandShortage);
          const reorderAlert = quantity <= minQuantity;

          if (!reorderAlert && demandShortage <= 0) continue;

          mappedParts.push({
            id: partId,
            name: demand.name || "Pièce",
            reference: demand.reference || "",
            category: demand.category || "",
            quantity,
            realStock: quantity,
            minQuantity,
            unitPrice,
            supplier: demand.supplier || "—",
            reorderAlert,
            demandQuantity: demandQty,
            demandShortage,
            thresholdShortage,
            shortage,
          });
        }

        // Dédupliquer et trier par manque décroissant
        const dedupedByPart = new Map<number, any>();
        for (const item of mappedParts) {
          const partId = Number(item.id);
          if (!Number.isFinite(partId) || partId <= 0) continue;
          const existing = dedupedByPart.get(partId);
          if (!existing || toNumber(item.shortage) > toNumber(existing.shortage)) {
            dedupedByPart.set(partId, item);
          }
        }
        const finalParts = Array.from(dedupedByPart.values()).sort(
          (a: any, b: any) => toNumber(b.shortage) - toNumber(a.shortage),
        );

        const totalShortage = finalParts.reduce((acc: number, item: any) => acc + toNumber(item.shortage), 0);
        const estimatedCost = finalParts.reduce(
          (acc: number, item: any) => acc + (toNumber(item.shortage) * toNumber(item.unitPrice)),
          0,
        );
        const otDemandShortage = finalParts.reduce((acc: number, item: any) => acc + toNumber(item.demandShortage), 0);
        const otDemandEstimatedCost = finalParts.reduce(
          (acc: number, item: any) => acc + (toNumber(item.demandShortage) * toNumber(item.unitPrice)),
          0,
        );

        return {
          parts: finalParts,
          totalAlerts: finalParts.length,
          totalShortage,
          estimatedCost,
          otDemandShortage,
          otDemandEstimatedCost,
        };
      })()
    : reorderAlertsQuery.data;

  const derivedStatistics = (() => {
    const stats = statisticsQuery.data;
    const parts = derivedReorderAlerts?.parts;

    if (!Array.isArray(parts)) return stats;

    const outOfStockCount = parts.filter((p: any) => toNumber(p.quantity) <= 0).length;
    const lowStockCount = parts.filter((p: any) => toNumber(p.quantity) > 0 && toNumber(p.quantity) <= toNumber(p.minQuantity)).length;

    // Étaler `stats` plutôt qu'énumérer les champs: cette recomposition ne doit
    // recalculer que les deux compteurs dérivés des pièces en alerte. En listant
    // les champs un par un, tout nouvel ajout au `select` était silencieusement
    // perdu — c'est ce qui faisait afficher « 0 unités physiques ».
    return {
      ...stats,
      lowStockCount,
      outOfStockCount,
    };
  })();

  return {
    inventoryValue: {
      data: inventoryValueQuery.data,
      isLoading: inventoryValueQuery.isLoading,
      error: inventoryValueQuery.error,
      refetch: inventoryValueQuery.refetch,
    },
    reorderAlerts: {
      data: derivedReorderAlerts,
      isLoading: reorderAlertsQuery.isLoading || lowStockPartsQuery.isLoading || partRequirementsQuery.isLoading,
      error: reorderAlertsQuery.error || lowStockPartsQuery.error || partRequirementsQuery.error,
      refetch: async () => {
        await Promise.all([
          reorderAlertsQuery.refetch(),
          lowStockPartsQuery.refetch(),
          partRequirementsQuery.refetch(),
        ]);
      },
    },
    statistics: {
      data: derivedStatistics,
      isLoading: statisticsQuery.isLoading || lowStockPartsQuery.isLoading,
      error: statisticsQuery.error,
      refetch: statisticsQuery.refetch,
    },
    service: warehouseService,
  };
}

export function useMostUsedParts(limit?: number) {
  return useQuery<any>({
    queryKey: ['/api/warehouse/most-used-parts', { limit }],
    enabled: true,
  });
}

export function usePartRealStock(partId: number | null) {
  return useQuery<any>({
    queryKey: ['/api/warehouse/parts', partId, 'real-stock'],
    enabled: !!partId && partId > 0,
  });
}

export function useWarehouseRefresh() {
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse'] });
  };

  const refreshInventoryValue = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/inventory-value'] });
  };

  const refreshReorderAlerts = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/reorder-alerts'] });
    queryClient.invalidateQueries({ queryKey: ['/api/parts/low-on-stock'] });
  };

  const refreshRealStock = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/real-stock'] });
  };

  return {
    refreshAll,
    refreshInventoryValue,
    refreshReorderAlerts,
    refreshRealStock,
  };
}
