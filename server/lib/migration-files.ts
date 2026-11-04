import { readdir } from "node:fs/promises";

/**
 * Fichiers de migration SQL à rejouer au démarrage, triés par nom.
 * Dossier absent (image Docker incomplète) : lève, pour que le démarrage échoue au lieu de servir
 * une base à laquelle il manque migrations et triggers (LESSONS_LEARNED, 4 novembre 2026).
 */
export async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  try {
    return (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  } catch (error) {
    throw new Error(`Migrations introuvables (${migrationsDir}) : le démarrage est interrompu.`, { cause: error });
  }
}
