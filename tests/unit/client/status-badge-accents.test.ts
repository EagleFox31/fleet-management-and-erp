import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Les libelles du StatusBadge generique s'ecrivent avec leurs accents (francais correct en UI).
const src = readFileSync("client/src/components/design-system/status-badge.tsx", "utf8");
const block = src.slice(src.indexOf("const STATUS_LABEL"), src.indexOf("};", src.indexOf("const STATUS_LABEL")));
const labels = Object.fromEntries([...block.matchAll(/^\s+(\w+): "([^"]+)",$/gm)].map(([, k, v]) => [k, v]));

describe("libelles du StatusBadge generique", () => {
  it("sont accentues", () => {
    expect(labels).toMatchObject({
      approved: "Approuvée", confirmed: "Confirmée", ordered: "Commandée", sent: "Envoyée", received: "Reçue",
      delivered: "Livrée", issued: "Émise", fulfilled: "Traitée", paid: "Payée", closed: "Clôturée",
      completed: "Terminée", cancelled: "Annulée", canceled: "Annulée", rejected: "Rejetée", partial: "Partielle", disputed: "Contestée",
    });
  });
  it("gardent le sens facture de issued (pas le vocabulaire stock, AGENTS.md §1)", () => {
    expect(labels.issued).toBe("Émise");
    expect(Object.values(labels)).not.toContain("Sortie du stock");
  });
});
