import type { ReactNode } from "react";
import { toast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

export type AppToastVariant = "default" | "destructive" | "success" | "warning" | "info";

type AppToastOptions = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: AppToastVariant;
};

function toToastText(value?: ReactNode): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** Déduit une couleur à partir du libellé quand aucune variante n'est fournie. */
export function inferToastVariant(title?: ReactNode, description?: ReactNode): AppToastVariant {
  const text = `${toToastText(title) ?? ""} ${toToastText(description) ?? ""}`.toLowerCase();

  if (/erreur|échec|echec|impossible|refus|bloqu|invalid|échou/.test(text)) {
    return "destructive";
  }
  if (/attention|incomplet|manquant|expir|retard|sans ca|avert/.test(text)) {
    return "warning";
  }
  if (
    /assigné|assigne|créé|cree|enregistré|enregistre|mis à jour|succès|succes|validé|valid|terminé|termine|ajouté|ajoute|supprimé|supprime|notifi|commencé|demarr/.test(
      text,
    )
  ) {
    return "success";
  }
  if (/nouvelle alerte|information|info|bientôt|bientot/.test(text)) {
    return "info";
  }

  return "default";
}

export function appToast({ title, description, variant }: AppToastOptions) {
  const resolvedTitle = toToastText(title);
  const resolvedDescription = toToastText(description);

  return toast({
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    ...(resolvedDescription ? { description: resolvedDescription } : {}),
    variant: variant ?? inferToastVariant(title, description),
  });
}

export function invalidateAlertQueries(): void {
  queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
  queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
  queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });
  queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
}
