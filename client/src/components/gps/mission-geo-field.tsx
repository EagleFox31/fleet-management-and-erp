import { lazy, Suspense, useState } from "react";
import { MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HUB_OPTIONS, hubName, type GeoSelection, NO_GEO } from "@/lib/gps-display";

const GeoPointMap = lazy(() => import("./geo-point-map"));

type Props = {
  /** `pickup` : point A (départ) ; `delivery` : point B (livraison). */
  which: "pickup" | "delivery";
  value: GeoSelection;
  onChange: (next: GeoSelection) => void;
  other?: GeoSelection;
  disabled?: boolean;
};

const META = {
  pickup: { letter: "A" as const, title: "Point A (départ)", color: "#2563eb" },
  delivery: { letter: "B" as const, title: "Point B (livraison)", color: "#16a34a" },
};

function summaryOf(value: GeoSelection): string {
  if (value.kind === "hub") return hubName(value.hubCode) ?? value.hubCode;
  if (value.kind === "map") return `${value.lat.toFixed(4)}, ${value.lng.toFixed(4)} (posé sur la carte)`;
  return "Aucun point : seule l'adresse en texte est enregistrée.";
}

/**
 * Saisie d'un point A ou B : un hub du référentiel CEMAC ou un point posé sur la carte. Facultatif :
 * l'adresse texte de la mission reste obligatoire et sert de repli. Le choix au clavier passe par la
 * liste des hubs ; la carte est un complément à la souris ou au doigt.
 */
export function MissionGeoField({ which, value, onChange, other, disabled }: Props) {
  const meta = META[which];
  const [mapOpen, setMapOpen] = useState(value.kind === "map");
  const selectId = `geo-${which}-hub`;

  return (
    <div className="space-y-2" data-testid={`geo-field-${which}`}>
      <Label htmlFor={selectId}>
        {meta.title} <span className="text-xs text-muted-foreground">(facultatif, pour le suivi sur carte)</span>
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={value.kind === "hub" ? value.hubCode : undefined}
          onValueChange={(hubCode) => onChange({ kind: "hub", hubCode })}
          disabled={disabled}
        >
          <SelectTrigger id={selectId} className="w-full sm:w-64" data-testid={`geo-hub-${which}`}>
            <SelectValue placeholder="Choisir un hub" />
          </SelectTrigger>
          <SelectContent>
            {HUB_OPTIONS.map((hub) => (
              <SelectItem key={hub.code} value={hub.code}>
                {hub.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={mapOpen ? "secondary" : "outline"}
          onClick={() => setMapOpen((open) => !open)}
          disabled={disabled}
          aria-expanded={mapOpen}
          data-testid={`geo-map-toggle-${which}`}
        >
          <MapPin className="mr-2 h-4 w-4" aria-hidden="true" />
          Poser sur la carte
        </Button>
        {value.kind !== "none" && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(NO_GEO)} disabled={disabled} data-testid={`geo-clear-${which}`}>
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            Effacer
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-testid={`geo-summary-${which}`}>{summaryOf(value)}</p>
      {mapOpen && (
        <Suspense fallback={<Skeleton className="h-56 w-full rounded-lg" />}>
          <GeoPointMap
            value={value}
            letter={meta.letter}
            color={meta.color}
            other={other}
            onPick={(lat, lng) => onChange({ kind: "map", lat, lng })}
          />
        </Suspense>
      )}
    </div>
  );
}
