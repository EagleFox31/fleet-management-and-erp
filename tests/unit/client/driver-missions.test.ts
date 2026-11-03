import { describe, expect, it } from "vitest";
import { splitDriverMissions } from "@/lib/driver-missions";

describe("missions à faire du chauffeur (DRV2-4)", () => {
  it("garde la première mission à faire comme mission active et liste les suivantes", () => {
    const { active, upcoming } = splitDriverMissions([
      { id: 1, status: "delivered" },
      { id: 2, status: "assigned" },
      { id: 3, status: "completed" },
      { id: 4, status: "in_progress" },
      { id: 5, status: "assigned" },
    ]);
    expect(active?.id).toBe(2);
    expect(upcoming.map((m) => m.id)).toEqual([4, 5]);
  });

  it("aucune mission à faire : ni active ni suivantes", () => {
    expect(splitDriverMissions([{ id: 1, status: "cancelled" }])).toEqual({ active: undefined, upcoming: [] });
    expect(splitDriverMissions([])).toEqual({ active: undefined, upcoming: [] });
  });
});
