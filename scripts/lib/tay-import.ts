/**
 * Import TAY : lecture des classeurs du client et normalisation, sans base de données.
 *
 * Tout ce qui est ici est pur (lignes de feuille en entrée, enregistrements et anomalies en sortie)
 * pour être testé sans fichier ni base : tests/unit/scripts/tay-import.test.ts.
 * L'écriture en base vit dans scripts/import-tay.ts.
 */

export type Cell = string | number | boolean | null | undefined;
export type SheetRows = Cell[][];

export const DEFAULT_TEXT = "Non renseigné";
/** Prénom d'un chauffeur connu par un seul mot : le mot va dans last_name. */
export const DEFAULT_FIRST_NAME = DEFAULT_TEXT;
export const TEST_VEHICLE_KEY = "TEST0001";
export const TEST_VEHICLE_LABEL = "Véhicule de test";
export const TEST_VEHICLE_NOTES = "Véhicule fictif pour les tests et la démo, ne correspond à aucun camion réel";

export type VehicleType = "tracteur" | "semi_remorque" | "autre";
export type SupplierCategory = "Pièces" | "Assurance" | "Carburant" | "Télécom" | "Autre";

export interface Anomaly {
  source: string;
  /** Ligne Excel (1 = première ligne), absente pour une anomalie globale. */
  row?: number;
  kind: string;
  /** Détail sans donnée personnelle : une plaque de camion ou un en-tête, jamais un nom. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Plaques
// ---------------------------------------------------------------------------

/**
 * Clé et forme canonique d'une plaque : majuscules, sans espace, tiret ni ponctuation.
 * Même expression que l'index vehicles_registration_key_idx (server/init-database.ts).
 */
export function normalizePlate(raw: Cell): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type PlateIssue = "chassis" | "incomplete" | "unusual";

const STANDARD_PLATE = /^[A-Z]{2}(TR|SR)\d{3}[A-Z]{2}$/;

/** Plaque suspecte : numéro de châssis (CH…), plaque tronquée, ou forme hors du modèle XXTR123AB / XXSR123AB. */
export function classifyPlate(key: string): PlateIssue | null {
  if (key === TEST_VEHICLE_KEY) return null;
  if (key.length < 5) return "incomplete";
  if (/^CH\d+$/.test(key)) return "chassis";
  if (!STANDARD_PLATE.test(key)) return "unusual";
  return null;
}

/** Type déduit de la plaque, en dernier recours (la colonne TYPES fait foi quand elle existe). */
export function vehicleTypeFromPlate(key: string): VehicleType | null {
  if (/^[A-Z]{2}TR/.test(key)) return "tracteur";
  if (/^[A-Z]{2}SR/.test(key)) return "semi_remorque";
  return null;
}

export function vehicleTypeFromCode(code: Cell): VehicleType | null {
  const c = String(code ?? "").trim().toUpperCase();
  if (c === "TR") return "tracteur";
  if (c === "SR") return "semi_remorque";
  return null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MIN_YEAR = 1950;
const MAX_YEAR = 2100;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function isoFromParts(y: number, m: number, d: number): string | null {
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** Numéro de série Excel (système 1900) vers AAAA-MM-JJ ; l'heure éventuelle est ignorée. */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const t = new Date(EXCEL_EPOCH_MS + Math.floor(serial) * DAY_MS);
  const y = t.getUTCFullYear();
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  return t.toISOString().slice(0, 10);
}

export interface ParsedDate {
  date: string | null;
  /** Cellule renseignée mais illisible : à signaler, jamais deviner. */
  invalid: boolean;
}

/**
 * Lit une date de cellule telle quelle (aucun décalage, même expirée) :
 * numéro de série Excel, JJ/MM/AAAA (ou AA), ou AAAA-MM-JJ.
 */
export function parseSheetDate(cell: Cell): ParsedDate {
  if (cell === null || cell === undefined) return { date: null, invalid: false };
  if (typeof cell === "number") {
    const date = excelSerialToIsoDate(cell);
    return { date, invalid: date === null };
  }
  const s = String(cell).trim();
  if (s === "" || s === "/" || s === "-") return { date: null, invalid: false };
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const yy = Number(m[3]);
    const year = m[3].length === 2 ? 2000 + yy : yy;
    const date = isoFromParts(year, Number(m[2]), Number(m[1]));
    return { date, invalid: date === null };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const date = isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
    return { date, invalid: date === null };
  }
  return { date: null, invalid: true };
}

/** AAAA-MM-JJ décalé de `months` mois (jour borné à la fin du mois). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

/** Lieu : NDERE, NDRE, N'DERE, NGAOUNDERE → NGAOUNDERE ; autre valeur en majuscules ; vide → null. */
export function normalizeLocation(raw: Cell): string | null {
  if (raw === null || raw === undefined) return null;
  const f = fold(String(raw)).replace(/\s+/g, " ");
  if (!f) return null;
  const compact = f.replace(/[^A-Z]/g, "");
  if (["NDERE", "NDRE", "NGAOUNDERE", "NGAOUNDRE", "NGDERE"].includes(compact)) return "NGAOUNDERE";
  return f;
}

/** FAMILLE d'achat → catégorie fournisseur. L'ordre compte : « ASSURANCE AUTO-MOBILE » est une assurance. */
export function normalizeSupplierCategory(famille: Cell): SupplierCategory {
  const f = fold(String(famille ?? ""));
  if (f.includes("ASSURANCE")) return "Assurance";
  if (/PIECE/.test(f)) return "Pièces";
  if (/CARBURANT|GASOIL|GAZOLE|ESSENCE|LUBRIFIANT/.test(f)) return "Carburant";
  if (/INTERNET|TELECOM|TELEPHON|GPS/.test(f)) return "Télécom";
  return "Autre";
}

/** Dernier mot = nom, le reste = prénom. Un seul mot : nom = ce mot, prénom = DEFAULT_FIRST_NAME. */
export function splitDriverName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: DEFAULT_FIRST_NAME, lastName: parts[0] ?? DEFAULT_TEXT };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** Numéro de chauffeur stable dérivé du N° de la feuille CPC : 7 → TAY-007. */
export function driverEmployeeNumber(n: number): string {
  return `TAY-${String(Math.trunc(n)).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Feuilles
// ---------------------------------------------------------------------------

function text(cell: Cell): string {
  return cell === null || cell === undefined ? "" : String(cell).trim();
}

function findRow(rows: SheetRows, predicate: (r: Cell[]) => boolean, limit = 20): number {
  for (let i = 0; i < Math.min(rows.length, limit); i++) if (predicate(rows[i] ?? [])) return i;
  return -1;
}

function findCol(header: Cell[], pattern: RegExp): number {
  return header.findIndex((c) => pattern.test(fold(text(c))));
}

function requireCol(header: Cell[], pattern: RegExp, source: string, label: string): number {
  const i = findCol(header, pattern);
  if (i < 0) throw new Error(`${source} : colonne « ${label} » introuvable, mise en page inattendue`);
  return i;
}

function dateField(cell: Cell, source: string, row: number, column: string, anomalies: Anomaly[]): string | null {
  const p = parseSheetDate(cell);
  if (p.invalid) anomalies.push({ source, row, kind: "date invalide", detail: column });
  return p.date;
}

export interface DocVehicle {
  key: string;
  row: number;
  vehicleType: VehicleType;
  /** Année de la carte grise (ou du premier document daté), null si aucune date. */
  year: number | null;
  yearSource: string | null;
  licensePlateExpiry: string | null;
  insuranceExpiry: string | null;
  technicalInspectionDate: string | null;
  issue: PlateIssue | null;
}

/**
 * SUIVI DOCUMENTATION CAMIONS. En-tête sur trois lignes (DOCUMENTS / CARTES GRISES… / VEHICULES, EMISSION, EXPIRATION).
 * Le tableau des âges plus bas n'a pas de plaque en colonne A : il est ignoré.
 */
export function parseDocumentation(rows: SheetRows, source = "DOCUMENTATION"): { vehicles: DocVehicle[]; anomalies: Anomaly[] } {
  const anomalies: Anomaly[] = [];
  const subHeader = findRow(rows, (r) => fold(text(r[0])) === "VEHICULES");
  if (subHeader < 1) throw new Error(`${source} : ligne d'en-tête « VEHICULES » introuvable`);
  const groups = rows[subHeader - 1] ?? [];
  const cg = requireCol(groups, /CARTES? GRISES?/, source, "CARTES GRISES");
  const cb = requireCol(groups, /CARTE BLEU/, source, "CARTE BLEU");
  const vt = requireCol(groups, /VISITE TECHNIQUE/, source, "VISITE TECHNIQUE");
  const as = requireCol(groups, /ASSURANCE/, source, "ASSURANCE");
  const sub = rows[subHeader];
  for (const [col, label] of [[cg, "CARTES GRISES"], [vt, "VISITE TECHNIQUE"], [as, "ASSURANCE"]] as const) {
    if (!/EMISSION/.test(fold(text(sub[col]))) || !/EXPIRATION/.test(fold(text(sub[col + 1])))) {
      throw new Error(`${source} : ${label} sans colonnes EMISSION / EXPIRATION`);
    }
  }

  const byKey = new Map<string, DocVehicle>();
  for (let i = subHeader + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const line = i + 1;
    const raw = text(r[0]);
    if (!raw) continue; // tableau des âges, lignes vides
    const key = normalizePlate(raw);
    const issue = classifyPlate(key);
    if (issue === "incomplete") {
      anomalies.push({ source, row: line, kind: "plaque incomplète, ligne ignorée", detail: key || "(vide)" });
      continue;
    }
    if (issue) anomalies.push({ source, row: line, kind: issue === "chassis" ? "numéro de châssis à la place de la plaque" : "plaque hors modèle", detail: key });

    const fromCode = vehicleTypeFromCode(r[1]);
    const fromPlate = vehicleTypeFromPlate(key);
    if (fromCode && fromPlate && fromCode !== fromPlate) {
      anomalies.push({ source, row: line, kind: "type TR/SR contraire à la plaque (colonne TYPES retenue)", detail: key });
    }
    const vehicleType = fromCode ?? fromPlate ?? "autre";

    let year: number | null = null;
    let yearSource: string | null = null;
    for (const [col, label] of [[cg, "carte grise"], [cb, "carte bleue"], [vt, "visite technique"]] as const) {
      const p = parseSheetDate(r[col]);
      if (p.date) {
        year = Number(p.date.slice(0, 4));
        yearSource = label;
        break;
      }
    }
    if (parseSheetDate(r[cg]).invalid) anomalies.push({ source, row: line, kind: "date invalide", detail: "carte grise émission" });

    const v: DocVehicle = {
      key,
      row: line,
      vehicleType,
      year,
      yearSource,
      licensePlateExpiry: dateField(r[cg + 1], source, line, "carte grise expiration", anomalies),
      technicalInspectionDate: dateField(r[vt + 1], source, line, "visite technique expiration", anomalies),
      insuranceExpiry: dateField(r[as + 1], source, line, "assurance expiration", anomalies),
      issue,
    };
    const prev = byKey.get(key);
    if (prev) {
      anomalies.push({ source, row: line, kind: "plaque en double, fusionnée avec la première ligne", detail: key });
      prev.licensePlateExpiry ??= v.licensePlateExpiry;
      prev.technicalInspectionDate ??= v.technicalInspectionDate;
      prev.insuranceExpiry ??= v.insuranceExpiry;
      if (prev.year === null) {
        prev.year = v.year;
        prev.yearSource = v.yearSource;
      }
      continue;
    }
    byKey.set(key, v);
  }
  return { vehicles: [...byKey.values()], anomalies };
}

export interface TruckTracking {
  key: string;
  maxKm: number | null;
  location: string | null;
  issue: PlateIssue | null;
}

const MAX_PLAUSIBLE_KM = 5_000_000;

/**
 * SUIVI DES CAMION TAY, feuille SUIVI 2025 : kilométrage maximal par plaque, toutes colonnes
 * « Kilométrage actuel » confondues ; lieu de la ligne au kilométrage maximal (sinon dernier lieu lu).
 */
export function parseTruckTracking(rows: SheetRows, source = "SUIVI 2025"): { trucks: TruckTracking[]; anomalies: Anomaly[]; plateRows: number } {
  const anomalies: Anomaly[] = [];
  const h = findRow(rows, (r) => /N. ?CAMIONS?/.test(fold(text(r[1]))));
  if (h < 0) throw new Error(`${source} : en-tête « N° Camions » introuvable`);
  const header = rows[h];
  const plateCol = 1;
  const lieuCol = requireCol(header, /^LIEUX?$/, source, "Lieu");
  const kmCols = header.map((c, i) => (/KILOMETRAGE ACTUEL/.test(fold(text(c))) ? i : -1)).filter((i) => i >= 0);
  if (kmCols.length === 0) throw new Error(`${source} : aucune colonne « Kilométrage actuel »`);

  const acc = new Map<string, { maxKm: number | null; kmLocation: string | null; lastLocation: string | null }>();
  let plateRows = 0;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const raw = text(r[plateCol]);
    if (!raw) continue;
    plateRows++;
    const key = normalizePlate(raw);
    const a = acc.get(key) ?? { maxKm: null, kmLocation: null, lastLocation: null };
    const loc = normalizeLocation(r[lieuCol]);
    if (loc) a.lastLocation = loc;
    for (const c of kmCols) {
      const v = r[c];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v < 0 || v > MAX_PLAUSIBLE_KM) {
        anomalies.push({ source, row: i + 1, kind: "kilométrage hors bornes ignoré", detail: key });
        continue;
      }
      const km = Math.round(v);
      if (a.maxKm === null || km > a.maxKm) {
        a.maxKm = km;
        a.kmLocation = loc;
      }
    }
    acc.set(key, a);
  }
  const trucks: TruckTracking[] = [];
  for (const [key, a] of acc) {
    const issue = classifyPlate(key);
    if (issue) anomalies.push({ source, kind: issue === "incomplete" ? "plaque incomplète, ignorée" : "plaque hors modèle", detail: key });
    if (issue === "incomplete") continue;
    trucks.push({ key, maxKm: a.maxKm, location: a.kmLocation ?? a.lastLocation, issue });
  }
  return { trucks, anomalies, plateRows };
}

export interface DriverRecord {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  cniExpiry: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  geoTrainingDate: string | null;
  cpcTrainingDate: string | null;
}

/** CPC ET HABILITATION, feuille CPC. Lignes numérotées sans nom et résidus de formules ignorés (comptés). */
export function parseDrivers(rows: SheetRows, source = "CPC"): { drivers: DriverRecord[]; anomalies: Anomaly[] } {
  const anomalies: Anomaly[] = [];
  const h = findRow(rows, (r) => /NOM DU CHAUFFEUR/.test(fold(text(r[1]))));
  if (h < 0) throw new Error(`${source} : en-tête « NOM DU CHAUFFEUR » introuvable`);
  const header = rows[h];
  const col = {
    num: requireCol(header, /^N.?$/, source, "N°"),
    name: requireCol(header, /NOM DU CHAUFFEUR/, source, "NOM DU CHAUFFEUR"),
    birth: requireCol(header, /NAISSANCE/, source, "DATE NAISSANCE"),
    cni: requireCol(header, /VALIDITE CNI/, source, "VALIDITE CNI"),
    geo: requireCol(header, /FORMAT\w* GEO/, source, "FORMATION GEO"),
    license: requireCol(header, /N. ?PERMIS/, source, "N° PERMIS"),
    licenseExpiry: requireCol(header, /VALIDITE PERMIS/, source, "VALIDITE PERMIS"),
    cpc: requireCol(header, /DATE FORMATION CPC/, source, "DATE FORMATION CPC"),
  };

  const drivers: DriverRecord[] = [];
  const seen = new Set<string>();
  let emptyNumbered = 0;
  let residues = 0;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const line = i + 1;
    const num = r[col.num];
    const name = text(r[col.name]);
    if (typeof num !== "number" || !Number.isInteger(num) || num <= 0) {
      if (r.some((c) => text(c) !== "")) residues++;
      continue;
    }
    if (!name) {
      emptyNumbered++;
      continue;
    }
    const employeeNumber = driverEmployeeNumber(num);
    if (seen.has(employeeNumber)) {
      anomalies.push({ source, row: line, kind: "N° de chauffeur en double, ligne ignorée", detail: employeeNumber });
      continue;
    }
    seen.add(employeeNumber);
    const { firstName, lastName } = splitDriverName(name);
    if (firstName === DEFAULT_FIRST_NAME) anomalies.push({ source, row: line, kind: "nom en un mot, prénom par défaut", detail: employeeNumber });
    const license = text(r[col.license]).replace(/\s+/g, " ");
    drivers.push({
      employeeNumber,
      firstName,
      lastName,
      birthDate: dateField(r[col.birth], source, line, "date de naissance", anomalies),
      cniExpiry: dateField(r[col.cni], source, line, "validité CNI", anomalies),
      licenseNumber: license || null,
      licenseExpiry: dateField(r[col.licenseExpiry], source, line, "validité permis", anomalies),
      geoTrainingDate: dateField(r[col.geo], source, line, "formation GEO", anomalies),
      cpcTrainingDate: dateField(r[col.cpc], source, line, "formation CPC", anomalies),
    });
  }
  if (emptyNumbered) anomalies.push({ source, kind: "lignes numérotées sans nom ignorées", detail: String(emptyNumbered) });
  if (residues) anomalies.push({ source, kind: "lignes sans N° (résidus de formules) ignorées", detail: String(residues) });
  return { drivers, anomalies };
}

export interface SupplierRecord {
  name: string;
  category: SupplierCategory;
}

/**
 * GESTION FOURNISSEURS : noms du RÉCAP GÉNÉRAL (hors TOTAL), catégorie = FAMILLE majoritaire
 * de la feuille du même nom.
 */
export function parseSuppliers(
  recap: SheetRows,
  sheets: Record<string, SheetRows>,
  source = "FOURNISSEURS",
): { suppliers: SupplierRecord[]; anomalies: Anomaly[] } {
  const anomalies: Anomaly[] = [];
  const h = findRow(recap, (r) => fold(text(r[0])) === "FOURNISSEURS");
  if (h < 0) throw new Error(`${source} : en-tête « FOURNISSEURS » du récapitulatif introuvable`);
  const suppliers: SupplierRecord[] = [];
  const seen = new Set<string>();
  const sheetByName = new Map(Object.keys(sheets).map((n) => [fold(n), sheets[n]]));
  for (let i = h + 1; i < recap.length; i++) {
    const name = text(recap[i]?.[0]).replace(/\s+/g, " ");
    if (!name || fold(name) === "TOTAL" || typeof recap[i]?.[0] === "number") continue;
    if (seen.has(fold(name))) continue;
    seen.add(fold(name));
    const sheet = sheetByName.get(fold(name));
    if (!sheet) {
      anomalies.push({ source, kind: "feuille fournisseur absente, catégorie Autre", detail: name });
      suppliers.push({ name, category: "Autre" });
      continue;
    }
    const fh = findRow(sheet, (r) => r.some((c) => fold(text(c)) === "FAMILLE"));
    const famCol = fh < 0 ? -1 : sheet[fh].findIndex((c) => fold(text(c)) === "FAMILLE");
    const counts = new Map<string, number>();
    if (famCol >= 0) {
      for (const r of sheet.slice(fh + 1)) {
        const f = r?.[famCol];
        if (typeof f !== "string" || !f.trim()) continue;
        counts.set(fold(f), (counts.get(fold(f)) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!top) anomalies.push({ source, kind: "FAMILLE illisible, catégorie Autre", detail: name });
    suppliers.push({ name, category: top ? normalizeSupplierCategory(top[0]) : "Autre" });
  }
  return { suppliers, anomalies };
}

/** Vrai si `a` et `b` diffèrent d'exactement un caractère inséré, supprimé ou remplacé. */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Faute de frappe au suivi kilométrique (CETTR… pour CETR…, LTT… pour LTTR…) : une plaque hors modèle
 * absente du suivi documentaire, à une seule frappe d'une seule plaque connue, est rattachée à celle-ci.
 * Plusieurs candidates : aucune correction, l'anomalie reste.
 */
export function reconcileTrackingPlates(trucks: TruckTracking[], knownKeys: Set<string>, source = "SUIVI 2025"): { trucks: TruckTracking[]; anomalies: Anomaly[] } {
  const anomalies: Anomaly[] = [];
  const byKey = new Map<string, TruckTracking>();
  for (const t of trucks) {
    let key = t.key;
    if (t.issue === "unusual" && !knownKeys.has(key)) {
      const candidates = [...knownKeys].filter((k) => classifyPlate(k) === null && oneEditApart(key, k));
      if (candidates.length === 1) {
        anomalies.push({ source, kind: "plaque corrigée (une frappe d'écart avec le suivi documentaire)", detail: `${key} -> ${candidates[0]}` });
        key = candidates[0];
      }
    }
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...t, key, issue: key === t.key ? t.issue : null });
      continue;
    }
    if (t.maxKm !== null && (prev.maxKm === null || t.maxKm > prev.maxKm)) {
      prev.maxKm = t.maxKm;
      prev.location = t.location ?? prev.location;
    }
    prev.location ??= t.location;
  }
  return { trucks: [...byKey.values()], anomalies };
}

// ---------------------------------------------------------------------------
// Assemblage véhicules
// ---------------------------------------------------------------------------

export interface VehicleRecord {
  key: string;
  // Écrits à la création seulement.
  brand: string;
  model: string;
  year: number;
  vehicleType: VehicleType;
  notes: string;
  // Possédés par l'import : mis à jour si la source les renseigne.
  licensePlateExpiry: string | null;
  insuranceExpiry: string | null;
  technicalInspectionDate: string | null;
  km: number | null;
  location: string | null;
  isTestVehicle: boolean;
}

export function buildVehicleRecords(doc: DocVehicle[], trucks: TruckTracking[], todayIso: string): VehicleRecord[] {
  const currentYear = Number(todayIso.slice(0, 4));
  const byKey = new Map<string, VehicleRecord>();
  for (const d of doc) {
    const notes = [
      d.year !== null ? `Import TAY : année estimée (année de la ${d.yearSource}).` : "Import TAY : année inconnue, valeur provisoire.",
      d.issue === "chassis" ? "Immatriculation provisoire : numéro de châssis." : null,
    ].filter(Boolean).join(" ");
    byKey.set(d.key, {
      key: d.key,
      brand: DEFAULT_TEXT,
      model: DEFAULT_TEXT,
      year: d.year ?? currentYear,
      vehicleType: d.vehicleType,
      notes,
      licensePlateExpiry: d.licensePlateExpiry,
      insuranceExpiry: d.insuranceExpiry,
      technicalInspectionDate: d.technicalInspectionDate,
      km: null,
      location: null,
      isTestVehicle: false,
    });
  }
  for (const t of trucks) {
    const v = byKey.get(t.key) ?? {
      key: t.key,
      brand: DEFAULT_TEXT,
      model: DEFAULT_TEXT,
      year: currentYear,
      vehicleType: vehicleTypeFromPlate(t.key) ?? "tracteur",
      notes: "Import TAY : année inconnue, valeur provisoire (absent du suivi documentaire).",
      licensePlateExpiry: null,
      insuranceExpiry: null,
      technicalInspectionDate: null,
      km: null,
      location: null,
      isTestVehicle: false,
    };
    v.km = t.maxKm;
    v.location = t.location;
    byKey.set(t.key, v);
  }
  return [...byKey.values()];
}

/**
 * Véhicule fictif de test : échéances valides entre 6 et 12 mois. Une échéance existante encore
 * dans cette fenêtre est conservée, si bien qu'une nouvelle exécution n'écrit rien.
 */
export function buildTestVehicle(
  todayIso: string,
  existing?: { licensePlateExpiry: string | null; insuranceExpiry: string | null; technicalInspectionDate: string | null },
): VehicleRecord {
  const low = addMonthsIso(todayIso, 6);
  const high = addMonthsIso(todayIso, 12);
  const target = addMonthsIso(todayIso, 9);
  const keep = (d: string | null | undefined) => (d && d >= low && d <= high ? d : target);
  return {
    key: TEST_VEHICLE_KEY,
    brand: TEST_VEHICLE_LABEL,
    model: TEST_VEHICLE_LABEL,
    year: Number(todayIso.slice(0, 4)),
    vehicleType: "tracteur",
    notes: TEST_VEHICLE_NOTES,
    licensePlateExpiry: keep(existing?.licensePlateExpiry),
    insuranceExpiry: keep(existing?.insuranceExpiry),
    technicalInspectionDate: keep(existing?.technicalInspectionDate),
    km: null,
    location: null,
    isTestVehicle: true,
  };
}

// ---------------------------------------------------------------------------
// Diff avec l'existant (même règle que les UPDATE de scripts/import-tay.ts)
// ---------------------------------------------------------------------------

export interface ExistingVehicle {
  id: number;
  registrationNumber: string;
  deleted: boolean;
  licensePlateExpiry: string | null;
  insuranceExpiry: string | null;
  technicalInspectionDate: string | null;
  mileage: number;
  lastMileage: number;
  currentKilometers: number | null;
  locationCode: string | null;
}

const maxOrNull = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/** Valeurs après import d'une fiche existante : la source gagne si renseignée, le kilométrage ne recule jamais. */
export function mergedVehicle(e: ExistingVehicle, v: VehicleRecord) {
  return {
    licensePlateExpiry: v.licensePlateExpiry ?? e.licensePlateExpiry,
    insuranceExpiry: v.insuranceExpiry ?? e.insuranceExpiry,
    technicalInspectionDate: v.technicalInspectionDate ?? e.technicalInspectionDate,
    mileage: Math.max(e.mileage, v.km ?? 0),
    lastMileage: Math.max(e.lastMileage, v.km ?? 0),
    currentKilometers: maxOrNull(e.currentKilometers, v.km),
    locationCode: v.location ?? e.locationCode,
  };
}

export function vehicleNeedsUpdate(e: ExistingVehicle, v: VehicleRecord): boolean {
  const m = mergedVehicle(e, v);
  return (
    m.licensePlateExpiry !== e.licensePlateExpiry ||
    m.insuranceExpiry !== e.insuranceExpiry ||
    m.technicalInspectionDate !== e.technicalInspectionDate ||
    m.mileage !== e.mileage ||
    m.lastMileage !== e.lastMileage ||
    m.currentKilometers !== e.currentKilometers ||
    m.locationCode !== e.locationCode
  );
}

export type ExistingDriver = DriverRecord & { id: number };

export function driverNeedsUpdate(e: ExistingDriver, d: DriverRecord): boolean {
  return (
    e.firstName !== d.firstName ||
    e.lastName !== d.lastName ||
    (d.birthDate ?? e.birthDate) !== e.birthDate ||
    (d.cniExpiry ?? e.cniExpiry) !== e.cniExpiry ||
    (d.licenseNumber ?? e.licenseNumber) !== e.licenseNumber ||
    (d.licenseExpiry ?? e.licenseExpiry) !== e.licenseExpiry ||
    (d.geoTrainingDate ?? e.geoTrainingDate) !== e.geoTrainingDate ||
    (d.cpcTrainingDate ?? e.cpcTrainingDate) !== e.cpcTrainingDate
  );
}

/** Clé de rapprochement d'un nom de fournisseur : sans accents, majuscules, espaces réduits. */
export function supplierKey(name: string): string {
  return fold(name).replace(/\s+/g, " ");
}

/** Fichier le plus récent d'une famille « <préfixe>_<horodatage>.xlsx » (les doublons ont le même contenu). */
export function pickLatestFile(fileNames: string[], prefix: string): string | null {
  const candidates = fileNames
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && fold(f).startsWith(fold(prefix)))
    .map((f) => ({ f, stamp: Number(/_(\d+)\.xlsx$/i.exec(f)?.[1] ?? 0) }))
    .sort((a, b) => b.stamp - a.stamp || a.f.localeCompare(b.f));
  return candidates[0]?.f ?? null;
}
