import { describe, expect, it } from "vitest";
import {
  ALREADY_RUNNING_TOLERANCE_MS,
  backupErrorLabel,
  backupRunOutcome,
  backupRunToast,
  formatBackupStart,
  hasRunningBackup,
} from "@/lib/backup-run";

const now = new Date(2026, 10, 2, 10, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe("déclenchement manuel de sauvegarde (202 dans les deux cas)", () => {
  it("exécution inconnue démarrée maintenant : sauvegarde lancée", () => {
    expect(backupRunOutcome({ id: 9, status: "running", startedAt: iso(now) }, [7, 8], now)).toBe("started");
  });

  it("exécution déjà listée et encore en cours : déjà en cours", () => {
    expect(backupRunOutcome({ id: 8, status: "running", startedAt: iso(now - 5_000) }, [7, 8], now)).toBe("already_running");
  });

  it("exécution non listée mais démarrée bien avant le clic : déjà en cours", () => {
    const startedAt = iso(now - ALREADY_RUNNING_TOLERANCE_MS - 1_000);
    expect(backupRunOutcome({ id: 10, status: "running", startedAt }, [], now)).toBe("already_running");
  });

  it("exécution déjà terminée à la réponse : lancée (pas de faux « déjà en cours »)", () => {
    expect(backupRunOutcome({ id: 8, status: "success", startedAt: iso(now) }, [8], now)).toBe("started");
  });

  it("messages : déjà en cours dit qu'aucune sauvegarde n'a été créée, avec l'heure", () => {
    const t = backupRunToast("already_running", { startedAt: iso(new Date(2026, 10, 2, 9, 58).getTime()) });
    expect(t.title).toBe("Sauvegarde déjà en cours");
    expect(t.description).toBe("Une sauvegarde lancée à 09:58 est en cours. Aucune nouvelle sauvegarde n'a été créée.");
    expect(backupRunToast("started", { startedAt: iso(now) }).title).toBe("Sauvegarde lancée");
  });
});

describe("affichage de l'historique", () => {
  it("code d'échec : libellé lisible, jamais le code brut", () => {
    expect(backupErrorLabel(null)).toBeNull();
    expect(backupErrorLabel("PG_DUMP_MISSING")).toBe("Outil d'export absent du serveur");
    expect(backupErrorLabel("BACKUP_FAILED")).toBe("Erreur inattendue");
  });

  it("date et heure de début", () => {
    expect(formatBackupStart(iso(new Date(2026, 9, 30, 2, 5).getTime()))).toBe("30/10/2026 02:05");
    expect(formatBackupStart("pas une date")).toBe("—");
  });

  it("rafraîchissement seulement tant qu'une exécution tourne", () => {
    expect(hasRunningBackup(undefined)).toBe(false);
    expect(hasRunningBackup([{ status: "success" }, { status: "failed" }])).toBe(false);
    expect(hasRunningBackup([{ status: "running" }])).toBe(true);
  });
});
