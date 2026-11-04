import type { Locator, Page } from "@playwright/test";

/**
 * Titre d'un toast, cherché dans la région « Notifications (F8) » du ToastViewport Radix.
 *
 * Radix annonce aussi le toast dans un `status` aria-live hors de cette région
 * (« Notification <titre><description> »), où le titre est un nœud texte à part :
 * `{ exact: true }` seul y trouve encore un second élément et le mode strict échoue
 * (DRV2-1, spec 19, rouge sur la passe vidéo du 4 novembre 2026).
 */
export function toastTitle(page: Page, title: string): Locator {
  return page.getByRole("region", { name: /^Notifications/ }).getByText(title, { exact: true });
}
