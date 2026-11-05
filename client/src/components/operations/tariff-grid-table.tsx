import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { AlertModal, HeaderCard, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingError } from "@/components/ui/loading-error";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useContractQuery } from "@/lib/contract-query";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import {
  PRICING_UNITS,
  PRICING_UNIT_LABELS,
  TARIFF_GRID_PATH,
  TARIFF_PAGE_SIZE_DEFAULT,
  tariffListResponseSchema,
  type PricingUnit,
  type TariffBody,
  type TariffRow,
} from "@shared/contracts/tariff-grid";

type Draft = {
  clientId: string;
  origin: string;
  destination: string;
  cargoType: string;
  pricingUnit: PricingUnit;
  unitPrice: string;
  validFrom: string;
  validTo: string;
  notes: string;
};

const EMPTY: Draft = {
  clientId: "",
  origin: "",
  destination: "",
  cargoType: "",
  pricingUnit: "ton",
  unitPrice: "",
  validFrom: "",
  validTo: "",
  notes: "",
};

const draftOf = (t: TariffRow): Draft => ({
  clientId: t.clientId ? String(t.clientId) : "",
  origin: t.origin,
  destination: t.destination,
  cargoType: t.cargoType,
  pricingUnit: t.pricingUnit,
  unitPrice: String(t.unitPrice),
  validFrom: t.validFrom,
  validTo: t.validTo ?? "",
  notes: t.notes ?? "",
});

/** Corps envoyé au serveur : champ vide = pas de client, pas de fin de période, pas de note. */
export const tariffBodyOf = (d: Draft, active = true): TariffBody => ({
  clientId: d.clientId ? Number(d.clientId) : null,
  origin: d.origin.trim(),
  destination: d.destination.trim(),
  cargoType: d.cargoType.trim(),
  pricingUnit: d.pricingUnit,
  unitPrice: Number(d.unitPrice),
  validFrom: d.validFrom,
  validTo: d.validTo || null,
  notes: d.notes.trim() || null,
  active,
});

const NO_CLIENT = "none";

const xaf = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} XAF`;

/** Libellé de la page affichée : « 51-100 sur 130 ». */
export function pageRangeLabel(p: { total: number; limit: number; offset: number }): string {
  if (p.total === 0) return "0 sur 0";
  return `${p.offset + 1}-${Math.min(p.offset + p.limit, p.total)} sur ${p.total}`;
}

/** Grille tarifaire (O3) : prix suggérés, jamais appliqués seuls. `readOnly` hors admin et direction. */
export function TariffGridTable({ readOnly = false }: { readOnly?: boolean }) {
  const { toast } = useToast();
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<TariffRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirmDeactivate, setConfirmDeactivate] = useState<TariffRow | null>(null);

  const query = useContractQuery(TARIFF_GRID_PATH, tariffListResponseSchema, {
    activeOnly: String(activeOnly),
    limit: String(TARIFF_PAGE_SIZE_DEFAULT),
    offset: String(page * TARIFF_PAGE_SIZE_DEFAULT),
  });
  // Dernière page vidée (désactivation d'un tarif en filtre actif) : retour à la page précédente.
  useEffect(() => {
    if (page > 0 && query.data && query.data.rows.length === 0) setPage(page - 1);
  }, [page, query.data]);
  const clients = useQuery<{ id: number; name: string }[]>({ queryKey: ["/api/clients"], enabled: !readOnly });

  const done = (title: string) => {
    queryClient.invalidateQueries({ queryKey: [TARIFF_GRID_PATH] });
    setEditing(null);
    toast({ title });
  };
  const failWith = (title: string) => (error: unknown) =>
    toast({ title, description: userMessageOf(error), variant: "destructive" });

  const save = useMutation({
    mutationFn: (v: { id: number | null; body: TariffBody }) =>
      v.id ? apiRequest("PUT", `${TARIFF_GRID_PATH}/${v.id}`, v.body) : apiRequest("POST", TARIFF_GRID_PATH, v.body),
    onSuccess: () => done("Tarif enregistré"),
    onError: failWith("Enregistrement impossible"),
  });
  const deactivate = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${TARIFF_GRID_PATH}/${id}`),
    onSuccess: () => {
      setConfirmDeactivate(null);
      done("Tarif désactivé");
    },
    onError: (error: unknown) => {
      setConfirmDeactivate(null);
      failWith("Désactivation impossible")(error);
    },
  });
  const submit = useSingleFlightMutate(save.mutate);
  const submitDeactivate = useSingleFlightMutate(deactivate.mutate);

  const open = (t: TariffRow | "new") => {
    setEditing(t);
    setDraft(t === "new" ? EMPTY : draftOf(t));
  };
  const set = (k: keyof Draft, v: string) => setDraft({ ...draft, [k]: v });
  const knownClients = clients.data ?? [];
  const missingClient = draft.clientId !== "" && clients.isSuccess && !knownClients.some((c) => String(c.id) === draft.clientId);
  const editingRow = editing && editing !== "new" ? editing : null;
  const valid =
    draft.origin.trim() !== "" && draft.destination.trim() !== "" && draft.validFrom !== "" &&
    draft.unitPrice !== "" && Number.isInteger(Number(draft.unitPrice)) && Number(draft.unitPrice) >= 0;

  const columns: PremiumDataTableColumn<TariffRow>[] = [
    { id: "client", header: "Client", cell: (t) => t.clientName ?? "Tous (générique)" },
    { id: "route", header: "Trajet", cell: (t) => `${t.origin} → ${t.destination}` },
    { id: "cargo", header: "Marchandise", cell: (t) => t.cargoType || "Toutes" },
    { id: "price", header: "Prix", align: "right", cell: (t) => `${xaf(t.unitPrice)} / ${PRICING_UNIT_LABELS[t.pricingUnit].toLowerCase()}` },
    { id: "period", header: "Période", cell: (t) => `${formatDate(t.validFrom)} – ${t.validTo ? formatDate(t.validTo) : "sans fin"}` },
    { id: "state", header: "État", cell: (t) => (t.active ? "Actif" : "Désactivé") },
  ];

  return (
    <div className="space-y-4" data-testid="tariff-grid">
      <HeaderCard moduleLabel="Exploitation" title="Grille tarifaire" icon={<Tag className="h-5 w-5" />} />
      <p className="text-sm text-muted-foreground">
        Les tarifs servent de suggestion de prix : ils ne modifient jamais une facture seuls.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={activeOnly} onCheckedChange={(c) => {
            setActiveOnly(c === true);
            setPage(0);
          }} data-testid="filter-active" />
          Tarifs actifs seulement
        </label>
        {!readOnly && (
          <Button onClick={() => open("new")} data-testid="new-tariff">Nouveau tarif</Button>
        )}
      </div>

      {query.isLoading || query.isError ? (
        <LoadingError isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PremiumDataTable
          columns={columns}
          rows={query.data?.rows ?? []}
          rowKey={(t) => t.id}
          onRowClick={readOnly ? undefined : (t) => open(t)}
          emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucun tarif.</p>}
        />
      )}

      {query.data && query.data.total > query.data.limit && (
        <div className="flex items-center justify-between text-sm" data-testid="tariff-pager">
          <span className="text-muted-foreground">{pageRangeLabel(query.data)}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} data-testid="tariff-prev">Précédent</Button>
            <Button variant="outline" size="sm" disabled={query.data.offset + query.data.limit >= query.data.total} onClick={() => setPage((p) => p + 1)} data-testid="tariff-next">Suivant</Button>
          </div>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Nouveau tarif" : "Modifier le tarif"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Client (vide = tarif générique)</span>
              <Select value={draft.clientId || NO_CLIENT} onValueChange={(v) => set("clientId", v === NO_CLIENT ? "" : v)}>
                <SelectTrigger data-testid="tariff-client"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>Tous les clients</SelectItem>
                  {missingClient && <SelectItem value={draft.clientId}>{`Client #${draft.clientId} (inactif)`}</SelectItem>}
                  {knownClients.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {([
              ["origin", "Origine"],
              ["destination", "Destination"],
              ["cargoType", "Type de marchandise (vide = toutes)"],
            ] as const).map(([k, label]) => (
              <label key={k} className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{label}</span>
                <Input value={draft[k]} onChange={(e) => set(k, e.target.value)} data-testid={`tariff-${k}`} />
              </label>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Unité</span>
                <Select value={draft.pricingUnit} onValueChange={(v) => set("pricingUnit", v)}>
                  <SelectTrigger data-testid="tariff-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRICING_UNITS.map((u) => (
                      <SelectItem key={u} value={u}>{PRICING_UNIT_LABELS[u]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Prix (XAF, entier)</span>
                <Input type="number" min={0} step={1} value={draft.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} data-testid="tariff-price" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Début</span>
                <Input type="date" value={draft.validFrom} onChange={(e) => set("validFrom", e.target.value)} data-testid="tariff-from" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Fin (vide = sans fin)</span>
                <Input type="date" value={draft.validTo} onChange={(e) => set("validTo", e.target.value)} data-testid="tariff-to" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Note</span>
              <Input value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
            </label>
            <div className="flex gap-2">
              <Button
                disabled={!valid || save.isPending}
                onClick={() => submit({ id: editingRow?.id ?? null, body: tariffBodyOf(draft, editingRow?.active ?? true) })}
                data-testid="save-tariff"
              >
                Enregistrer
              </Button>
              {editingRow && !editingRow.active && (
                <Button variant="outline" disabled={!valid || save.isPending} onClick={() => submit({ id: editingRow.id, body: tariffBodyOf(draft, true) })} data-testid="reactivate-tariff">
                  Réactiver
                </Button>
              )}
              {editingRow?.active && (
                <Button variant="outline" disabled={deactivate.isPending} onClick={() => setConfirmDeactivate(editingRow)} data-testid="deactivate-tariff">
                  Désactiver
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertModal
        open={confirmDeactivate !== null}
        onOpenChange={(o) => !o && setConfirmDeactivate(null)}
        variant="confirm"
        title="Désactiver ce tarif ?"
        description="Il ne sera plus suggéré. L'historique est conservé et le tarif peut être réactivé."
        confirmLabel="Désactiver"
        cancelLabel="Annuler"
        onConfirm={() => confirmDeactivate && submitDeactivate(confirmDeactivate.id)}
      />
    </div>
  );
}
