import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REALTIME_EVENT_NAMES, REALTIME_EVENTS, REUSED_REALTIME_EVENTS } from "@shared/contracts/realtime-events";

const source = readFileSync(path.resolve(__dirname, "../../../client/src/hooks/useRealTimeSync.ts"), "utf8");

describe("câblage temps réel du catalogue", () => {
  it.each(REALTIME_EVENT_NAMES)("l'événement %s a un case dans useRealTimeSync", (name) => {
    expect(source).toContain(`case "${name}":`);
    expect(source).toContain(`invalidateCatalogEvent("${name}")`);
  });

  it.each(REUSED_REALTIME_EVENTS)("l'événement réutilisé %s reste géré", (name) => {
    expect(source).toContain(`case "${name}"`);
  });

  it("chaque événement déclare au moins une clé à invalider, au format /api/...", () => {
    for (const name of REALTIME_EVENT_NAMES) {
      const keys = REALTIME_EVENTS[name].invalidates;
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(key.startsWith("/api/")).toBe(true);
    }
  });

  it("les tuiles KPI sont réinterrogées sur work_order_updated", () => {
    expect(source).toMatch(/queryKey: \["\/api\/kpi"\]/);
  });
});
