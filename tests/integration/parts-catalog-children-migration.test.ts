import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { faultCatalog, faultCatalogParts } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Migration 20261102_parts_catalog_children : dédoublonnage de `fault_catalog_parts`.
 * - seules les lignes strictement identiques (panne, pièce, quantité, optionnel) sont supprimées ;
 * - si des lignes divergentes subsistent pour un couple, l'index unique n'est pas posé et un WARNING le dit ;
 * - sans divergence, l'index est posé. La migration est rejouée : le second passage n'écrit rien.
 */
const MIGRATION = readFileSync("server/db/migrations/20261102_parts_catalog_children.sql", "utf8");
const INDEX = "ux_fault_catalog_parts_fault_part";
const ids = createIdBag();
const faultIds: number[] = [];

async function indexExists(): Promise<boolean> {
  const res = await pool.query("SELECT 1 FROM pg_indexes WHERE indexname = $1", [INDEX]);
  return res.rows.length > 0;
}

/** Joue la migration sur une connexion dédiée et rend les messages NOTICE / WARNING reçus. */
async function runMigration(): Promise<string[]> {
  const client = await pool.connect();
  const messages: string[] = [];
  client.on("notice", (n: { message?: string }) => messages.push(String(n.message ?? "")));
  try {
    await client.query(MIGRATION);
  } finally {
    client.release();
  }
  return messages;
}

async function newFaultAndPart() {
  const [fault] = await db
    .insert(faultCatalog)
    .values({ name: uniqueTestToken("panne"), description: "TEST", category: "Moteur" })
    .returning();
  faultIds.push(fault.id);
  const part = await createTestPart();
  ids.partIds.push(part.id);
  return { faultId: fault.id, partId: part.id };
}

const linksOf = (faultId: number) =>
  db.select().from(faultCatalogParts).where(eq(faultCatalogParts.faultCatalogId, faultId)).orderBy(faultCatalogParts.id);

beforeAll(async () => {
  await runMigration();
}, 60000);

afterAll(async () => {
  if (faultIds.length > 0) await db.delete(faultCatalog).where(inArray(faultCatalog.id, faultIds));
  await cleanupCreated(ids);
  await runMigration(); // restaure l'index unique si un test l'a retiré
}, 60000);

describe("migration fault_catalog_parts : dédoublonnage prudent", { timeout: 60000 }, () => {
  it("lignes divergentes (1/false, 4/true, 1/false) : le doublon identique part, la divergence reste, index non posé, WARNING", async () => {
    const { faultId, partId } = await newFaultAndPart();
    await pool.query(`DROP INDEX IF EXISTS ${INDEX}`);
    await db.insert(faultCatalogParts).values([
      { faultCatalogId: faultId, partId, quantity: 1, isOptional: false },
      { faultCatalogId: faultId, partId, quantity: 4, isOptional: true },
      { faultCatalogId: faultId, partId, quantity: 1, isOptional: false },
    ]);

    const messages = await runMigration();

    const rows = await linksOf(faultId);
    expect(rows.map((r) => [r.quantity, r.isOptional])).toEqual([
      [1, false],
      [4, true],
    ]);
    expect(await indexExists()).toBe(false);
    expect(messages.some((m) => m.includes(INDEX) && m.includes("non posé"))).toBe(true);

    // Rejouée à l'identique : aucune ligne de plus ni de moins.
    await runMigration();
    expect(await linksOf(faultId)).toHaveLength(2);
    expect(await indexExists()).toBe(false);
  });

  it("doublons tous identiques : un seul reste et l'index unique est posé", async () => {
    // Les lignes divergentes du test précédent bloqueraient l'index : on repart d'une panne sans divergence.
    const prior = faultIds[faultIds.length - 1];
    await db.delete(faultCatalog).where(eq(faultCatalog.id, prior));

    const { faultId, partId } = await newFaultAndPart();
    await pool.query(`DROP INDEX IF EXISTS ${INDEX}`);
    await db.insert(faultCatalogParts).values([
      { faultCatalogId: faultId, partId, quantity: 2, isOptional: false },
      { faultCatalogId: faultId, partId, quantity: 2, isOptional: false },
    ]);

    await runMigration();

    expect(await linksOf(faultId)).toHaveLength(1);
    expect(await indexExists()).toBe(true);
  });
});
