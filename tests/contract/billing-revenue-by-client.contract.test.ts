import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { currentMonthPeriod } from "../../server/services/client-revenue-service";
import { clientInvoices } from "../../shared/schema";
import { CLIENT_BILLING_STATS_ROLES } from "../../shared/constants/roles";
import { leakText } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestClient, createTestClientInvoice, type TestUserRole } from "../support/factories";
import { deleteClientInvoicesWhere } from "../support/money-override";

/**
 * `GET /api/billing/revenue/by-client` : chiffre d'affaires HT réel par client.
 * Lecteurs = CLIENT_BILLING_STATS_ROLES (admin, secrétaire, logistique, direction) ; tout autre rôle,
 * client compris, reçoit un 403 sans aucun nom de client. Période invalide : 400 lisible.
 */
const ROLES: Record<TestUserRole, TestUserRole> = {
  admin: "admin", secretary: "secretary", logistics: "logistics", management: "management",
  workshop_manager: "workshop_manager", technician: "technician", warehouse: "warehouse",
  driver: "driver", client: "client", user: "user",
};
const ALL = Object.keys(ROLES) as TestUserRole[];
const READERS = ALL.filter((role) => (CLIENT_BILLING_STATS_ROLES as readonly string[]).includes(role));
const OTHERS = ALL.filter((role) => !READERS.includes(role));
const PATH = "/api/billing/revenue/by-client";
const PERIOD = "from=2048-05-01&to=2048-05-31";

let session: Awaited<ReturnType<typeof startContractSession<TestUserRole>>>;
let clientName = "";
const invoiceIds: number[] = [];

beforeAll(async () => {
  session = await startContractSession(ROLES);
  const client = await createTestClient();
  session.ids.clientIds.push(client.id);
  clientName = client.name;
  const row = await createTestClientInvoice({ clientId: client.id, invoiceDate: "2048-05-10", amountHT: "123456.78" });
  invoiceIds.push(row.id);
}, 180000);

afterAll(async () => {
  if (invoiceIds.length) await deleteClientInvoicesWhere(inArray(clientInvoices.id, invoiceIds));
  await session.stop();
});

describe("CA réel par client : rôles", { timeout: 120000 }, () => {
  it("les quatre lecteurs sont bien admin, secrétaire, logistique, direction", () => {
    expect([...READERS].sort()).toEqual(["admin", "logistics", "management", "secretary"]);
  });

  it.each(READERS)("%s : 200, CA HT exact en chaîne décimale", async (role) => {
    const res = await session.call("GET", `${PATH}?${PERIOD}`, { actor: role });
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: { clientName: string | null }) => r.clientName === clientName);
    expect(row).toMatchObject({ invoiceCount: 1, revenueHt: "123456.78", negativeInvoiceCount: 0 });
    expect(res.body).toMatchObject({ from: "2048-05-01", to: "2048-05-31" });
  });

  it.each(OTHERS)("%s : 403, aucun nom de client dans la réponse", async (role) => {
    const res = await session.call("GET", `${PATH}?${PERIOD}`, { actor: role });
    expect(res.status).toBe(403);
    expect(leakText(res.body)).not.toContain(clientName);
  });

  it("anonyme : 401", async () => {
    expect((await session.call("GET", `${PATH}?${PERIOD}`, { actor: null })).status).toBe(401);
  });
});

describe("CA réel par client : période", { timeout: 120000 }, () => {
  it("sans période : le mois en cours à Douala", async () => {
    const res = await session.call("GET", PATH, { actor: "secretary" });
    expect(res.status).toBe(200);
    expect({ from: res.body.from, to: res.body.to }).toEqual(currentMonthPeriod());
  });

  it.each([
    ["from après to", "from=2048-05-31&to=2048-05-01", /précéder/],
    ["date inexistante", "from=2048-02-30&to=2048-03-31", /Date de début invalide/],
    ["format libre", "from=2048-05-01&to=demain", /Date de fin invalide/],
    ["plus de 366 jours", "from=2047-01-01&to=2048-05-31", /366 jours/],
    ["une seule borne", "from=2048-05-01", /date de début et la date de fin/],
  ])("%s : 400 lisible, sans détail technique", async (_label, query, message) => {
    const res = await session.call("GET", `${PATH}?${query}`, { actor: "secretary" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
    expect(leakText(res.body)).not.toMatch(/SELECT|stack|at \w+ \(/);
  });

  it("366 jours exactement : accepté", async () => {
    const res = await session.call("GET", `${PATH}?from=2047-06-01&to=2048-05-31`, { actor: "secretary" });
    expect(res.status).toBe(200);
  });
});
