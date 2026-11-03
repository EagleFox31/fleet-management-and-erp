import { describe, expect, it } from "vitest";
import { splitDriverMissions } from "@/lib/driver-missions";

describe("missions à faire du chauffeur (DRV2-4)", () => {
  it("seules les missions assigned et in_progress sont à faire", () => {
    const { active, upcoming } = splitDriverMissions([
      { id: 1, status: "delivered", pickupDate: "2026-11-01T08:00:00Z" },
      { id: 2, status: "assigned", pickupDate: "2026-11-03T08:00:00Z" },
      { id: 3, status: "completed", pickupDate: "2026-11-02T08:00:00Z" },
      { id: 4, status: "cancelled", pickupDate: "2026-11-02T09:00:00Z" },
    ]);
    expect(active?.id).toBe(2);
    expect(upcoming).toEqual([]);
  });

  it("une mission in_progress reste active devant une mission assigned, même plus tardive", () => {
    const { active, upcoming } = splitDriverMissions([
      { id: 2, status: "assigned", pickupDate: "2026-11-03T08:00:00Z" },
      { id: 4, status: "in_progress", pickupDate: "2026-11-04T08:00:00Z" },
    ]);
    expect(active?.id).toBe(4);
    expect(upcoming.map((m) => m.id)).toEqual([2]);
  });

  it("entre missions de même statut, l'enlèvement le plus proche d'abord, quel que soit l'ordre reçu (le serveur trie à l'envers)", () => {
    const { active, upcoming } = splitDriverMissions([
      { id: 7, status: "assigned", pickupDate: "2026-11-06T08:00:00Z" },
      { id: 6, status: "assigned", pickupDate: "2026-11-05T08:00:00Z" },
      { id: 5, status: "assigned", pickupDate: "2026-11-04T08:00:00Z" },
    ]);
    expect(active?.id).toBe(5);
    expect(upcoming.map((m) => m.id)).toEqual([6, 7]);
  });

  it("une mission sans date d'enlèvement passe après les missions datées", () => {
    const { active, upcoming } = splitDriverMissions([
      { id: 8, status: "assigned", pickupDate: null },
      { id: 9, status: "assigned", pickupDate: "2026-11-05T08:00:00Z" },
    ]);
    expect(active?.id).toBe(9);
    expect(upcoming.map((m) => m.id)).toEqual([8]);
  });

  it("aucune mission à faire : ni active ni suivantes", () => {
    expect(splitDriverMissions([{ id: 1, status: "cancelled" }])).toEqual({ active: undefined, upcoming: [] });
    expect(splitDriverMissions([])).toEqual({ active: undefined, upcoming: [] });
  });
});
