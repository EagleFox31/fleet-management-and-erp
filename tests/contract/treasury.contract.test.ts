import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerOf, TREASURY_BASE_PATH } from "../../shared/contracts/treasury";
import { db } from "../../server/db";
import { treasuryAccounts, treasuryEntries } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Lot T1 : journal de tresorerie (droits par role, solde courant, virement, rejeu). */
process.env.FEATURE_FLAGS = "finance=on";

const ids = createIdBag();
const cookies = new Map<string, string>();
const accountIds: number[] = [];
const suffix = Date.now().toString(36).toUpperCase();
let server: Server;
let baseUrl = "";

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
}
async function call(method: string, path: string, role?: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(role ? { Cookie: cookies.get(role)! } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* corps non JSON (export) */
  }
  return { status: res.status, body: json, text, headers: res.headers };
}
async function newAccount(tag: string, extra: Record<string, unknown> = {}) {
  const res = await call("POST", `${TREASURY_BASE_PATH}/accounts`, "secretary", {
    code: `T1${suffix}${tag}`,
    label: `Compte ${tag}`,
    kind: "cash",
    openingBalance: "1000.00",
    ...extra,
  });
  expect(res.status).toBe(201);
  accountIds.push(res.body.id);
  return res.body as { id: number; code: string };
}
const entriesPath = (id: number, query = "") => `${TREASURY_BASE_PATH}/accounts/${id}/entries${query}`;

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "secretary", "management", "technician", "client", "logistics"] as const) await login(role);
}, 180000);

afterAll(async () => {
  if (accountIds.length) {
    await db.delete(treasuryEntries).where(inArray(treasuryEntries.accountId, accountIds));
    await db.delete(treasuryAccounts).where(inArray(treasuryAccounts.id, accountIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("journal de tresorerie", { timeout: 120000 }, () => {
  it("sans session 401, hors lecture 403, saisie reservee a admin et secretariat", async () => {
    const list = `${TREASURY_BASE_PATH}/accounts`;
    expect((await call("GET", list)).status).toBe(401);
    for (const role of ["technician", "client"]) expect((await call("GET", list, role)).status, role).toBe(403);
    // Logistique (lot T2) : lecture limitée aux comptes carte carburant.
    const logistics = await call("GET", list, "logistics");
    expect(logistics.status).toBe(200);
    expect(logistics.body.every((a: { kind: string }) => a.kind === "fuel_card")).toBe(true);
    for (const role of ["admin", "secretary", "management"]) expect((await call("GET", list, role)).status, role).toBe(200);
    const body = { code: `T1${suffix}W`, label: "x", kind: "cash" };
    expect((await call("POST", list, "management", body)).status).toBe(403);
    expect((await call("POST", list, "technician", body)).status).toBe(403);
    const entry = { accountId: 1, entryDate: "2026-11-05", label: "x", direction: "in", amount: "1" };
    for (const role of ["management", "technician", "client", "logistics"]) {
      expect((await call("POST", `${TREASURY_BASE_PATH}/entries`, role, entry)).status, role).toBe(403);
      expect((await call("POST", `${TREASURY_BASE_PATH}/transfers`, role, {})).status, role).toBe(403);
    }
  });

  it("compte : creation, code en double 409, validation 400", async () => {
    const acc = await newAccount("A");
    const dup = await call("POST", `${TREASURY_BASE_PATH}/accounts`, "admin", { code: acc.code, label: "bis", kind: "bank" });
    expect(dup.status).toBe(409);
    expect((await call("POST", `${TREASURY_BASE_PATH}/accounts`, "admin", { code: "a b", label: "x", kind: "cash" })).status).toBe(400);
    const list = await call("GET", `${TREASURY_BASE_PATH}/accounts`, "management");
    expect(list.body.find((a: any) => a.id === acc.id)).toMatchObject({ openingBalance: "1000.00", currentBalance: "1000.00" });
  });

  it("solde courant et totaux du mois conformes a la reference, solde d'ouverture du mois = report", async () => {
    const acc = await newAccount("B");
    const post = (entryDate: string, direction: string, amount: string, label: string) =>
      call("POST", `${TREASURY_BASE_PATH}/entries`, "secretary", { accountId: acc.id, entryDate, direction, amount, label });
    expect((await post("2026-10-20", "out", "300.00", "Octobre")).status).toBe(201);
    expect((await post("2026-11-02", "in", "250.50", "Appro")).status).toBe(201);
    expect((await post("2026-11-02", "out", "100.25", "Carburant")).status).toBe(201);
    expect((await post("2026-11-15", "out", "2000.00", "Gros achat")).status).toBe(201);
    expect((await post("2026-12-01", "in", "10.00", "Hors mois")).status).toBe(201);

    const ledger = await call("GET", entriesPath(acc.id, "?month=2026-11"), "management");
    expect(ledger.status).toBe(200);
    const expected = ledgerOf("700.00", [
      { direction: "in", amount: "250.50" },
      { direction: "out", amount: "100.25" },
      { direction: "out", amount: "2000.00" },
    ]);
    expect(ledger.body.openingBalance).toBe("700.00");
    expect(ledger.body.entries.map((e: any) => e.balanceAfter)).toEqual(expected.balances);
    expect(ledger.body.entries.map((e: any) => e.label)).toEqual(["Appro", "Carburant", "Gros achat"]);
    expect(ledger.body.totals).toEqual(expected.totals);
    expect(ledger.body.closingBalance).toBe(expected.closing);

    const after = await call("GET", `${TREASURY_BASE_PATH}/accounts`, "admin");
    expect(after.body.find((a: any) => a.id === acc.id).currentBalance).toBe("-1139.75");
    expect((await call("GET", entriesPath(acc.id, "?month=2026-13"), "admin")).status).toBe(400);
    expect((await call("GET", entriesPath(99999999, "?month=2026-11"), "admin")).status).toBe(404);
    expect((await call("GET", entriesPath(0), "admin")).status).toBe(400);
  });

  it("ecriture : montant invalide 400, compte inconnu 404, compte inactif 409", async () => {
    const acc = await newAccount("C");
    const base = { accountId: acc.id, entryDate: "2026-11-05", label: "x", direction: "in" };
    const path = `${TREASURY_BASE_PATH}/entries`;
    expect((await call("POST", path, "admin", { ...base, amount: "0" })).status).toBe(400);
    expect((await call("POST", path, "admin", { ...base, amount: "1.234" })).status).toBe(400);
    expect((await call("POST", path, "admin", { ...base, accountId: 99999999, amount: "5" })).status).toBe(404);
    await db.update(treasuryAccounts).set({ isActive: false }).where(inArray(treasuryAccounts.id, [acc.id]));
    expect((await call("POST", path, "admin", { ...base, amount: "5" })).status).toBe(409);
  });

  it("rejeu : meme cle et meme contenu = 200 sans doublon, contenu different = 409", async () => {
    const acc = await newAccount("D");
    const path = `${TREASURY_BASE_PATH}/entries`;
    const body = { accountId: acc.id, entryDate: "2026-11-05", label: "Appro", direction: "in", amount: "40", requestKey: `k-${suffix}-1` };
    const first = await call("POST", path, "secretary", body);
    expect(first.status).toBe(201);
    const second = await call("POST", path, "secretary", body);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect((await call("POST", path, "secretary", { ...body, amount: "41" })).status).toBe(409);
    // Tous les champs comptent, pas seulement compte, sens, montant et date.
    expect((await call("POST", path, "secretary", { ...body, label: "Autre libelle" })).status).toBe(409);
    expect((await call("POST", path, "secretary", { ...body, category: "salaire" })).status).toBe(409);
    expect((await call("POST", path, "secretary", { ...body, pieceRef: "P-1" })).status).toBe(409);
    const ledger = await call("GET", entriesPath(acc.id, "?month=2026-11"), "admin");
    expect(ledger.body.entries).toHaveLength(1);
    expect(ledger.body.closingBalance).toBe("1040.00");
  });

  it("cles : une ecriture de cle « K:out » ne bloque pas le virement de cle « K »", async () => {
    const from = await newAccount("K");
    const to = await newAccount("L");
    const key = `c-${suffix}`;
    const entry = { accountId: from.id, entryDate: "2026-11-05", label: "Piege", direction: "out", amount: "1", requestKey: `${key}:out` };
    expect((await call("POST", `${TREASURY_BASE_PATH}/entries`, "secretary", entry)).status).toBe(201);
    const transfer = { fromAccountId: from.id, toAccountId: to.id, entryDate: "2026-11-05", amount: "5", label: "Virement", requestKey: key };
    const res = await call("POST", `${TREASURY_BASE_PATH}/transfers`, "secretary", transfer);
    expect(res.status).toBe(201);
    expect((await call("POST", `${TREASURY_BASE_PATH}/transfers`, "secretary", transfer)).status).toBe(200);
    expect((await call("POST", `${TREASURY_BASE_PATH}/transfers`, "secretary", { ...transfer, label: "Autre" })).status).toBe(409);
    expect((await call("GET", entriesPath(from.id, "?month=2026-11"), "admin")).body.entries).toHaveLength(2);
  });

  it("ids du corps hors borne integer : 400, jamais 500", async () => {
    const acc = await newAccount("M");
    const tooBig = 2147483648;
    const entry = { accountId: tooBig, entryDate: "2026-11-05", label: "x", direction: "in", amount: "1" };
    expect((await call("POST", `${TREASURY_BASE_PATH}/entries`, "admin", entry)).status).toBe(400);
    expect((await call("POST", `${TREASURY_BASE_PATH}/entries`, "admin", { ...entry, accountId: acc.id, vehicleId: tooBig })).status).toBe(400);
    expect((await call("POST", `${TREASURY_BASE_PATH}/entries`, "admin", { ...entry, accountId: "12" })).status).toBe(400);
    const transfer = { fromAccountId: acc.id, toAccountId: tooBig, entryDate: "2026-11-05", amount: "5", label: "x" };
    expect((await call("POST", `${TREASURY_BASE_PATH}/transfers`, "admin", transfer)).status).toBe(400);
  });

  it("virement vers un compte inactif : 409, aucune ligne ecrite", async () => {
    const from = await newAccount("N");
    const to = await newAccount("O");
    await db.update(treasuryAccounts).set({ isActive: false }).where(inArray(treasuryAccounts.id, [to.id]));
    const transfer = { fromAccountId: from.id, toAccountId: to.id, entryDate: "2026-11-05", amount: "5", label: "x" };
    expect((await call("POST", `${TREASURY_BASE_PATH}/transfers`, "secretary", transfer)).status).toBe(409);
    expect((await call("GET", entriesPath(from.id, "?month=2026-11"), "admin")).body.entries).toHaveLength(0);
    expect((await call("GET", entriesPath(to.id, "?month=2026-11"), "admin")).body.entries).toHaveLength(0);
  });

  it("virement : deux lignes liees, soldes justes, neutre sur l'ensemble, rejeu sans doublon", async () => {
    const from = await newAccount("E");
    const to = await newAccount("F", { openingBalance: "50.00" });
    const path = `${TREASURY_BASE_PATH}/transfers`;
    const body = { fromAccountId: from.id, toAccountId: to.id, entryDate: "2026-11-05", amount: "300", label: "Banque vers caisse", requestKey: `t-${suffix}-1` };
    const first = await call("POST", path, "secretary", body);
    expect(first.status).toBe(201);
    expect(first.body.entries).toHaveLength(2);
    const [out, inn] = first.body.entries;
    expect(out).toMatchObject({ accountId: from.id, direction: "out", amount: "300.00", category: "virement_interne" });
    expect(inn).toMatchObject({ accountId: to.id, direction: "in", amount: "300.00", category: "virement_interne" });
    expect(out.transferGroup).toBeTruthy();
    expect(out.transferGroup).toBe(inn.transferGroup);

    const accounts = (await call("GET", `${TREASURY_BASE_PATH}/accounts`, "admin")).body;
    const balance = (id: number) => Number(accounts.find((a: any) => a.id === id).currentBalance);
    expect(balance(from.id)).toBe(700);
    expect(balance(to.id)).toBe(350);

    const replay = await call("POST", path, "secretary", body);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    const ledger = await call("GET", entriesPath(from.id, "?month=2026-11"), "admin");
    expect(ledger.body.entries).toHaveLength(1);

    expect((await call("POST", path, "secretary", { ...body, toAccountId: from.id, requestKey: undefined })).status).toBe(400);
    expect((await call("POST", path, "secretary", { ...body, toAccountId: 99999999, requestKey: undefined })).status).toBe(404);
    const ghost = await call("GET", entriesPath(from.id, "?month=2026-11"), "admin");
    expect(ghost.body.entries).toHaveLength(1);
  });

  it("export CSV : en-tetes, piece jointe, lecture reservee", async () => {
    const acc = await newAccount("G");
    await call("POST", `${TREASURY_BASE_PATH}/entries`, "admin", { accountId: acc.id, entryDate: "2026-11-05", label: "=SOMME(A1)", direction: "out", amount: "12.5" });
    const csv = await call("GET", entriesPath(acc.id, "?month=2026-11&format=csv"), "management");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain(`tresorerie-${acc.code}-2026-11.csv`);
    expect(csv.text).toContain("'=SOMME(A1)");
    expect((await call("GET", entriesPath(acc.id, "?month=2026-11&format=csv"), "technician")).status).toBe(403);
  });

  it("drapeau finance coupe : 404", async () => {
    const before = process.env.FEATURE_FLAGS;
    process.env.FEATURE_FLAGS = "finance=off";
    try {
      expect((await call("GET", `${TREASURY_BASE_PATH}/accounts`, "admin")).status).toBe(404);
      expect((await call("POST", `${TREASURY_BASE_PATH}/entries`, "admin", {})).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = before;
    }
  });
});

