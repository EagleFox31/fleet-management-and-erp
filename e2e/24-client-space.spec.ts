import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { like } from "drizzle-orm";
import { db } from "../server/db";
import { vehicleAcquisitionWorkflows } from "../shared/schema";
import { loginAs, loginWithSession } from "./helpers/auth";
import { recetteAccount, requireRecettePassword, vehiclesOwnedBy, type RecetteAccount } from "./helpers/recette-accounts";

/**
 * Profil client, niveau E (AGENTS.md §11, cloison entre clients).
 *
 * Un client ne voit que ses véhicules (`vehicles.ownerId`) et les sessions d'acquisition qu'il a créées.
 * Ouvrir le véhicule d'un autre client est refusé (403), et il ne fait aucune saisie d'exploitation,
 * même sur son propre véhicule. Le contrat de référence est
 * tests/contract/vehicle-documents-client-scope.contract.test.ts : ici, on joue le parcours
 * dans le navigateur, avec deux comptes clients de la base de recette.
 *
 * Données : comptes recette_client_1 et recette_client_2 avec leurs véhicules RCT-*
 * (scripts/recette-seed.ts). Seules les sessions d'acquisition préfixées E2E-CLI- sont
 * créées ici, et elles sont supprimées en fin de spec.
 */

const PREFIX = "E2E-CLI-";
let clientA: RecetteAccount;
let clientB: RecetteAccount;
let vehiclesA: { id: number; registrationNumber: string }[];
let vehiclesB: { id: number; registrationNumber: string }[];

requireRecettePassword("client");

async function purge(): Promise<void> {
  await db.delete(vehicleAcquisitionWorkflows).where(like(vehicleAcquisitionWorkflows.sessionId, `${PREFIX}%`));
}

async function expectForbidden(response: APIResponse, what: string): Promise<void> {
  expect(response.status(), what).toBe(403);
  const body = await response.json();
  expect(body.code, what).toBe("FORBIDDEN");
  expect(body.requestId, what).toBe(response.headers()["x-request-id"]);
}

async function ownerIdsOf(page: Page, path: string): Promise<number[]> {
  const response = await page.request.get(path);
  expect(response.status(), path).toBe(200);
  const body = await response.json();
  const list: { ownerId: number | null }[] = Array.isArray(body) ? body : body.vehicles;
  return list.map((vehicle) => vehicle.ownerId ?? -1);
}

test.describe.configure({ mode: "serial" });

test.describe("Profil client : cloison et lecture seule", () => {
  test.beforeAll(async () => {
    await purge();
    clientA = await recetteAccount(process.env.E2E_CLIENT_A_USERNAME || "recette_client_1", "client", "client A");
    clientB = await recetteAccount(process.env.E2E_CLIENT_B_USERNAME || "recette_client_2", "client", "client B");
    vehiclesA = await vehiclesOwnedBy(clientA.id);
    vehiclesB = await vehiclesOwnedBy(clientB.id);
    expect(vehiclesA.length, "le client A doit posséder au moins un véhicule (seed de recette)").toBeGreaterThan(0);
    expect(vehiclesB.length, "le client B doit posséder au moins un véhicule (seed de recette)").toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    await purge();
  });

  test("connexion : tableau de bord client, sans les KPI de la direction", async ({ page }) => {
    const identity = await loginAs(page, clientA);
    expect(identity?.role, "connexion du client A").toBe("client");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("client-kpi-vehicles")).toBeVisible({ timeout: 30_000 });
    // Les tuiles KPI sont réservées à la direction et à l'admin : rien rendu, rien appelé.
    await expect(page.getByTestId("kpi-tiles")).toHaveCount(0);
    await expectForbidden(await page.request.get("/api/kpi/incidents-per-month"), "KPI direction lu par un client");
  });

  test("liste des véhicules : les siens seulement, sans bouton d'ajout", async ({ page }) => {
    await loginWithSession(page, clientA);

    for (const path of ["/api/vehicles", "/api/vehicles/all", "/api/vehicles/all-with-status"]) {
      const owners = await ownerIdsOf(page, path);
      expect(owners.length, `${path} : au moins un véhicule`).toBeGreaterThan(0);
      expect(new Set(owners), `${path} : uniquement les véhicules du client A`).toEqual(new Set([clientA.id]));
    }

    await page.goto("/vehicles", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(vehiclesA[0].registrationNumber).first()).toBeVisible({ timeout: 30_000 });
    for (const other of vehiclesB) {
      await expect(page.getByText(other.registrationNumber, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: "Ajouter un véhicule" })).toHaveCount(0);
  });

  test("véhicule d'un autre client : 403, rien n'est affiché de lui", async ({ page }) => {
    await loginWithSession(page, clientA);
    const foreign = vehiclesB[0];

    await expectForbidden(await page.request.get(`/api/vehicles/${foreign.id}/documents`), "documents du véhicule de B");

    const detail = await page.request.get(`/api/vehicles/${foreign.id}`);
    expect(detail.status(), "détail du véhicule de B").toBe(403);
    expect(await detail.text(), "aucun champ du véhicule de B").not.toContain(foreign.registrationNumber);

    await page.goto(`/vehicles/${foreign.id}`, { waitUntil: "domcontentloaded" });
    // Première ouverture de la fiche : Vite la compile à froid en dev, d'où le délai large.
    await expect(page.getByRole("heading", { name: "Véhicule non trouvé" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(foreign.registrationNumber)).toHaveCount(0);

    // Son propre véhicule s'ouvre normalement.
    const own = vehiclesA[0];
    expect((await page.request.get(`/api/vehicles/${own.id}`)).status(), "détail de son propre véhicule").toBe(200);
    await page.goto(`/vehicles/${own.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(own.registrationNumber).first()).toBeVisible();
  });

  test("aucune saisie d'exploitation, même sur son véhicule", async ({ page }) => {
    await loginWithSession(page, clientA);
    const own = vehiclesA[0];

    await expectForbidden(
      await page.request.put(`/api/vehicles/${own.id}/mileage`, { data: { mileage: 999_999 } }),
      "kilométrage de son véhicule",
    );
    await expectForbidden(
      await page.request.put(`/api/vehicles/${own.id}/maintenance-position`, { data: { position: "garage" } }),
      "position de maintenance de son véhicule",
    );
    await expectForbidden(
      await page.request.post("/api/work-orders", { data: { vehicleId: own.id, title: `${PREFIX}OT`, type: "corrective" } }),
      "création d'un OT",
    );
    await expectForbidden(
      await page.request.post("/api/fuel-records", { data: { vehicleId: own.id, liters: 10, cost: 1000 } }),
      "saisie carburant",
    );

    // Le kilométrage n'a pas bougé.
    const after = await (await page.request.get(`/api/vehicles/${own.id}`)).json();
    expect(after.mileage, "kilométrage inchangé").not.toBe(999_999);
  });

  test("sessions d'acquisition : le client B ne lit ni ne modifie celle du client A", async ({ browser }) => {
    const sessionId = `${PREFIX}${Date.now().toString(36)}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await loginWithSession(pageA, clientA);
      await loginWithSession(pageB, clientB);

      const created = await pageA.request.post("/api/workflows/vehicle-acquisition", {
        data: { sessionId, currentStep: 1, workflowData: { registrationNumber: `${PREFIX}SECRET` } },
      });
      expect(created.status(), "création de la session par A").toBe(200);

      const ownRead = await pageA.request.get(`/api/workflows/vehicle-acquisition/${sessionId}`);
      expect(ownRead.status()).toBe(200);
      expect(await ownRead.text(), "A relit sa session").toContain(`${PREFIX}SECRET`);

      const foreignRead = await pageB.request.get(`/api/workflows/vehicle-acquisition/${sessionId}`);
      expect(await foreignRead.text(), "B ne lit rien de la session de A").not.toContain(`${PREFIX}SECRET`);

      const foreignPatch = await pageB.request.patch(`/api/workflows/vehicle-acquisition/${sessionId}`, {
        data: { currentStep: 3 },
      });
      expect(foreignPatch.status(), "B ne modifie pas la session de A").toBe(404);

      // La liste est filtrée sur le propriétaire (ownerScopeOf) : B reçoit une liste vide, pas les pièces de A.
      const foreignDocuments = await pageB.request.get(`/api/workflows/${sessionId}/documents`);
      expect(foreignDocuments.status(), "documents de la session de A lus par B").toBe(200);
      expect(await foreignDocuments.json(), "aucun document de A pour B").toEqual([]);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
