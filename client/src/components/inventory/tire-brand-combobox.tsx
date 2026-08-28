import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { TIRE_BRAND_OPTIONS } from "@shared/constants/tires";
import { TireBrandLogo } from "@/components/inventory/tire-brand-logo";

const OTHER_BRAND_VALUE = "__other__";

interface TireBrandComboboxProps {
  value: string;
  onChange: (brand: string) => void;
  disabled?: boolean;
}

export function TireBrandCombobox({ value, onChange, disabled }: TireBrandComboboxProps) {
  const [open, setOpen] = useState(false);
  const [customBrand, setCustomBrand] = useState("");

  const isKnownBrand = useMemo(
    () => TIRE_BRAND_OPTIONS.some((brand) => brand.value === value),
    [value],
  );

  const [useCustomBrand, setUseCustomBrand] = useState(() => Boolean(value) && !isKnownBrand);

  useEffect(() => {
    if (value && !TIRE_BRAND_OPTIONS.some((brand) => brand.value === value)) {
      setUseCustomBrand(true);
      setCustomBrand(value);
    }
  }, [value]);

  const displayLabel = useCustomBrand ? customBrand || value : value;

  return (
    <div className="space-y-2">
      {!useCustomBrand ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="w-full justify-between font-normal"
              data-testid="combobox-tire-brand"
            >
              <span className={cn("flex min-w-0 items-center gap-2", !value && "text-muted-foreground")}>
                {value ? <TireBrandLogo brand={value} /> : null}
                <span className="truncate">{value || "Choisir une marque"}</span>
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Rechercher une marque…" />
              <CommandList>
                <CommandEmpty>Aucune marque trouvée.</CommandEmpty>
                <CommandGroup>
                  {TIRE_BRAND_OPTIONS.map((brand) => (
                    <CommandItem
                      key={brand.value}
                      value={brand.label}
                      className="py-2.5"
                      onSelect={() => {
                        onChange(brand.value);
                        setUseCustomBrand(false);
                        setCustomBrand("");
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-1 h-4 w-4 shrink-0",
                          value === brand.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <TireBrandLogo brand={brand.value} size="md" />
                      <span>{brand.label}</span>
                    </CommandItem>
                  ))}
                  <CommandItem
                    value={OTHER_BRAND_VALUE}
                    onSelect={() => {
                      setUseCustomBrand(true);
                      setCustomBrand(value && !isKnownBrand ? value : "");
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    Autre (saisie libre)
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex gap-2">
          <Input
            value={customBrand}
            placeholder="Nom de la marque"
            disabled={disabled}
            data-testid="input-tire-brand-custom"
            onChange={(event) => {
              const next = event.target.value;
              setCustomBrand(next);
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setUseCustomBrand(false);
              setCustomBrand("");
              onChange("");
            }}
          >
            Liste
          </Button>
        </div>
      )}
      {displayLabel && !useCustomBrand && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Marque sélectionnée :</span>
          <TireBrandLogo brand={displayLabel} />
          <span>{displayLabel}</span>
        </p>
      )}
    </div>
  );
}
