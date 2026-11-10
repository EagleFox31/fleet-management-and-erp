import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: { current: null as unknown as import("@tanstack/react-query").QueryClient } }));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  client.current = new QC();
  return { queryClient: client.current };
});

import { handleDomainUpdate } from "@/hooks/useRealTimeSync";

/** Couche 3 de `vehicle_position_updated` : positions de la flotte et trace de la mission concernée. */
describe("vehicle_position_updated : resynchronisation ciblée", () => {
  const keys = ["/api/vehicle-positions", "/api/missions/42/track", "/api/missions/7/track", "/api/missions/42"];
  beforeEach(() => {
    client.current.clear();
    for (const key of keys) client.current.setQueryData([key], { ok: true });
  });
  const stale = () => keys.filter((key) => client.current.getQueryState([key])?.isInvalidated);

  it("invalide les positions et la seule trace de la mission annoncée", () => {
    handleDomainUpdate({ type: "vehicle_position_updated", entityId: 1, data: { missionId: 42 } });
    expect(stale()).toEqual(["/api/vehicle-positions", "/api/missions/42/track"]);
  });

  it("sans missionId, toutes les traces ouvertes sont relues, jamais le détail", () => {
    handleDomainUpdate({ type: "vehicle_position_updated", entityId: 1, data: {} });
    expect(stale()).toEqual(["/api/vehicle-positions", "/api/missions/42/track", "/api/missions/7/track"]);
  });
});

/** PATCH /geo : mission_updated { missionId, geo: true } doit faire relire les points A/B aux autres profils. */
describe("mission_updated : trace de la mission", () => {
  const keys = ["/api/missions/42/track", "/api/missions/7/track", "/api/vehicle-positions"];
  beforeEach(() => {
    client.current.clear();
    for (const key of keys) client.current.setQueryData([key], { ok: true });
  });
  const stale = () => keys.filter((key) => client.current.getQueryState([key])?.isInvalidated);

  it("invalide la trace de la mission annoncée, pas celles des autres", () => {
    handleDomainUpdate({ type: "mission_updated", entityId: 42, data: { missionId: 42, geo: true } });
    expect(stale()).toEqual(["/api/missions/42/track"]);
  });
});
