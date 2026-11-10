import { describe, expect, it } from "vitest";
import { formatOfflineStamp, offlineBannerText, offlineReadOnlyBannerText } from "../../../client/src/lib/offline-data-banner";

const read = new Date(2026, 10, 10, 14, 5).getTime();
const until = new Date(2026, 10, 13, 8, 30).getTime();

describe("bandeau hors ligne : échéance de la session hors ligne", () => {
  it("cite la date des données puis l'échéance", () => {
    expect(formatOfflineStamp(until)).toBe("13/11/2026 à 08:30");
    expect(offlineBannerText({ online: false, updatedAt: read, expiresAt: until })).toBe(
      "Hors ligne, données du 10/11/2026 à 14:05, session hors ligne jusqu'au 13/11/2026 à 08:30",
    );
  });

  it("sans échéance connue, le texte d'avant est inchangé", () => {
    expect(offlineBannerText({ online: false, updatedAt: read })).toBe("Hors ligne, données du 10/11/2026 à 14:05");
    expect(offlineBannerText({ online: false, updatedAt: read, expiresAt: null })).toBe(
      "Hors ligne, données du 10/11/2026 à 14:05",
    );
  });

  it("toujours absent en ligne", () => {
    expect(offlineBannerText({ online: true, updatedAt: read, expiresAt: until })).toBeNull();
  });
});

describe("bandeau de consultation seule (reprise hors ligne)", () => {
  it("cite les données puis l'échéance de la consultation", () => {
    expect(offlineReadOnlyBannerText({ updatedAt: read, expiresAt: until })).toBe(
      "Hors ligne. Données du 10/11/2026 à 14:05. Consultation seule jusqu'au 13/11/2026 à 08:30.",
    );
  });

  it("sans date de données, « Données du » est omis", () => {
    expect(offlineReadOnlyBannerText({ updatedAt: null, expiresAt: until })).toBe(
      "Hors ligne. Consultation seule jusqu'au 13/11/2026 à 08:30.",
    );
  });
});
