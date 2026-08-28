import { test, expect } from "@playwright/test";
import { loginAs, MANAGER_CREDENTIALS, VIEWER_CREDENTIALS } from "./helpers/auth";

/**
 * La liste des OT est rafraichie par polling toutes les 7s
 * (`client/src/components/maintenance/work-order-table.tsx`).
 * Toute assertion UI au-dela de ce delai serait satisfaite par le polling seul
 * et ne prouverait rien sur le temps reel: on verifie donc d'abord la trame
 * WebSocket recue par le profil observateur, que le polling ne peut pas produire.
 */
const UI_POLLING_INTERVAL_MS = 7_000;

test.describe("Critical Journey 6 - Temps Réel OT (inter-profils)", () => {
  test("un OT cree par le chef d'atelier remonte chez le magasinier sans refresh", async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const viewerContext = await browser.newContext();
    const creatorContext = await browser.newContext();

    try {
      const viewerPage = await viewerContext.newPage();

      // Capture des trames /ws AVANT toute navigation: le socket s'ouvre au montage de l'app.
      const realtimeFrames: string[] = [];
      viewerPage.on("websocket", (webSocket) => {
        if (!webSocket.url().includes("/ws")) {
          return;
        }
        webSocket.on("framereceived", (frame) => {
          realtimeFrames.push(
            typeof frame.payload === "string" ? frame.payload : frame.payload.toString(),
          );
        });
      });

      const viewer = await loginAs(viewerPage, VIEWER_CREDENTIALS);
      const creatorPage = await creatorContext.newPage();
      const creator = await loginAs(creatorPage, MANAGER_CREDENTIALS);

      test.skip(
        !viewer || !creator,
        `Comptes multi-profils absents (${MANAGER_CREDENTIALS.username} / ${VIEWER_CREDENTIALS.username}). ` +
          "Executer `npx tsx scripts/seed-production-data.ts` ou surcharger E2E_MANAGER_* / E2E_VIEWER_*.",
      );

      // Garde-fou: sans cela, le scenario pourrait silencieusement retomber
      // sur un test mono-utilisateur et ne plus rien prouver.
      expect(creator!.id, "Le createur et l'observateur doivent etre deux comptes distincts").not.toBe(
        viewer!.id,
      );
      expect(creator!.role, "Le createur et l'observateur doivent avoir deux roles distincts").not.toBe(
        viewer!.role,
      );

      await viewerPage.goto("/maintenance/work-orders", { waitUntil: "domcontentloaded" });
      await expect(
        viewerPage.getByRole("heading", { name: "Ordres de travail", level: 1 }),
      ).toBeVisible();

      // Le serveur emet `auth_success` a l'ouverture du socket: c'est notre preuve
      // que la session observatrice est bien branchee avant de declencher l'action.
      await expect
        .poll(() => realtimeFrames.some((frame) => frame.includes("auth_success")), {
          message: `La session ${VIEWER_CREDENTIALS.label} n'a pas etabli la connexion temps reel /ws`,
          timeout: 20_000,
        })
        .toBe(true);

      const vehiclesResponse = await creatorPage.request.get("/api/vehicles?limit=1&offset=0");
      expect(vehiclesResponse.ok()).toBeTruthy();
      const vehiclesPayload = await vehiclesResponse.json();
      const vehicleId = vehiclesPayload?.vehicles?.[0]?.id;

      test.skip(
        typeof vehicleId !== "number",
        "Aucun vehicule en base: creation d'OT impossible, scenario temps reel non exerce.",
      );

      const uniqueTitle = `E2E-RT-${Date.now()}`;
      const createWorkOrderResponse = await creatorPage.request.post("/api/work-orders", {
        data: {
          vehicleId,
          title: uniqueTitle,
          description: "OT créée pour test temps réel e2e inter-profils",
          status: "pending",
          priority: "medium",
          startDate: new Date().toISOString(),
          isPreventive: false,
          technicianId: null,
        },
      });

      expect(
        createWorkOrderResponse.ok(),
        `Le profil ${MANAGER_CREDENTIALS.label} doit pouvoir creer un OT`,
      ).toBeTruthy();
      const createdWorkOrderId = (await createWorkOrderResponse.json())?.id;

      try {
        // Assertion 1 (la preuve): la trame a bien traverse le broadcast serveur
        // jusqu'a un profil d'un AUTRE role. Inatteignable par le polling HTTP.
        await expect
          .poll(
            () =>
              realtimeFrames.some(
                (frame) => frame.includes(uniqueTitle) && frame.includes("work_order_created"),
              ),
            {
              message: `Aucune trame WebSocket 'work_order_created' recue par le profil ${VIEWER_CREDENTIALS.label}`,
              timeout: 15_000,
            },
          )
          .toBe(true);

        // Assertion 2: l'UI a reagi a l'evenement. Le budget est volontairement
        // inferieur a l'intervalle de polling pour ne pas valider un simple refetch.
        await expect(viewerPage.getByText(uniqueTitle)).toBeVisible({
          timeout: UI_POLLING_INTERVAL_MS - 2_000,
        });
      } finally {
        // La suite tourne sur une base reelle: on ne laisse pas trainer l'OT de test.
        if (typeof createdWorkOrderId === "number") {
          await creatorPage.request
            .delete(`/api/work-orders/${createdWorkOrderId}`)
            .catch(() => undefined);
        }
      }
    } finally {
      await viewerContext.close();
      await creatorContext.close();
    }
  });
});
