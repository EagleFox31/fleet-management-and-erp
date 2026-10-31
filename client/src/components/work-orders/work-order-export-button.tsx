import { useState } from "react";
import { ChevronDown, FileText, Loader2 } from "lucide-react";
import { WORK_ORDER_EXPORT_DOCS, workOrderExportPath, type WorkOrderExportDoc } from "@shared/contracts/work-order-export";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { appToast } from "@/lib/app-toast";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest } from "@/lib/queryClient";

const DOC_LABELS: Record<WorkOrderExportDoc, string> = {
  ot: "Ordre de travail (Word)",
  "bon-sortie": "Bon de sortie (Word)",
};

/** Le fichier est la reponse : on le recupere en blob, sans JSON a valider. */
async function downloadDocx(workOrderId: number, doc: WorkOrderExportDoc): Promise<void> {
  const res = await apiRequest("GET", workOrderExportPath(workOrderId, doc));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${doc === "ot" ? "OT" : "Bon-de-sortie"}-${workOrderId}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Export Word de l'OT ou du bon de sortie. Le serveur reste maitre des roles : une 403 s'affiche en clair. */
export function WorkOrderExportButton({ workOrderId }: { workOrderId: number }) {
  const [busy, setBusy] = useState(false);

  const run = async (doc: WorkOrderExportDoc) => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadDocx(workOrderId, doc);
    } catch (error) {
      appToast({
        title: "Export impossible",
        description: userMessageOf(error, "Le document n'a pas pu être généré."),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Exporter
          <ChevronDown className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {WORK_ORDER_EXPORT_DOCS.map((doc) => (
          <DropdownMenuItem key={doc} onSelect={() => void run(doc)}>
            {DOC_LABELS[doc]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
