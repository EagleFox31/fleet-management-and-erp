import { userMessageOf } from "@/lib/api-error";
import { reportErrorContext } from "@/lib/fetch-all-pages";
import { fetchAllWorkOrders } from "@/lib/fetch-all-work-orders";
import { clientLogger } from "@/lib/logger";
import { exportWorkOrdersToPDF } from "@/lib/pdf-export";

export interface ExportToast {
  title: string;
  description?: string;
  variant?: "destructive";
}

/**
 * Export PDF de la liste des OT : lu au clic sur toutes les pages (`fetchAllWorkOrders`).
 * Le succès n'est annoncé qu'après une lecture complète et un PDF produit ; une liste vide n'est
 * pas un « Export réussi » ; un échec affiche un message lisible et journalise le détail du refus.
 */
export async function runWorkOrdersExport(toast: (t: ExportToast) => void): Promise<void> {
  try {
    const workOrders = await fetchAllWorkOrders();
    if (workOrders.length === 0) {
      toast({ title: "Aucun ordre de travail à exporter", description: "Le rapport n'a pas été généré." });
      return;
    }
    await exportWorkOrdersToPDF(workOrders);
    toast({ title: "Export réussi", description: "Le rapport des ordres de travail a été téléchargé." });
  } catch (error) {
    clientLogger.error("Export PDF des ordres de travail non généré", reportErrorContext(error));
    toast({
      title: "Erreur d'export",
      description: userMessageOf(error, "Une erreur est survenue lors de l'export."),
      variant: "destructive",
    });
  }
}
