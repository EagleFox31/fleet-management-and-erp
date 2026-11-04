/**
 * Import des données réelles du client TAY : véhicules, kilométrage, chauffeurs, fournisseurs.
 *
 *   npx tsx scripts/import-tay.ts                         # aperçu (par défaut), aucune écriture
 *   npx tsx scripts/import-tay.ts --apply                 # écrit tout dans une transaction
 *   options : --dir <dossier des xlsx> (défaut attached_assets), --no-test-vehicle
 *
 * Idempotent : clé naturelle (plaque normalisée, employee_number, nom du fournisseur), upsert gardé par
 * IS DISTINCT FROM ; une seconde exécution n'écrit rien. Aucun soft delete, aucune désactivation :
 * seuls les champs listés dans docs/data-import/IMPORT_TAY.md sont écrits.
 * Sans DATABASE_URL, l'aperçu lit les fichiers et signale les anomalies sans comparer à la base.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { moduleLogger } from "../server/lib/logger";
import {
  type Anomaly,
  type DriverRecord,
  type ExistingDriver,
  type ExistingVehicle,
  type SheetRows,
  type SupplierRecord,
  type VehicleRecord,
  buildTestVehicle,
  buildVehicleRecords,
  driverNeedsUpdate,
  mergedVehicle,
  normalizePlate,
  parseDocumentation,
  parseDrivers,
  parseSuppliers,
  parseTruckTracking,
  pickLatestFile,
  reconcileTrackingPlates,
  supplierKey,
  TEST_VEHICLE_KEY,
  vehicleNeedsUpdate,
} from "./lib/tay-import";

const log = moduleLogger("import-tay");

interface Options {
  apply: boolean;
  dir: string;
  testVehicle: boolean;
}

function parseArgs(argv: string[]): Options {
  const dirIdx = argv.indexOf("--dir");
  if (dirIdx >= 0 && !argv[dirIdx + 1]) throw new Error("--dir attend un dossier");
  return {
    apply: argv.includes("--apply"),
    dir: path.resolve(dirIdx >= 0 ? argv[dirIdx + 1] : "attached_assets"),
    testVehicle: !argv.includes("--no-test-vehicle"),
  };
}

const SOURCES = {
  documentation: "SUIVI DOCUMENTATION CAMIONS",
  trucks: "SUIVI DES CAMION TAY",
  cpc: "CPC ET HABILITATION",
  suppliers: "GESTION FOURNISSEURS",
} as const;

interface LoadedFile {
  name: string;
  sha256: string;
  workbook: XLSX.WorkBook;
}

function loadFile(dir: string, files: string[], prefix: string): LoadedFile {
  const name = pickLatestFile(files, prefix);
  if (!name) throw new Error(`Fichier « ${prefix}*.xlsx » introuvable dans ${dir}`);
  const buf = readFileSync(path.join(dir, name));
  return { name, sha256: createHash("sha256").update(buf).digest("hex"), workbook: XLSX.read(buf, { type: "buffer" }) };
}

function sheetRows(file: LoadedFile, sheetName: string): SheetRows {
  const sheet = file.workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`${file.name} : feuille « ${sheetName} » introuvable`);
  return XLSX.utils.sheet_to_json<SheetRows[number]>(sheet, { header: 1, defval: null, raw: true, blankrows: true });
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Hôte masqué : assez pour reconnaître la cible, pas pour la divulguer. */
function describeTarget(url: string | undefined): string {
  if (!url) return "(DATABASE_URL absente)";
  try {
    const u = new URL(url);
    const [first, ...rest] = u.hostname.split(".");
    const masked = first.length > 4 ? `${first.slice(0, 4)}***` : first;
    return `${[masked, ...rest].join(".")}${u.pathname}`;
  } catch {
    return "(DATABASE_URL illisible)";
  }
}

interface Parsed {
  files: LoadedFile[];
  vehicles: VehicleRecord[];
  drivers: DriverRecord[];
  suppliers: SupplierRecord[];
  anomalies: Anomaly[];
  stats: Record<string, number>;
}

function parseAll(opts: Options): Parsed {
  const files = readdirSync(opts.dir);
  const doc = loadFile(opts.dir, files, SOURCES.documentation);
  const trucks = loadFile(opts.dir, files, SOURCES.trucks);
  const cpc = loadFile(opts.dir, files, SOURCES.cpc);
  const sup = loadFile(opts.dir, files, SOURCES.suppliers);

  const docSheet = doc.workbook.SheetNames[0];
  const d = parseDocumentation(sheetRows(doc, docSheet));
  const t = parseTruckTracking(sheetRows(trucks, "SUIVI 2025"));
  const c = parseDrivers(sheetRows(cpc, "CPC"));
  const recapName = sup.workbook.SheetNames.find((n) => /R.CAP G.N.RAL/i.test(n));
  if (!recapName) throw new Error(`${sup.name} : feuille « RÉCAP GÉNÉRAL » introuvable`);
  const supplierSheets = Object.fromEntries(
    sup.workbook.SheetNames.filter((n) => !/^R.CAP/i.test(n)).map((n) => [n.trim(), sheetRows(sup, n)]),
  );
  const s = parseSuppliers(sheetRows(sup, recapName), supplierSheets);

  const r = reconcileTrackingPlates(t.trucks, new Set(d.vehicles.map((v) => v.key)));
  const vehicles = buildVehicleRecords(d.vehicles, r.trucks, todayUtcIso());
  return {
    files: [doc, trucks, cpc, sup],
    vehicles,
    drivers: c.drivers,
    suppliers: s.suppliers,
    anomalies: [...d.anomalies, ...t.anomalies, ...r.anomalies, ...c.anomalies, ...s.anomalies],
    stats: {
      documentationVehicles: d.vehicles.length,
      trackingPlateRows: t.plateRows,
      trackingPlates: t.trucks.length,
      uniquePlates: vehicles.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Base de données
// ---------------------------------------------------------------------------

interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

interface Counts {
  insert: number;
  update: number;
  unchanged: number;
  skipped: number;
}
const zero = (): Counts => ({ insert: 0, update: 0, unchanged: 0, skipped: 0 });

interface VehiclePlanItem {
  record: VehicleRecord;
  /** Valeur exacte de registration_number visée par ON CONFLICT : celle de la fiche existante si elle existe. */
  registrationNumber: string;
  action: "insert" | "update" | "unchanged" | "skipped";
}

interface Plan {
  vehicles: VehiclePlanItem[];
  drivers: Array<{ record: DriverRecord; action: keyof Counts }>;
  suppliers: Array<{ record: SupplierRecord; name: string; action: keyof Counts }>;
  anomalies: Anomaly[];
}

async function loadExistingVehicles(db: Queryable): Promise<Map<string, ExistingVehicle>> {
  const { rows } = await db.query<{
    id: number; registration_number: string; deleted: boolean; lpe: string | null; ie: string | null; tid: string | null;
    mileage: number; last_mileage: number; current_kilometers: number | null; location_code: string | null;
  }>(`SELECT id, registration_number, deleted_at IS NOT NULL AS deleted,
            license_plate_expiry::text AS lpe, insurance_expiry::text AS ie, technical_inspection_date::text AS tid,
            mileage, last_mileage, current_kilometers, location_code
       FROM vehicles ORDER BY deleted_at NULLS FIRST, id`);
  const map = new Map<string, ExistingVehicle>();
  for (const r of rows) {
    const key = normalizePlate(r.registration_number);
    if (map.has(key)) continue; // fiche active d'abord (ORDER BY)
    map.set(key, {
      id: r.id, registrationNumber: r.registration_number, deleted: r.deleted,
      licensePlateExpiry: r.lpe, insuranceExpiry: r.ie, technicalInspectionDate: r.tid,
      mileage: r.mileage, lastMileage: r.last_mileage, currentKilometers: r.current_kilometers, locationCode: r.location_code,
    });
  }
  return map;
}

async function buildPlan(db: Queryable, parsed: Parsed, opts: Options): Promise<Plan> {
  const anomalies: Anomaly[] = [];
  const existingVehicles = await loadExistingVehicles(db);
  const records = [...parsed.vehicles];
  if (opts.testVehicle) {
    const e = existingVehicles.get(TEST_VEHICLE_KEY);
    records.push(buildTestVehicle(todayUtcIso(), e));
  }
  const vehicles: VehiclePlanItem[] = records.map((record) => {
    const e = existingVehicles.get(record.key);
    if (!e) return { record, registrationNumber: record.key, action: "insert" };
    if (e.deleted) {
      anomalies.push({ source: "base", kind: "véhicule supprimé (soft delete) non modifié", detail: record.key });
      return { record, registrationNumber: e.registrationNumber, action: "skipped" };
    }
    return { record, registrationNumber: e.registrationNumber, action: vehicleNeedsUpdate(e, record) ? "update" : "unchanged" };
  });

  const { rows: dr } = await db.query<Record<string, string | number | null>>(
    `SELECT id, employee_number, first_name, last_name, birth_date::text AS birth_date, cni_expiry::text AS cni_expiry,
            license_number, license_expiry::text AS license_expiry, geo_training_date::text AS geo_training_date,
            cpc_training_date::text AS cpc_training_date
       FROM drivers WHERE employee_number = ANY($1::text[])`,
    [parsed.drivers.map((d) => d.employeeNumber)],
  );
  const existingDrivers = new Map<string, ExistingDriver>(dr.map((r) => [String(r.employee_number), {
    id: Number(r.id), employeeNumber: String(r.employee_number), firstName: String(r.first_name), lastName: String(r.last_name),
    birthDate: r.birth_date as string | null, cniExpiry: r.cni_expiry as string | null, licenseNumber: r.license_number as string | null,
    licenseExpiry: r.license_expiry as string | null, geoTrainingDate: r.geo_training_date as string | null,
    cpcTrainingDate: r.cpc_training_date as string | null,
  }]));
  const drivers = parsed.drivers.map((record) => {
    const e = existingDrivers.get(record.employeeNumber);
    return { record, action: (!e ? "insert" : driverNeedsUpdate(e, record) ? "update" : "unchanged") as keyof Counts };
  });

  const { rows: sr } = await db.query<{ name: string; category: string | null }>(`SELECT name, category FROM suppliers ORDER BY id`);
  const existingSuppliers = new Map<string, { name: string; category: string | null }>();
  for (const r of sr) if (!existingSuppliers.has(supplierKey(r.name))) existingSuppliers.set(supplierKey(r.name), r);
  const suppliers = parsed.suppliers.map((record) => {
    const e = existingSuppliers.get(supplierKey(record.name));
    if (!e) return { record, name: record.name, action: "insert" as const };
    return { record, name: e.name, action: (e.category === record.category ? "unchanged" : "update") as keyof Counts };
  });
  return { vehicles, drivers, suppliers, anomalies };
}

function tally<T extends { action: keyof Counts }>(items: T[]): Counts {
  const c = zero();
  for (const i of items) c[i.action]++;
  return c;
}

const VEHICLE_UPSERT = `
INSERT INTO vehicles (registration_number, brand, model, year, mileage, last_mileage, current_kilometers, vehicle_type,
                      status, fuel_type, owner_id, created_by, license_plate_expiry, insurance_expiry,
                      technical_inspection_date, location_code, notes%BATCH_COL%)
VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'operational', 'diesel', NULL, $8, $9::date, $10::date, $11::date, $12, $13%BATCH_VAL%)
ON CONFLICT (registration_number) DO UPDATE SET
  license_plate_expiry = COALESCE(EXCLUDED.license_plate_expiry, vehicles.license_plate_expiry),
  insurance_expiry = COALESCE(EXCLUDED.insurance_expiry, vehicles.insurance_expiry),
  technical_inspection_date = COALESCE(EXCLUDED.technical_inspection_date, vehicles.technical_inspection_date),
  mileage = GREATEST(vehicles.mileage, EXCLUDED.mileage),
  last_mileage = GREATEST(vehicles.last_mileage, EXCLUDED.last_mileage),
  current_kilometers = GREATEST(vehicles.current_kilometers, EXCLUDED.current_kilometers),
  location_code = COALESCE(EXCLUDED.location_code, vehicles.location_code)
WHERE vehicles.deleted_at IS NULL
  AND (vehicles.license_plate_expiry, vehicles.insurance_expiry, vehicles.technical_inspection_date,
       vehicles.mileage, vehicles.last_mileage, vehicles.current_kilometers, vehicles.location_code)
  IS DISTINCT FROM
      (COALESCE(EXCLUDED.license_plate_expiry, vehicles.license_plate_expiry),
       COALESCE(EXCLUDED.insurance_expiry, vehicles.insurance_expiry),
       COALESCE(EXCLUDED.technical_inspection_date, vehicles.technical_inspection_date),
       GREATEST(vehicles.mileage, EXCLUDED.mileage), GREATEST(vehicles.last_mileage, EXCLUDED.last_mileage),
       GREATEST(vehicles.current_kilometers, EXCLUDED.current_kilometers),
       COALESCE(EXCLUDED.location_code, vehicles.location_code))
RETURNING (xmax = 0) AS inserted`;

const DRIVER_UPSERT = `
INSERT INTO drivers (employee_number, first_name, last_name, birth_date, cni_expiry, license_number, license_expiry,
                     geo_training_date, cpc_training_date)
VALUES ($1, $2, $3, $4::date, $5::date, $6, $7::date, $8::date, $9::date)
ON CONFLICT (employee_number) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  birth_date = COALESCE(EXCLUDED.birth_date, drivers.birth_date),
  cni_expiry = COALESCE(EXCLUDED.cni_expiry, drivers.cni_expiry),
  license_number = COALESCE(EXCLUDED.license_number, drivers.license_number),
  license_expiry = COALESCE(EXCLUDED.license_expiry, drivers.license_expiry),
  geo_training_date = COALESCE(EXCLUDED.geo_training_date, drivers.geo_training_date),
  cpc_training_date = COALESCE(EXCLUDED.cpc_training_date, drivers.cpc_training_date)
WHERE (drivers.first_name, drivers.last_name, drivers.birth_date, drivers.cni_expiry, drivers.license_number,
       drivers.license_expiry, drivers.geo_training_date, drivers.cpc_training_date)
  IS DISTINCT FROM
      (EXCLUDED.first_name, EXCLUDED.last_name, COALESCE(EXCLUDED.birth_date, drivers.birth_date),
       COALESCE(EXCLUDED.cni_expiry, drivers.cni_expiry), COALESCE(EXCLUDED.license_number, drivers.license_number),
       COALESCE(EXCLUDED.license_expiry, drivers.license_expiry),
       COALESCE(EXCLUDED.geo_training_date, drivers.geo_training_date),
       COALESCE(EXCLUDED.cpc_training_date, drivers.cpc_training_date))
RETURNING (xmax = 0) AS inserted`;

const SUPPLIER_UPSERT = `
INSERT INTO suppliers (name, category, created_by) VALUES ($1, $2, $3)
ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category, updated_at = now()
WHERE suppliers.category IS DISTINCT FROM EXCLUDED.category
RETURNING (xmax = 0) AS inserted`;

async function tableHasColumn(db: Queryable, table: string, column: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

/** Empreinte du lot : sha256 des empreintes des quatre fichiers, triées. */
function batchSha(files: LoadedFile[]): string {
  return createHash("sha256").update(files.map((f) => `${f.sha256}  ${f.name}`).sort().join("\n")).digest("hex");
}

async function applyPlan(db: Queryable, parsed: Parsed, opts: Options, adminId: number): Promise<{ plan: Plan; actual: Record<string, Counts>; batchId: number | null }> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('import-tay'))`);
  const plan = await buildPlan(db, parsed, opts); // relu sous verrou, dans la transaction
  const planned = { vehicles: tally(plan.vehicles), drivers: tally(plan.drivers), suppliers: tally(plan.suppliers) };
  const changes = Object.values(planned).reduce((n, c) => n + c.insert + c.update, 0);
  const actual = { vehicles: zero(), drivers: zero(), suppliers: zero() };
  if (changes === 0) {
    actual.vehicles = planned.vehicles;
    actual.drivers = planned.drivers;
    actual.suppliers = planned.suppliers;
    return { plan, actual, batchId: null };
  }

  // Lot journalisé si import_batches existe ; une fiche créée porte son import_batch_id.
  let batchId: number | null = null;
  const withBatch = await tableHasColumn(db, "import_batches", "file_sha256");
  const linkBatch = withBatch && (await tableHasColumn(db, "vehicles", "import_batch_id"));
  if (withBatch) {
    const sha = batchSha(parsed.files);
    const summary = {
      source: "import-tay",
      files: parsed.files.map((f) => ({ name: f.name, sha256: f.sha256 })),
      planned,
    };
    // Lecture puis insertion sous le verrou consultatif : ne dépend pas de la présence de
    // l'index partiel import_batches_applied_file_uidx (posé par init-database, pas par drizzle-kit).
    const { rows: found } = await db.query<{ id: number }>(
      `SELECT id FROM import_batches WHERE kind = 'vehicles' AND file_sha256 = $1 AND status = 'applied' ORDER BY id LIMIT 1`, [sha]);
    batchId = found[0]?.id ?? null;
    if (batchId === null) {
      const ins = await db.query<{ id: number }>(
        `INSERT INTO import_batches (kind, file_name, file_sha256, status, summary, created_by)
         VALUES ('vehicles', $1, $2, 'applied', $3::jsonb, $4) RETURNING id`,
        ["Import TAY (4 classeurs)", sha, JSON.stringify(summary), adminId],
      );
      batchId = ins.rows[0]?.id ?? null;
    }
  }
  const vehicleSql = VEHICLE_UPSERT
    .replace("%BATCH_COL%", linkBatch ? ", import_batch_id" : "")
    .replace("%BATCH_VAL%", linkBatch ? ", $14" : "");

  const record = (c: Counts, rows: Array<{ inserted?: unknown }>, planned: keyof Counts) => {
    if (rows.length === 0) c[planned === "skipped" ? "skipped" : "unchanged"]++;
    else if (rows[0].inserted) c.insert++;
    else c.update++;
  };

  for (const item of plan.vehicles) {
    if (item.action === "skipped") { actual.vehicles.skipped++; continue; }
    const v = item.record;
    const params: unknown[] = [
      item.registrationNumber, v.brand, v.model, v.year, v.km ?? 0, v.km, v.vehicleType, adminId,
      v.licensePlateExpiry, v.insuranceExpiry, v.technicalInspectionDate, v.location, v.notes,
    ];
    if (linkBatch) params.push(batchId);
    const res = await db.query<{ inserted: boolean }>(vehicleSql, params);
    record(actual.vehicles, res.rows, item.action);
  }
  for (const item of plan.drivers) {
    const d = item.record;
    const res = await db.query<{ inserted: boolean }>(DRIVER_UPSERT, [
      d.employeeNumber, d.firstName, d.lastName, d.birthDate, d.cniExpiry, d.licenseNumber, d.licenseExpiry,
      d.geoTrainingDate, d.cpcTrainingDate,
    ]);
    record(actual.drivers, res.rows, item.action);
  }
  for (const item of plan.suppliers) {
    const res = await db.query<{ inserted: boolean }>(SUPPLIER_UPSERT, [item.name, item.record.category, adminId]);
    record(actual.suppliers, res.rows, item.action);
  }

  for (const k of ["vehicles", "drivers", "suppliers"] as const) {
    const p = planned[k];
    const a = actual[k];
    if (p.insert !== a.insert || p.update !== a.update) {
      throw new Error(`Écart entre l'aperçu et l'écriture (${k}) : prévu ${JSON.stringify(p)}, écrit ${JSON.stringify(a)}. Transaction annulée.`);
    }
  }
  return { plan, actual, batchId };
}

// ---------------------------------------------------------------------------
// Rapport (aucune donnée personnelle : comptes, plaques de camion, n° de ligne)
// ---------------------------------------------------------------------------

function fmt(c: Counts): string {
  return `à insérer ${c.insert}, à mettre à jour ${c.update}, inchangés ${c.unchanged}${c.skipped ? `, ignorés ${c.skipped}` : ""}`;
}

function report(parsed: Parsed, anomalies: Anomaly[], lines: string[]): void {
  const out = [
    "Fichiers :",
    ...parsed.files.map((f) => `  ${f.name}  sha256 ${f.sha256.slice(0, 16)}…`),
    `Lecture : ${parsed.stats.documentationVehicles} véhicule(s) au suivi documentaire, ${parsed.stats.trackingPlateRows} ligne(s) avec plaque au suivi kilométrique (${parsed.stats.trackingPlates} plaque(s)), ${parsed.stats.uniquePlates} plaque(s) uniques au total ; ${parsed.drivers.length} chauffeur(s) ; ${parsed.suppliers.length} fournisseur(s).`,
    ...lines,
    `Anomalies (${anomalies.length}) :`,
    ...anomalies.map((a) => `  [${a.source}${a.row ? ` l.${a.row}` : ""}] ${a.kind}${a.detail ? ` : ${a.detail}` : ""}`),
  ];
  process.stdout.write(`${out.join("\n")}\n`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const parsed = parseAll(opts);
  const target = describeTarget(process.env.DATABASE_URL);

  if (!process.env.DATABASE_URL) {
    if (opts.apply) throw new Error("--apply exige DATABASE_URL");
    const v = parsed.vehicles.length + (opts.testVehicle ? 1 : 0);
    report(parsed, parsed.anomalies, [
      "Mode : aperçu sans base (DATABASE_URL absente) : rien n'est comparé ni écrit.",
      `À traiter : ${v} véhicule(s)${opts.testVehicle ? " dont le véhicule de test" : ""}, ${parsed.drivers.length} chauffeur(s), ${parsed.suppliers.length} fournisseur(s).`,
    ]);
    return;
  }

  const { pool, listenerPool } = await import("../server/db");
  const client = await pool.connect();
  try {
    const db = client as unknown as Queryable;
    const { rows: admins } = await db.query<{ id: number }>(`SELECT id FROM users WHERE username = 'admin' ORDER BY id LIMIT 1`);
    const adminId = admins[0]?.id ?? null;

    if (!opts.apply) {
      const plan = await buildPlan(db, parsed, opts);
      report(parsed, [...parsed.anomalies, ...plan.anomalies], [
        `Mode : aperçu (aucune écriture). Base : ${target}`,
        adminId === null ? "Attention : aucun utilisateur « admin », --apply sera refusé." : `Auteur des fiches : utilisateur admin #${adminId}.`,
        `Véhicules : ${fmt(tally(plan.vehicles))}${opts.testVehicle ? " (véhicule de test inclus)" : ""}`,
        `Chauffeurs : ${fmt(tally(plan.drivers))}`,
        `Fournisseurs : ${fmt(tally(plan.suppliers))}`,
        "Pour écrire : relancer avec --apply.",
      ]);
      return;
    }

    if (adminId === null) throw new Error("Aucun utilisateur « admin » : impossible de renseigner created_by");
    await db.query("BEGIN");
    try {
      const { plan, actual, batchId } = await applyPlan(db, parsed, opts, adminId);
      await db.query("COMMIT");
      const written = Object.values(actual).reduce((n, c) => n + c.insert + c.update, 0);
      log.info({ written, batchId, actual }, "import TAY appliqué");
      report(parsed, [...parsed.anomalies, ...plan.anomalies], [
        `Mode : écriture (transaction validée). Base : ${target}`,
        `Véhicules : insérés ${actual.vehicles.insert}, mis à jour ${actual.vehicles.update}, inchangés ${actual.vehicles.unchanged}${actual.vehicles.skipped ? `, ignorés ${actual.vehicles.skipped}` : ""}`,
        `Chauffeurs : insérés ${actual.drivers.insert}, mis à jour ${actual.drivers.update}, inchangés ${actual.drivers.unchanged}`,
        `Fournisseurs : insérés ${actual.suppliers.insert}, mis à jour ${actual.suppliers.update}, inchangés ${actual.suppliers.unchanged}`,
        `Écritures : ${written}${batchId !== null ? ` (lot import_batches #${batchId})` : written === 0 ? " (rien à faire)" : ""}`,
      ]);
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
    await listenerPool.end();
  }
}

main().catch((err) => {
  log.error({ err }, "import TAY interrompu");
  process.exitCode = 1;
});
