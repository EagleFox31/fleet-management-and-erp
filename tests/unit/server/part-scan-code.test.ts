import { describe, expect, it } from "vitest";
import {
  PART_ID_MAX,
  PART_LABELS_MAX_IDS,
  partLabelsQuerySchema,
  partScanResolveQuerySchema,
} from "../../../shared/contracts/part-scans";
import {
  SCAN_CODE_FORMATS,
  buildPartScanPayload,
  parseScanCode,
  referenceFormat,
  type ScanCodeFormat,
} from "../../../server/lib/part-scan-code";

/** Charge utile et lecture des codes de pièces (CDC-3) : fonctions pures, sans base ni serveur. */

const fm = (partId: number) => ({ format: "fleetmaster", version: 1, partId });
const ref = (reference: string) => ({ format: "reference", reference });

describe("charge utile", () => {
  it("URL relative versionnée, stable, sans hôte", () => {
    expect(buildPartScanPayload(12)).toBe("/inventory/scan?c=FM1:12");
    expect(buildPartScanPayload(1)).toBe("/inventory/scan?c=FM1:1");
    expect(buildPartScanPayload(PART_ID_MAX)).toBe(`/inventory/scan?c=FM1:${PART_ID_MAX}`);
    expect(buildPartScanPayload(12)).not.toMatch(/^[a-z]+:\/\//i);
  });

  it("ne contient que l'identifiant : aucun prix, aucune donnée de la fiche", () => {
    expect(buildPartScanPayload(20)).toMatch(/^\/inventory\/scan\?c=FM1:20$/);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, PART_ID_MAX + 1, Number.MAX_SAFE_INTEGER + 1])(
    "refuse l'identifiant %s",
    (id) => {
      expect(() => buildPartScanPayload(id)).toThrow(RangeError);
    },
  );
});

describe("aller-retour", () => {
  it.each([1, 7, 20, 13_000, PART_ID_MAX])("la charge utile de %s est relue telle quelle", (id) => {
    expect(parseScanCode(buildPartScanPayload(id))).toEqual(fm(id));
  });

  it("avec un préfixe d'origine, le client préfixe, le serveur relit la même pièce", () => {
    for (const origin of ["https://app.exemple.test", "http://192.168.1.20:5000", "https://a.b.c.d.example/fleet"]) {
      expect(parseScanCode(origin + buildPartScanPayload(42))).toEqual(fm(42));
    }
  });
});

describe("parseur tolérant", () => {
  it.each([
    ["FM1:12", 12],
    ["fm1:12", 12],
    ["Fm1:12", 12],
    ["  FM1:12  ", 12],
    ["\tFM1:12\r\n", 12],
    ["FM1 : 12", 12],
    ["FM1: 12", 12],
    ["ＦＭ１：１２", 12],
    ["/inventory/scan?c=FM1:12", 12],
    ["/inventory/scan?c=FM1%3A12", 12],
    ["/inventory/scan/?c=FM1:12", 12],
    ["/INVENTORY/Scan?C=fm1:12", 12],
    ["/inventory/scan?utm=x&c=FM1:12#haut", 12],
    ["  /inventory/scan?c=FM1:12  ", 12],
    ["http://localhost:5000/inventory/scan?c=FM1:12", 12],
    ["https://fleet.exemple.test/inventory/scan?c=FM1:12", 12],
    ["HTTPS://FLEET.EXEMPLE.TEST/inventory/scan?c=FM1:12", 12],
    ["https://exemple.test/prefixe/inventory/scan?c=FM1:12", 12],
    ["https://user:mdp@exemple.test:8443/inventory/scan?c=FM1:12", 12],
    ["//exemple.test/inventory/scan?c=FM1:12", 12],
  ])("%j -> pièce %i", (input, partId) => {
    expect(parseScanCode(input)).toEqual(fm(partId));
  });

  it("une chaîne qui n'est pas une charge utile est une référence interne, casse conservée", () => {
    expect(parseScanCode("FIL-001")).toEqual(ref("FIL-001"));
    expect(parseScanCode("  fil-001 ")).toEqual(ref("fil-001"));
    expect(parseScanCode("AB/123")).toEqual(ref("AB/123"));
    expect(parseScanCode("1234567890128")).toEqual(ref("1234567890128"));
    expect(parseScanCode("FMX-12")).toEqual(ref("FMX-12"));
  });
});

describe("entrées hostiles et inconnues", () => {
  it.each([
    ["chaîne vide", ""],
    ["espaces", "   \t\n"],
    ["version inconnue", "FM2:12"],
    ["version 0", "FM0:12"],
    ["version inconnue dans une URL", "/inventory/scan?c=FM2:12"],
    ["préfixe FM seul", "FM1:"],
    ["identifiant nul", "FM1:0"],
    ["identifiant négatif", "FM1:-5"],
    ["zéros en tête (deux codes pour une pièce)", "FM1:012"],
    ["identifiant décimal", "FM1:1.5"],
    ["identifiant avec suffixe", "FM1:12abc"],
    ["identifiant exponentiel", "FM1:1e3"],
    ["hors bornes int32", `FM1:${PART_ID_MAX + 1}`],
    ["hors bornes numériques", "FM1:99999999999999999999"],
    ["trop de chiffres", "FM1:00000000000012"],
    ["URL d'une autre page", "https://exemple.test/vehicles?c=FM1:12"],
    ["URL sans clé c", "/inventory/scan?code=FM1:12"],
    ["URL avec clé c répétée", "/inventory/scan?c=FM1:12&c=FM1:13"],
    ["URL sans paramètre", "/inventory/scan"],
    ["protocole javascript", "javascript://exemple.test/inventory/scan?c=FM1:12"],
    ["protocole ftp", "ftp://exemple.test/inventory/scan?c=FM1:12"],
    ["URL illisible", "http://[::1/inventory/scan?c=FM1:12"],
    ["caractère de contrôle", "FIL\u0000-001"],
    ["saut de ligne interne", "FIL-001\nFIL-002"],
    ["séparateur de ligne Unicode", `FIL${String.fromCharCode(0x2028)}-001`],
    ["référence trop longue", "A".repeat(101)],
    ["chemin absolu qui n'est pas le scan", "/etc/passwd"],
  ])("%s est refusé (null)", (_label, input) => {
    expect(parseScanCode(input)).toBeNull();
  });

  it("jamais d'exception sur une entrée quelconque", () => {
    for (const input of [undefined, null, 12, {}, [], ["FM1:12"], true, Symbol.iterator, () => 1] as unknown[]) {
      expect(() => parseScanCode(input)).not.toThrow();
      expect(parseScanCode(input)).toBeNull();
    }
  });

  it("entrée démesurée : refus rapide, sans exception", () => {
    const huge = "FM1:" + "1".repeat(1_000_000);
    const startedAt = Date.now();
    expect(parseScanCode(huge)).toBeNull();
    expect(parseScanCode("/inventory/scan?c=" + "%".repeat(500_000))).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("injection SQL ou script : lue comme référence, jamais exécutée ici (la requête est paramétrée)", () => {
    expect(parseScanCode("'; DROP TABLE parts; --")).toEqual(ref("'; DROP TABLE parts; --"));
    expect(parseScanCode("<script>alert(1)</script>")).toEqual(ref("<script>alert(1)</script>"));
  });

  it("une charge utile FleetMaster malformée ne retombe jamais en référence", () => {
    for (const input of ["FM1:abc", "FM1:", "FM1:012", "FM9:1", "fm2 : 5"]) {
      expect(parseScanCode(input), input).toBeNull();
    }
  });
});

describe("point d'extension : un format de plus sans toucher aux autres", () => {
  const ean13: ScanCodeFormat = {
    id: "reference",
    parse: (raw) => (/^\d{13}$/.test(raw.trim()) ? { format: "reference", reference: `EAN:${raw.trim()}` } : null),
  };

  it("un format ajouté devant les autres est essayé en premier, les autres restent intacts", () => {
    const formats = [ean13, ...SCAN_CODE_FORMATS];
    expect(parseScanCode("3017620422003", formats)).toEqual(ref("EAN:3017620422003"));
    expect(parseScanCode("FM1:12", formats)).toEqual(fm(12));
    expect(parseScanCode("FIL-001", formats)).toEqual(ref("FIL-001"));
  });

  it("les formats par défaut ne lisent pas EAN comme tel (hors périmètre, décision en attente)", () => {
    expect(parseScanCode("3017620422003")).toEqual(ref("3017620422003"));
    expect(SCAN_CODE_FORMATS.map((format) => format.id)).toEqual(["fleetmaster", "reference"]);
  });

  it("la référence libre passe en dernier", () => {
    expect(SCAN_CODE_FORMATS[SCAN_CODE_FORMATS.length - 1]).toBe(referenceFormat);
  });
});

describe("schémas du contrat", () => {
  it("code : borné en longueur, requis, texte seul", () => {
    expect(partScanResolveQuerySchema.parse({ code: "  FM1:12 " })).toEqual({ code: "FM1:12" });
    expect(partScanResolveQuerySchema.safeParse({}).success).toBe(false);
    expect(partScanResolveQuerySchema.safeParse({ code: "" }).success).toBe(false);
    expect(partScanResolveQuerySchema.safeParse({ code: "   " }).success).toBe(false);
    expect(partScanResolveQuerySchema.safeParse({ code: "a".repeat(301) }).success).toBe(false);
    expect(partScanResolveQuerySchema.safeParse({ code: "a".repeat(300) }).success).toBe(true);
    expect(partScanResolveQuerySchema.safeParse({ code: ["FM1:1", "FM1:2"] }).success).toBe(false);
    expect(partScanResolveQuerySchema.safeParse({ code: { $ne: "" } }).success).toBe(false);
  });

  it("ids : entiers stricts, dédoublonnés, ordre conservé", () => {
    expect(partLabelsQuerySchema.parse({ ids: "3,1,2" }).ids).toEqual([3, 1, 2]);
    expect(partLabelsQuerySchema.parse({ ids: " 3 , 1 ,3" }).ids).toEqual([3, 1]);
    expect(partLabelsQuerySchema.parse({ ids: "7" }).ids).toEqual([7]);
  });

  it.each(["", "a", "1,,2", "1,2,", "1.5", "12abc", "0", "-1", "01", "1e3", String(PART_ID_MAX + 1), "99999999999999999999", " "])(
    "ids %j refusé, jamais tronqué",
    (ids) => {
      expect(partLabelsQuerySchema.safeParse({ ids }).success).toBe(false);
    },
  );

  it("ids : manquant ou répété refusé", () => {
    expect(partLabelsQuerySchema.safeParse({}).success).toBe(false);
    expect(partLabelsQuerySchema.safeParse({ ids: ["1", "2"] }).success).toBe(false);
  });

  it(`ids : ${PART_LABELS_MAX_IDS} pièces au plus`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => i + 1).join(",");
    expect(partLabelsQuerySchema.parse({ ids: many(PART_LABELS_MAX_IDS) }).ids).toHaveLength(PART_LABELS_MAX_IDS);
    expect(partLabelsQuerySchema.safeParse({ ids: many(PART_LABELS_MAX_IDS + 1) }).success).toBe(false);
    // Les doublons comptent : la borne protège la requête, pas seulement le résultat.
    expect(partLabelsQuerySchema.safeParse({ ids: Array(PART_LABELS_MAX_IDS + 1).fill("5").join(",") }).success).toBe(false);
  });
});
