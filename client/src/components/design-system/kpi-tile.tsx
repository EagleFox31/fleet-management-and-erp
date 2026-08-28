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
  ...props
}: KpiTileProps) {
  const isClickable = typeof onClick === "function";

  return (
    <div
      className={cn(
        "rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1",
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
            "w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-green-600",
            iconWrapperClassName,
          )}
        >
          {icon}
        </div>
      )}
      <p className="text-[11px] font-medium text-gray-500 mt-1">{label}</p>
      <p className={cn("text-[15px] font-bold text-gray-800 leading-tight", valueClassName)}>{value}</p>
      {subValue ? <p className="text-[11px] text-gray-400 mt-0.5">{subValue}</p> : null}
    </div>
  );
}
