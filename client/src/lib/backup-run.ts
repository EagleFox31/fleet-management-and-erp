import type { BackupRun } from "@shared/contracts/backups";

/**
 * Lecture côté écran de `POST /api/admin/backups/run` (contrat `backups`).
 *
 * Le serveur répond 202 dans les deux cas : nouvelle exécution, ou exécution déjà en
 * cours renvoyée telle quelle (pas de doublon). Rien dans la réponse ne les distingue :
 * l'écran compare à ce qu'il connaissait avant le clic.
 */
export type BackupRunOutcome = "started" | "already_running";

/** Une exécution démarrée plus de 30 s avant le clic n'a pas été créée par lui (marge d'horloge). */
export const ALREADY_RUNNING_TOLERANCE_MS = 30_000;

export function backupRunOutcome(
  run: Pick<BackupRun, "id" | "startedAt" | "status">,
  knownRunIds: readonly number[],
  requestedAt: number,
): BackupRunOutcome {
  if (run.status !== "running") return "started";
  if (knownRunIds.includes(run.id)) return "already_running";
  const startedAt = Date.parse(run.startedAt);
  if (!Number.isNaN(startedAt) && startedAt < requestedAt - ALREADY_RUNNING_TOLERANCE_MS) return "already_running";
  return "started";
}

function hhmm(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** « 30/10/2026 14:05 » : plusieurs sauvegardes possibles le même jour, l'heure compte. */
export function formatBackupStart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${date} ${hhmm(iso)}`;
}

export function backupRunToast(
  outcome: BackupRunOutcome,
  run: Pick<BackupRun, "startedAt">,
): { title: string; description: string } {
  if (outcome === "already_running") {
    const time = hhmm(run.startedAt);
    return {
      title: "Sauvegarde déjà en cours",
      description: `${time ? `Une sauvegarde lancée à ${time}` : "Une sauvegarde"} est en cours. Aucune nouvelle sauvegarde n'a été créée.`,
    };
  }
  return {
    title: "Sauvegarde lancée",
    description: "Elle s'exécute en arrière-plan ; l'historique se met à jour à la fin.",
  };
}

/** Codes d'échec stables du job (`server/lib/backup/dump.ts`, `encrypt.ts`), jamais le message technique. */
const ERROR_LABELS: Record<string, string> = {
  PG_DUMP_MISSING: "Outil d'export absent du serveur",
  PG_DUMP_VERSION: "Outil d'export incompatible avec la base",
  PG_DUMP_FAILED: "Export de la base interrompu",
  KEY_MISSING: "Clé de chiffrement non configurée",
  KEY_INVALID: "Clé de chiffrement invalide",
  AUTH_FAILED: "Contrôle d'intégrité du fichier en échec",
  FORMAT_INVALID: "Fichier de sauvegarde illisible",
};

export function backupErrorLabel(code: string | null): string | null {
  if (!code) return null;
  return ERROR_LABELS[code] ?? "Erreur inattendue";
}

/** Rafraîchissement de l'historique tant qu'une exécution tourne (aucun événement temps réel en cas de succès). */
export const RUNNING_REFRESH_MS = 5_000;

export function hasRunningBackup(runs: readonly Pick<BackupRun, "status">[] | undefined): boolean {
  return (runs ?? []).some((r) => r.status === "running");
}
