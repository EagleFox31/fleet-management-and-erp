import { describe, expect, it } from "vitest";
import { canManageOrder, canRecordOrderDelivery, isPlainRowClick, orderStatusActions } from "@/lib/purchase-order-actions";

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

describe("canManageOrder / canRecordOrderDelivery", () => {
  it.each([
    ["admin", true, true], ["admin", false, true],
    ["secretary", true, true], ["secretary", false, true],
    ["warehouse", true, true], ["warehouse", false, true],
    ["logistics", true, false], ["logistics", false, true],
    ["technician", false, false], ["client", false, false], ["", false, false],
  ] as const)("canManageOrder(%s, pièces=%s) = %s", (role, parts, expected) => {
    expect(canManageOrder(role, parts)).toBe(expected);
  });

  it.each([
    ["admin", true], ["warehouse", true], ["secretary", false], ["logistics", false], ["technician", false], ["", false],
  ] as const)("canRecordOrderDelivery(%s) = %s", (role, expected) => {
    expect(canRecordOrderDelivery(role)).toBe(expected);
  });

  it("logisticien, commande sans pièces, annulation demandée : confirmer ou revenir", () => {
    expect(statuses("logistics", "cancellation_requested", false)).toEqual(["cancelled", "confirmed"]);
    expect(statuses("logistics", "cancellation_requested", true)).toEqual([]);
  });
});

describe("isPlainRowClick", () => {
  const click = { ctrlKey: false, metaKey: false, shiftKey: false, button: 0 };
  it("clic gauche simple sans sélection : navigation", () => {
    expect(isPlainRowClick(click)).toBe(true);
    expect(isPlainRowClick(click, "   ")).toBe(true);
  });
  it("Ctrl, Cmd, Maj, molette ou sélection de texte : pas de navigation", () => {
    expect(isPlainRowClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainRowClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainRowClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainRowClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainRowClick(click, "DEMO-BC-001")).toBe(false);
  });
});
