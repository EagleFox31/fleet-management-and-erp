import { beforeEach, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: { current: null as unknown as import("@tanstack/react-query").QueryClient } }));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  client.current = new QC();
  return { queryClient: client.current };
});

import { handleDomainUpdate, mergeMissionPatch } from "@/hooks/useRealTimeSync";
import { omitMissionBudget } from "../../../server/lib/mission-budget-scope";

/**
 * Q19 : la trame mission part sans montant du budget (`omitMissionBudget`). Le cache d'un rôle lecteur garde
 * l'ancien budget au lieu de le perdre, et la mission est relue (détail et liste) pour recevoir un budget modifié.
 */
const READER_DETAIL = {
  id: 42,
  status: "assigned",
  estimatedFuelCost: "555000",
  workflowData: { budgetPlan: { fuelBudget: 777000 }, execution: { startedAt: null } },
};

// Trame telle que le serveur l'émet : même mission, budget modifié, montants retirés.
const frame = () =>
  omitMissionBudget({
    id: 42,
    status: "in_progress",
    estimatedFuelCost: "999000",
    workflowData: { budgetPlan: { fuelBudget: 888000 }, execution: { startedAt: "2026-11-05T10:00:00.000Z" } },
  });

describe("trame mission sans montant du budget (Q19)", () => {
  beforeEach(() => {
    client.current.clear();
    client.current.setQueryData(["/api/missions/42"], READER_DETAIL);
    client.current.setQueryData(["/api/missions"], [READER_DETAIL, { id: 7, status: "planned" }]);
  });

  it("la trame ne porte aucun montant du budget", () => {
    const sent = JSON.stringify(frame());
    expect(sent).not.toContain("999000");
    expect(sent).not.toContain("888000");
    expect(sent).not.toContain("estimatedFuelCost");
    expect(sent).not.toContain("budgetPlan");
  });

  it("détail et liste : statut et dates suivent la trame, l'ancien budget reste en cache", () => {
    handleDomainUpdate({ type: "mission_updated", entityId: 42, data: { mission: frame(), missionId: 42 } });
    for (const cached of [
      client.current.getQueryData<Record<string, any>>(["/api/missions/42"]),
      client.current.getQueryData<Array<Record<string, any>>>(["/api/missions"])?.[0],
    ]) {
      expect(cached?.status).toBe("in_progress");
      expect(cached?.workflowData.execution.startedAt).toBe("2026-11-05T10:00:00.000Z");
      expect(cached?.estimatedFuelCost).toBe("555000");
      expect(cached?.workflowData.budgetPlan).toEqual({ fuelBudget: 777000 });
    }
  });

  it("budget modifié : détail et liste sont relus, le lecteur reçoit la nouvelle valeur au refetch", () => {
    handleDomainUpdate({ type: "mission_updated", entityId: 42, data: { mission: frame(), missionId: 42 } });
    expect(client.current.getQueryState(["/api/missions/42"])?.isInvalidated).toBe(true);
    expect(client.current.getQueryState(["/api/missions"])?.isInvalidated).toBe(true);
  });

  it("une valeur portée par la trame remplace celle du cache", () => {
    const merged = mergeMissionPatch(READER_DETAIL, { id: 42, workflowData: { budgetPlan: { fuelBudget: 1 } } });
    expect(merged.workflowData).toEqual({ budgetPlan: { fuelBudget: 1 } });
  });
});
