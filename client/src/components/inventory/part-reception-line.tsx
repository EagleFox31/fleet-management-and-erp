import { formatDate } from "@/lib/utils";
import type { PartRequirementReception } from "@shared/contracts/part-requirement-receive";

/**
 * Ligne « Entrée en stock par X, le … » (T-52). Le libellé du statut lui-même
 * vient de `getPartRequirementStatusLabel`. À afficher sous la demande dans
 * `pages/inventory/requests.tsx` (branchement à faire, fichier chaud).
 */
export function PartReceptionLine({ reception }: { reception: PartRequirementReception }) {
  if (!reception.receivedAt && !reception.receivedByName) return null;
  const who = reception.receivedByName ?? "utilisateur inconnu";
  return (
    <p className="text-xs text-muted-foreground" data-testid="part-reception-line">
      Entrée en stock par {who}
      {reception.receivedAt ? `, le ${formatDate(reception.receivedAt)}` : ""}
    </p>
  );
}
