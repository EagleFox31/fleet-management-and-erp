import { createServer, type Server } from "http";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { isCheckViolation, moneyLockMessageOf, pgConstraintOf } from "../../server/lib/pg-errors";
import { clientInvoices, clientPayments, missions } from "../../shared/schema";
import { INVOICES_AWAITING_PAYMENT_PATH } from "../../shared/contracts/invoices-awaiting-payment";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { cleanupPodFiles, seedPodFile } from "../support/pod";
import { deleteClientInvoicesWhere } from "../support/money-override";

/**
 * Niveau C, lot V1 PR4 : le trigger `client_invoices_issued_locked` laisse passer le cycle de facturation réel.
 * Facture générée depuis une mission livrée, paiement partiel, dépôt (rejeu identique 200, autre date refusée en base),
 * solde, puis paiement de trop refusé ; pendant tout le cycle, montant et suppression restent refusés en base.
 * Écrit en base ; tout est supprimé (factures par le helper de levée, paiements en cascade).
 */
// Le dépôt vit sous le drapeau finance.
process.env.FEATURE_FLAGS = "finance=on";

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const missionIds: number[] = [];

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const pay = (invoiceId: number, amount: number) =>
  call("POST", `/api/billing/invoices/${invoiceId}/payments`, {
    amount,
    paymentDate: "2026-10-29",
    paymentMethod: "cash",
    reference: uniqueTestToken("pay"),
  });

const deposit = (invoiceId: number, depositedAt: string) =>
  call("PATCH", `${INVOICES_AWAITING_PAYMENT_PATH}/${invoiceId}/deposit`, { depositedAt });

async function rowOf(invoiceId: number) {
  const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
  return row;
}

/** Écriture directe hors service : le trigger doit la refuser en check_violation sur la contrainte nommée. */
async function expectLocked(statement: ReturnType<typeof sql>) {
  let caught: unknown;
  try {
    await db.execute(statement);
  } catch (error) {
    caught = error;
  }
  expect(caught, "écriture acceptée alors qu'elle devait être refusée").toBeDefined();
  expect(isCheckViolation(caught)).toBe(true);
  expect(pgConstraintOf(caught)).toBe("client_invoices_issued_locked");
  // Ce que la route renverrait en 409 : message métier, sans détail technique.
  expect(moneyLockMessageOf(caught)).toMatch(/^Cette facture est émise/);
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const user = await createTestUser({ role: "secretary" });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  await cleanupPodFiles(missionIds);
  if (missionIds.length > 0) {
    await deleteClientInvoicesWhere(inArray(clientInvoices.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Factures émises verrouillées : le cycle de facturation passe", { timeout: 120000 }, () => {
  it("génération, paiement partiel, dépôt une fois, solde ; montant et suppression refusés tout du long", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const [mission] = await db
      .insert(missions)
      .values({
        orderNumber: uniqueTestToken("mis"),
        clientId: client.id,
        pickupAddress: "Douala",
        deliveryAddress: "Yaoundé",
        status: "delivered",
      })
      .returning();
    missionIds.push(mission.id);
    await seedPodFile(mission.id, ids.userIds[0]);

    const generated = await call("POST", "/api/billing/invoices/generate", {
      missionId: mission.id,
      amount: 100000,
      dueDate: "2099-12-31",
    });
    expect(generated.status).toBe(200);
    const [created] = await db.select().from(clientInvoices).where(eq(clientInvoices.missionId, mission.id));
    expect(created).toMatchObject({ status: "pending", amountTTC: "119250.00", balance: "119250.00" });
    const id = created.id;
    await expectLocked(sql`UPDATE client_invoices SET amount_ttc = 1 WHERE id = ${id}`);

    expect((await pay(id, 19250)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: "partial", balance: "100000.00" });

    // La facture générée est datée du jour : le dépôt ne peut être ni avant ni dans le futur.
    const day = created.invoiceDate;
    const first = await deposit(id, day);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ depositedAt: day });
    expect((await deposit(id, day)).status).toBe(200);
    expect((await rowOf(id)).depositedAt).toBe(day);
    // Un second dépôt à une autre date : refusé par la base même hors service (409 de la route : finance-receivables).
    await expectLocked(sql`UPDATE client_invoices SET deposited_at = '2026-03-01' WHERE id = ${id}`);

    expect((await pay(id, 100000)).status).toBe(200);
    const paid = await rowOf(id);
    expect(paid).toMatchObject({ status: "paid", depositedAt: day, amountTTC: "119250.00" });
    expect(Number(paid.balance)).toBe(0);
    expect((await pay(id, 1)).status).toBe(409);
    expect(await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, id))).toHaveLength(2);

    await expectLocked(sql`DELETE FROM client_invoices WHERE id = ${id}`);
    expect(await rowOf(id)).toBeDefined();
  });
});
