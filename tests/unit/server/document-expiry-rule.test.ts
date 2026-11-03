import { describe, expect, it } from "vitest";
import {
  classifyDocumentExpiry,
  documentExpiryDedupeKey,
  documentExpiryDedupeKeyPrefixes,
  daysUntilExpiry,
} from "../../../server/services/document-expiry-rule";

const today = new Date("2026-10-30T15:30:00Z");

describe("règle d'échéance à 30 jours (T-17a)", () => {
  it.each([
    ["2026-11-28", "due", 29],
    ["2026-11-29", "due", 30],
    ["2026-11-30", "none", 31],
    ["2026-10-30", "expired", 0],
    ["2026-10-29", "expired", -1],
    ["2025-01-01", "expired", -667],
  ])("échéance %s -> %s (J%i)", (expiry, status, days) => {
    expect(classifyDocumentExpiry(expiry, today)).toEqual({ status, days });
  });

  it("respecte le délai d'alerte du type", () => {
    expect(classifyDocumentExpiry("2026-11-10", today, 7).status).toBe("none");
    expect(classifyDocumentExpiry("2026-11-05", today, 7).status).toBe("due");
  });

  it("ignore l'absence de date ou une date illisible", () => {
    expect(classifyDocumentExpiry(null, today).status).toBe("none");
    expect(classifyDocumentExpiry("", today).status).toBe("none");
    expect(daysUntilExpiry("pas-une-date", today)).toBeNull();
  });

  it("la clé de déduplication change avec l'échéance et le statut", () => {
    const a = documentExpiryDedupeKey(7, "2026-11-29", "due");
    expect(a).toBe(documentExpiryDedupeKey(7, "2026-11-29", "due"));
    expect(a).not.toBe(documentExpiryDedupeKey(7, "2027-11-29", "due"));
    expect(a).not.toBe(documentExpiryDedupeKey(7, "2026-11-29", "expired"));
    expect(a).not.toBe(documentExpiryDedupeKey(8, "2026-11-29", "due"));
  });

  it("les préfixes de levée d'un document ne couvrent pas un autre id qui commence pareil (1 / 12)", () => {
    const prefixes = documentExpiryDedupeKeyPrefixes(1);
    const own = [documentExpiryDedupeKey(1, "2026-11-29", "due"), documentExpiryDedupeKey(1, "2026-11-29", "expired")];
    const other = [documentExpiryDedupeKey(12, "2026-11-29", "due"), documentExpiryDedupeKey(10, "2026-11-29", "expired")];
    const covered = (key: string) => prefixes.some((p) => key.startsWith(p));
    expect(own.every(covered)).toBe(true);
    expect(other.some(covered)).toBe(false);
  });
});
