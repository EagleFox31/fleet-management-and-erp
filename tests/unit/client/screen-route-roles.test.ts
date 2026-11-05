import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as roles from "@shared/constants/roles";

/**
 * Écart n°9 de la carte des droits : six écrans s'ouvraient par adresse pour tout compte connecté
 * (`PrivateRoute`) alors que leurs données sont refusées selon le rôle. Chacun passe par `RoleRoute`
 * avec les rôles de son API, et chaque entrée de menu qui y mène doit viser un rôle admis (sinon
 * lien mort vers « Accès refusé »).
 */

const ROOT = resolve(__dirname, "../../..");
const APP = readFileSync(resolve(ROOT, "client/src/App.tsx"), "utf8");
const SIDEBAR = readFileSync(resolve(ROOT, "client/src/components/layout/sidebar.tsx"), "utf8");

const EXPECTED: Record<string, readonly string[]> = {
  "/operations": roles.PENDING_INVOICE_ROLES,
  "/fuel": roles.FUEL_READ_ROLES,
  "/maintenance/preventive": ["admin", "workshop_manager"],
  "/technicians": ["admin", "workshop_manager"],
  "/missions": roles.MISSION_MANAGER_ROLES,
  "/inventory/tires": ["admin", "workshop_manager", "warehouse", "secretary", "logistics", "technician"],
};

function routeRoles(path: string): string[] {
  const start = APP.indexOf(`<Route path="${path}">`);
  expect(start, `route ${path} absente de App.tsx`).toBeGreaterThan(-1);
  const block = APP.slice(start, APP.indexOf("</Route>", start));
  expect(block, `${path} doit passer par RoleRoute`).toContain("<RoleRoute");
  const expr = /allowedRoles=\{([^}]+)\}/.exec(block)?.[1].trim() ?? "";
  if (expr.startsWith("[")) return [...expr.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const constant = (roles as Record<string, unknown>)[expr];
  expect(Array.isArray(constant), `${expr} inconnu dans shared/constants/roles`).toBe(true);
  return [...(constant as string[])];
}

/** Rôles dont le menu (bloc `case '<rôle>':` de la sidebar) contient un lien vers `path`. */
function menuRoles(path: string): string[] {
  const cases = [...SIDEBAR.matchAll(/case '([a-z_]+)':/g)];
  return cases
    .filter((m, i) => SIDEBAR.slice(m.index, cases[i + 1]?.index ?? SIDEBAR.length).includes(`href: "${path}"`))
    .map((m) => m[1]);
}

describe("écrans restreints aux rôles de leur API", () => {
  it.each(Object.entries(EXPECTED))("%s : RoleRoute avec les rôles attendus", (path, expected) => {
    expect(routeRoles(path).sort()).toEqual([...expected].sort());
  });

  it.each(Object.keys(EXPECTED))("%s : chaque menu qui y mène vise un rôle admis", (path) => {
    const allowed = routeRoles(path);
    expect(menuRoles(path).filter((role) => !allowed.includes(role))).toEqual([]);
  });

  it("le relevé du menu voit bien les liens (garde du test)", () => {
    expect(menuRoles("/fuel").length).toBeGreaterThan(0);
  });
});
