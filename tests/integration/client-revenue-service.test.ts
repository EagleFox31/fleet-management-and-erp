import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { getRevenueByClient, type ClientRevenueRow } from "../../server/services/client-revenue-service";
import { clientInvoices, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { deleteClientInvoicesWhere } from "../support/money-override";

/**
 * Lot « CA réel » : `getRevenueByClient` lit le chiffre d'affaires HT sur les factures émises.
 * Période propre au fichier (mars 2047) : les autres suites partagent la base, aucune n'y facture.
 */
const ids = createIdBag();
const missionIds: number[] = [];
const PERIOD = { from: "2047-03-01", to: "2047-03-31" };

async function mission(clientId: number | null, actualFuelCost: string | null) {
  const [row] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("REV"),
      pickupAddress: "A",
      deliveryAddress: "B",
      pickupDate: new Date("2047-03-02T08:00:00Z"),
      deliveryDate: new Date("2047-03-03T08:00:00Z"),
      clientId,
      actualFuelCost,
    } as any)
    .returning();
  missionIds.push(row.id);
  return row.id;
}

async function invoice(values: {
  clientId?: number | null;
  missionId?: number | null;
  amountHT: string;
  invoiceDate?: string;
  status?: "pending" | "partial" | "paid" | "overdue" | "cancelled";
}) {
  const ht = Number(values.amountHT);
  const ttc = (ht * 1.1925).toFixed(2);
  const [row] = await db
    .insert(clientInvoices)
    .values({
      clientId: values.clientId ?? null,
      missionId: values.missionId ?? null,
      invoiceNumber: uniqueTestToken("REVI"),
      invoiceDate: values.invoiceDate ?? "2047-03-15",
      dueDate: "2099-02-15",
      amountHT: values.amountHT,
      vatAmount: (Number(ttc) - ht).toFixed(2),
      amountTTC: ttc,
      balance: ttc,
      status: values.status ?? "pending",
    } as any)
    .returning();
  ids.clientInvoiceIds.push(row.id);
  return row.id;
}

async function newClient() {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  return client;
}

let report: Awaited<ReturnType<typeof getRevenueByClient>>;
const rowOf = (clientId: number | null): ClientRevenueRow => {
  const row = report.rows.find((r) => r.clientId === clientId);
  expect(row, `ligne du client ${clientId}`).toBeDefined();
  return row!;
};

// Clients du scénario, un par règle.
let plain: { id: number; name: string };
let viaMission: { id: number; name: string };
let unknownFuel: { id: number; name: string };
let noMission: { id: number; name: string };
let split: { id: number; name: string };
let credit: { id: number; name: string };

beforeAll(async () => {
  plain = await newClient();
  viaMission = await newClient();
  unknownFuel = await newClient();
  noMission = await newClient();
  split = await newClient();
  credit = await newClient();

  // plain : HT (pas TTC), annulée exclue, bornes de période (dernier jour inclus, voisins exclus).
  const plainMission = await mission(plain.id, "30000.10");
  await invoice({ clientId: plain.id, missionId: plainMission, amountHT: "100000.25", invoiceDate: "2047-03-01" });
  await invoice({ clientId: plain.id, missionId: plainMission, amountHT: "50000.50", invoiceDate: "2047-03-31" });
  await invoice({ clientId: plain.id, missionId: plainMission, amountHT: "999999.00", status: "cancelled" });
  await invoice({ clientId: plain.id, missionId: plainMission, amountHT: "777777.00", invoiceDate: "2047-04-01" });
  await invoice({ clientId: plain.id, missionId: plainMission, amountHT: "666666.00", invoiceDate: "2047-02-28" });

  // viaMission : la facture ne porte pas le client, la mission oui.
  const vm = await mission(viaMission.id, "1000.00");
  await invoice({ clientId: null, missionId: vm, amountHT: "5000.00" });

  // unknownFuel : une mission facturée sans coût carburant réel.
  await invoice({ clientId: unknownFuel.id, missionId: await mission(unknownFuel.id, "2000.00"), amountHT: "10000.00" });
  await invoice({ clientId: unknownFuel.id, missionId: await mission(unknownFuel.id, null), amountHT: "10000.00" });

  // noMission : facture sans mission, coût inconnu.
  await invoice({ clientId: noMission.id, missionId: null, amountHT: "8000.00" });

  // split : acompte + solde sur la même mission, carburant compté une fois.
  const sm = await mission(split.id, "4000.00");
  await invoice({ clientId: split.id, missionId: sm, amountHT: "6000.00" });
  await invoice({ clientId: split.id, missionId: sm, amountHT: "4000.00" });

  // credit : montant négatif (faute de table d'avoirs) sommé avec son signe et compté.
  const cm = await mission(credit.id, "500.00");
  await invoice({ clientId: credit.id, missionId: cm, amountHT: "3000.00" });
  await invoice({ clientId: credit.id, missionId: cm, amountHT: "-1000.00" });

  // Sans client ni mission : ligne anonyme, comptée dans le total.
  await invoice({ clientId: null, missionId: null, amountHT: "700.00" });

  report = await getRevenueByClient(PERIOD);
}, 120000);

afterAll(async () => {
  if (ids.clientInvoiceIds.length) await deleteClientInvoicesWhere(inArray(clientInvoices.id, ids.clientInvoiceIds));
  ids.clientInvoiceIds = [];
  if (missionIds.length) await db.delete(missions).where(inArray(missions.id, missionIds));
  await cleanupCreated(ids);
});

describe("getRevenueByClient : CA HT réel par client", { timeout: 120000 }, () => {
  it("HT, factures annulées exclues, bornes de période incluses et voisins exclus", () => {
    const row = rowOf(plain.id);
    expect(row.clientName).toBe(plain.name);
    expect(row.invoiceCount).toBe(2);
    expect(row.revenueHt).toBe("150000.75");
    expect(row.fuelCostKnown).toBe("30000.10");
    expect(row.marginAfterFuelHt).toBe("120000.65");
  });

  it("client lu par la mission quand la facture ne le porte pas", () => {
    const row = rowOf(viaMission.id);
    expect(row.clientName).toBe(viaMission.name);
    expect(row.revenueHt).toBe("5000.00");
    expect(row.marginAfterFuelHt).toBe("4000.00");
  });

  it("mission facturée sans coût carburant réel : marge inconnue, coût connu partiel", () => {
    const row = rowOf(unknownFuel.id);
    expect(row.revenueHt).toBe("20000.00");
    expect(row.fuelCostKnown).toBe("2000.00");
    expect(row.marginAfterFuelHt).toBeNull();
  });

  it("facture sans mission : marge inconnue", () => {
    const row = rowOf(noMission.id);
    expect(row.revenueHt).toBe("8000.00");
    expect(row.fuelCostKnown).toBeNull();
    expect(row.marginAfterFuelHt).toBeNull();
  });

  it("acompte + solde sur une mission : carburant compté une seule fois", () => {
    const row = rowOf(split.id);
    expect(row.invoiceCount).toBe(2);
    expect(row.revenueHt).toBe("10000.00");
    expect(row.fuelCostKnown).toBe("4000.00");
    expect(row.marginAfterFuelHt).toBe("6000.00");
  });

  it("montant négatif sommé avec son signe et signalé", () => {
    const row = rowOf(credit.id);
    expect(row.revenueHt).toBe("2000.00");
    expect(row.negativeInvoiceCount).toBe(1);
    expect(row.marginAfterFuelHt).toBe("1500.00");
  });

  it("facture sans client ni mission : ligne « Sans client » sans nom, en dernier", () => {
    const row = rowOf(null);
    expect(row.clientName).toBeNull();
    expect(row.revenueHt).toBe("700.00");
    expect(row.marginAfterFuelHt).toBeNull();
    expect(report.rows.at(-1)?.clientId).toBeNull();
  });

  it("totaux exacts au centime ; marge totale inconnue dès qu'un client l'est", () => {
    const mine = new Set<number | null>([plain.id, viaMission.id, unknownFuel.id, noMission.id, split.id, credit.id, null]);
    expect(report.rows.every((r) => mine.has(r.clientId)), "période réservée au fichier").toBe(true);
    expect(report.from).toBe(PERIOD.from);
    expect(report.to).toBe(PERIOD.to);
    expect(report.totals.revenueHt).toBe("195700.75");
    expect(report.totals.invoiceCount).toBe(11);
    expect(report.totals.negativeInvoiceCount).toBe(1);
    expect(report.totals.fuelCostKnown).toBe("37500.10");
    expect(report.totals.marginAfterFuelHt).toBeNull();
  });

  it("période sans facture : zéros, pas de ligne", async () => {
    const empty = await getRevenueByClient({ from: "2047-06-01", to: "2047-06-30" });
    expect(empty.rows).toEqual([]);
    expect(empty.totals).toEqual({
      invoiceCount: 0, negativeInvoiceCount: 0, revenueHt: "0.00", fuelCostKnown: "0.00", marginAfterFuelHt: "0.00",
    });
  });
});
