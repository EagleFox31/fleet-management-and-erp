import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { normalizeScope, resolveRecipients } from "../../server/lib/realtime-scope";
import { CLIENT_FINANCE_FIELDS, CLIENT_INVOICE_FINANCE_FIELDS } from "../../server/lib/client-public-columns";
import { assignments, clientInvoices, clients, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestClient, createTestClientInvoice, createTestFuelRecord, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Champs finance (lot F1) hors des lectures non finance : la fiche client jointe aux missions,
 * aux factures et à la création de mission depuis un plein ne porte ni taux de retenue, ni
 * retenues, ni net figés. La trame de création de mission ne part plus aux comptes client.
 */
const ACTORS = { admin: "admin", logistics: "logistics", driver: "driver", client: "client" } as const;
type Actor = keyof typeof ACTORS;
const FORBIDDEN_KEYS: readonly string[] = [...CLIENT_FINANCE_FIELDS, ...CLIENT_INVOICE_FINANCE_FIELDS];

const ids = createIdBag();
const driverIds: number[] = [];
const spy = vi.fn();
const previous = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let clientId = 0;
let clientName = "";
let invoiceId = 0;
let fuelRecordId = 0;

/** Chemins des clés finance trouvées, à toute profondeur. */
function financeKeysIn(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => financeKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      FORBIDDEN_KEYS.includes(k) ? [`${path}.${k}`] : financeKeysIn(v, `${path}.${k}`),
    );
  }
  return [];
}

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
  clientName = client.name;
  await db
    .update(clients)
    .set({ withholdingVatRate: "19.25", withholdingIsRate: "2.20", withholdingIsBase: "ttc", withholdingUpdatedBy: session.userIdOf("admin") })
    .where(eq(clients.id, clientId));
  const invoice = await createTestClientInvoice({ clientId, amountHT: "100000.00", vatAmount: "19250.00", amountTTC: "119250.00" });
  ids.clientInvoiceIds.push(invoice.id);
  invoiceId = invoice.id;
  await db
    .update(clientInvoices)
    .set({
      depositedAt: "2026-02-01",
      depositedBy: session.userIdOf("admin"),
      withholdingVatAmount: "19250",
      withholdingIsAmount: "2624",
      netPayable: "97376",
    })
    .where(eq(clientInvoices.id, invoiceId));
  const vehicle = await createTestVehicle({ registrationNumber: uniqueTestToken("cff") });
  ids.vehicleIds.push(vehicle.id);
  const fuel = await createTestFuelRecord({ vehicleId: vehicle.id });
  ids.fuelRecordIds.push(fuel.id);
  fuelRecordId = fuel.id;
  (global as any).broadcastUpdate = spy;
}, 60000);

beforeEach(() => spy.mockClear());

afterAll(async () => {
  (global as any).broadcastUpdate = previous;
  try {
    const own = db.select({ id: missions.id }).from(missions).where(eq(missions.clientId, clientId));
    await db.delete(clientInvoices).where(inArray(clientInvoices.missionId, own));
    await db.delete(assignments).where(inArray(assignments.missionId, own));
    await db.delete(missions).where(eq(missions.clientId, clientId));
    if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

describe("champs finance absents des jointures client hors finance", { timeout: 60000 }, () => {
  let missionId = 0;

  it("création de mission depuis un plein : réponse et trame sans champs finance, trame hors comptes client", async () => {
    const res = await session.call("POST", "/api/operations/missions/from-fuel", {
      actor: "logistics",
      body: { fuelRecordId, clientName },
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(financeKeysIn(res.body)).toEqual([]);
    missionId = res.body.mission?.id ?? res.body.data?.mission?.id;
    expect(missionId).toBeGreaterThan(0);

    const calls = spy.mock.calls.filter(([event]) => event === "mission_created_from_fuel");
    expect(calls.length).toBe(1);
    const [, data] = calls[0];
    expect(financeKeysIn(data.payload)).toEqual([]);
    const index = { byUser: new Map<number, Set<Actor>>(), byRole: new Map<string, Set<Actor>>() };
    (Object.keys(ACTORS) as Actor[]).forEach((actor) => {
      index.byUser.set(session.userIdOf(actor), new Set([actor]));
      index.byRole.set(ACTORS[actor], new Set([...(index.byRole.get(ACTORS[actor]) ?? []), actor]));
    });
    const recipients = [...resolveRecipients(normalizeScope(data.scope, null), index)];
    expect(recipients).not.toContain("client");
    expect(recipients).toEqual(expect.arrayContaining(["admin", "logistics"]));
  });

  it("GET /api/operations/missions : chauffeur affecté et logistique, client joint sans taux", async () => {
    expect(missionId).toBeGreaterThan(0);
    const [profile] = await db
      .insert(drivers)
      .values({ userId: session.userIdOf("driver"), firstName: "TEST", lastName: uniqueTestToken("cff") } as any)
      .returning({ id: drivers.id });
    driverIds.push(profile.id);
    await db.update(assignments).set({ driverId: profile.id }).where(eq(assignments.missionId, missionId));

    for (const actor of ["driver", "logistics"] as const) {
      const res = await session.call("GET", "/api/operations/missions", { actor });
      expect(res.status, actor).toBe(200);
      const list = Array.isArray(res.body) ? res.body : res.body.data ?? res.body.missions;
      const mine = (list as any[]).find((m) => m.id === missionId);
      expect(mine?.client?.id, actor).toBe(clientId);
      expect(financeKeysIn(res.body), actor).toEqual([]);
    }
  });

  it("GET /api/billing/invoices et /:id (logistique) : ni taux du client, ni retenues ni net figés", async () => {
    const list = await session.call("GET", "/api/billing/invoices", { actor: "logistics" });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(String(invoiceId));
    expect(financeKeysIn(list.body)).toEqual([]);
    const one = await session.call("GET", `/api/billing/invoices/${invoiceId}`, { actor: "logistics" });
    expect(one.status).toBe(200);
    expect(financeKeysIn(one.body)).toEqual([]);
  });

  it("témoin : les champs sont bien en base (le filtrage n'est pas un effet de données vides)", async () => {
    const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
    expect(row.netPayable).not.toBeNull();
    const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(c.withholdingIsBase).toBe("ttc");
  });
});
