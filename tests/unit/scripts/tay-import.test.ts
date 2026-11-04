import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  buildTestVehicle,
  buildVehicleRecords,
  classifyPlate,
  DEFAULT_FIRST_NAME,
  driverNeedsUpdate,
  excelSerialToIsoDate,
  normalizeLocation,
  normalizePlate,
  normalizeSupplierCategory,
  oneEditApart,
  parseDocumentation,
  parseDrivers,
  parseSheetDate,
  parseSuppliers,
  parseTruckTracking,
  pickLatestFile,
  reconcileTrackingPlates,
  splitDriverName,
  TEST_VEHICLE_KEY,
  vehicleNeedsUpdate,
  type ExistingVehicle,
  type SheetRows,
} from "../../../scripts/lib/tay-import";

describe("oneEditApart / reconcileTrackingPlates", () => {
  it("détecte exactement une frappe d'écart", () => {
    expect(oneEditApart("CETTR958AE", "CETR958AE")).toBe(true);
    expect(oneEditApart("LTT919AO", "LTTR919AO")).toBe(true);
    expect(oneEditApart("LTTR919AO", "LTTR919AP")).toBe(true);
    expect(oneEditApart("LTTR919AO", "LTTR919AO")).toBe(false);
    expect(oneEditApart("LT919AO", "LTTR919AO")).toBe(false);
  });

  it("rattache la faute de frappe à l'unique plaque connue et garde le kilométrage maximal", () => {
    const { trucks, anomalies } = reconcileTrackingPlates(
      [
        { key: "CETR958AE", maxKm: 504017, location: "NGAOUNDERE", issue: null },
        { key: "CETTR958AE", maxKm: 466580, location: null, issue: "unusual" },
      ],
      new Set(["CETR958AE"]),
    );
    expect(trucks).toEqual([{ key: "CETR958AE", maxKm: 504017, location: "NGAOUNDERE", issue: null }]);
    expect(anomalies.map((a) => a.detail)).toEqual(["CETTR958AE -> CETR958AE"]);
  });

  it("ne corrige rien si plusieurs plaques sont candidates", () => {
    const { trucks, anomalies } = reconcileTrackingPlates(
      [{ key: "LTTR919A", maxKm: 2, location: null, issue: "unusual" }],
      new Set(["LTTR919AO", "LTTR919AP"]),
    );
    expect(trucks[0].key).toBe("LTTR919A");
    expect(anomalies).toHaveLength(0);
  });
});

describe("normalizePlate / classifyPlate", () => {
  it("met en majuscules et retire espaces, tirets et ponctuation", () => {
    expect(normalizePlate("LTTR 077 AU ")).toBe("LTTR077AU");
    expect(normalizePlate("lt-tr-077.au")).toBe("LTTR077AU");
    expect(normalizePlate("TEST-0001")).toBe(TEST_VEHICLE_KEY);
    expect(normalizePlate(null)).toBe("");
  });

  it("signale châssis, plaque tronquée et forme hors modèle", () => {
    expect(classifyPlate("LTTR077AU")).toBeNull();
    expect(classifyPlate("ADSR123AB")).toBeNull();
    expect(classifyPlate("CH123456")).toBe("chassis");
    expect(classifyPlate("CH")).toBe("incomplete");
    expect(classifyPlate("")).toBe("incomplete");
    expect(classifyPlate("CETTR123AE")).toBe("unusual");
    expect(classifyPlate("LTT123AO")).toBe("unusual");
    expect(classifyPlate(TEST_VEHICLE_KEY)).toBeNull();
  });
});

describe("dates", () => {
  it("convertit un numéro de série Excel sans décalage", () => {
    expect(excelSerialToIsoDate(45970)).toBe("2025-11-09");
    expect(excelSerialToIsoDate(44273.75)).toBe("2021-03-18");
    expect(excelSerialToIsoDate(5)).toBeNull();
  });

  it("garde une date expirée telle quelle", () => {
    expect(parseSheetDate(44216)).toEqual({ date: "2021-01-20", invalid: false });
  });

  it("lit JJ/MM/AAAA, JJ/MM/AA et AAAA-MM-JJ", () => {
    expect(parseSheetDate("24/03/2021").date).toBe("2021-03-24");
    expect(parseSheetDate("5/1/25").date).toBe("2025-01-05");
    expect(parseSheetDate("2026-02-28").date).toBe("2026-02-28");
  });

  it("signale une date illisible ou impossible sans la deviner", () => {
    expect(parseSheetDate("24/0/2021")).toEqual({ date: null, invalid: true });
    expect(parseSheetDate("31/02/2025")).toEqual({ date: null, invalid: true });
    expect(parseSheetDate("bientôt")).toEqual({ date: null, invalid: true });
  });

  it("traite vide, / et null comme absents", () => {
    for (const v of [null, undefined, "", " ", "/"]) expect(parseSheetDate(v)).toEqual({ date: null, invalid: false });
  });

  it("ajoute des mois en bornant à la fin du mois", () => {
    expect(addMonthsIso("2026-11-04", 9)).toBe("2027-08-04");
    expect(addMonthsIso("2026-08-31", 6)).toBe("2027-02-28");
  });
});

describe("catégories et libellés", () => {
  it("ramène les FAMILLE aux cinq catégories", () => {
    expect(normalizeSupplierCategory("PIECES DETACHEES")).toBe("Pièces");
    expect(normalizeSupplierCategory("ASSURANCE AUTO-MOBILE")).toBe("Assurance");
    expect(normalizeSupplierCategory("ASSURANCE")).toBe("Assurance");
    expect(normalizeSupplierCategory("CARBURANT")).toBe("Carburant");
    expect(normalizeSupplierCategory("INTERNET")).toBe("Télécom");
    expect(normalizeSupplierCategory("GPS")).toBe("Télécom");
    expect(normalizeSupplierCategory("VISITE TECHNIQUE")).toBe("Autre");
    expect(normalizeSupplierCategory("MATERIELS")).toBe("Autre");
    expect(normalizeSupplierCategory(null)).toBe("Autre");
  });

  it("normalise NDERE / NDRE en NGAOUNDERE", () => {
    expect(normalizeLocation("NDERE")).toBe("NGAOUNDERE");
    expect(normalizeLocation(" ndre ")).toBe("NGAOUNDERE");
    expect(normalizeLocation("Ngaoundéré")).toBe("NGAOUNDERE");
    expect(normalizeLocation("Douala")).toBe("DOUALA");
    expect(normalizeLocation(null)).toBeNull();
  });

  it("découpe le nom ; un seul mot donne le prénom par défaut", () => {
    expect(splitDriverName("AAA BBB CCC")).toEqual({ firstName: "AAA BBB", lastName: "CCC" });
    expect(splitDriverName(" AAA ")).toEqual({ firstName: DEFAULT_FIRST_NAME, lastName: "AAA" });
  });

  it("choisit le fichier au suffixe le plus récent", () => {
    expect(pickLatestFile(["CPC ET HABILITATION_1.xlsx", "CPC ET HABILITATION_9.xlsx", "autre.xlsx", "CPC ET HABILITATION_5.docx"], "CPC ET HABILITATION"))
      .toBe("CPC ET HABILITATION_9.xlsx");
    expect(pickLatestFile([], "X")).toBeNull();
  });
});

// Classeurs fictifs, même mise en page que les originaux.
const docRows: SheetRows = [
  ["SOCIETE"], [null], ["SUIVI"],
  ["DOCUMENTS", null, "CLIENTS", "VALIDITE 10 ANS", null, null, "VALIDITE 01 AN", null, null, "VALIDITE 06 MOIS", null, null, null, null, null, null, null, null, null, null, null, null, null, null, "VALIDITE 01 AN"],
  [null, null, null, "CARTES GRISES TR", null, null, "CARTE BLEU TR / SR", null, null, "VISITE TECHNIQUE TR", null, null, null, null, null, null, null, null, null, null, null, null, null, null, "ASSURANCE "],
  ["VEHICULES", "TYPES", null, "EMISSION", "EXPIRATION", null, "EMISSION", "EXPIRATION", null, "EMISSION", "EXPIRATION", null, null, null, null, null, null, null, null, null, null, null, null, null, "EMISSION", "EXPIRATION"],
  ["XXTR 001 AA ", "TR", "DIVERS", 44273, 47925, null, 45702, 46067, null, 45786, 45970, null, null, null, null, null, null, null, null, null, null, null, null, null, 45700, 46065],
  ["XXSR 001 AA", "SR", "DIVERS", "24/0/2021", 47925, null, 45702, 46067, null, null, "pas lue", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ["CH 123456", "TR", "DIVERS"],
  ["CH", "SR", "DIVERS", 44273],
  ["XXTR 001-AA", "TR", "DIVERS", null, 48000],
  [null, null, null, "TABLEAU DES AGES"],
  [null, null, null, "ANNEE", 2019, 2020],
];

describe("parseDocumentation", () => {
  const { vehicles, anomalies } = parseDocumentation(docRows);

  it("lit les échéances, l'année de la carte grise et ignore le tableau des âges", () => {
    expect(vehicles.map((v) => v.key)).toEqual(["XXTR001AA", "XXSR001AA", "CH123456"]);
    expect(vehicles[0]).toMatchObject({
      vehicleType: "tracteur", year: 2021, yearSource: "carte grise",
      licensePlateExpiry: "2031-03-18", technicalInspectionDate: "2025-11-09", insuranceExpiry: "2026-02-12",
    });
  });

  it("se replie sur la carte bleue quand l'émission de carte grise est illisible", () => {
    expect(vehicles[1]).toMatchObject({ vehicleType: "semi_remorque", year: 2025, yearSource: "carte bleue", technicalInspectionDate: null });
  });

  it("signale châssis, plaque incomplète, doublon et dates invalides", () => {
    const kinds = anomalies.map((a) => a.kind);
    expect(kinds).toContain("numéro de châssis à la place de la plaque");
    expect(kinds).toContain("plaque incomplète, ligne ignorée");
    expect(kinds).toContain("plaque en double, fusionnée avec la première ligne");
    expect(anomalies.filter((a) => a.kind === "date invalide").map((a) => a.detail).sort())
      .toEqual(["carte grise émission", "visite technique expiration"]);
  });

  it("refuse une mise en page inattendue", () => {
    expect(() => parseDocumentation([["autre"]])).toThrow(/VEHICULES/);
  });
});

describe("parseTruckTracking", () => {
  const rows: SheetRows = [
    [null, null, "SUIVI"], [null],
    ["DATE", "N° Camions", "Lieu", "Marques", "Quantités", "Position", "Kilométrage actuel (km)", "Lieu", "Kilométrage actuel (km)"],
    [45717, "XXTR 001AA", "NDERE", null, 1, null, 300000, null, null],
    [45718, "XXTR001AA", "NDRE", null, 1, null, null, null, 310500.4],
    [45719, "XXTR001AA", null, null, 1, null, 290000, null, null],
    [45719, "XXTTR002AA", null, null, 1, null, 9_999_999, null, null],
    [45719, null, "NDERE"],
  ];
  const { trucks, anomalies, plateRows } = parseTruckTracking(rows);

  it("garde le kilométrage maximal toutes colonnes confondues et le lieu de cette ligne", () => {
    expect(plateRows).toBe(4);
    expect(trucks.find((t) => t.key === "XXTR001AA")).toEqual({ key: "XXTR001AA", maxKm: 310500, location: "NGAOUNDERE", issue: null });
  });

  it("ignore un kilométrage hors bornes et signale la plaque hors modèle", () => {
    expect(trucks.find((t) => t.key === "XXTTR002AA")?.maxKm).toBeNull();
    expect(anomalies.map((a) => a.kind)).toEqual(expect.arrayContaining(["kilométrage hors bornes ignoré", "plaque hors modèle"]));
  });
});

describe("parseDrivers", () => {
  const rows: SheetRows = [
    ["SUIVI CNI"],
    ["N°", "NOM DU CHAUFFEUR", "DATE NAISSANCE", "VALIDITE CNI", "FORMATON GEOIS", "N° PERMIS", 45818, "VALIDITE PERMIS", "DATE FORMATION CPC", "STATUT FORMATION CPC"],
    [1, "AAA BBB", 25934, 45593, 45944, "XX -1  - 10", null, 45894, null, ""],
    [2, "CCC", 27861, 45657, 45944, "XX-2", null, 46751, null, ""],
    [3, null, null, null, null, null, null, null, null, ""],
    [null, null, "x", 45000],
  ];
  const { drivers, anomalies } = parseDrivers(rows);

  it("crée un chauffeur par ligne nommée, clé TAY-NNN, cpc non renseigné", () => {
    expect(drivers.map((d) => d.employeeNumber)).toEqual(["TAY-001", "TAY-002"]);
    expect(drivers[0]).toMatchObject({ firstName: "AAA", lastName: "BBB", birthDate: "1971-01-01", licenseNumber: "XX -1 - 10", cpcTrainingDate: null });
    expect(drivers[1]).toMatchObject({ firstName: DEFAULT_FIRST_NAME, lastName: "CCC" });
  });

  it("compte les lignes numérotées vides et les résidus sans les importer", () => {
    expect(anomalies.map((a) => [a.kind, a.detail])).toEqual(expect.arrayContaining([
      ["lignes numérotées sans nom ignorées", "1"],
      ["lignes sans N° (résidus de formules) ignorées", "1"],
    ]));
  });

  it("ne voit pas de changement quand la base porte déjà les valeurs", () => {
    const d = drivers[0];
    expect(driverNeedsUpdate({ ...d, id: 1 }, d)).toBe(false);
    expect(driverNeedsUpdate({ ...d, id: 1, licenseExpiry: null }, d)).toBe(true);
    expect(driverNeedsUpdate({ ...d, id: 1 }, { ...d, cpcTrainingDate: null })).toBe(false);
  });
});

describe("parseSuppliers", () => {
  const recap: SheetRows = [["RÉCAP"], ["FOURNISSEURS", "MONTANT"], [null, null, 0], ["ALPHA", 1], ["BETA", 2], ["GAMMA", 3], ["TOTAL", 6]];
  const sheet = (fam: (string | number)[]): SheetRows => [["X"], ["MOIS", "DATE", "FAMILLE"], [null], ...fam.map((f) => [1, 2, f])];
  const { suppliers, anomalies } = parseSuppliers(recap, {
    ALPHA: sheet(["PIECES DETACHEES", "PIECES DETACHEES"]),
    BETA: sheet(["ASSURANCE", 1, "ELVIS", "ASSURANCE"]),
  });

  it("exclut TOTAL et prend la FAMILLE majoritaire", () => {
    expect(suppliers).toEqual([
      { name: "ALPHA", category: "Pièces" },
      { name: "BETA", category: "Assurance" },
      { name: "GAMMA", category: "Autre" },
    ]);
    expect(anomalies).toHaveLength(1);
  });
});

describe("véhicules : assemblage, véhicule de test, idempotence du diff", () => {
  const today = "2026-11-04";
  const doc = parseDocumentation(docRows).vehicles;
  const trucks = [{ key: "XXTR001AA", maxKm: 310500, location: "NGAOUNDERE", issue: null }, { key: "XXTR009ZZ", maxKm: 5, location: null, issue: null }];
  const records = buildVehicleRecords(doc, trucks, today);

  it("unit les deux sources, défauts Non renseigné, kilométrage rattaché", () => {
    expect(records.map((r) => r.key)).toEqual(["XXTR001AA", "XXSR001AA", "CH123456", "XXTR009ZZ"]);
    expect(records[0]).toMatchObject({ brand: "Non renseigné", model: "Non renseigné", km: 310500, location: "NGAOUNDERE" });
    expect(records[0].notes).toContain("année estimée");
    expect(records[2].notes).toContain("châssis");
    expect(records[3]).toMatchObject({ vehicleType: "tracteur", year: 2026, licensePlateExpiry: null });
  });

  it("donne au véhicule de test des échéances entre 6 et 12 mois, stables d'une exécution à l'autre", () => {
    const t = buildTestVehicle(today);
    expect(t).toMatchObject({ key: TEST_VEHICLE_KEY, brand: "Véhicule de test", licensePlateExpiry: "2027-08-04" });
    expect(t.notes).toContain("ne correspond à aucun camion réel");
    const later = buildTestVehicle("2026-12-20", t);
    expect(later.insuranceExpiry).toBe(t.insuranceExpiry);
    expect(buildTestVehicle("2027-03-01", t).insuranceExpiry).toBe("2027-12-01");
  });

  const existing = (over: Partial<ExistingVehicle> = {}): ExistingVehicle => ({
    id: 1, registrationNumber: "XXTR001AA", deleted: false,
    licensePlateExpiry: "2031-03-18", insuranceExpiry: "2026-02-12", technicalInspectionDate: "2025-11-09",
    mileage: 310500, lastMileage: 310500, currentKilometers: 310500, locationCode: "NGAOUNDERE", ...over,
  });

  it("ne réécrit rien quand la fiche est à jour, et le kilométrage ne recule jamais", () => {
    expect(vehicleNeedsUpdate(existing(), records[0])).toBe(false);
    expect(vehicleNeedsUpdate(existing({ mileage: 400000, lastMileage: 400000, currentKilometers: 400000 }), records[0])).toBe(false);
    expect(vehicleNeedsUpdate(existing({ insuranceExpiry: null }), records[0])).toBe(true);
    expect(vehicleNeedsUpdate(existing({ currentKilometers: null }), records[0])).toBe(true);
  });
});
