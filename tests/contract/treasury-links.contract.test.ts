import fs from "fs";
import path from "path";
import { eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TREASURY_BASE_PATH } from "../../shared/contracts/treasury";
import { db } from "../../server/db";
import { fuelRecords, supplierInvoiceSettlements, treasuryAccounts, treasuryEntries, type FuelRecord } from "../../shared/schema";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { linkFuelConsumption } from "../../server/services/treasury-links";
import { storage } from "../../server/storage";
import { createTestSupplier, createTestSupplierInvoice, createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * Lots T2 et T3 : écritures de trésorerie posées par la carte carburant (recharge, plein) et par
 * le règlement fournisseur, dans la transaction de l'opération. Vérifie le lien, le rejeu sans
 * doublon, l'absence d'écriture orpheline quand l'opération échoue, le drapeau et les rôles.
 */

process.env.FEATURE_FLAGS = "finance=on";

type Actor = "admin" | "secretary" | "logistics" | "management" | "technician" | "workshop_manager";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;

const suffix = Date.now().toString(36).toUpperCase();
// Année isolée : aucun autre fichier n'écrit de plein en 2037 (balayage en fin de fichier).
const DATE = "2037-02-10";
const PROOF_DIR = path.join(process.cwd(), "uploads", "supplier-invoices", "settlements");
const PROOF_NAME = uniqueTestToken("t3proof");

const ownedAccountIds: number[] = [];
const fuelIds: number[] = [];
const settlementIds: number[] = [];
let cardId = 0;
let bankId = 0;

const linesOfFuel = (id: number) => db.select().from(treasuryEntries).where(eq(treasuryEntries.fuelRecordId, id));
const linesOfSettlement = (id: number) => db.select().from(treasuryEntries).where(eq(treasuryEntries.supplierSettlementId, id));
const fuelByOrder = (orderNumber: string) => db.select().from(fuelRecords).where(eq(fuelRecords.orderNumber, orderNumber));
const fuelByStation = (stationName: string) => db.select().from(fuelRecords).where(eq(fuelRecords.stationName, stationName));

async function newAccount(tag: string, kind: "bank" | "cash" | "fuel_card") {
  const res = await session.call("POST", `${TREASURY_BASE_PATH}/accounts`, {
    actor: "secretary",
    body: { code: `T2${suffix}${tag}`, label: `Compte ${tag}`, kind, openingBalance: "0" },
  });
  if (res.status === 201) ownedAccountIds.push(res.body.id);
  return res;
}

async function recharge(over: Record<string, unknown> = {}, actor: Actor = "admin") {
  const body = { amount: 100000, unitPrice: 800, date: DATE, paymentMode: "virement", orderNumber: uniqueTestToken("t2cmd"), ...over };
  const res = await session.call("POST", "/api/fuel-card/recharge", { actor, body });
  if (typeof res.body?.recharge?.id === "number") fuelIds.push(res.body.recharge.id);
  return { res, orderNumber: body.orderNumber as string };
}

async function postSettlement(invoiceId: number, extra: Record<string, string>, reference = uniqueTestToken("t3chq"), amount = 1000) {
  const form = new FormData();
  form.append("amount", String(amount));
  form.append("paymentMethod", "virement");
  form.append("paymentReference", reference);
  form.append("paymentDate", "2037-02-11");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), `${PROOF_NAME}.pdf`);
  const response = await session.raw("POST", `/api/supplier-invoices/${invoiceId}/settlements`, "secretary", form);
  const body = await response.json().catch(() => null);
  if (typeof body?.settlement?.id === "number") settlementIds.push(body.settlement.id);
  return { status: response.status, body, reference };
}

async function approvedInvoice() {
  const supplier = await createTestSupplier();
  session.ids.supplierIds.push(supplier.id);
  const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status: "approved" });
  session.ids.invoiceIds.push(invoice.id);
  return invoice;
}

async function withFinanceOff<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.FEATURE_FLAGS;
  process.env.FEATURE_FLAGS = "finance=off";
  try {
    return await fn();
  } finally {
    process.env.FEATURE_FLAGS = before;
  }
}

beforeAll(async () => {
  session = await startContractSession<Actor>({
    admin: "admin",
    secretary: "secretary",
    logistics: "logistics",
    management: "management",
    technician: "technician",
    workshop_manager: "workshop_manager",
  });
  // Un seul compte carte actif en base : on le crée, ou on reprend celui qui existe (sans le posséder).
  const created = await newAccount("C", "fuel_card");
  if (created.status === 201) cardId = created.body.id;
  else {
    const [existing] = await db.select().from(treasuryAccounts).where(sql`${treasuryAccounts.kind} = 'fuel_card' AND ${treasuryAccounts.isActive}`);
    cardId = existing.id;
  }
  const bank = await newAccount("B", "bank");
  expect(bank.status).toBe(201);
  bankId = bank.body.id;
}, 120000);

afterAll(async () => {
  const conditions = [
    fuelIds.length ? inArray(treasuryEntries.fuelRecordId, fuelIds) : undefined,
    settlementIds.length ? inArray(treasuryEntries.supplierSettlementId, settlementIds) : undefined,
    ownedAccountIds.length ? inArray(treasuryEntries.accountId, ownedAccountIds) : undefined,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (conditions.length) await db.delete(treasuryEntries).where(or(...conditions));
  if (fuelIds.length) await db.delete(fuelRecords).where(inArray(fuelRecords.id, fuelIds));
  await db.delete(fuelRecords).where(sql`${fuelRecords.date} >= '2037-01-01' AND ${fuelRecords.date} < '2038-01-01'`);
  for (const name of fs.existsSync(PROOF_DIR) ? fs.readdirSync(PROOF_DIR).filter((n) => n.startsWith(PROOF_NAME)) : []) {
    fs.unlinkSync(path.join(PROOF_DIR, name));
  }
  await session.stop();
  if (ownedAccountIds.length) await db.delete(treasuryAccounts).where(inArray(treasuryAccounts.id, ownedAccountIds));
});

describe("T2 : carte carburant au journal de trésorerie", { timeout: 120000 }, () => {
  it("un seul compte carte carburant actif : le second est refusé en 409", async () => {
    const second = await newAccount("D", "fuel_card");
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/carte carburant actif/);
  });

  it("recharge sans compte source : une entrée sur la carte, liée à la recharge", async () => {
    const { res } = await recharge();
    expect(res.status).toBe(201);
    const lines = await linesOfFuel(res.body.recharge.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ accountId: cardId, direction: "in", amount: "100000.00", category: "appro", requestKey: `fuel:${res.body.recharge.id}` });
  });

  it("recharge avec compte source : virement en deux lignes liées (sortie banque, entrée carte)", async () => {
    const { res } = await recharge({ sourceAccountId: bankId, amount: 50000 });
    expect(res.status).toBe(201);
    const lines = await linesOfFuel(res.body.recharge.id);
    expect(lines).toHaveLength(2);
    const out = lines.find((l) => l.direction === "out")!;
    const inn = lines.find((l) => l.direction === "in")!;
    expect(out).toMatchObject({ accountId: bankId, amount: "50000.00", category: "virement_interne" });
    expect(inn).toMatchObject({ accountId: cardId, amount: "50000.00", category: "virement_interne" });
    expect(out.transferGroup).toBeTruthy();
    expect(out.transferGroup).toBe(inn.transferGroup);
  });

  it("recharge refusée (source inactive, source = carte, source illisible) : ni plein, ni écriture", async () => {
    const inactive = await newAccount("I", "cash");
    await db.update(treasuryAccounts).set({ isActive: false }).where(eq(treasuryAccounts.id, inactive.body.id));
    for (const [sourceAccountId, status] of [
      [inactive.body.id, 409],
      [cardId, 400],
      ["abc", 400],
    ] as const) {
      const { res, orderNumber } = await recharge({ sourceAccountId });
      expect(res.status, String(sourceAccountId)).toBe(status);
      expect(await fuelByOrder(orderNumber)).toHaveLength(0);
    }
    expect(await db.select().from(treasuryEntries).where(eq(treasuryEntries.accountId, inactive.body.id))).toHaveLength(0);
  });

  it("plein payé par la carte : une sortie liée au plein ; lien rejoué = aucune seconde ligne", async () => {
    await recharge();
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const res = await session.call("POST", "/api/fuel-card/consumption", {
      actor: "admin",
      body: { vehicleId: vehicle.id, quantity: 10, unitPrice: 800, date: DATE, stationName: "TEST T2", destination: "Douala" },
    });
    expect(res.status).toBe(201);
    const record = res.body.consumption as FuelRecord;
    fuelIds.push(record.id);
    const lines = await linesOfFuel(record.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ accountId: cardId, direction: "out", category: "carburant", vehicleId: vehicle.id, requestKey: `fuel:${record.id}` });
    expect(Number(lines[0].amount)).toBe(Number(record.debitAmount));

    // Lien posé deux fois pour le même plein : clé `fuel:<id>`, ON CONFLICT DO NOTHING.
    const [stored] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id));
    await db.transaction((tx) => linkFuelConsumption(tx as never, stored, session.userId("admin")));
    expect(await linesOfFuel(record.id)).toHaveLength(1);

    // Rejeu du plein (clé de soumission déjà vue) : ni débit, ni écriture.
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(treasuryEntries).where(eq(treasuryEntries.accountId, cardId));
    const replayed = await fuelCardService.recordConsumption(
      { vehicleId: vehicle.id, quantity: 10, unitPrice: 800, date: DATE, stationName: "TEST T2", destination: "Douala", userId: session.userId("admin") },
      undefined,
      { replay: async () => stored },
    );
    expect(replayed.replayed).toBe(true);
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(treasuryEntries).where(eq(treasuryEntries.accountId, cardId));
    expect(after[0].n).toBe(before[0].n);
  });

  it("suppression définitive d'un véhicule : ses pleins liés sont contre-passés, net nul sur la carte", async () => {
    await recharge();
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const res = await session.call("POST", "/api/fuel-card/consumption", {
      actor: "admin",
      body: { vehicleId: vehicle.id, quantity: 5, unitPrice: 800, date: DATE, stationName: "TEST T2 VEH", destination: "Douala" },
    });
    expect(res.status).toBe(201);
    const recordId = (res.body.consumption as FuelRecord).id;
    const keys = [`fuel:${recordId}`, `fuel:${recordId}:reverse`];
    const lines = () => db.select().from(treasuryEntries).where(inArray(treasuryEntries.requestKey, keys));
    try {
      expect(await storage.deleteVehicle(vehicle.id, session.userId("secretary"))).toBe(true);
      expect(await fuelByStation("TEST T2 VEH")).toHaveLength(0);
      const after = await lines();
      expect(after.map((l) => l.requestKey).sort()).toEqual(keys);
      const reverse = after.find((l) => l.requestKey === keys[1])!;
      expect(reverse).toMatchObject({ accountId: cardId, direction: "in", createdBy: session.userId("secretary") });
      const net = after.reduce((sum, l) => sum + (l.direction === "in" ? 1 : -1) * Number(l.amount), 0);
      expect(net).toBe(0);
      // Plein et véhicule supprimés : les écritures restent, leurs liens passent à NULL.
      expect(after.every((l) => l.fuelRecordId === null && l.vehicleId === null)).toBe(true);
    } finally {
      // Le lien au plein est tombé : nettoyage par la clé.
      await db.delete(treasuryEntries).where(inArray(treasuryEntries.requestKey, keys));
    }
  });

  it("plein annulé (écriture liée en échec, solde insuffisant) : ni plein, ni écriture orpheline", async () => {
    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const station = uniqueTestToken("T2rollback");
    await expect(
      fuelCardService.recordConsumption(
        { vehicleId: vehicle.id, quantity: 1, unitPrice: 800, date: DATE, stationName: station, destination: "Douala", userId: session.userId("admin") },
        async () => {
          throw new Error("échec simulé de l'écriture liée");
        },
      ),
    ).rejects.toThrow();
    expect(await fuelByStation(station)).toHaveLength(0);

    const poor = await session.call("POST", "/api/fuel-card/consumption", {
      actor: "admin",
      body: { vehicleId: vehicle.id, quantity: 1_000_000, unitPrice: 100_000, date: DATE, stationName: station, destination: "Douala" },
    });
    expect(poor.status).toBe(409);
    expect(await fuelByStation(station)).toHaveLength(0);
    const orphans = await db.select().from(treasuryEntries).where(sql`${treasuryEntries.requestKey} LIKE 'fuel:%' AND ${treasuryEntries.fuelRecordId} IS NULL AND ${treasuryEntries.accountId} = ${cardId} AND ${treasuryEntries.label} = ${`Plein ${station}`}`);
    expect(orphans).toHaveLength(0);
  });

  it("logistique : choisit le compte source (dérogation FUEL_RECHARGE_SOURCE_ROLES), lignes signées par elle", async () => {
    const { res } = await recharge({ sourceAccountId: String(bankId), amount: 20000 }, "logistics");
    expect(res.status).toBe(201);
    const lines = await linesOfFuel(res.body.recharge.id);
    expect(lines.map((l) => l.requestKey).sort()).toEqual([`fuel:${res.body.recharge.id}`, `fuel:${res.body.recharge.id}:source`]);
    expect(lines.find((l) => l.direction === "out")).toMatchObject({ accountId: bankId, amount: "20000.00" });
    expect(lines.every((l) => l.createdBy === session.userId("logistics"))).toBe(true);
  });

  it("compte source : rôle hors liste 403, id non entier ou hors borne 400, sans plein ni écriture", async () => {
    for (const actor of ["management", "technician", "workshop_manager"] as const) {
      const { res, orderNumber } = await recharge({ sourceAccountId: bankId }, actor);
      expect(res.status, actor).toBe(403);
      expect(await fuelByOrder(orderNumber)).toHaveLength(0);
    }
    for (const sourceAccountId of [true, 1.5, -1, 0, 2147483648, [bankId], " "]) {
      const { res, orderNumber } = await recharge({ sourceAccountId });
      expect(res.status, JSON.stringify(sourceAccountId)).toBe(400);
      expect(await fuelByOrder(orderNumber)).toHaveLength(0);
    }
  });

  it("suppression d'une recharge payée par un compte source ou d'un plein : contre-passation, net nul", async () => {
    const net = (lines: Awaited<ReturnType<typeof linesOfFuel>>, accountId: number) =>
      lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + (l.direction === "in" ? 1 : -1) * Number(l.amount), 0);
    const { res } = await recharge({ sourceAccountId: bankId, amount: 30000 });
    expect(res.status).toBe(201);
    const id = res.body.recharge.id as number;
    expect((await session.call("DELETE", `/api/fuel-records/${id}`, { actor: "secretary" })).status).toBeLessThan(300);
    const lines = await linesOfFuel(id);
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.requestKey).sort()).toEqual([`fuel:${id}`, `fuel:${id}:reverse`, `fuel:${id}:source`, `fuel:${id}:source:reverse`]);
    expect(net(lines, cardId)).toBe(0);
    expect(net(lines, bankId)).toBe(0);
    const reversed = lines.filter((l) => l.requestKey!.endsWith(":reverse"));
    expect(reversed[0].transferGroup).toBeTruthy();
    expect(reversed[0].transferGroup).toBe(reversed[1].transferGroup);
    expect(reversed.every((l) => l.createdBy === session.userId("secretary"))).toBe(true);
    // Seconde suppression : la ligne est déjà supprimée, aucune ligne de plus.
    await session.call("DELETE", `/api/fuel-records/${id}`, { actor: "secretary" });
    expect(await linesOfFuel(id)).toHaveLength(4);

    const vehicle = await createTestVehicle();
    session.ids.vehicleIds.push(vehicle.id);
    const plein = await session.call("POST", "/api/fuel-card/consumption", {
      actor: "admin",
      body: { vehicleId: vehicle.id, quantity: 5, unitPrice: 800, date: DATE, stationName: uniqueTestToken("T2rev"), destination: "Douala" },
    });
    expect(plein.status).toBe(201);
    const pleinId = plein.body.consumption.id as number;
    fuelIds.push(pleinId);
    expect((await session.call("DELETE", `/api/fuel-records/${pleinId}`, { actor: "admin" })).status).toBeLessThan(300);
    const pleinLines = await linesOfFuel(pleinId);
    expect(pleinLines).toHaveLength(2);
    expect(net(pleinLines, cardId)).toBe(0);
    expect(pleinLines.find((l) => l.requestKey === `fuel:${pleinId}:reverse`)).toMatchObject({ direction: "in", vehicleId: vehicle.id });
  });

  it("drapeau finance coupé : recharge sans écriture ; avec compte source, refus 409 sans plein", async () => {
    const { res } = await withFinanceOff(() => recharge());
    expect(res.status).toBe(201);
    expect(await linesOfFuel(res.body.recharge.id)).toHaveLength(0);
    const refused = await withFinanceOff(() => recharge({ sourceAccountId: bankId }));
    expect(refused.res.status).toBe(409);
    expect(await fuelByOrder(refused.orderNumber)).toHaveLength(0);
  });

  it("logistique : lit le seul compte carte (liste filtrée, autres comptes 403), ne saisit rien", async () => {
    const list = await session.call("GET", `${TREASURY_BASE_PATH}/accounts`, { actor: "logistics" });
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body.every((a: any) => a.kind === "fuel_card")).toBe(true);
    expect((await session.call("GET", `${TREASURY_BASE_PATH}/accounts/${cardId}/entries?month=2037-02`, { actor: "logistics" })).status).toBe(200);
    expect((await session.call("GET", `${TREASURY_BASE_PATH}/accounts/${bankId}/entries?month=2037-02`, { actor: "logistics" })).status).toBe(403);
    expect((await session.call("GET", `${TREASURY_BASE_PATH}/accounts/${bankId}/entries?month=2037-02&format=csv`, { actor: "logistics" })).status).toBe(403);
    // Compte absent : même 403 qu'un compte banque, rien à sonder.
    expect((await session.call("GET", `${TREASURY_BASE_PATH}/accounts/2147483000/entries`, { actor: "logistics" })).status).toBe(403);
    expect((await session.call("GET", `${TREASURY_BASE_PATH}/accounts/2147483000/entries`, { actor: "management" })).status).toBe(404);
    const entry = { accountId: cardId, entryDate: DATE, label: "x", direction: "in", amount: "1" };
    expect((await session.call("POST", `${TREASURY_BASE_PATH}/entries`, { actor: "logistics", body: entry })).status).toBe(403);
    // La direction garde la lecture de tous les comptes.
    const all = await session.call("GET", `${TREASURY_BASE_PATH}/accounts`, { actor: "management" });
    expect(all.body.some((a: any) => a.id === bankId)).toBe(true);
    for (const actor of ["technician", "workshop_manager"] as const) {
      expect((await session.call("GET", `${TREASURY_BASE_PATH}/accounts`, { actor })).status, actor).toBe(403);
      expect((await session.call("GET", `${TREASURY_BASE_PATH}/accounts/${cardId}/entries`, { actor })).status, actor).toBe(403);
    }
  });
});

describe("T3 : règlement fournisseur au journal de trésorerie", { timeout: 120000 }, () => {
  it("règlement avec compte : sortie liée ; rejeu = même règlement, aucune seconde ligne", async () => {
    const invoice = await approvedInvoice();
    const first = await postSettlement(invoice.id, { treasuryAccountId: String(bankId) });
    expect(first.status).toBe(201);
    const id = first.body.settlement.id;
    expect(first.body.settlement.treasuryAccountId).toBe(bankId);
    const lines = await linesOfSettlement(id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      accountId: bankId,
      direction: "out",
      amount: "1000.00",
      category: "reglement_fournisseur",
      supplierId: invoice.supplierId,
      pieceRef: first.reference,
      requestKey: `settlement:${id}`,
    });

    const again = await postSettlement(invoice.id, { treasuryAccountId: String(bankId) }, first.reference);
    expect(again.status).toBe(200);
    expect(again.body.settlement.id).toBe(id);
    expect(await linesOfSettlement(id)).toHaveLength(1);
  });

  it("rejet : contre-passation (entrée du même montant), net nul, jamais de suppression", async () => {
    const invoice = await approvedInvoice();
    const recorded = await postSettlement(invoice.id, { treasuryAccountId: String(bankId) });
    const id = recorded.body.settlement.id;
    const path = `/api/supplier-invoices/${invoice.id}/settlements/${id}/reject`;
    expect((await session.call("PATCH", path, { actor: "secretary", body: { reason: "Virement retourné" } })).status).toBe(200);
    expect((await session.call("PATCH", path, { actor: "secretary", body: { reason: "Double clic" } })).status).toBe(200);
    const lines = await linesOfSettlement(id);
    expect(lines.map((l) => l.direction).sort()).toEqual(["in", "out"]);
    expect(lines.every((l) => l.amount === "1000.00" && l.accountId === bankId)).toBe(true);
    expect(lines.find((l) => l.direction === "in")!.requestKey).toBe(`settlement:${id}:reject`);
  });

  it("sans compte : aucune écriture (champ texte seul, comme avant)", async () => {
    const invoice = await approvedInvoice();
    const res = await postSettlement(invoice.id, { treasuryAccount: "Banque X" });
    expect(res.status).toBe(201);
    expect(await linesOfSettlement(res.body.settlement.id)).toHaveLength(0);
  });

  it("compte inactif, carte carburant, id hors borne ou drapeau coupé : refus, ni règlement ni écriture", async () => {
    const invoice = await approvedInvoice();
    const inactive = await newAccount("J", "bank");
    await db.update(treasuryAccounts).set({ isActive: false }).where(eq(treasuryAccounts.id, inactive.body.id));
    const cases: [Record<string, string>, number, boolean][] = [
      [{ treasuryAccountId: String(inactive.body.id) }, 409, false],
      [{ treasuryAccountId: String(cardId) }, 400, false],
      [{ treasuryAccountId: "2147483648" }, 400, false],
      [{ treasuryAccountId: String(bankId) }, 409, true],
    ];
    for (const [extra, status, flagOff] of cases) {
      const res = flagOff ? await withFinanceOff(() => postSettlement(invoice.id, extra)) : await postSettlement(invoice.id, extra);
      expect(res.status, JSON.stringify(extra)).toBe(status);
    }
    const rows = await db.select().from(supplierInvoiceSettlements).where(eq(supplierInvoiceSettlements.supplierInvoiceId, invoice.id));
    expect(rows).toHaveLength(0);
  });
});
