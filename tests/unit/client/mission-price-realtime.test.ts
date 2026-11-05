import { beforeEach, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: { current: null as unknown as import("@tanstack/react-query").QueryClient } }));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  client.current = new QC();
  return { queryClient: client.current };
});

import { missionPricePath } from "@shared/contracts/mission-price";
import { handleDomainUpdate } from "@/hooks/useRealTimeSync";

describe("prix convenu : couche 3 sur mission_updated", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(client.current, "invalidateQueries");
  });
  const invalidated = () => spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

  it("invalide la lecture du prix de la mission concernée", () => {
    handleDomainUpdate({ type: "mission_updated", entityId: 42, data: { mission: { id: 42 } } });
    expect(invalidated()).toContain(JSON.stringify([missionPricePath(42)]));
  });

  it("n'invalide pas le prix d'une autre mission", () => {
    handleDomainUpdate({ type: "mission_updated", entityId: 42, data: { mission: { id: 42 } } });
    expect(invalidated()).not.toContain(JSON.stringify([missionPricePath(7)]));
  });
});
