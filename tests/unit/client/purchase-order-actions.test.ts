import { describe, expect, it } from "vitest";
import { orderStatusActions } from "@/lib/purchase-order-actions";

const statuses = (role: string, status: string, isPartsLinkedOrder: boolean) =>
  orderStatusActions({ role, status, isPartsLinkedOrder }).map((a) => a.status);

describe("orderStatusActions : matrice rôle × statut × type de commande", () => {
  it.each([
    // [rôle, statut, commande pièces, actions attendues]
    ["warehouse", "confirmed", true, ["delivered"]],
    ["warehouse", "partial", true, ["delivered"]],
    ["warehouse", "confirmed", false, ["delivered"]],
    ["admin", "confirmed", true, ["delivered"]],
    ["secretary", "confirmed", true, []],
    ["secretary", "draft", true, ["sent"]],
    ["warehouse", "sent", true, ["confirmed"]],
    ["logistics", "draft", true, []],
    ["logistics", "confirmed", true, []],
    ["logistics", "draft", false, ["sent"]],
    ["logistics", "confirmed", false, []],
    ["technician", "confirmed", false, []],
    ["warehouse", "delivered", true, []],
    ["warehouse", "completed", true, []],
  ] as const)("%s, %s, pièces=%s → %j", (role, status, parts, expected) => {
    expect(statuses(role, status, parts)).toEqual(expected);
  });

  it("annulation demandée : confirmer, ou revenir au statut d'avant", () => {
    expect(orderStatusActions({ role: "secretary", status: "cancellation_requested", isPartsLinkedOrder: true, rollbackStatus: "partial" }))
      .toEqual([
        { status: "cancelled", label: "Confirmer l'annulation fournisseur" },
        { status: "partial", label: "Refus fournisseur (retour réception partielle)" },
      ]);
    expect(statuses("warehouse", "cancellation_requested", true)).toEqual(["cancelled", "confirmed"]);
  });
});
