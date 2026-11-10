import { createServer, type Server } from "http";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missionPricePath, missionPriceResponseSchema } from "../../shared/contracts/mission-price";
import { db } from "../../server/db";
import { clientInvoices, missionPriceHistory, missions, tariffGrid } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { waitForBlockedBy } from "../support/lock-wait";
import { deleteClientInvoicesWhere } from "../support/money-override";
import { cleanupPodFiles, seedPodFile } from "../support/pod";

/** O3 lot 3b : correction du prix convenu (rôle x statut, facture, motif, historique, événement sans prix). */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const missionIds: number[] = [];
const origin = uniqueTestToken("orig");
let tariffId = 0;
const events: Array<{ type: string; data: unknown }> = [];

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  return user;
}
async function call(method: string, path: string, role: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookies.get(role)! },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function mission(status: string, extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/missions", "logistics", {
    orderNumber: uniqueTestToken("MIS"),
    pickupAddress: "TEST A",
    deliveryAddress: "TEST B",
    status: "planned",
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  missionIds.push(res.body.id);
  if (status !== "planned") await db.update(missions).set({ status: status as never }).where(eq(missions.id, res.body.id));
  // Une mission livrée se facture : elle porte sa preuve de livraison.
  if (status === "delivered") await seedPodFile(res.body.id, ids.userIds[0]);
  return res.body.id as number;
}
const historyOf = (id: number) => db.select().from(missionPriceHistory).where(eq(missionPriceHistory.missionId, id));
const priceOf = async (id: number) => {
  const [m] = await db.select({ p: missions.agreedPrice, t: missions.tariffGridId }).from(missions).where(eq(missions.id, id));
  return m;
};

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  (global as any).broadcastUpdate = (type: string, data: unknown) => events.push({ type, data });
  const admin = await login("admin");
  for (const r of ["management", "logistics", "secretary", "technician", "client", "driver", "warehouse"] as const) await login(r);
  const [t] = await db
    .insert(tariffGrid)
    .values({ origin, destination: "x", pricingUnit: "ton", unitPrice: "100", validFrom: "2026-01-01", createdBy: admin.id, updatedBy: admin.id })
    .returning();
  tariffId = t.id;
}, 180000);
afterAll(async () => {
  await cleanupPodFiles(missionIds);
  if (missionIds.length > 0) {
    await deleteClientInvoicesWhere(inArray(clientInvoices.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await db.delete(tariffGrid).where(eq(tariffGrid.origin, origin));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("prix convenu : correction", { timeout: 120000 }, () => {
  it("lecture : admin, direction, secrétariat, logistique ; technicien et client 403 ; mission inconnue 404", async () => {
    const id = await mission("planned", { agreedPrice: 5000 });
    for (const role of ["admin", "management", "secretary", "logistics"]) {
      const res = await call("GET", missionPricePath(id), role);
      expect(res.status, role).toBe(200);
      expect(missionPriceResponseSchema.parse(res.body)).toMatchObject({ agreedPrice: 5000, tariffGridId: null, history: [] });
    }
    for (const role of ["technician", "client"]) expect((await call("GET", missionPricePath(id), role)).status, role).toBe(403);
    expect((await call("GET", missionPricePath(99999999), "admin")).status).toBe(404);
  });

  it("avant le départ : la logistique corrige, l'historique garde avant/après, un rejeu identique n'écrit rien", async () => {
    const id = await mission("planned", { agreedPrice: 5000 });
    const put = await call("PUT", missionPricePath(id), "logistics", { agreedPrice: 7000, tariffGridId: tariffId });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(await priceOf(id)).toEqual({ p: "7000", t: tariffId });
    const [row] = await historyOf(id);
    expect(row).toMatchObject({ oldPrice: "5000", newPrice: "7000", oldTariffGridId: null, newTariffGridId: tariffId });
    expect(row.changedBy).not.toBeNull();
    expect(missionPriceResponseSchema.parse(put.body).history).toHaveLength(1);
    expect((await call("PUT", missionPricePath(id), "logistics", { agreedPrice: 7000, tariffGridId: tariffId })).status).toBe(200);
    expect(await historyOf(id)).toHaveLength(1);
    // Saisie manuelle : tarif d'origine omis = lien effacé. Prix null : effacé aussi.
    expect((await call("PUT", missionPricePath(id), "secretary", { agreedPrice: 7500 })).status).toBe(200);
    expect(await priceOf(id)).toEqual({ p: "7500", t: null });
    expect((await call("PUT", missionPricePath(id), "admin", { agreedPrice: null })).status).toBe(200);
    expect(await priceOf(id)).toEqual({ p: null, t: null });
    expect(await historyOf(id)).toHaveLength(3);
  });

  it("corps refusé en 400 sans rien écrire : décimal, négatif, champ inconnu, tarif sans prix, tarif inconnu", async () => {
    const id = await mission("planned", { agreedPrice: 100 });
    for (const bad of [{ agreedPrice: 10.5 }, { agreedPrice: -1 }, { agreedPrice: 1, status: "x" }, { agreedPrice: null, tariffGridId: tariffId }, { agreedPrice: 5, tariffGridId: 2147483000 }]) {
      expect((await call("PUT", missionPricePath(id), "admin", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await priceOf(id)).toEqual({ p: "100", t: null });
    expect(await historyOf(id)).toHaveLength(0);
  });

  it("direction hors admin : refusée avant le départ (403), acceptée après avec motif", async () => {
    const early = await mission("planned", { agreedPrice: 100 });
    expect((await call("PUT", missionPricePath(early), "management", { agreedPrice: 200 })).status).toBe(403);
    const late = await mission("in_progress", { agreedPrice: 100 });
    expect((await call("PUT", missionPricePath(late), "management", { agreedPrice: 200 })).status).toBe(400);
    expect((await call("PUT", missionPricePath(late), "management", { agreedPrice: 200, reason: "abc" })).status).toBe(400);
    expect(await priceOf(late)).toEqual({ p: "100", t: null });
    const ok = await call("PUT", missionPricePath(late), "management", { agreedPrice: 200, reason: "Surcharge convenue par téléphone" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await historyOf(late))[0]).toMatchObject({ reason: "Surcharge convenue par téléphone", oldPrice: "100", newPrice: "200" });
  });

  it("en cours ou livrée : logistique et secrétariat 403 ; terminée ou annulée : 409 même pour l'admin", async () => {
    const live = await mission("delivered", { agreedPrice: 100 });
    for (const role of ["logistics", "secretary"]) expect((await call("PUT", missionPricePath(live), role, { agreedPrice: 1, reason: "motif valable" })).status, role).toBe(403);
    expect((await call("PUT", missionPricePath(live), "admin", { agreedPrice: 150, reason: "motif valable" })).status).toBe(200);
    for (const status of ["completed", "cancelled"]) {
      const id = await mission(status, { agreedPrice: 100 });
      expect((await call("PUT", missionPricePath(id), "admin", { agreedPrice: 1, reason: "motif valable" })).status, status).toBe(409);
      expect(await priceOf(id)).toEqual({ p: "100", t: null });
    }
  });

  it("facture non annulée liée : 409 (avoir), facture annulée : le prix redevient modifiable", async () => {
    const id = await mission("planned", { agreedPrice: 100 });
    const today = new Date().toISOString().slice(0, 10);
    const [invoice] = await db
      .insert(clientInvoices)
      .values({ missionId: id, invoiceNumber: uniqueTestToken("inv-price"), invoiceDate: today, dueDate: today, amountHT: "100", amountTTC: "100", balance: "100" } as any)
      .returning({ id: clientInvoices.id });
    const blocked = await call("PUT", missionPricePath(id), "admin", { agreedPrice: 200 });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain("avoir");
    expect(await priceOf(id)).toEqual({ p: "100", t: null });
    await db.update(clientInvoices).set({ status: "cancelled" }).where(eq(clientInvoices.id, invoice.id));
    expect((await call("PUT", missionPricePath(id), "admin", { agreedPrice: 200 })).status).toBe(200);
  });

  it("le PATCH générique n'écrit jamais le prix ; technicien et client n'atteignent pas la route", async () => {
    const id = await mission("planned", { agreedPrice: 100 });
    const patch = await call("PATCH", `/api/missions/${id}`, "logistics", { specialInstructions: "RAS", agreedPrice: 999, tariffGridId: tariffId });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(await priceOf(id)).toEqual({ p: "100", t: null });
    for (const role of ["technician", "client"]) expect((await call("PUT", missionPricePath(id), role, { agreedPrice: 1 })).status, role).toBe(403);
  });

  it("événements temps réel : jamais de prix ni de tarif dans la trame (création comme correction)", async () => {
    events.length = 0;
    const id = await mission("planned", { agreedPrice: 424242 });
    expect((await call("PUT", missionPricePath(id), "admin", { agreedPrice: 434343 })).status).toBe(200);
    const frames = JSON.stringify(events);
    expect(events.some((e) => (e.data as any)?.payload?.source === "mission_price_edit")).toBe(true);
    expect(frames).not.toContain("424242");
    expect(frames).not.toContain("434343");
    expect(frames).not.toContain("agreedPrice");
  });

  it("brouillon et affectée : même règle qu’avant le départ ; chauffeur et magasinier 403 à tout stade", async () => {
    for (const status of ["draft", "assigned"]) {
      const id = await mission(status, { agreedPrice: 100 });
      expect((await call("PUT", missionPricePath(id), "logistics", { agreedPrice: 120 })).status, status).toBe(200);
      for (const role of ["driver", "warehouse"]) {
        expect((await call("PUT", missionPricePath(id), role, { agreedPrice: 1 })).status, role + " " + status).toBe(403);
        expect((await call("GET", missionPricePath(id), role)).status, role + " GET").toBe(403);
      }
      expect(await priceOf(id)).toEqual({ p: "120", t: null });
    }
  });

  it("admin sur une mission en cours sans motif : 400, rien n’est écrit", async () => {
    const id = await mission("in_progress", { agreedPrice: 100 });
    expect((await call("PUT", missionPricePath(id), "admin", { agreedPrice: 200 })).status).toBe(400);
    expect(await priceOf(id)).toEqual({ p: "100", t: null });
    expect(await historyOf(id)).toHaveLength(0);
  });

  it("génération de facture : attend le verrou de la mission tenu par une correction de prix", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const id = await mission("delivered", { agreedPrice: 100, clientId: client.id });
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: (pid: number) => void;
    const lockTaken = new Promise<number>((r) => (locked = r));
    const holder = db.transaction(async (tx) => {
      await tx.select({ id: missions.id }).from(missions).where(eq(missions.id, id)).for("update");
      const { rows } = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      locked(Number((rows[0] as { pid: number }).pid));
      await held;
    });
    const holderPid = await lockTaken;
    let done = false;
    const gen = call("POST", "/api/billing/invoices/generate", "admin", { missionId: id, amount: 100, dueDate: due, includeVAT: false }).then((r) => {
      done = true;
      return r;
    });
    await waitForBlockedBy(holderPid, "génération de facture");
    expect(done, "la génération doit attendre le verrou").toBe(false);
    release();
    await holder;
    const res = await gen;
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  });

  it("correction de prix et génération de facture lancées ensemble : 409, ou facture émise après la correction", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < 4; i++) {
      const id = await mission("delivered", { agreedPrice: 100, clientId: client.id });
      const [put, gen] = await Promise.all([
        call("PUT", missionPricePath(id), "admin", { agreedPrice: 250, reason: "correction concurrente" }),
        call("POST", "/api/billing/invoices/generate", "admin", { missionId: id, amount: 250, dueDate: due, includeVAT: false }),
      ]);
      expect(gen.status, JSON.stringify(gen.body)).toBeLessThan(300);
      const live = await db.select().from(clientInvoices).where(eq(clientInvoices.missionId, id));
      expect(live).toHaveLength(1);
      if (put.status === 409) {
        expect(await priceOf(id)).toEqual({ p: "100", t: null });
        expect(await historyOf(id)).toHaveLength(0);
      } else {
        expect(put.status, JSON.stringify(put.body)).toBe(200);
        const [h] = await historyOf(id);
        expect(h.newPrice).toBe("250");
        expect(Number(live[0].amountHT)).toBe(Number(h.newPrice));
      }
    }
  });
});
