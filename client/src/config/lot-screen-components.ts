/**
 * Composants des écrans du lot, par `id` de `lot-screens.ts`.
 *
 * Un écran livré s'ajoute ici, en une ligne chargée à la demande :
 *   "admin-locked-users": lazy(() => import("@/pages/admin/locked-users")),
 * Un `id` absent affiche la page vide (`pages/lot/screen-placeholder.tsx`).
 * Le composant reçoit `{ screen, params }`.
 */
import { lazy, type ComponentType } from "react";
import type { LotScreen } from "@/config/lot-screens";

export type LotScreenComponentProps = {
  screen: LotScreen;
  params: Record<string, string | undefined>;
};

export const LOT_SCREEN_COMPONENTS: Partial<Record<string, ComponentType<LotScreenComponentProps>>> = {
  scope: lazy(() => import("@/pages/scope")),
};
