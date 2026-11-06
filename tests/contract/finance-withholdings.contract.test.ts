import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { clientInvoices, clients } from "../../shared/schema";
import { isoDateInZone } from "../../shared/contracts/kpi-period";
import { FINANCE_WITHHOLDINGS_PATH, financeWithholdingsResponseSchema } from "../../shared/contracts/finance-withholdings";
import { apiErrorProblems } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestClient, createTestClientInvoice } from "../support/factories";

/**
 * GET /api/finance/withholdings : retenues à la source subies sur une période.
 * - Rôles : `FINANCE_RECEIVABLE_READ_ROLES` (admin, management, secretary, logistics) ; autres 403.
 * - Périmètre : factures déposées entre `from` et `to` inclus, non annulées ; non déposée exclue.
 * - Montants figés au dépôt : un changement de taux du client ne les modifie pas.
 * - Défaut : `to` = aujourd'hui à Africa/Douala, `from` = premier jour du mois.
 * Période de 2001 : aucun autre fichier n'y dépose de facture. Écrit en base ; tout est supprimé.
 */
const previousFlags = process.env.FEATURE_FLAGS;
const MAY = "from=2001-05-01&to=2001-05-31";
const path = (query = "") => `${FINANCE_WITHHOLDINGS_PATH}${query ? `?${query}` : ""}`;

let session: Awaited<ReturnType<typeof startContractSession<"admin" | "management" | "secretary" | "logistics" | "warehouse" | "technician" | "driver" | "client">>>;
const client = { a: 0, b: 0 };
const inv: Record<"a1" | "a2" | "b1", number> = { a1: 0, a2: 0, b1: 0 };
let orphan = 0;

async function deposited(
  clientId: number,
  depositedAt: string | null,
  amounts: { ht: string; ttc: string; vat: string; is: string; net: string },
  status: "pending" | "paid" | "cancelled" = "pending",
) {
  const row = await createTestClientInvoice({
    clientId,
    invoiceDate: "2001-04-01",
    amountHT: amounts.ht,
    vatAmount: (Number(amounts.ttc) - Number(amounts.ht)).toFixed(2),
    amountTTC: amounts.ttc,
    status,
  });
  session.ids.clientInvoiceIds.push(row.id);
  if (depositedAt !== null) {
    await db
      .update(clientInvoices)
      .set({ depositedAt, withholdingVatAmount: amounts.vat, withholdingIsAmount: amounts.is, netPayable: amounts.net })
      .where(eq(clientInvoices.id, row.id));
  }
  return row.id;
}

const A1 = { ht: "100000.00", ttc: "119250.00", vat: "19250.00", is: "2200.00", net: "97800.00" };
const A2 = { ht: "50000.00", ttc: "59625.00", vat: "9625.00", is: "1100.00", net: "48900.00" };
const B1 = { ht: "10000.00", ttc: "11925.00", vat: "1925.00", is: "220.00", net: "9780.00" };

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "finance=on";
  session = await startContractSession({
    admin: "admin",
    management: "management",
    secretary: "secretary",
    logistics: "logistics",
    warehouse: "warehouse",
    technician: "technician",
    driver: "driver",
    client: "client",
  });
  for (const key of ["a", "b"] as const) {
    const row = await createTestClient();
    session.ids.clientIds.push(row.id);
    client[key] = row.id;
  }
  inv.a1 = await deposited(client.a, "2001-05-01", A1, "paid");
  inv.a2 = await deposited(client.a, "2001-05-31", A2);
  inv.b1 = await deposited(client.b, "2001-05-10", B1);
  // Hors périmètre : lendemain de `to`, annulée, non déposée.
  await deposited(client.a, "2001-06-01", A1);
  await deposited(client.a, "2001-05-15", A1, "cancelled");
  await deposited(client.a, null, A1);
  // Facture sans client rattaché : ligne `clientId` nulle, groupe nul en dernier.
  orphan = await deposited(client.b, "2001-05-20", B1);
  await db.update(clientInvoices).set({ clientId: null }).where(eq(clientInvoices.id, orphan));
  // Taux changé après dépôt : les montants figés ne bougent pas.
  await db.update(clients).set({ withholdingVatRate: "50.00", withholdingIsRate: "10.00" }).where(eq(clients.id, client.a));
}, 180000);

afterAll(async () => {
  await session.stop();
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
});

describe("droits", () => {
  it("sans session : 401", async () => {
    expect((await session.call("GET", path(MAY), { actor: null })).status).toBe(401);
  });

  it.each(["warehouse", "technician", "driver", "client"] as const)("%s : 403", async (actor) => {
    expect((await session.call("GET", path(MAY), { actor })).status).toBe(403);
  });

  it.each(["admin", "management", "secretary", "logistics"] as const)("%s : 200 au contrat", async (actor) => {
    const r = await session.call("GET", path(MAY), { actor });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    financeWithholdingsResponseSchema.parse(r.body);
  });

  it("drapeau finance coupé : 404", async () => {
    process.env.FEATURE_FLAGS = "finance=off";
    try {
      expect((await session.call("GET", path(MAY), { actor: "admin" })).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "finance=on";
    }
  });
});

describe("paramètres", () => {
  it.each([
    ["from=2001-06-01&to=2001-05-01", "La date de début doit précéder la date de fin."],
    ["from=2001-02-30", "Cette date n'existe pas au calendrier."],
    ["to=demain", "Date attendue au format AAAA-MM-JJ."],
    ["from[]=2001-05-01", "Période invalide."],
    ["from=2001-05-01&from=2001-05-02", "Période invalide."],
    ["status=paid", "Paramètre non reconnu."],
    [`${MAY}&clientId=12abc`, "Identifiant de client invalide."],
    [`${MAY}&clientId=0`, "Identifiant de client invalide."],
    [`${MAY}&clientId=1&clientId=2`, "Identifiant de client invalide."],
    ["from=2099-01-01", "La date de début ne peut pas dépasser aujourd'hui."],
    ["from=2001-01-01&to=2004-01-01", "Période trop longue : 36 mois au plus."],
  ])("%s : 400 lisible", async (query, message) => {
    const r = await session.call("GET", path(query), { actor: "admin" });
    expect(apiErrorProblems(r.status, r.body, 400)).toEqual([]);
    expect(r.body.message).toBe(message);
  });

  it("sans période : du premier du mois à aujourd'hui, à Africa/Douala", async () => {
    const today = isoDateInZone(new Date());
    const r = await session.call("GET", path(), { actor: "secretary" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ from: `${today.slice(0, 8)}01`, to: today, clientId: null });
  });

  it("36 mois exactement : accepté", async () => {
    expect((await session.call("GET", path("from=2001-01-01&to=2003-12-31"), { actor: "admin" })).status).toBe(200);
  });

  it("clientId vide : sans filtre", async () => {
    const r = await session.call("GET", path(`${MAY}&clientId=`), { actor: "admin" });
    expect(r.status).toBe(200);
    expect(r.body.clientId).toBeNull();
    expect(r.body.items.filter((i: { invoiceId: number }) => Object.values(inv).includes(i.invoiceId))).toHaveLength(3);
  });
});

describe("récapitulatif", () => {
  it("un client : bornes incluses, montants figés au dépôt, annulée, non déposée et hors période exclues", async () => {
    const r = await session.call("GET", path(`${MAY}&clientId=${client.a}`), { actor: "logistics" });
    const s = financeWithholdingsResponseSchema.parse(r.body);
    expect(s.clientId).toBe(client.a);
    expect(s.items.map((i) => [i.invoiceId, i.depositedAt, i.withholdingVatAmount, i.withholdingIsAmount, i.netPayable])).toEqual([
      [inv.a1, "2001-05-01", 19250, 2200, 97800],
      [inv.a2, "2001-05-31", 9625, 1100, 48900],
    ]);
    const totals = { count: 2, amountHt: 150000, amountTtc: 178875, withholdingVatAmount: 28875, withholdingIsAmount: 3300, netPayable: 146700 };
    expect(s.totals).toEqual(totals);
    expect(s.byClient).toEqual([{ clientId: client.a, clientName: expect.any(String), ...totals }]);
  });

  it("tous clients : une ligne par client, totaux généraux au moins égaux aux factures du test", async () => {
    const r = await session.call("GET", path(MAY), { actor: "management" });
    const s = financeWithholdingsResponseSchema.parse(r.body);
    const mine = s.byClient.filter((c) => c.clientId === client.a || c.clientId === client.b);
    expect(mine.find((c) => c.clientId === client.b)).toMatchObject({ count: 1, withholdingVatAmount: 1925, withholdingIsAmount: 220, netPayable: 9780 });
    expect(mine.find((c) => c.clientId === client.a)).toMatchObject({ count: 2, netPayable: 146700 });
    expect(s.items.filter((i) => Object.values(inv).includes(i.invoiceId))).toHaveLength(3);
    const sum = (k: "netPayable" | "withholdingVatAmount") => s.byClient.reduce((t, c) => t + Math.round(c[k] * 100), 0) / 100;
    expect(s.totals.netPayable).toBe(sum("netPayable"));
    expect(s.totals.withholdingVatAmount).toBe(sum("withholdingVatAmount"));
    expect(s.totals.count).toBe(s.items.length);
  });

  it("facture sans client : clientId nul sur la ligne, groupe nul placé en dernier", async () => {
    const r = await session.call("GET", path(MAY), { actor: "admin" });
    const s = financeWithholdingsResponseSchema.parse(r.body);
    expect(s.items.find((i) => i.invoiceId === orphan)).toMatchObject({ clientId: null, clientName: null, netPayable: 9780 });
    const last = s.byClient[s.byClient.length - 1];
    expect(last).toMatchObject({ clientId: null, clientName: null });
    expect(last.count).toBeGreaterThanOrEqual(1);
    expect(s.byClient.filter((c) => c.clientId === null)).toHaveLength(1);
  });

  it("client sans dépôt dans la période : récapitulatif vide", async () => {
    const r = await session.call("GET", path(`from=2001-07-01&to=2001-07-31&clientId=${client.b}`), { actor: "admin" });
    expect(r.body).toMatchObject({ items: [], byClient: [], totals: { count: 0, amountHt: 0, netPayable: 0 } });
  });
});
