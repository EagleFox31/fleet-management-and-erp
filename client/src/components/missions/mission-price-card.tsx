import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TariffSuggestionPanel, type AgreedPriceState } from "@/components/missions/tariff-suggestion-panel";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseAgreedPrice } from "@/lib/tariff-suggestion";
import { MISSION_PRICE_READ_ROLES, MISSION_PRICE_REASON_MIN, canEditMissionPrice } from "@shared/constants/roles";
import { missionPricePath, missionPriceResponseSchema, reasonLongEnough, type MissionPriceBody } from "@shared/contracts/mission-price";

const xaf = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} XAF`;
const priceOrNone = (n: number | null) => (n === null ? "aucun" : xaf(n));

type Props = {
  missionId: number;
  status: string;
  clientId: string;
  pickupAddress: string;
  deliveryAddress: string;
  cargoDescription: string;
  pickupDate: string;
  weight: string;
};

/**
 * Prix convenu d'une mission (O3 lot 3b) : visible des lecteurs de la grille, modifiable selon
 * `canEditMissionPrice` (avant le départ : gestionnaires ; en cours ou livrée : direction avec motif ;
 * clôturée, annulée ou facturée : figé). Le serveur reste juge : un refus s'affiche tel quel.
 */
export function MissionPriceCard(props: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canRead = (MISSION_PRICE_READ_ROLES as readonly string[]).includes(String(user?.role ?? ""));
  const decision = canEditMissionPrice(user?.role, props.status, false);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<AgreedPriceState>({ agreedPrice: "", tariffGridId: null });
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: [missionPricePath(props.missionId)],
    enabled: canRead,
    retry: false,
    queryFn: async () => missionPriceResponseSchema.parse(await (await apiRequest("GET", missionPricePath(props.missionId))).json()),
  });

  const save = useMutation({
    mutationFn: async (body: MissionPriceBody) => {
      const res = await apiRequest("PUT", missionPricePath(props.missionId), body);
      return missionPriceResponseSchema.parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.setQueryData([missionPricePath(props.missionId)], data);
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${props.missionId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices"] });
      setOpen(false);
      setReason("");
      toast({ title: "Prix enregistré" });
    },
    onError: (error) => toast({ title: "Prix non enregistré", description: userMessageOf(error, "Le prix n'a pas pu être enregistré."), variant: "destructive" }),
  });
  const submit = useSingleFlightMutate(save.mutate);

  if (!canRead) return null;
  const current = query.data;
  const typed = parseAgreedPrice(value.agreedPrice);
  const reasonRequired = decision.allowed && decision.reasonRequired;
  const unchanged = typed !== "invalid" && typed === (current?.agreedPrice ?? null) && value.tariffGridId === (current?.tariffGridId ?? null);
  const canSubmit = typed !== "invalid" && !unchanged && (!reasonRequired || reasonLongEnough(reason));

  const openEditor = () => {
    setValue({ agreedPrice: current?.agreedPrice != null ? String(current.agreedPrice) : "", tariffGridId: current?.tariffGridId ?? null });
    setReason("");
    setOpen(true);
  };

  const blockedText =
    decision.allowed || !current ? null
    : decision.blockedBy === "status" ? "Prix figé : mission clôturée ou annulée."
    : decision.blockedBy === "invoice" ? "Prix figé : une facture est liée (correction par avoir)."
    : null;

  return (
    <div className="rounded-2xl border border-gray-100 shadow-sm bg-card px-5 py-4" data-testid="mission-price-card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-semibold">Prix convenu</span>
        </div>
        {decision.allowed && (
          <Button size="sm" variant="outline" onClick={openEditor} disabled={query.isLoading} data-testid="button-edit-agreed-price">
            Modifier
          </Button>
        )}
      </div>

      {query.isError ? (
        <p className="text-sm text-muted-foreground">Prix indisponible pour le moment.</p>
      ) : (
        <p className="text-lg font-semibold" data-testid="text-agreed-price">
          {query.isLoading ? "..." : current?.agreedPrice != null ? xaf(current.agreedPrice) : "Non renseigné"}
        </p>
      )}
      {blockedText && <p className="text-xs text-muted-foreground mt-1">{blockedText}</p>}

      {current && current.history.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t pt-3" data-testid="agreed-price-history">
          {current.history.map((h) => (
            <li key={h.id} className="text-xs text-muted-foreground">
              {new Date(h.changedAt).toLocaleString("fr-FR")} - {h.changedByName ?? "Utilisateur"} : {priceOrNone(h.oldPrice)} vers{" "}
              {priceOrNone(h.newPrice)}
              {h.reason ? ` (${h.reason})` : ""}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier le prix convenu</DialogTitle>
            <DialogDescription>
              {reasonRequired ? "La mission est partie : un motif est obligatoire et le changement est historisé." : "Le changement est historisé."}
            </DialogDescription>
          </DialogHeader>
          <TariffSuggestionPanel
            input={{
              clientId: props.clientId,
              pickupAddress: props.pickupAddress,
              deliveryAddress: props.deliveryAddress,
              cargoDescription: props.cargoDescription,
              pickupDate: props.pickupDate,
            }}
            weight={props.weight}
            value={value}
            onChange={setValue}
          />
          {reasonRequired && (
            <div className="space-y-2">
              <Label htmlFor="price-reason">Motif ({MISSION_PRICE_REASON_MIN} caractères minimum)</Label>
              <Textarea id="price-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-price-reason" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              disabled={!canSubmit || save.isPending}
              onClick={() =>
                typed !== "invalid" &&
                submit({
                  agreedPrice: typed,
                  ...(typed !== null && value.tariffGridId !== null ? { tariffGridId: value.tariffGridId } : {}),
                  ...(reasonRequired ? { reason: reason.trim() } : {}),
                })
              }
              data-testid="button-save-agreed-price"
            >
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
