import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
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
  PRICING_UNITS,
  PRICING_UNIT_LABELS,
  TARIFF_GRID_PATH,
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

const xaf = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} XAF`;

/** Grille tarifaire (O3) : prix suggérés, jamais appliqués seuls. `readOnly` hors admin et direction. */
export function TariffGridTable({ readOnly = false }: { readOnly?: boolean }) {
  const { toast } = useToast();
  const [activeOnly, setActiveOnly] = useState(true);
  const [editing, setEditing] = useState<TariffRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const query = useContractQuery(TARIFF_GRID_PATH, tariffListResponseSchema, { activeOnly: String(activeOnly) });
  const clients = useQuery<{ id: number; name: string }[]>({ queryKey: ["/api/clients"], enabled: !readOnly });

  const done = (title: string) => {
    queryClient.invalidateQueries({ queryKey: [TARIFF_GRID_PATH] });
    setEditing(null);
    toast({ title });
  };
  const fail = (error: unknown) =>
    toast({ title: "Enregistrement impossible", description: userMessageOf(error), variant: "destructive" });

  const save = useMutation({
    mutationFn: (v: { id: number | null; body: TariffBody }) =>
      v.id ? apiRequest("PUT", `${TARIFF_GRID_PATH}/${v.id}`, v.body) : apiRequest("POST", TARIFF_GRID_PATH, v.body),
    onSuccess: () => done("Tarif enregistré"),
    onError: fail,
  });
  const deactivate = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `${TARIFF_GRID_PATH}/${id}`),
    onSuccess: () => done("Tarif désactivé"),
    onError: fail,
  });
  const submit = useSingleFlightMutate(save.mutate);
  const submitDeactivate = useSingleFlightMutate(deactivate.mutate);

  const open = (t: TariffRow | "new") => {
    setEditing(t);
    setDraft(t === "new" ? EMPTY : draftOf(t));
  };
  const set = (k: keyof Draft, v: string) => setDraft({ ...draft, [k]: v });
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
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} data-testid="filter-active" />
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

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Nouveau tarif" : "Modifier le tarif"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Client (vide = tarif générique)</span>
              <select className="h-9 w-full rounded-md border bg-background px-2" value={draft.clientId} onChange={(e) => set("clientId", e.target.value)} data-testid="tariff-client">
                <option value="">Tous les clients</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
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
                <select className="h-9 w-full rounded-md border bg-background px-2" value={draft.pricingUnit} onChange={(e) => set("pricingUnit", e.target.value)} data-testid="tariff-unit">
                  {PRICING_UNITS.map((u) => (
                    <option key={u} value={u}>{PRICING_UNIT_LABELS[u]}</option>
                  ))}
                </select>
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
                onClick={() => submit({ id: editing && editing !== "new" ? editing.id : null, body: tariffBodyOf(draft, editing && editing !== "new" ? editing.active : true) })}
                data-testid="save-tariff"
              >
                Enregistrer
              </Button>
              {editing && editing !== "new" && editing.active && (
                <Button variant="outline" disabled={deactivate.isPending} onClick={() => submitDeactivate(editing.id)} data-testid="deactivate-tariff">
                  Désactiver
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
