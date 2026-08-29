import React from "react";
import { cn } from "@/lib/utils";

interface KpiTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  icon?: React.ReactNode;
  iconWrapperClassName?: string;
  valueClassName?: string;
  /** Rend la tuile cliquable : curseur, survol et accès clavier (Entrée / Espace). */
  onClick?: () => void;
  /**
   * Met la tuile en avant : fond sombre, chiffre agrandi.
   *
   * Une seule par grille. Toutes les tuiles au même poids visuel, c'est aucune
   * hiérarchie : l'oeil ne sait pas par où commencer. Celle-ci porte le chiffre
   * sur lequel le métier se décide — il diffère par profil (solde carte pour le
   * magasin, véhicules immobilisés pour l'atelier, missions actives pour
   * l'exploitation).
   */
  featured?: boolean;
  /**
   * Tonalité de la tuile promue. `danger` pour un chiffre qui va mal :
   * un résultat négatif sur fond vert célébrerait une perte.
   */
  featuredTone?: "default" | "danger";
}

export function KpiTile({
  label,
  value,
  subValue,
  icon,
  className,
  iconWrapperClassName,
  valueClassName,
  onClick,
  featured = false,
  featuredTone = "default",
  ...props
}: KpiTileProps) {
  const isClickable = typeof onClick === "function";

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5 flex flex-col gap-1",
        featured
          ? featuredTone === "danger"
            ? "border-transparent bg-gradient-to-br from-red-600 to-rose-700 shadow-sm"
            : "border-transparent bg-gradient-to-br from-emerald-600 to-green-700 shadow-sm"
          : "border-gray-100 bg-gray-50",
        isClickable &&
          "cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isClickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      {...props}
    >
      {icon && (
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center",
            featured
              ? "bg-white/15 text-white"
              : "bg-green-50 text-green-600",
            !featured && iconWrapperClassName,
          )}
        >
          {icon}
        </div>
      )}
      <p className={cn("text-[11px] font-medium mt-1", featured ? "text-white/70" : "text-gray-500")}>
        {label}
      </p>
      {/* Sur fond sombre, `valueClassName` porte des couleurs pensees pour le
          fond clair (text-red-600...) et deviendrait illisible: on l'ignore. */}
      <p
        className={cn(
          "font-bold leading-tight",
          featured ? "text-[19px] text-white" : "text-[15px] text-gray-800",
          !featured && valueClassName,
        )}
      >
        {value}
      </p>
      {subValue ? (
        <p className={cn("text-[11px] mt-0.5", featured ? "text-white/60" : "text-gray-400")}>
          {subValue}
        </p>
      ) : null}
    </div>
  );
}
