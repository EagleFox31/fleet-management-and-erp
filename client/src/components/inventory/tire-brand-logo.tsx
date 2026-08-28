import { cn } from "@/lib/utils";
import { getTireBrandLogoUrl } from "@shared/constants/tires";

interface TireBrandLogoProps {
  brand: string;
  className?: string;
  /** sm = bouton sélectionné ; md = liste déroulante */
  size?: "sm" | "md";
}

const LOGO_BOX = {
  sm: "h-7 w-[4.5rem]",
  md: "h-9 w-24",
} as const;

export function TireBrandLogo({ brand, className, size = "sm" }: TireBrandLogoProps) {
  const logoUrl = getTireBrandLogoUrl(brand);
  const boxClass = LOGO_BOX[size];

  if (!logoUrl) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold uppercase text-muted-foreground",
          size === "md" ? "h-9 w-9" : "h-7 w-7",
          className,
        )}
      >
        {brand.slice(0, 2)}
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-start", boxClass, className)}
    >
      <img
        src={logoUrl}
        alt=""
        className="max-h-full max-w-full object-contain object-left"
      />
    </span>
  );
}
