import { describe, expect, it } from "vitest";
import {
  ALL_APP_ROLES,
  GPS_VIEW_ROLES,
  IMPORT_INTERVENTION_ROLES,
  IMPORT_ROLES,
  KPI_VIEWER_ROLES,
  MAINTENANCE_REPORT_ROLES,
  MISSION_ADVISORY_ROLES,
  PART_LABEL_ROLES,
  PART_SALE_READ_ROLES,
  PART_SALE_ROLES,
  PART_SCAN_ROLES,
} from "../../../shared/constants/roles";
import { FEATURE_FLAGS, resolveFeatureFlags } from "../../../shared/feature-flags";

/** Drapeaux et groupes de rôles du lot CDC-0a : les lots suivants s'appuient sur ces noms exacts. */
describe("drapeaux CDC", () => {
  const CDC_FLAGS = {
    "mission-maintenance-advisory": "Avis de maintenance sur mission",
    "part-qr": "Étiquettes et scan QR des pièces",
    "part-sales": "Vente de pièces",
    "kpi-reports": "Rapports d'indicateurs",
    "maintenance-report": "Rapport de maintenance",
    "excel-import": "Import Excel",
    "technician-offline": "Saisie hors ligne du technicien",
  } as const;

  it("7 clés de niveau should, coupées par défaut, libellés français", () => {
    for (const [key, label] of Object.entries(CDC_FLAGS)) {
      expect(FEATURE_FLAGS[key as keyof typeof FEATURE_FLAGS], key).toEqual({ level: "should", defaultEnabled: false, label });
    }
  });

  it("offline-writes (lot #10b) : protection serveur coupée par défaut, distincte des drapeaux d'écran", () => {
    expect(FEATURE_FLAGS["offline-writes"]).toEqual({ level: "should", defaultEnabled: false, label: "Écritures rejouables sans doublon" });
    expect(resolveFeatureFlags("technician-offline=on")["offline-writes"]).toBe(false);
  });

  it("gps n'est pas dupliqué et reste coupé", () => {
    expect(Object.keys(FEATURE_FLAGS).filter((key) => key === "gps")).toHaveLength(1);
    expect(resolveFeatureFlags(undefined).gps).toBe(false);
  });

  it("la surcharge d'environnement allume une clé CDC", () => {
    expect(resolveFeatureFlags("part-qr=on")["part-qr"]).toBe(true);
    expect(resolveFeatureFlags("part-qr=on")["part-sales"]).toBe(false);
  });
});

describe("groupes de rôles CDC", () => {
  it("valeurs figées", () => {
    expect([...PART_LABEL_ROLES]).toEqual(["admin", "warehouse"]);
    expect([...PART_SCAN_ROLES]).toEqual(["admin", "warehouse", "workshop_manager", "technician"]);
    expect([...PART_SALE_ROLES]).toEqual(["admin", "warehouse", "secretary"]);
    expect([...PART_SALE_READ_ROLES]).toEqual(["admin", "warehouse", "secretary", "management"]);
    expect([...GPS_VIEW_ROLES]).toEqual(["admin", "logistics", "management", "workshop_manager"]);
    expect([...IMPORT_ROLES]).toEqual(["admin"]);
    expect([...IMPORT_INTERVENTION_ROLES]).toEqual(["admin", "workshop_manager"]);
    expect([...MAINTENANCE_REPORT_ROLES]).toEqual(["admin", "workshop_manager", "management"]);
    expect([...MISSION_ADVISORY_ROLES]).toEqual(["admin", "logistics", "workshop_manager"]);
  });

  it("tous les rôles existent dans le schéma", () => {
    const groups = [
      PART_LABEL_ROLES, PART_SCAN_ROLES, PART_SALE_ROLES, PART_SALE_READ_ROLES, GPS_VIEW_ROLES,
      IMPORT_ROLES, IMPORT_INTERVENTION_ROLES, MAINTENANCE_REPORT_ROLES, MISSION_ADVISORY_ROLES,
    ];
    for (const group of groups) for (const role of group) expect(ALL_APP_ROLES).toContain(role);
  });

  it("KPI_VIEWER_ROLES : admin, direction et chef d'atelier (lot #7)", () => {
    expect([...KPI_VIEWER_ROLES]).toEqual(["admin", "management", "workshop_manager"]);
  });
});
