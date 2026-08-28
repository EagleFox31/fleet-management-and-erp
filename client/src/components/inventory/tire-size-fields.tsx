import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { formatTireSize, TIRE_SIZE_PRESETS } from "@shared/constants/tires";
import { cn } from "@/lib/utils";

interface TireSizeFieldsProps {
  width: string;
  aspect: string;
  diameter: string;
  onWidthChange: (value: string) => void;
  onAspectChange: (value: string) => void;
  onDiameterChange: (value: string) => void;
  onPresetSelect?: (preset: (typeof TIRE_SIZE_PRESETS)[number]) => void;
  widthError?: string;
  aspectError?: string;
  diameterError?: string;
}

export function TireSizeFields({
  width,
  aspect,
  diameter,
  onWidthChange,
  onAspectChange,
  onDiameterChange,
  onPresetSelect,
  widthError,
  aspectError,
  diameterError,
}: TireSizeFieldsProps) {
  const preview =
    width && aspect && diameter ? formatTireSize(width, aspect, diameter) : null;

  return (
    <FormItem className="md:col-span-3">
      <FormLabel>Dimension <span className="text-red-500">*</span></FormLabel>
      {onPresetSelect ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {TIRE_SIZE_PRESETS.map((preset) => {
            const isActive =
              width === preset.width &&
              aspect === preset.aspect &&
              diameter === preset.diameter;
            return (
              <Button
                key={preset.label}
                type="button"
                size="sm"
                variant={isActive ? "default" : "outline"}
                className={cn("h-8 text-xs", isActive && "bg-green-700 hover:bg-green-800")}
                data-testid={`tire-size-preset-${preset.width}-${preset.aspect}`}
                onClick={() => onPresetSelect(preset)}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <FormControl>
            <Input
              type="number"
              min={200}
              max={500}
              step={5}
              placeholder="315"
              value={width}
              data-testid="input-tire-width"
              onChange={(event) => onWidthChange(event.target.value)}
            />
          </FormControl>
          <p className="mt-1 text-[11px] text-muted-foreground">Largeur (mm)</p>
          {widthError ? <p className="text-sm font-medium text-destructive">{widthError}</p> : null}
        </div>
        <div>
          <FormControl>
            <Input
              type="number"
              min={50}
              max={100}
              step={5}
              placeholder="80"
              value={aspect}
              data-testid="input-tire-aspect"
              onChange={(event) => onAspectChange(event.target.value)}
            />
          </FormControl>
          <p className="mt-1 text-[11px] text-muted-foreground">Profil (%)</p>
          {aspectError ? <p className="text-sm font-medium text-destructive">{aspectError}</p> : null}
        </div>
        <div>
          <FormControl>
            <Input
              type="number"
              min={17}
              max={25}
              step={0.5}
              placeholder="22.5"
              value={diameter}
              data-testid="input-tire-diameter"
              onChange={(event) => onDiameterChange(event.target.value)}
            />
          </FormControl>
          <p className="mt-1 text-[11px] text-muted-foreground">Diamètre (pouces)</p>
          {diameterError ? (
            <p className="text-sm font-medium text-destructive">{diameterError}</p>
          ) : null}
        </div>
      </div>
      <FormDescription>
        {preview ? `Aperçu : ${preview}` : "Exemple : 315 / 80 / 22.5 → 315/80R22.5"}
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
}
