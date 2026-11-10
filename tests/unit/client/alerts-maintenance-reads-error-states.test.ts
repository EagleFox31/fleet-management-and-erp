import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * Alertes, catalogue de pannes, conformité et maintenances planifiées en échec : le serveur répond
 * 500 au lieu de `[]` / `0`. Un écran qui retombe sur `|| 0` ou `= []` afficherait « 0 non lue »,
 * « aucune alerte » ou une conformité à 0 comme de vraies valeurs. Chaque écran lit `isError`.
 */
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const SCREENS: Array<{ path: string; shows: RegExp[] }> = [
  { path: "client/src/components/layout/topnav.tsx", shows: [/alertsUnavailable/, /Alertes indisponibles/] },
  { path: "client/src/pages/maintenance/fault-catalog.tsx", shows: [/isError/, /<InlineQueryError/] },
  { path: "client/src/pages/dashboard.tsx", shows: [/scheduledError/, /Indisponible/] },
  { path: "client/src/pages/workshop-manager/dashboard.tsx", shows: [/complianceError/, /Indisponible/] },
  { path: "client/src/pages/inventory/requests.tsx", shows: [/awaitingPartsView\.kind === "error"/, /OT en attente de pièces sont momentanément indisponibles/] },
];

describe("lectures alertes et maintenance : l'écran montre l'erreur, jamais 0", () => {
  it.each(SCREENS)("$path", ({ path, shows }) => {
    const src = read(path);
    for (const pattern of shows) expect(src).toMatch(pattern);
  });

  it("le badge des non-lues vaut 0 seulement quand la lecture a réussi", () => {
    const src = read("client/src/components/layout/topnav.tsx");
    expect(src).toMatch(/alertsUnavailable \? 0 : Number\(alertsCount\?\.unread/);
    expect(src).toMatch(/notificationCount > 0 &&/);
  });
});
