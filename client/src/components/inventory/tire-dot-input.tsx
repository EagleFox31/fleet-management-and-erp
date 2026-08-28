import { AlertTriangle, CircleHelp, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  TIRE_FLEET_MAX_AGE_YEARS,
  formatDotDateHighlight,
  getTireAgeStatus,
  getTireAgeYears,
  parseDotManufacturingDate,
} from "@shared/constants/tires";

interface TireDotInputProps {
  value: string;
  manufacturingWeek: string;
  manufacturingYear: string;
  onChange: (dotCode: string) => void;
  onManufacturingChange?: (week: string, year: string) => void;
  disabled?: boolean;
}

export function TireDotInput({
  value,
  manufacturingWeek,
  manufacturingYear,
  onChange,
  onManufacturingChange,
  disabled,
}: TireDotInputProps) {
  const dotHighlight = formatDotDateHighlight(value);
  const parsed = parseDotManufacturingDate(value);
  const ageYears = getTireAgeYears(manufacturingWeek, manufacturingYear);
  const ageStatus = getTireAgeStatus(manufacturingWeek, manufacturingYear);

  const handleChange = (nextValue: string) => {
    onChange(nextValue);
    const dotDate = parseDotManufacturingDate(nextValue);
    if (dotDate && onManufacturingChange) {
      onManufacturingChange(dotDate.week, dotDate.year);
    }
  };

  return (
    <div className="space-y-3">
      <Input
        value={value}
        disabled={disabled}
        placeholder="Recopier le DOT du flanc (ex: DOT X9AB CDEF 2424)"
        className="font-mono text-sm"
        data-testid="input-tire-dot"
        onChange={(event) => handleChange(event.target.value)}
      />

      {dotHighlight ? (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-mono">
          <span className="text-muted-foreground">{dotHighlight.prefix || "DOT … "}</span>
          <span className="rounded bg-primary/15 px-1 font-semibold text-primary">
            {dotHighlight.week}
            {dotHighlight.yearSuffix}
          </span>
          <span className="ml-2 text-muted-foreground">
            → sem. {parsed?.week} / 20{dotHighlight.yearSuffix}
          </span>
        </div>
      ) : null}

      {ageStatus !== "unknown" && ageYears !== null ? (
        <div className="flex items-start gap-2">
          {ageStatus === "critical" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          ) : ageStatus === "warning" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          )}
          <div className="space-y-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span>Âge estimé : {ageYears.toFixed(1)} ans</span>
              {ageStatus === "critical" ? (
                <Badge variant="destructive">Au-delà de {TIRE_FLEET_MAX_AGE_YEARS} ans</Badge>
              ) : ageStatus === "warning" ? (
                <Badge variant="outline" className="border-amber-500 text-amber-700">
                  Proche limite flotte
                </Badge>
              ) : (
                <Badge variant="outline" className="border-green-600 text-green-700">
                  Âge acceptable
                </Badge>
              )}
            </div>
            {ageStatus === "critical" ? (
              <p className="text-muted-foreground">
                Vérifier la politique de renouvellement avant mise en stock ou montage.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs">
            <CircleHelp className="mr-1.5 h-3.5 w-3.5" />
            Comment lire le DOT sur le flanc ?
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p>Repérez la mention <strong>DOT</strong> gravée sur le flanc intérieur du pneu.</p>
          <p>
            Les <strong>4 derniers chiffres</strong> indiquent la date : 2 chiffres semaine (WW) + 2
            chiffres année (YY). Exemple : <strong>2424</strong> = semaine 24, année 2024.
          </p>
          <p>
            Saisissez la chaîne complète telle quelle ; semaine et année se remplissent
            automatiquement.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
