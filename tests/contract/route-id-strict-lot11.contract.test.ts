import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID } from "../../server/lib/route-id";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lot 11 de #360 : un id de filtre lu dans `req.query` passe par `parseQueryId` (`queryIdOrNaN` dans
 * `server/routes.ts`, gelé). `?x=12abc` répondait la liste filtrée sur 12, `?x=abc` ignorait le filtre
 * ou répondait 500 ; désormais 400 avec le message de l'id. Témoin : un id bien formé répond 200.
 * Aucune donnée créée hors du compte admin : le témoin vise un id valide inexistant (liste vide).
 */

const FILTERS: Array<{ path: string; param: string; message: string }> = [
  { path: "/api/billing/invoices", param: "clientId", message: "Identifiant client invalide" },
  { path: "/api/billing/invoices/summary", param: "clientId", message: "Identifiant client invalide" },
  { path: "/api/fuel-card/history", param: "vehicleId", message: "ID de véhicule invalide" },
  { path: "/api/operations/missions", param: "clientId", message: "Identifiant client invalide" },
  { path: "/api/purchase-orders", param: "supplierId", message: "ID fournisseur invalide" },
  { path: "/api/purchase-orders", param: "createdBy", message: "ID d'utilisateur invalide" },
  { path: "/api/supplier-invoices", param: "supplierId", message: "ID fournisseur invalide" },
  { path: "/api/document-renewals/requests", param: "vehicleId", message: "ID de véhicule invalide" },
  { path: "/api/parts/stock-movements", param: "partId", message: "ID de pièce invalide" },
  { path: "/api/fuel-records", param: "vehicleId", message: "ID de véhicule invalide." },
  { path: "/api/fuel-records/consumption-history", param: "vehicleId", message: "ID de véhicule invalide." },
  { path: "/api/tire-inspections", param: "vehicleTireId", message: "ID de pneu véhicule invalide" },
  { path: "/api/tire-rotations", param: "vehicleId", message: "ID de véhicule invalide" },
];

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

async function get(path: string) {
  const response = await fetch(baseUrl + path, { headers: { Cookie: cookie } });
  const json = (await response.json().catch(() => null)) as { message?: string } | null;
  return { status: response.status, message: json && !Array.isArray(json) ? json.message : undefined };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const user = await createTestUser({ role: "admin" });
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
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("ids de filtre stricts (lot 11)", () => {
  for (const { path, param, message } of FILTERS) {
    it(`${path}?${param}=12abc : 400 « ${message} »`, async () => {
      expect(await get(`${path}?${param}=12abc`)).toEqual({ status: 400, message });
    });

    it(`${path}?${param} hors int4 : 400`, async () => {
      expect((await get(`${path}?${param}=${MAX_DB_INTEGER_ID + 1}`)).status).toBe(400);
    });

    it(`${path}?${param} bien formé : 200 (témoin)`, async () => {
      expect((await get(`${path}?${param}=${MAX_DB_INTEGER_ID}`)).status).toBe(200);
    });
  }
});
