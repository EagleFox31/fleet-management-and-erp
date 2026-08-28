import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { TIRE_LOAD_INDEX_OPTIONS } from "@shared/constants/tires";

interface TireLoadIndexComboboxProps {
  value: string;
  onChange: (loadIndex: string) => void;
  disabled?: boolean;
}

export function TireLoadIndexCombobox({ value, onChange, disabled }: TireLoadIndexComboboxProps) {
  const [open, setOpen] = useState(false);

  const selectedLabel = useMemo(
    () => TIRE_LOAD_INDEX_OPTIONS.find((option) => option.value === value)?.label ?? null,
    [value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid="combobox-tire-load-index"
        >
          <span className={cn(!selectedLabel && "text-muted-foreground")}>
            {selectedLabel ?? "Choisir un indice"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Rechercher (ex: 152, 3750)…" />
          <CommandList>
            <CommandEmpty>Aucun indice trouvé.</CommandEmpty>
            <CommandGroup className="max-h-72 overflow-y-auto">
              {TIRE_LOAD_INDEX_OPTIONS.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.value} ${option.kg}`}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
