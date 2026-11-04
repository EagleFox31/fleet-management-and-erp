import { describe, expect, it, vi } from "vitest";

vi.mock("../../../server/db", () => ({ db: {} }));

import { relayDatabaseEvent } from "../../../server/lib/db-event-relay";
import type { BroadcastableAlert } from "../../../server/lib/alert-broadcast";

/** Réserve 5 de #287 : relais des alertes créées par trigger (`alert_created`, ids seuls). */
const alert = (id: number, userId: number | null): BroadcastableAlert => ({
  id,
  userId,
  title: "Consommation carburant élevée",
  message: "Véhicule X",
  type: "fuel",
  priority: "high",
  link: "/vehicles/1",
});

function deps(rows: BroadcastableAlert[] | Error) {
  const broadcast = vi.fn();
  const broadcastAlert = vi.fn();
  const readAlerts = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  return { broadcast, broadcastAlert, readAlerts, inferEntity: () => "alert" };
}

describe("db-event-relay : alert_created", () => {
  it("relit les alertes par id et diffuse chacune à son destinataire, jamais en broadcast", async () => {
    const d = deps([alert(10, 7), alert(11, 8)]);
    await relayDatabaseEvent({ eventType: "alert_created", payload: { alertIds: [10, 11, 10] } }, d);
    expect(d.readAlerts).toHaveBeenCalledWith([10, 11]);
    expect(d.broadcastAlert.mock.calls.map(([a]) => a.id)).toEqual([10, 11]);
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("ids absents ou invalides : aucune lecture, aucune trame", async () => {
    const d = deps([]);
    await relayDatabaseEvent({ eventType: "alert_created", payload: { alertIds: ["1", -2, 0, 1.5] } }, d);
    await relayDatabaseEvent({ eventType: "alert_created", payload: {} }, d);
    expect(d.readAlerts).not.toHaveBeenCalled();
    expect(d.broadcastAlert).not.toHaveBeenCalled();
  });

  it("lecture en échec : rien n'est envoyé, l'appelant ne lève pas", async () => {
    const d = deps(new Error("base indisponible"));
    await expect(relayDatabaseEvent({ eventType: "alert_created", payload: { alertIds: [1] } }, d)).resolves.toBeUndefined();
    expect(d.broadcastAlert).not.toHaveBeenCalled();
  });
});
