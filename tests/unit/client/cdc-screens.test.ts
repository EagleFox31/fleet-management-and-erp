import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CDC_SCREENS, screenFeatures, type CdcScreen } from "@/config/cdc-screens";
import { LOT_SCREENS } from "@/config/lot-screens";
import { KPI_VIEWER_ROLES, PART_LABEL_ROLES, type AppRole } from "@shared/constants/roles";
import { FEATURE_FLAGS } from "@shared/feature-flags";
import { MOUNT_CASES } from "../../support/cdc-mounts";

/**
 * Registre des écrans du chantier CDC (client/src/config/cdc-screens.ts), lot CDC-0b.
 *
 * Garde-fous : les rôles d'un écran égalent ceux de l'API que le serveur monte pour lui (leçon
 * « Écran ouvert à un rôle que son API refuse »), son drapeau existe, ses ids et chemins sont
 * uniques, il a une page et une entrée de composant. La vérité côté serveur est la table de
 * montages partagée avec les tests serveur (`tests/support/cdc-mounts.ts`).
 */
const root = resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf-8");

type Access =
  /** Mêmes rôles que le montage serveur. */
  | { mount: string }
  /** Rôles plus étroits que le montage : la route de l'écran porte sa propre garde. */
  | { narrowerThan: string; guard: string }
  /** Pas de montage CDC : la garde est celle d'un routeur existant, vérifiée par `check`. */
  | { roles: readonly AppRole[]; check: () => void };

const kpiGuardRoles = (): readonly string[] => {
  const match = read("server/middleware/auth.ts").match(/isManagementOrAdmin\s*=\s*authorize\(\[([^\]]*)\]\)/);
  if (!match) throw new Error("garde isManagementOrAdmin introuvable dans server/middleware/auth.ts");
  return [...match[1].matchAll(/['"]([\w]+)['"]/g)].map((m) => m[1]);
};

/** Pour chaque écran, ce que le serveur autorise. Un écran absent de cette table échoue ci-dessous. */
const SERVER_ACCESS: Record<string, Access> = {
  "part-scanner": { mount: "part-scans" },
  // Le montage /api/part-scans admet aussi atelier et technicien ; l'impression d'étiquettes est
  // réservée à PART_LABEL_ROLES. Le lot #3 doit garder sa route d'étiquette par ce groupe.
  "part-labels": { narrowerThan: "part-scans", guard: "PART_LABEL_ROLES" },
  "part-sales": { mount: "part-sales (lecture)" },
  "fleet-map": { mount: "vehicle-positions" },
  "telemetry-devices": { mount: "admin/telemetry-devices" },
  "kpi-reports": {
    roles: KPI_VIEWER_ROLES,
    check: () => expect([...kpiGuardRoles()].sort()).toEqual([...KPI_VIEWER_ROLES].sort()),
  },
  "maintenance-report": { mount: "maintenance-reports" },
  "excel-import": { mount: "imports (interventions)" },
};

const mountByName = (name: string) => {
  const found = MOUNT_CASES.find((mount) => mount.name === name);
  if (!found) throw new Error(`montage « ${name} » absent de tests/support/cdc-mounts.ts`);
  return found;
};

const sorted = (roles: readonly string[]) => [...roles].sort();

/** Écarts entre les rôles de l'écran et ceux que le serveur autorise ; vide = aligné. */
function roleGaps(screen: CdcScreen, access: Access): string[] {
  if ("mount" in access) {
    const allowed = mountByName(access.mount).allowed;
    const extra = screen.roles.filter((role) => !allowed.includes(role));
    const missing = allowed.filter((role) => !screen.roles.includes(role));
    return [...extra.map((r) => `${r} ouvert à l'écran, refusé par l'API`), ...missing.map((r) => `${r} admis par l'API, absent de l'écran`)];
  }
  if ("narrowerThan" in access) {
    const allowed = mountByName(access.narrowerThan).allowed;
    return screen.roles.filter((role) => !allowed.includes(role)).map((r) => `${r} ouvert à l'écran, refusé par l'API`);
  }
  return sorted(screen.roles).join() === sorted(access.roles).join() ? [] : ["rôles différents de ceux de la garde"];
}

describe("registre des écrans CDC", () => {
  it("contient les huit écrans du chantier", () => {
    expect(CDC_SCREENS.map((s) => s.id).sort()).toEqual(
      ["excel-import", "fleet-map", "kpi-reports", "maintenance-report", "part-labels", "part-sales", "part-scanner", "telemetry-devices"],
    );
  });

  it("chaque écran a sa ligne dans la table des accès serveur, et inversement", () => {
    expect(Object.keys(SERVER_ACCESS).sort()).toEqual(CDC_SCREENS.map((s) => s.id).sort());
  });

  it.each(CDC_SCREENS.map((s) => [s.id, s] as const))("%s : rôles de l'écran = rôles de son API", (_id, screen) => {
    const access = SERVER_ACCESS[screen.id];
    expect(roleGaps(screen, access)).toEqual([]);
    if ("narrowerThan" in access) {
      expect(sorted(screen.roles)).toEqual(sorted(PART_LABEL_ROLES));
    }
    if ("check" in access) access.check();
  });

  it("la contre-épreuve détecte un rôle que l'API refuse et un rôle que l'écran oublie", () => {
    const scanner = CDC_SCREENS.find((s) => s.id === "part-scanner")!;
    expect(roleGaps({ ...scanner, roles: [...scanner.roles, "client"] }, SERVER_ACCESS["part-scanner"])).toEqual([
      "client ouvert à l'écran, refusé par l'API",
    ]);
    expect(roleGaps({ ...scanner, roles: ["admin"] }, SERVER_ACCESS["part-scanner"]).length).toBe(3);
  });

  it.each(CDC_SCREENS.map((s) => [s.id, s] as const))("%s : drapeau déclaré, coupé par défaut, repris par le montage", (_id, screen) => {
    expect(Object.keys(FEATURE_FLAGS)).toContain(screen.feature);
    expect(FEATURE_FLAGS[screen.feature].defaultEnabled).toBe(false);
    const access = SERVER_ACCESS[screen.id];
    // Montage propre à l'écran : l'écran exige exactement les drapeaux du montage, ni plus (écran
    // caché pour rien) ni moins (écran ouvert, API en 404).
    if ("mount" in access) expect([...screenFeatures(screen)].sort()).toEqual([...mountByName(access.mount).flags].sort());
    else if ("narrowerThan" in access) expect(mountByName(access.narrowerThan).flags).toContain(screen.feature);
  });

  it("le rapport de maintenance exige aussi le drapeau d'export, comme son montage serveur", () => {
    const report = CDC_SCREENS.find((s) => s.id === "maintenance-report");
    expect(screenFeatures(report as CdcScreen)).toEqual(["maintenance-report", "exports"]);
  });

  it.each(CDC_SCREENS.map((s) => [s.id, s] as const))("%s : appels d'API déclarés et menu complet", (_id, screen) => {
    expect(screen.apis.length).toBeGreaterThan(0);
    for (const api of screen.apis) expect(api.path.startsWith("/api/")).toBe(true);
    const access = SERVER_ACCESS[screen.id];
    if ("mount" in access) {
      const mount = mountByName(access.mount);
      expect(screen.apis.some((api) => mount.path.startsWith(api.path))).toBe(true);
    }
    expect(screen.menu?.label.length).toBeGreaterThan(0);
    expect(screen.menu?.icon).toBeDefined();
    expect(screen.roles.length).toBeGreaterThan(0);
    expect(`${screen.title}${screen.description}${screen.menu?.label}`).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("les ids sont uniques, aussi face aux écrans du lot recette", () => {
    const ids = [...LOT_SCREENS, ...CDC_SCREENS].map((s) => s.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("les chemins sont uniques et sans collision avec le lot recette ni App.tsx", () => {
    const paths = [...LOT_SCREENS, ...CDC_SCREENS].map((s) => s.path);
    expect(paths.filter((p, index) => paths.indexOf(p) !== index)).toEqual([]);
    const app = read("client/src/App.tsx");
    const appPaths = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
    expect(appPaths.size).toBeGreaterThan(20);
    expect(CDC_SCREENS.map((s) => s.path).filter((p) => appPaths.has(p))).toEqual([]);
    for (const screen of CDC_SCREENS) {
      expect(screen.path.startsWith("/")).toBe(true);
      expect(screen.path).not.toMatch(/[?#]/);
    }
  });

  it("les routes du chantier passent avant les routes à :id de App.tsx", () => {
    const app = read("client/src/App.tsx");
    const lotRoutes = app.indexOf("renderLotRoutes()");
    expect(lotRoutes).toBeGreaterThan(-1);
    expect(lotRoutes).toBeLessThan(app.indexOf('path="/inventory/:id"'));
    expect(lotRoutes).toBeLessThan(app.indexOf('path="/vehicles/:id"'));
  });

  it("chaque écran a sa page vide ou remplie et son entrée dans la table des composants", () => {
    const table = read("client/src/config/cdc-screen-components.ts");
    for (const screen of CDC_SCREENS) {
      expect(existsSync(resolve(root, `client/src/pages/cdc/${screen.id}.tsx`)), `page de ${screen.id}`).toBe(true);
      expect(table).toContain(`"${screen.id}": lazy(() => import("@/pages/cdc/${screen.id}"))`);
    }
    const ids = new Set(CDC_SCREENS.map((s) => s.id));
    const declared = [...table.matchAll(/^\s+"([\w-]+)":\s*lazy/gm)].map((m) => m[1]);
    expect(declared.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("lot-routes.tsx et la sidebar itèrent le registre CDC", () => {
    expect(read("client/src/components/lot-routes.tsx")).toContain("...CDC_SCREENS");
    expect(read("client/src/components/layout/sidebar.tsx")).toContain("...CDC_SCREENS");
  });
});
