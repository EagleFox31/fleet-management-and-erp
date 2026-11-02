import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { parts } from "../../shared/schema";
import { createTestPart } from "../support/factories";
import { startContractSession } from "../support/contract-session";

/**
 * DIR3 : contenu exact de l'export Excel de l'inventaire
 * (`GET /api/exports/inventory`). Les droits sont dans `lot-exports-roles`.
 * Deux pieces au jeton unique, retrouvees par leur reference dans le classeur.
 */
type Actor = "admin";
type Row = Record<string, string | number>;
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
let low: { id: number; reference: string };
let ok: { id: number; reference: string };
let rows: Row[] = [];

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin" });
  const a = await createTestPart({ quantity: 2, minQuantity: 5, unitPrice: "125.50", supplier: "Fournisseur DIR3", location: "DIR3-A1" });
  const b = await createTestPart({ quantity: 7, minQuantity: 5, unitPrice: "10.00" });
  session.ids.partIds.push(a.id, b.id);
  await db.update(parts).set({ realStock: 6 }).where(eq(parts.id, a.id));
  low = a;
  ok = b;
  const res = await session.raw("GET", "/api/exports/inventory", "admin");
  expect(res.status).toBe(200);
  const workbook = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
  expect(workbook.SheetNames).toEqual(["Inventaire"]);
  rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets["Inventaire"]);
}, 60000);

afterAll(async () => {
  await session.stop();
});

const find = (reference: string) => rows.find((r) => r["Référence"] === reference)!;

describe("DIR3 : export inventaire, cellules exactes", { timeout: 60000 }, () => {
  it("une piece en stock bas : alerte OUI, valeur = stock reel x prix, fournisseur et emplacement", () => {
    expect(find(low.reference)).toMatchObject({
      "Stock Théorique": 2,
      "Stock Réel": 6,
      "Seuil Min": 5,
      "Alerte CDE": "OUI",
      "Prix Unitaire": 125.5,
      "Valeur Stock": 753,
      Fournisseur: "Fournisseur DIR3",
      Emplacement: "DIR3-A1",
    });
  });

  it("une piece sans stock reel ni fournisseur : 0, N/A, alerte NON, valeur 0", () => {
    expect(find(ok.reference)).toMatchObject({
      "Stock Théorique": 7,
      "Stock Réel": 0,
      "Alerte CDE": "NON",
      "Valeur Stock": 0,
      Fournisseur: "N/A",
    });
  });

  it("la derniere ligne TOTAL : nombre de pieces et somme exacte des valeurs", () => {
    const total = rows[rows.length - 1];
    const lines = rows.slice(0, -1);
    expect(total["Référence"]).toBe("TOTAL");
    expect(total["Désignation"]).toBe(`${lines.length} pièces`);
    const sum = lines.reduce((s, r) => s + Number(r["Valeur Stock"]), 0);
    expect(Number(total["Valeur Stock"])).toBeCloseTo(sum, 2);
    expect(lines.filter((r) => r["Référence"] === "TOTAL")).toHaveLength(0);
  });

  it("chaque reference apparait une seule fois", () => {
    expect(rows.filter((r) => r["Référence"] === low.reference)).toHaveLength(1);
  });
});
