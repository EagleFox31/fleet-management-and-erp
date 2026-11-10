import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Ticket } from "lucide-react";
import { HeaderCard, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingError } from "@/components/ui/loading-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useToast } from "@/hooks/use-toast";
import { userMessageOf } from "@/lib/api-error";
import { useContractQuery } from "@/lib/contract-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import {
  FUEL_VOUCHERS_PATH,
  fuelVoucherValidationResponseSchema,
  fuelVouchersResponseSchema,
  validateFuelVoucherPath,
  type FuelValidationStatus,
  type FuelVoucher,
  type FuelVoucherValidateBody,
  type FuelVouchersQuery,
} from "@shared/contracts/fuel-vouchers";

/** Le badge décrit le bon (AGENTS.md §1). */
export const FUEL_VOUCHER_STATUS_LABELS: Record<FuelValidationStatus, string> = {
  pending: "En attente",
  validated: "Validé",
};

const FILTERS: { value: FuelVouchersQuery["status"]; label: string }[] = [
  { value: "pending", label: "En attente" },
  { value: "validated", label: "Validés" },
  { value: "all", label: "Tous" },
];

/**
 * Bons de carburant (P-17). `readOnly` pour qui consulte sans valider (chef d'atelier,
 * direction : hors `FUEL_WRITE_ROLES`) : la colonne Valider n'existe pas pour eux.
 */
export function FuelVouchersTable({ readOnly = false }: { readOnly?: boolean }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<FuelVouchersQuery["status"]>("pending");
  const vouchers = useContractQuery(FUEL_VOUCHERS_PATH, fuelVouchersResponseSchema, { status });

  const mutation = useMutation({
    // La version affichée part avec la validation : un bon modifié depuis son affichage répond 409.
    mutationFn: async ({ id, version }: { id: number; version: string }) =>
      fuelVoucherValidationResponseSchema.parse(
        await (await apiRequest("POST", validateFuelVoucherPath(id), { version } satisfies FuelVoucherValidateBody)).json(),
      ),
    onSuccess: () => {
      // Couche 3 : liste des bons et écrans carburant qui affichent les pleins.
      for (const key of [FUEL_VOUCHERS_PATH, "/api/fuel-records", "/api/fuel-card"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast({ title: "Bon validé" });
    },
    onError: (error) => {
      // 409 (bon changé ou déjà validé) : la liste est périmée, on la recharge.
      void queryClient.invalidateQueries({ queryKey: [FUEL_VOUCHERS_PATH] });
      toast({ title: "Bon non validé", description: userMessageOf(error), variant: "destructive" });
    },
  });
  const validate = useSingleFlightMutate(mutation.mutate);

  const columns: PremiumDataTableColumn<FuelVoucher>[] = [
    { id: "date", header: "Date", cell: (v) => (v.date ? formatDate(v.date) : "—") },
    { id: "vehicle", header: "Véhicule", cell: (v) => v.vehicleLabel ?? `#${v.vehicleId}` },
    { id: "quantity", header: "Quantité", align: "right", cell: (v) => `${v.quantity.toLocaleString("fr-FR")} L` },
    { id: "cost", header: "Montant", align: "right", cell: (v) => (v.cost == null ? "—" : `${v.cost.toLocaleString("fr-FR")} FCFA`) },
    { id: "station", header: "Station", cell: (v) => v.stationName ?? "—" },
    {
      id: "status",
      header: "Statut",
      cell: (v) => (
        <Badge variant={v.validationStatus === "validated" ? "default" : "secondary"}>
          {FUEL_VOUCHER_STATUS_LABELS[v.validationStatus]}
        </Badge>
      ),
    },
    { id: "by", header: "Validé par", cell: (v) => v.validatedByName ?? "—" },
  ];
  if (!readOnly) {
    columns.push({
      id: "action",
      header: "",
      align: "right",
      cell: (v) =>
        v.validationStatus === "pending" ? (
          <Button size="sm" variant="outline" onClick={() => validate({ id: v.id, version: v.version })} data-testid={`fuel-voucher-validate-${v.id}`}>
            <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
            Valider
          </Button>
        ) : null,
    });
  }

  return (
    <div className="space-y-4" data-testid="fuel-vouchers">
      <HeaderCard moduleLabel="Carburant" title="Bons de carburant" icon={<Ticket className="h-5 w-5" />} />
      {vouchers.isError ? (
        <LoadingError isLoading={false} error={vouchers.error} onRetry={() => vouchers.refetch()} />
      ) : (
        <PremiumDataTable
          columns={columns}
          rows={vouchers.data ?? []}
          rowKey={(v) => String(v.id)}
          toolbar={
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Select value={status} onValueChange={(value) => setStatus(value as FuelVouchersQuery["status"])}>
                <SelectTrigger className="h-8 w-40" aria-label="Statut des bons">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
          emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucun bon pour ce filtre.</p>}
        />
      )}
    </div>
  );
}
