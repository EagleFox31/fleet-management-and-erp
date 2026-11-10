import fs from "fs";
import path from "path";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { UNSUPPORTED_CONTENT_TYPE_MESSAGE } from "../../server/middleware/require-json-content-type";
import { activityLogs, clientPayments, fuelRecords, incidents, parts, partsStockMovements, vehicleDocuments, workOrders } from "../../shared/schema";
import { apiErrorProblems, leakText } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestClient, createTestClientInvoice, createTestPart, createTestVehicle } from "../support/factories";
import { deleteFuelRecordsWhere } from "../support/money-override";

/**
 * Anti-CSRF (cookie de session SameSite=None, aucun jeton) : un formulaire hébergé sur un autre site
 * POSTe en urlencoded, multipart ou text/plain sans préflight CORS, cookies de la victime joints.
 * Toute écriture /api doit donc être refusée en 415 si ce n'est ni du JSON ni du multipart, AVANT
 * tout effet : le compte de lignes ne bouge pas.
 *
 * Les trois routes ci-dessous écriraient bel et bien avec un corps urlencoded (schémas à coercition) :
 * c'est ce que la version sans garde faisait.
 */

const ACTORS = { admin: "admin", boss: "workshop_manager", secretary: "secretary" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let vehicleId = 0;
let partId = 0;
const vehicleDir = () => path.join("./uploads/documents", `vehicle-${vehicleId}`);
const filesOnDisk = () => (fs.existsSync(vehicleDir()) ? fs.readdirSync(vehicleDir()).filter((f) => f !== ".gitkeep") : []);

const FORM = "application/x-www-form-urlencoded";

async function footprint() {
  const [breakdowns] = await db.select({ n: sql<number>`count(*)::int` }).from(incidents).where(eq(incidents.vehicleId, vehicleId));
  const [fuel] = await db.select({ n: sql<number>`count(*)::int` }).from(fuelRecords).where(eq(fuelRecords.vehicleId, vehicleId));
  const [part] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  const [moves] = await db.select({ n: sql<number>`count(*)::int` }).from(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  return { incidents: breakdowns.n, fuelRecords: fuel.n, quantity: part.quantity, movements: moves.n };
}

type Target = { name: string; path: () => string; fields: () => Record<string, string> };
const TARGETS: Target[] = [
  {
    name: "POST /api/driver/breakdowns",
    path: () => "/api/driver/breakdowns",
    fields: () => ({ vehicleId: String(vehicleId), description: "TEST panne forgee", severity: "high" }),
  },
  {
    name: "POST /api/parts/:id/update-stock",
    path: () => `/api/parts/${partId}/update-stock`,
    fields: () => ({ adjustment: "5", reason: "TEST ajustement forge" }),
  },
  {
    name: "POST /api/fuel-records",
    path: () => "/api/fuel-records",
    fields: () => ({ vehicleId: String(vehicleId), date: "2026-01-01", quantity: "10", cost: "10", mileage: "1000" }),
  },
];

async function raw(target: Target, contentType: string | undefined, body: string | undefined, actor: Actor = "admin") {
  const res = await fetch(session.baseUrl + target.path(), {
    method: "POST",
    headers: { Cookie: session.cookies.get(actor)!, ...(contentType ? { "Content-Type": contentType } : {}) },
    body,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

const urlencoded = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const vehicle = await createTestVehicle();
  vehicleId = vehicle.id;
  ids.vehicleIds.push(vehicle.id);
  const part = await createTestPart({ quantity: 10 });
  partId = part.id;
  ids.partIds.push(part.id);
}, 120000);

afterAll(async () => {
  await db.delete(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
  await deleteFuelRecordsWhere(eq(fuelRecords.vehicleId, vehicleId));
  await db.delete(incidents).where(eq(incidents.vehicleId, vehicleId));
  await db.delete(workOrders).where(eq(workOrders.vehicleId, vehicleId));
  await db.delete(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  for (const f of filesOnDisk()) fs.rmSync(path.join(vehicleDir(), f), { recursive: true, force: true });
  if (fs.existsSync(vehicleDir()) && fs.readdirSync(vehicleDir()).length === 0) fs.rmdirSync(vehicleDir());
  if (ids.userIds.length) await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  await cleanupCreated(ids);
  await session.close();
});

describe("écritures /api hors JSON : refus 415 avant tout effet", { timeout: 120000 }, () => {
  for (const target of TARGETS) {
    it(`${target.name} : urlencoded, text/plain et POST sans type donnent 415, rien n'est écrit`, async () => {
      const before = await footprint();
      const form = urlencoded(target.fields());
      const attempts: [string, string | undefined, string | undefined][] = [
        ["urlencoded", FORM, form],
        ["urlencoded + charset", `${FORM}; charset=UTF-8`, form],
        ["urlencoded en majuscules", "APPLICATION/X-WWW-FORM-URLENCODED", form],
        ["text/plain", "text/plain", form],
        ["text/plain + charset", "text/plain;charset=UTF-8", JSON.stringify(target.fields())],
        ["sans type ni corps", undefined, undefined],
        ["urlencoded vide", FORM, ""],
      ];
      for (const [label, type, body] of attempts) {
        const res = await raw(target, type, body);
        expect(apiErrorProblems(res.status, res.json ?? res.text, 415), label).toEqual([]);
        expect((res.json as { message?: string }).message, label).toBe(UNSUPPORTED_CONTENT_TYPE_MESSAGE);
        expect(res.headers.get("content-type"), label).toMatch(/^application\/json/);
        expect(leakText(res.json), label).not.toMatch(/urlencoded|multer|body-parser|express/i);
      }
      expect(await footprint()).toEqual(before);
    });
  }

  it("refuse un corps text/plain sur PATCH, PUT et DELETE, et laisse passer un DELETE sans corps", async () => {
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const res = await fetch(`${session.baseUrl}/api/parts/${partId}`, {
        method,
        headers: { Cookie: session.cookies.get("admin")!, "Content-Type": "text/plain" },
        body: "name=forge",
      });
      expect(res.status, method).toBe(415);
    }
    const [part] = await db.select({ name: parts.name }).from(parts).where(eq(parts.id, partId));
    expect(part.name).not.toBe("forge");
    // Sans corps, ces méthodes déclenchent un préflight cross-site : le garde ne s'en mêle pas.
    const bodyless = await fetch(`${session.baseUrl}/api/parts/999999999`, {
      method: "DELETE",
      headers: { Cookie: session.cookies.get("admin")!, "Content-Length": "0" },
    });
    expect(bodyless.status).not.toBe(415);
  });

  it("les lectures ne sont pas concernées (GET sans type)", async () => {
    const res = await fetch(`${session.baseUrl}/api/parts/${partId}`, { headers: { Cookie: session.cookies.get("admin")! } });
    expect(res.status).not.toBe(415);
  });
});

describe("route d'argent de facturation : paiement client en urlencoded", { timeout: 120000 }, () => {
  it("POST /api/billing/invoices/:id/payments : 415, aucun paiement écrit, solde intact", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const invoice = await createTestClientInvoice({ clientId: client.id });
    ids.clientInvoiceIds.push(invoice.id);
    const form = new URLSearchParams({ amount: "1000", paymentDate: "2026-10-29", paymentMethod: "cash" }).toString();
    for (const [type, body] of [[FORM, form], ["text/plain", form], [undefined, undefined]] as const) {
      const res = await fetch(`${session.baseUrl}/api/billing/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { Cookie: session.cookies.get("secretary")!, ...(type ? { "Content-Type": type } : {}) },
        body,
      });
      const json = await res.json();
      expect(apiErrorProblems(res.status, json, 415), String(type)).toEqual([]);
      expect(json.message).toBe(UNSUPPORTED_CONTENT_TYPE_MESSAGE);
    }
    const payments = await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, invoice.id));
    expect(payments).toHaveLength(0);
    const ok = await session.call("POST", `/api/billing/invoices/${invoice.id}/payments`, {
      actor: "secretary",
      body: { amount: 1000, paymentDate: "2026-10-29", paymentMethod: "cash" },
    });
    expect(ok.status, leakText(ok.body)).toBe(200);
  });
});

describe("JSON et multipart passent toujours", { timeout: 120000 }, () => {
  it("JSON (casse et charset variés) : les trois routes écrivent", async () => {
    const before = await footprint();
    let quantity = before.quantity;
    for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON"]) {
      const stock = await raw(TARGETS[1], type, JSON.stringify({ adjustment: 1, reason: "TEST json" }));
      expect(stock.status, type).toBe(200);
      quantity += 1;
    }
    const fuel = await raw(
      TARGETS[2],
      "application/json",
      JSON.stringify({ vehicleId, date: "2026-01-02", quantity: 10, cost: 10, mileage: 1000 }),
    );
    expect(fuel.status, leakText(fuel.json)).toBe(201);
    const breakdown = await raw(
      TARGETS[0],
      "application/json",
      JSON.stringify({ vehicleId, description: "TEST panne json", severity: "high" }),
    );
    expect(breakdown.status, leakText(breakdown.json)).toBe(201);
    const after = await footprint();
    expect(after.quantity).toBe(quantity);
    expect(after.fuelRecords).toBe(before.fuelRecords + 1);
    expect(after.incidents).toBe(before.incidents + 1);
  });

  it("multipart/form-data : l'upload d'un document de véhicule passe (route réelle)", async () => {
    const form = new FormData();
    form.append("name", "TEST carte grise");
    form.append("type", "carte_grise");
    form.append("document", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "doc-test.pdf");
    const res = await fetch(`${session.baseUrl}/api/vehicles/${vehicleId}/documents`, {
      method: "POST",
      headers: { Cookie: session.cookies.get("boss")! },
      body: form,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const rows = await db.select({ id: vehicleDocuments.id }).from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(rows).toHaveLength(1);
  });
});
