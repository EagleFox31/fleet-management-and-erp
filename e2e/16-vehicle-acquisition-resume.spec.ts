import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { db } from "../server/db";
import { vehicleAcquisitionWorkflows, vehicles } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * VEH3 : acquisition d'un véhicule, niveau écran. Le contrat HTTP
 * (`tests/contract/vehicle-acquisition-workflow.contract.test.ts`) fige déjà
 * l'enregistrement, l'appartenance et les statuts ; ici on prouve le parcours :
 * - reprise de l'étape en cours depuis le bandeau « Workflows en cours », puis
 *   après rechargement de la page (l'état vient du serveur, pas du navigateur) ;
 * - téléversement des documents obligatoires, vérifié côté serveur ;
 * - fin `completed` (activation) et `abandoned`.
 *
 * Chaque test amorce sa propre session (compte neuf, identifiants préfixés
 * `E2E-VEH3`) : aucun ordre, aucune donnée partagée entre tests.
 */

// La base de test est distante (Neon) : une reprise peut dépasser les 10 s par défaut.
const STEP_TIMEOUT = 45_000;

const ids = createIdBag();
const stamp = Date.now().toString(36);
let counter = 0;
let owner: E2ECredentials & { id: number };
const sessionIds: string[] = [];
const registrations: string[] = [];

const VIN_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
function uniqueVin(): string {
  let tail = "";
  for (let i = 0; i < 12; i++) tail += VIN_ALPHABET[Math.floor(Math.random() * VIN_ALPHABET.length)];
  return `E2EV3${tail}`;
}

interface Seed {
  sessionId: string;
  registration: string;
  vin: string;
}

function newSeed(): Seed {
  counter += 1;
  const sessionId = `E2E-VEH3-${stamp}-${counter}`;
  const registration = `E2E-VEH3-${stamp.toUpperCase()}-${counter}`;
  sessionIds.push(sessionId);
  registrations.push(registration);
  return { sessionId, registration, vin: uniqueVin() };
}

function draftData(seed: Seed, over: Record<string, unknown> = {}) {
  return {
    registrationNumber: seed.registration,
    brand: "Volvo",
    model: "FH16",
    year: 2022,
    vin: seed.vin,
    vehicleType: "tracteur",
    tonnage: 18,
    axleCount: 3,
    engineSpec: "",
    purchaseDate: "",
    purchasePrice: 0,
    fuelType: "diesel",
    status: "operational",
    mileage: 1200,
    nextMaintenanceDate: "",
    nextMaintenanceMileage: 0,
    licensePlateExpiry: "",
    insuranceExpiry: "",
    technicalInspectionDate: "",
    notes: "",
    vinValidated: false,
    vinValidationResult: null,
    documents: { carteGrise: null, assurance: null, visiteTechnique: null, facturAchat: null },
    documentsUploaded: false,
    maintenanceScheduled: false,
    firstMaintenanceDate: "",
    maintenanceType: "preventive",
    activated: false,
    ...over,
  };
}

/** Amorce un brouillon par l'API, comme le fait le formulaire « Nouveau véhicule ». */
async function seedDraft(page: Page, seed: Seed, currentStep: number, over: Record<string, unknown> = {}) {
  const response = await page.request.post("/api/workflows/vehicle-acquisition", {
    data: { sessionId: seed.sessionId, currentStep, workflowData: draftData(seed, over) },
  });
  expect(response.status(), "amorçage du brouillon").toBe(200);
}

async function serverDraft(page: Page, sessionId: string) {
  const response = await page.request.get(`/api/workflows/vehicle-acquisition/${sessionId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as null | {
    id: number;
    currentStep: number;
    status: string;
    workflowData: Record<string, any>;
  };
}

async function openWizard(page: Page, sessionId: string) {
  await page.goto(`/workflows/vehicle-acquisition?resumeSession=${sessionId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Acquisition de Véhicule", level: 1 })).toBeVisible();
}

function stepTitle(page: Page, step: number, title: string) {
  return page.getByText(`Étape ${step}: ${title}`, { exact: true });
}

function pdf(name: string) {
  return { name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4 ${name}`) };
}

test.beforeAll(async () => {
  owner = await createE2EUser("workshop_manager", ids);
});

test.afterAll(async () => {
  for (const sessionId of sessionIds) {
    const dir = join(process.cwd(), "uploads", "workflows", sessionId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    // Les lignes de documents partent avec le brouillon (ON DELETE CASCADE).
    await db.delete(vehicleAcquisitionWorkflows).where(eq(vehicleAcquisitionWorkflows.sessionId, sessionId));
  }
  for (const registration of registrations) {
    await db.delete(vehicles).where(eq(vehicles.registrationNumber, registration));
  }
  await cleanupCreated(ids);
});

test.beforeEach(async ({ page }) => {
  await loginWithSession(page, owner);
});

test.describe("VEH3 - acquisition de véhicule", () => {
  test("reprise depuis le bandeau, puis après rechargement, à l'étape enregistrée", async ({ page }) => {
    const seed = newSeed();
    await seedDraft(page, seed, 2);

    await page.goto("/vehicles", { waitUntil: "domcontentloaded" });
    const banner = page.getByText("Workflows en cours").locator("xpath=ancestor::div[contains(@class,'bg-orange-50')][1]");
    await expect(banner).toContainText(seed.registration);
    await expect(banner).toContainText("Étape 2/5");

    await banner.getByRole("button", { name: "Continuer" }).click();
    await expect(page).toHaveURL(new RegExp(`/workflows/vehicle-acquisition\\?resumeSession=${seed.sessionId}$`));
    await expect(stepTitle(page, 2, "Validation VIN")).toBeVisible({ timeout: STEP_TIMEOUT });
    await expect(page.getByLabel("VIN à valider")).toHaveValue(seed.vin);

    // Rechargement : le navigateur n'a rien gardé, l'étape revient du serveur.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(stepTitle(page, 2, "Validation VIN")).toBeVisible({ timeout: STEP_TIMEOUT });
    await expect(page.getByLabel("VIN à valider")).toHaveValue(seed.vin);

    // Valider le VIN avance à l'étape 3 et le serveur le sait.
    await page.getByRole("button", { name: "Valider le VIN" }).click();
    await expect(stepTitle(page, 3, "Documents Obligatoires")).toBeVisible({ timeout: STEP_TIMEOUT });
    await expect
      .poll(async () => {
        const draft = await serverDraft(page, seed.sessionId);
        return draft ? { step: draft.currentStep, vin: draft.workflowData.vinValidated } : null;
      })
      .toEqual({ step: 3, vin: true });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(stepTitle(page, 3, "Documents Obligatoires")).toBeVisible({ timeout: STEP_TIMEOUT });
  });

  test("documents obligatoires : refus tant qu'il en manque, puis téléversés côté serveur", async ({ page }) => {
    const seed = newSeed();
    await seedDraft(page, seed, 3, { vinValidated: true });
    await openWizard(page, seed.sessionId);
    await expect(stepTitle(page, 3, "Documents Obligatoires")).toBeVisible({ timeout: STEP_TIMEOUT });

    // Aucun document : on reste à l'étape 3, le serveur n'avance pas.
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Documents manquants", { exact: true })).toBeVisible();
    expect((await serverDraft(page, seed.sessionId))?.currentStep).toBe(3);

    const inputs = page.locator('input[type="file"]');
    await expect(inputs).toHaveCount(4);
    const types = ["carte_grise", "assurance", "visite_technique"];
    for (let i = 0; i < 3; i++) {
      const uploaded = page.waitForResponse(
        (r) => r.url().includes(`/api/workflows/${seed.sessionId}/documents`) && r.request().method() === "POST",
      );
      await inputs.nth(i).setInputFiles(pdf(`${types[i]}.pdf`));
      expect((await uploaded).status(), `téléversement ${types[i]}`).toBe(201);
    }

    const listed = await page.request.get(`/api/workflows/${seed.sessionId}/documents`);
    expect(listed.ok()).toBeTruthy();
    const docs = (await listed.json()) as Array<{ documentType: string; originalName: string }>;
    expect(docs.map((d) => d.documentType).sort()).toEqual([...types].sort());
    expect(docs.map((d) => d.originalName).sort()).toEqual(types.map((t) => `${t}.pdf`).sort());

    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(stepTitle(page, 4, "Planification Maintenance")).toBeVisible({ timeout: STEP_TIMEOUT });
    await expect
      .poll(async () => {
        const draft = await serverDraft(page, seed.sessionId);
        return draft ? { step: draft.currentStep, docs: draft.workflowData.documentsUploaded } : null;
      })
      .toEqual({ step: 4, docs: true });
  });

  test("fin completed : l'activation crée le véhicule, clôt le brouillon et vide le bandeau", async ({ page }) => {
    const seed = newSeed();
    await seedDraft(page, seed, 4, { vinValidated: true, documentsUploaded: true });
    await openWizard(page, seed.sessionId);
    await expect(stepTitle(page, 4, "Planification Maintenance")).toBeVisible({ timeout: STEP_TIMEOUT });

    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await page.getByLabel("Date de première maintenance").fill(future);
    await page.getByRole("button", { name: "Programmer la maintenance" }).click();
    await expect(stepTitle(page, 5, "Activation Flotte")).toBeVisible({ timeout: STEP_TIMEOUT });

    const activation = page.waitForResponse(
      (r) => r.url().includes("/api/vehicles/activate-from-workflow") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Activer le véhicule dans la flotte" }).click();
    expect((await activation).status()).toBeLessThan(300);
    await expect(page).toHaveURL(new RegExp(`/vehicles/${encodeURIComponent(seed.registration)}`));

    const [created] = await db.select().from(vehicles).where(eq(vehicles.registrationNumber, seed.registration));
    expect(created, "véhicule créé").toBeTruthy();
    expect(created.vin).toBe(seed.vin);

    await expect
      .poll(async () => {
        const [row] = await db
          .select()
          .from(vehicleAcquisitionWorkflows)
          .where(eq(vehicleAcquisitionWorkflows.sessionId, seed.sessionId));
        return row ? { status: row.status, finished: row.completedAt !== null } : null;
      })
      .toEqual({ status: "completed", finished: true });

    // DEFAUT PRODUIT (VEH3-UI-2), gelé tel quel : activateVehicle() appelle
    // updateData({ activated: true }), dont l'enregistrement différé de 500 ms
    // (client/src/hooks/use-workflow-persistence.ts:171, setTimeout saveWorkflow)
    // part APRES completeWorkflow(). Le PATCH ne trouve plus de brouillon
    // en cours (404), le repli POST en recrée un, de même sessionId, en
    // "in_progress" : une acquisition terminée réapparaît dans « Workflows en cours ».
    // Le contrat ne le voit pas (il n'envoie pas cet enregistrement tardif).
    // Quand le défaut est corrigé, remplacer par : serverDraft(...) === null.
    await expect
      .poll(async () => (await serverDraft(page, seed.sessionId))?.status ?? null, { timeout: 20_000 })
      .toBe('in_progress');
    const rows = await db
      .select()
      .from(vehicleAcquisitionWorkflows)
      .where(eq(vehicleAcquisitionWorkflows.sessionId, seed.sessionId));
    expect(rows.map((r) => r.status).sort()).toEqual(['completed', 'in_progress']);
  });

  test("fin abandoned : l'abandon retire le brouillon du bandeau et de la reprise", async ({ page }) => {
    const seed = newSeed();
    await seedDraft(page, seed, 2);

    await page.goto("/vehicles", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(seed.registration)).toBeVisible();

    // Même route que le bouton « Abandonner » de WorkflowReminders (mode complet).
    const abandon = await page.request.patch(`/api/workflows/active/${seed.sessionId}/abandon`);
    expect(abandon.ok()).toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Véhicules", level: 2 })).toBeVisible();
    await expect(page.getByText(seed.registration)).toHaveCount(0);
    expect(await serverDraft(page, seed.sessionId)).toBeNull();

    const [row] = await db
      .select()
      .from(vehicleAcquisitionWorkflows)
      .where(eq(vehicleAcquisitionWorkflows.sessionId, seed.sessionId));
    expect(row.status).toBe("abandoned");
  });

  // DEFAUT PRODUIT (VEH3-UI-1) : aucun écran n'offre l'abandon. Le bouton
  // « Abandonner » n'existe que dans le mode complet de `WorkflowReminders`
  // (client/src/components/workflows/workflow-reminders.tsx, bouton du mode non
  // compact), or le seul montage est `<WorkflowReminders compact />`
  // (client/src/pages/vehicles/index.tsx:119), dont le bandeau n'a que
  // « Continuer ». Le wizard déstructure `abandonWorkflow` sans jamais l'appeler
  // (client/src/pages/workflows/vehicle-acquisition.tsx:102). Un brouillon
  // laissé en route ne peut donc pas être abandonné depuis l'interface.
  // `test.fail` : rouge attendu ; si le défaut est corrigé le test passe et
  // Playwright signale l'inversion, il suffit alors de retirer `test.fail`.
  test("DEFAUT PRODUIT : l'écran propose d'abandonner un brouillon en cours", async ({ page }) => {
    test.fail(true, "VEH3-UI-1 : aucun bouton Abandonner n'est monté (bandeau compact)");
    const seed = newSeed();
    await seedDraft(page, seed, 2);

    await page.goto("/vehicles", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(seed.registration)).toBeVisible();
    await expect(page.getByRole("button", { name: /Abandonner/ })).toBeVisible({ timeout: 3_000 });
  });
});
