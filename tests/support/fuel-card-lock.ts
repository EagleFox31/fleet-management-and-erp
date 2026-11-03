import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "../../server/db";
import { lockFuelCard, type DbExecutor } from "../../server/lib/fuel-card-lock";

/**
 * Preuves du verrou de la carte carburant (docs/analysis/LESSONS_LEARNED.md, « Carte carburant :
 * contrôle du solde hors transaction »). Partagé par les tests d'intégration et de contrat.
 */

const BLOCK_WINDOW_MS = 400;

/** Une transaction de test prend le verrou et le garde jusqu'à `release()`. */
export function holdFuelCardLock() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let markAcquired!: () => void;
  const acquired = new Promise<void>((resolve) => (markAcquired = resolve));
  const done = db.transaction(async (tx) => {
    await lockFuelCard(tx);
    markAcquired();
    await gate;
  });
  return {
    acquired,
    release: async () => {
      release();
      await done;
    },
  };
}

/** Lance l'écriture pendant que le verrou est tenu ; elle ne doit aboutir qu'après libération. */
export async function expectWaitsForLock<T>(write: () => Promise<T>): Promise<T> {
  // Connexions du pool ouvertes d'avance : l'ouverture d'une connexion à froid dépasse la
  // fenêtre d'observation et ferait passer une écriture non verrouillée pour bloquée.
  await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`SELECT 1`)));
  const holder = holdFuelCardLock();
  await holder.acquired;
  let settled = false;
  const pending = write().finally(() => {
    settled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, BLOCK_WINDOW_MS));
    expect(settled, "l'écriture a abouti sans attendre le verrou de la carte").toBe(false);
  } finally {
    await holder.release();
  }
  return pending;
}

/** Vrai si la session de `tx` détient un verrou consultatif (celui de la carte, dans ces tests). */
export async function holdsAdvisoryLock(tx: DbExecutor): Promise<boolean> {
  const result = await tx.execute(
    sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted`,
  );
  const rows = (result as unknown as { rows?: Array<{ n: number }> }).rows ?? (result as unknown as Array<{ n: number }>);
  return Number(rows[0]?.n ?? 0) > 0;
}
