import type { LucideIcon } from "lucide-react";

/** Taille standard des icônes d'onglets PremiumTabsNav */
export const TAB_ICON_CLASS = "h-4 w-4";

export function TabIcon({
  icon: Icon,
  className = TAB_ICON_CLASS,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return <Icon className={className} />;
}
