/**
 * Preuve de livraison (POD) d'une mission : règles d'affichage et envoi, côté client.
 * Contrat : `shared/contracts/mission-pod.ts`. Règles serveur : `server/api/mission-pod.routes.ts`.
 */
import type { QueryClient } from "@tanstack/react-query";
import { MISSION_STATUS_ROLES } from "@shared/constants/roles";
import { missionPodFilesPath, missionPodUploadResponseSchema, type MissionPodUploadResponse } from "@shared/contracts/mission-pod";
import { apiRequest } from "@/lib/queryClient";
import { satelliteTargetsOf } from "@/lib/realtime-satellites";

export const POD_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

/** Statuts où le serveur accepte un dépôt (409 sinon). */
export const POD_DEPOSIT_STATUSES = ["in_progress", "delivered", "completed"] as const;
/** Statuts où une facture client peut être générée. */
const INVOICEABLE_STATUSES = ["delivered", "completed"] as const;

export function canDepositPod(role: string | null | undefined, status: string | null | undefined): boolean {
  return (
    (MISSION_STATUS_ROLES as readonly string[]).includes(String(role ?? "")) &&
    (POD_DEPOSIT_STATUSES as readonly string[]).includes(String(status ?? ""))
  );
}

export type PodReadState = {
  /** Nombre de POD lus, `undefined` tant que la lecture n'a pas abouti. */
  count: number | undefined;
  /** La lecture a échoué sans données : on ne sait pas s'il y a un POD. */
  failed: boolean;
};

/**
 * Facturation d'une mission : livrée ou clôturée, avec au moins un POD lu. Une lecture en échec ou en
 * cours n'est jamais « aucun POD » : la facturation reste fermée et la raison le dit.
 */
export function invoiceGate(status: string | null | undefined, pod: PodReadState): { allowed: boolean; reason: string | null } {
  if (!(INVOICEABLE_STATUSES as readonly string[]).includes(String(status ?? ""))) {
    return { allowed: false, reason: "Disponible une fois la mission livrée." };
  }
  if (pod.failed) {
    return { allowed: false, reason: "Les preuves de livraison n'ont pas pu être lues : la facturation est suspendue." };
  }
  if (pod.count === undefined) {
    return { allowed: false, reason: "Lecture des preuves de livraison en cours." };
  }
  if (pod.count < 1) {
    return { allowed: false, reason: "Déposez le POD avant de facturer." };
  }
  return { allowed: true, reason: null };
}

export function podFilesKey(missionId: number | string): string {
  return `/api/missions/${missionId}/pod-files`;
}

/** Envoi multipart : les fichiers partent sous le champ `files`. */
export async function uploadMissionPod(missionId: number | string, files: File[]): Promise<MissionPodUploadResponse> {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  const response = await apiRequest("POST", missionPodFilesPath(missionId), body);
  return missionPodUploadResponseSchema.parse(await response.json());
}

/**
 * Après un dépôt réussi : couche 1 (la liste locale reçoit les fichiers sans attendre le réseau),
 * couche 3 (détail, liste, POD, factures à émettre et écrans satellites déclarés pour l'événement).
 */
export function applyPodUploaded(queryClient: QueryClient, missionId: number | string, result: MissionPodUploadResponse): void {
  queryClient.setQueryData<{ files: MissionPodUploadResponse["files"] } | undefined>([podFilesKey(missionId)], (previous) => {
    if (!previous) return previous;
    const known = new Set(previous.files.map((f) => f.id));
    return { files: [...previous.files, ...result.files.filter((f) => !known.has(f.id))] };
  });
  const keys = new Set<string>([
    podFilesKey(missionId),
    `/api/missions/${missionId}`,
    "/api/missions",
    "/api/billing/pending-invoices",
    "/api/drivers/me",
    ...satelliteTargetsOf("mission_pod_uploaded", { missionId }).keys,
  ]);
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
}
