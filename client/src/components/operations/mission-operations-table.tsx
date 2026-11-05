import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { HeaderCard, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingError } from "@/components/ui/loading-error";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useContractQuery } from "@/lib/contract-query";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import {
  DEFAULT_TRIP_DURATION_BASIS,
  MISSION_OPERATIONS_PATH,
  OPERATION_RECAP_LABELS,
  OPERATION_RECAP_STATUSES,
  TRIP_DURATION_BASES,
  TRIP_DURATION_BASIS_LABELS,
  missionOperationsResponseSchema,
  tripDurationDays,
  type MissionOperationBody,
  type MissionOperationRow,
  type TripDurationBasis,
} from "@shared/contracts/mission-operations";

const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const dateCell = (iso: string | null) => (iso ? formatDate(iso) : "—");

type Draft = Record<
  | "containerNumber" | "blNumber" | "sector" | "goodsNature" | "comment"
  | "loadingDate" | "departureDate" | "returnDate" | "unloadingDate",
  string
>;

const draftOf = (r: MissionOperationRow): Draft => ({
  containerNumber: r.containerNumber ?? "",
  blNumber: r.blNumber ?? "",
  sector: r.sector ?? "",
  goodsNature: r.goodsNature ?? "",
  comment: r.comment ?? "",
  loadingDate: dayOf(r.loadingDate),
  departureDate: dayOf(r.departureDate),
  returnDate: dayOf(r.returnDate),
  unloadingDate: dayOf(r.unloadingDate),
});

/** Champ vide = valeur effacée (null) ; le serveur rejoue le même corps sans effet de bord. */
export const operationBodyOf = (d: Draft): MissionOperationBody => ({
  containerNumber: d.containerNumber || null,
  blNumber: d.blNumber || null,
  sector: d.sector || null,
  goodsNature: d.goodsNature || null,
  comment: d.comment || null,
  loadingDate: d.loadingDate || null,
  departureDate: d.departureDate || null,
  returnDate: d.returnDate || null,
  unloadingDate: d.unloadingDate || null,
});

const FIELDS: { key: keyof Draft; label: string; type?: "date" }[] = [
  { key: "containerNumber", label: "N° conteneur" },
  { key: "blNumber", label: "N° BL" },
  { key: "sector", label: "Secteur" },
  { key: "goodsNature", label: "Nature de la marchandise" },
  { key: "loadingDate", label: "Chargement", type: "date" },
  { key: "departureDate", label: "Départ", type: "date" },
  { key: "unloadingDate", label: "Déchargement", type: "date" },
  { key: "returnDate", label: "Retour", type: "date" },
  { key: "comment", label: "Commentaire" },
];

/** Suivi des opérations clients (O1) : une ligne par mission, récapitulatif en 5 statuts. */
export function MissionOperationsTable({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");
  const [month, setMonth] = useState("");
  const [basis, setBasis] = useState<TripDurationBasis>(DEFAULT_TRIP_DURATION_BASIS);
  const [editing, setEditing] = useState<MissionOperationRow | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const params = { ...(clientId ? { clientId } : {}), ...(month ? { month } : {}) };
  const query = useContractQuery(MISSION_OPERATIONS_PATH, missionOperationsResponseSchema, params);
  const data = query.data;

  const clients = useMemo(() => {
    const seen = new Map<number, string>();
    for (const r of data?.rows ?? []) if (r.clientId && r.clientName) seen.set(r.clientId, r.clientName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const save = useMutation({
    mutationFn: (v: { missionId: number; body: MissionOperationBody }) =>
      apiRequest("PUT", `${MISSION_OPERATIONS_PATH}/${v.missionId}`, v.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MISSION_OPERATIONS_PATH] });
      setEditing(null);
      toast({ title: "Suivi enregistré" });
    },
    onError: (error) =>
      toast({ title: "Enregistrement impossible", description: userMessageOf(error), variant: "destructive" }),
  });
  const submit = useSingleFlightMutate(save.mutate);

  const columns: PremiumDataTableColumn<MissionOperationRow>[] = [
    { id: "client", header: "Client", cell: (r) => r.clientName ?? "—" },
    { id: "order", header: "Commande", cell: (r) => r.orderNumber },
    { id: "container", header: "Conteneur", cell: (r) => r.containerNumber ?? "—" },
    { id: "bl", header: "BL", cell: (r) => r.blNumber ?? "—" },
    { id: "sector", header: "Secteur", cell: (r) => r.sector ?? "—" },
    { id: "loading", header: "Chargement", cell: (r) => dateCell(r.loadingDate) },
    { id: "departure", header: "Départ", cell: (r) => dateCell(r.departureDate) },
    { id: "unloading", header: "Déchargement", cell: (r) => dateCell(r.unloadingDate) },
    { id: "return", header: "Retour", cell: (r) => dateCell(r.returnDate) },
    {
      id: "duration",
      header: "Durée",
      align: "right",
      cell: (r) => {
        const d = tripDurationDays(r, basis);
        return d === null ? "—" : `${d} j`;
      },
    },
    { id: "invoice", header: "Facture", cell: (r) => r.invoiceNumber ?? "—" },
    { id: "status", header: "Statut", cell: (r) => OPERATION_RECAP_LABELS[r.recapStatus] },
  ];

  return (
    <div className="space-y-4" data-testid="mission-operations">
      <HeaderCard moduleLabel="Exploitation" title="Suivi des opérations clients" icon={<ClipboardList className="h-5 w-5" />} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="operations-recap">
        {OPERATION_RECAP_STATUSES.map((s) => (
          <div key={s} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{OPERATION_RECAP_LABELS[s]}</p>
            <p className="text-2xl font-semibold" data-testid={`recap-${s}`}>{data?.recap[s] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Client</span>
          <select className="h-9 rounded-md border bg-background px-2" value={clientId} onChange={(e) => setClientId(e.target.value)} data-testid="filter-client">
            <option value="">Tous</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Mois</span>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="filter-month" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Durée du voyage</span>
          <select className="h-9 rounded-md border bg-background px-2" value={basis} onChange={(e) => setBasis(e.target.value as TripDurationBasis)} data-testid="duration-basis">
            {TRIP_DURATION_BASES.map((b) => (
              <option key={b} value={b}>{TRIP_DURATION_BASIS_LABELS[b]}</option>
            ))}
          </select>
        </label>
      </div>

      {query.isLoading || query.isError ? (
        <LoadingError isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PremiumDataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(r) => r.missionId}
          onRowClick={canWrite ? (r) => { setEditing(r); setDraft(draftOf(r)); } : undefined}
          emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucune opération pour ces filtres.</p>}
        />
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suivi de la commande {editing?.orderNumber}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              {FIELDS.map((f) => (
                <label key={f.key} className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">{f.label}</span>
                  <Input type={f.type ?? "text"} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                </label>
              ))}
              <Button
                disabled={save.isPending}
                onClick={() => editing && submit({ missionId: editing.missionId, body: operationBodyOf(draft) })}
                data-testid="save-operation"
              >
                Enregistrer
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
