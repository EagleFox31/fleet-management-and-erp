/**
 * Premier démarrage d'une base Postgres en conteneur (serveur de site, VPS) :
 * crée le schéma Drizzle seulement si la base est vide (table `users` absente).
 * Ensuite, c'est init-database (au démarrage de l'app) qui ajoute colonnes, triggers et migrations
 * de façon idempotente. On ne rejoue jamais `drizzle-kit push --force` sur une base qui a des
 * données : il peut supprimer une colonne absente du schéma.
 *
 * Usage : DATABASE_URL=... [DATABASE_WS_PROXY=...] tsx scripts/db-bootstrap.ts
 */
import { spawnSync } from "child_process";

async function main(): Promise<void> {
  const { pool } = await import("../server/db");
  try {
    const { rows } = await pool.query<{ t: string | null }>("SELECT to_regclass('public.users')::text AS t");
    if (rows[0]?.t) {
      console.info("Schéma déjà présent : rien à faire.");
      return;
    }
    console.info("Base vide : création du schéma (drizzle-kit push).");
    const result = spawnSync("npx", ["drizzle-kit", "push", "--force"], { stdio: "inherit", env: process.env });
    if (result.status !== 0) throw new Error(`drizzle-kit push a échoué (code ${result.status}).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
