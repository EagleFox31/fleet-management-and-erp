/**
 * Premier démarrage d'une base Postgres en conteneur (serveur de site, VPS) : crée le schéma Drizzle
 * si la base n'en a pas encore de complet. Ensuite, c'est init-database (au démarrage de l'app) qui
 * ajoute colonnes, triggers et migrations de façon idempotente.
 *
 * Schéma complet = toutes les tables déclarées dans shared/schema.ts présentes.
 * - Complet : rien à faire.
 * - Incomplet et sans aucun utilisateur (base vide, ou `push` interrompu) : `drizzle-kit push`.
 * - Incomplet avec des utilisateurs : on ne pousse pas. `push --force` peut supprimer une colonne
 *   absente du schéma, et init-database crée les tables récentes. Avertissement seulement.
 *
 * Usage : DATABASE_URL=... [DATABASE_WS_PROXY=...] tsx scripts/db-bootstrap.ts
 */
import { spawnSync } from "child_process";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { moduleLogger } from "../server/lib/logger";

const log = moduleLogger("db-bootstrap");

async function main(): Promise<void> {
  const [{ pool }, schema] = await Promise.all([import("../server/db"), import("../shared/schema")]);
  const tables = [
    ...new Set(Object.values(schema).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t).name)),
  ];
  try {
    const { rows } = await pool.query<{ name: string }>(
      "SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass('public.' || quote_ident(name)) IS NULL",
      [tables],
    );
    const missing = rows.map((r) => r.name);
    if (missing.length === 0) {
      log.info({ tables: tables.length }, "Schéma déjà complet : rien à faire.");
      return;
    }

    const hasUsers = !missing.includes("users")
      && Number((await pool.query<{ n: string }>("SELECT count(*) AS n FROM users")).rows[0]?.n ?? 0) > 0;
    if (hasUsers) {
      log.warn({ missing }, "Tables absentes sur une base qui a des utilisateurs : pas de drizzle-kit push, init-database doit les créer.");
      return;
    }

    log.info({ missing: missing.length, total: tables.length }, "Base sans schéma complet ni utilisateur : création du schéma (drizzle-kit push).");
    const result = spawnSync("npx", ["drizzle-kit", "push", "--force"], { stdio: "inherit", env: process.env });
    if (result.status !== 0) throw new Error(`drizzle-kit push a échoué (code ${result.status}).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  log.error({ err }, "Création du schéma interrompue");
  process.exit(1);
});
