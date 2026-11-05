import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import {
  parseAgreedPrice,
  suggestedMissionAmount,
  suggestionAttempts,
  type SuggestionInput,
} from "@/lib/tariff-suggestion";
import { PRICING_UNIT_LABELS, TARIFF_SUGGEST_PATH, tariffSuggestionSchema } from "@shared/contracts/tariff-grid";

const xaf = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} XAF`;

export type AgreedPriceState = { agreedPrice: string; tariffGridId: number | null };

/**
 * Prix convenu d'une mission (O3) : affiche le tarif suggéré, ne remplit jamais seul.
 * « Utiliser » copie le montant et garde la trace du tarif ; toute saisie manuelle efface cette trace.
 * Erreur ou 403 : encart masqué, le champ de prix reste utilisable.
 */
export function TariffSuggestionPanel({
  input,
  weight,
  value,
  onChange,
}: {
  input: SuggestionInput;
  weight: string;
  value: AgreedPriceState;
  onChange: (next: AgreedPriceState) => void;
}) {
  const attempts = suggestionAttempts(input);
  const query = useQuery({
    queryKey: [TARIFF_SUGGEST_PATH, attempts],
    enabled: attempts.length > 0,
    retry: false,
    queryFn: async () => {
      for (const attempt of attempts) {
        const qs = new URLSearchParams(attempt.params).toString();
        const res = await apiRequest("GET", `${TARIFF_SUGGEST_PATH}?${qs}`);
        const { suggestion } = tariffSuggestionSchema.parse(await res.json());
        if (suggestion) return { suggestion, matchedOnCity: attempt.matchedOnCity };
      }
      return { suggestion: null, matchedOnCity: false };
    },
  });

  const parsedWeight = weight.trim() === "" ? null : Number(weight);
  const found = query.data?.suggestion ?? null;
  const amount = found ? suggestedMissionAmount(found.unitPrice, found.pricingUnit, parsedWeight) : null;
  const typed = parseAgreedPrice(value.agreedPrice);

  return (
    <div className="border-t pt-6 space-y-3" data-testid="tariff-suggestion">
      <h3 className="font-semibold">
        <Tag className="inline h-5 w-5 mr-2 align-text-bottom" aria-hidden />
        Prix de la mission
      </h3>

      {!query.isError && attempts.length > 0 && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="tariff-suggestion-box">
          {query.isLoading ? (
            <p className="text-muted-foreground">Recherche d'un tarif...</p>
          ) : found && amount !== null ? (
            <div className="space-y-2">
              <p>
                Prix suggéré : <strong>{xaf(found.unitPrice)}</strong> / {PRICING_UNIT_LABELS[found.pricingUnit].toLowerCase()}{" "}
                ({found.source === "client" ? "tarif du client" : "tarif générique"})
                {query.data?.matchedOnCity && <span className="text-muted-foreground"> - correspondance sur la ville</span>}
              </p>
              {amount !== found.unitPrice && (
                <p className="text-muted-foreground">Total estimé pour {parsedWeight} t : {xaf(amount)}</p>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onChange({ agreedPrice: String(amount), tariffGridId: found.tariffId })}
                data-testid="use-suggested-price"
              >
                Utiliser {xaf(amount)}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Aucun tarif pour ce trajet : saisissez le prix à la main.</p>
          )}
        </div>
      )}

      <div className="space-y-2 max-w-xs">
        <Label htmlFor="agreedPrice">Prix convenu (XAF, entier)</Label>
        <Input
          id="agreedPrice"
          inputMode="numeric"
          value={value.agreedPrice}
          onChange={(e) => onChange({ agreedPrice: e.target.value, tariffGridId: null })}
          placeholder="Facultatif"
          data-testid="input-agreed-price"
        />
        {typed === "invalid" && <p className="text-sm text-destructive-text">Montant entier en XAF, sans décimale.</p>}
        {value.tariffGridId !== null && <p className="text-xs text-muted-foreground">Repris du tarif suggéré (modifiable).</p>}
      </div>
    </div>
  );
}
