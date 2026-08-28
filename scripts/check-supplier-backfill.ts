/**
 * Contrôle du rattachement pièces -> fournisseurs (parts.supplier_id).
 *
 * Lecture seule. À lancer après le démarrage du serveur, qui exécute la
 * migration et le backfill dans `initializeDatabase()`.
 *
 *   npx tsx --env-file=.env scripts/check-supplier-backfill.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const colonne = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'parts' AND column_name = 'supplier_id'
  `);

  if (colonne.rows.length === 0) {
    console.log("La colonne parts.supplier_id n'existe pas encore.");
    console.log("Démarre le serveur (npm run dev) pour appliquer la migration.");
    process.exit(1);
  }

  const totaux = await db.execute(sql`
    SELECT
      count(*)::int AS total,
      count(supplier_id)::int AS rattachees,
      count(*) FILTER (
        WHERE supplier_id IS NULL AND supplier IS NOT NULL AND btrim(supplier) <> ''
      )::int AS orphelines,
      count(*) FILTER (
        WHERE supplier_id IS NULL AND (supplier IS NULL OR btrim(supplier) = '')
      )::int AS sans_fournisseur
    FROM parts
  `);

  const t = totaux.rows[0] as Record<string, number>;
  console.log("\n=== Rattachement pièces -> fournisseurs ===");
  console.log(`Total pièces          : ${t.total}`);
  console.log(`Rattachées (FK)       : ${t.rattachees}`);
  console.log(`Orphelines (nom seul) : ${t.orphelines}`);
  console.log(`Sans fournisseur      : ${t.sans_fournisseur}`);

  if (t.orphelines > 0) {
    const detail = await db.execute(sql`
      SELECT supplier, count(*)::int AS nb
      FROM parts
      WHERE supplier_id IS NULL AND supplier IS NOT NULL AND btrim(supplier) <> ''
      GROUP BY supplier
      ORDER BY nb DESC
    `);
    console.log("\nNoms non rattachés (à créer ou corriger via le combobox) :");
    for (const ligne of detail.rows as Array<Record<string, unknown>>) {
      console.log(`  - "${ligne.supplier}" (${ligne.nb} pièce(s))`);
    }
  } else {
    console.log("\nAucune pièce orpheline.");
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Échec du contrôle:", error);
  process.exit(1);
});
