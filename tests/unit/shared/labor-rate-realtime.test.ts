import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KPI_QUERY_KEYS, REALTIME_EVENTS } from "../../../shared/contracts/realtime-events";
import { WORK_ORDER_COST_READ_ROLES } from "../../../shared/constants/roles";

/**
 * Un nouveau taux horaire change le coût des OT clos après sa date d'effet : l'événement
 * `workshop_labor_rate_created` doit atteindre les lecteurs de coût, eux seuls, et rafraîchir
 * KPI, listes du technicien et taux d'un OT ouvert (3 couches, AGENTS.md §2).
 */
const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");
const event = REALTIME_EVENTS.workshop_labor_rate_created;

describe("événement workshop_labor_rate_created", () => {
  it("portée = lecteurs de coût d'OT : ni chauffeur ni client", () => {
    expect(event.scope).toEqual({ type: "roles", roles: [...WORK_ORDER_COST_READ_ROLES] });
    const roles = (event.scope as { roles: readonly string[] }).roles;
    expect(roles).not.toContain("driver");
    expect(roles).not.toContain("client");
  });

  it("invalide les KPI et les listes d'OT du technicien", () => {
    for (const key of KPI_QUERY_KEYS) expect(event.invalidates).toContain(key);
    expect(event.invalidates).toContain("/api/technician/work-orders");
  });

  it("émis par la création d'un taux, reçu par le client avec le taux d'OT par prédicat", () => {
    expect(read("server/api/workshop-labor-rates.routes.ts")).toMatch(/broadcastUpdate\("workshop_labor_rate_created"/);
    const hook = read("client/src/hooks/useRealTimeSync.ts");
    expect(hook).toMatch(/case "workshop_labor_rate_created":[\s\S]{0,400}endsWith\("\/labor-rate"\)/);
  });
});
