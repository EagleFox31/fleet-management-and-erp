import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestClient, createTestClientInvoice, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { resolveRecipients, normalizeScope } from "../../server/lib/realtime-scope";

/**
 * Cloison temps réel (AGENTS.md §11, lot 3) : un événement sur le véhicule, la facture ou la
 * fiche d'un client ne part plus en `broadcast`. Deux comptes client A et B, un membre du
 * personnel : l'événement de A atteint le personnel et A, jamais B. Les destinataires sont
 * calculés par `resolveRecipients`, le même module que le serveur WebSocket.
 */
const ACTORS = { admin: "admin", staff: "workshop_manager", driver: "driver", clientA: "client", clientB: "client" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const token = uniqueTestToken("l3bs");
const spy = vi.fn();
const previous = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let vehicleA = 0;

/** Qui reçoit chaque trame émise depuis le dernier `beforeEach`, par acteur. */
function receivers(eventType: string): { actors: Actor[][]; payloads: any[] } {
  const index = { byUser: new Map<number, Set<Actor>>(), byRole: new Map<string, Set<Actor>>() };
  (Object.keys(ACTORS) as Actor[]).forEach((actor) => {
    index.byUser.set(session.userIdOf(actor), new Set([actor]));
    const role = ACTORS[actor];
    index.byRole.set(role, new Set([...(index.byRole.get(role) ?? []), actor]));
  });
  const calls = spy.mock.calls.filter(([event]) => event === eventType);
  return {
    actors: calls.map(([, data]) => [...resolveRecipients(normalizeScope(data.scope, null), index)].sort()),
    payloads: calls.map(([, data]) => data.payload),
  };
}

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  const vehicle = await createTestVehicle({ registrationNumber: `${token}-a`, ownerId: session.userIdOf("clientA") });
  ids.vehicleIds.push(vehicle.id);
  vehicleA = vehicle.id;
  (global as any).broadcastUpdate = spy;
}, 60000);

beforeEach(() => spy.mockClear());

afterAll(async () => {
  (global as any).broadcastUpdate = previous;
  try {
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

describe("portée des événements : ni broadcast, ni client hors périmètre", { timeout: 60000 }, () => {
  it("vehicle_mileage_updated : personnel (fiche complète), chauffeur et propriétaire A (trame réduite), jamais B", async () => {
    const res = await session.call("PUT", `/api/vehicles/${vehicleA}/mileage`, { actor: "staff", body: { kilometers: 5_000_000 } });
    expect(res.status).toBe(200);
    const { actors, payloads } = receivers("vehicle_mileage_updated");
    const flat = actors.flat();
    expect(flat).toEqual(expect.arrayContaining(["admin", "staff", "clientA", "driver"]));
    expect(flat).not.toContain("clientB");
    // La fiche (prix d'achat compris) ne part qu'au personnel hors chauffeur.
    actors.forEach((list, i) => {
      if (list.includes("clientA") || list.includes("driver")) {
        expect(payloads[i].vehicle).toBeUndefined();
        expect(payloads[i].vehicleId).toBe(vehicleA);
      }
    });
  });

  it("vehicle_maintenance_position_updated : jamais B", async () => {
    const res = await session.call("PUT", `/api/vehicles/${vehicleA}/maintenance-position`, { actor: "staff", body: { position: "Zone A" } });
    expect(res.status).toBe(200);
    const flat = receivers("vehicle_maintenance_position_updated").actors.flat();
    expect(flat).toEqual(expect.arrayContaining(["admin", "staff", "clientA"]));
    expect(flat).not.toContain("clientB");
  });

  it("client_created : personnel seul, aucun compte client", async () => {
    const res = await session.call("POST", "/api/clients", { actor: "admin", body: { name: token, email: `${token}@client.test` } });
    expect(res.status).toBe(201);
    ids.clientIds.push(res.body.id);
    const flat = receivers("client_created").actors.flat();
    expect(flat).toEqual(expect.arrayContaining(["admin", "staff", "driver"]));
    expect(flat).not.toContain("clientA");
    expect(flat).not.toContain("clientB");
  });

  it("client_invoice_payment_recorded : rôles de facturation seuls, aucun compte client", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const invoice = await createTestClientInvoice({ clientId: client.id, amountHT: "100.00", vatAmount: "0.00", amountTTC: "100.00" });
    ids.clientInvoiceIds.push(invoice.id);
    const res = await session.call("POST", `/api/billing/invoices/${invoice.id}/payments`, {
      actor: "admin",
      body: { amount: 10, paymentDate: "2026-11-03", paymentMethod: "cash", reference: token },
    });
    expect(res.status).toBe(200);
    const flat = receivers("client_invoice_payment_recorded").actors.flat();
    expect(flat).toContain("admin");
    expect(flat).not.toContain("clientA");
    expect(flat).not.toContain("clientB");
    expect(flat).not.toContain("driver");
  });
});
