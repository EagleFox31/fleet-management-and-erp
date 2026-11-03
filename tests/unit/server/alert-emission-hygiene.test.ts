import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { scanAlertWrites, siteKey } from "../../support/alert-emission-scan";

/**
 * Garde-fou couche 2 (AGENTS.md §2) : toute alerte créée côté serveur émet `alert_created`,
 * par `broadcastAlertCreated` (`server/lib/alert-broadcast.ts`) ou un helper qui l'émet.
 * Sans trame, la cloche d'un autre profil n'apprend l'alerte qu'au prochain polling
 * (cas de la réception de pièces, corrigé par #180).
 *
 * Complète `alerts-write-hygiene` (UPDATE / DELETE et propriétaire) : ici, INSERT et diffusion.
 * Clé d'un site : `fichier:portée` (fonction nommée ou `METHODE /chemin`), stable aux lignes.
 */

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Écritures qui n'ont pas à émettre, avec la raison. */
const NOT_A_NEW_ALERT: Record<string, string> = {
  // Primitive : chacun de ses appelants est un site recensé et contrôlé.
  "server/storage.ts:createAlert": "primitive d'insertion",
  // Restauration de sauvegarde (admin) : rejoue des alertes historiques, rien à notifier.
  "server/routes.ts:POST /api/admin/import-backup": "restauration de sauvegarde",
};

/**
 * Défauts connus, gelés en égalité stricte : un site corrigé doit sortir de la liste, un nouveau
 * site muet fait échouer le test.
 * - checkAndCreateStockAlerts : alerte de stock bas après un ajustement, jamais diffusée.
 * POST /api/alerts et POST /api/test-date-maintenance émettent depuis le 3 novembre 2026
 * (émission ajoutée dans le handler existant, aucune route créée).
 */
const SILENT_WRITES_FROZEN = [
  "server/storage.ts:checkAndCreateStockAlerts",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "_archive" || name === "node_modules") return [];
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

const sites = walk(join(repoRoot, "server")).flatMap((full) =>
  scanAlertWrites(relative(repoRoot, full).replace(/\\/g, "/"), readFileSync(full, "utf8")),
);

describe("alertes créées côté serveur : trame alert_created", () => {
  it("le recensement voit les écritures connues (le scan n'est pas aveugle)", () => {
    const keys = new Set(sites.map(siteKey));
    expect(keys).toContain("server/services/procurement-service.ts:notifyPartReceived");
    expect(keys).toContain("server/storage.ts:createAlert");
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it("toute écriture muette est gelée ou justifiée, et la liste gelée est exacte", () => {
    const silent = [...new Set(sites.filter((s) => !s.emits).map(siteKey))].filter((key) => !(key in NOT_A_NEW_ALERT)).sort();
    expect(silent).toEqual([...SILENT_WRITES_FROZEN].sort());
  });

  it("les exceptions justifiées existent toujours (pas de ligne morte)", () => {
    const keys = new Set(sites.map(siteKey));
    for (const key of Object.keys(NOT_A_NEW_ALERT)) expect(keys, key).toContain(key);
  });
});

describe("scanAlertWrites : formes reconnues", () => {
  const scan = (text: string) => scanAlertWrites("f.ts", text).map((s) => `${s.scope}:${s.emits}`);

  it("insert(alerts) muet, puis avec broadcastAlertCreated", () => {
    expect(scan(`async function a() { await db.insert(alerts).values(x); }`)).toEqual(["a:false"]);
    expect(scan(`async function a() { const [r] = await db.insert(alerts).values(x).returning(); broadcastAlertCreated(r); }`)).toEqual(["a:true"]);
  });

  it("schema.alerts, tx.insert et SQL brut sont des écritures", () => {
    expect(scan(`const a = async (tx) => { await tx.insert(schema.alerts).values(x); };`)).toEqual(["a:false"]);
    expect(scan(`async function a() { await pool.query("INSERT INTO alerts (title) VALUES ($1)", [t]); }`)).toEqual(["a:false"]);
    expect(scan(`async function a() { await pool.query("INSERT INTO alerts_archive VALUES (1)"); }`)).toEqual([]);
  });

  it("émission par la chaîne alert_created ou par un helper local qui émet", () => {
    expect(scan(`function a() { storage.createAlert(x); broadcastUpdate("alert_created", {}); }`)).toEqual(["a:true"]);
    const helper = `function notify(r) { broadcastUpdate("alert_created", r); }\nasync function a() { notify(await storage.createAlert(x)); }`;
    expect(scan(helper)).toEqual(["a:true"]);
  });

  it("portée : gestionnaire de route, méthode, rappel anonyme remonté", () => {
    expect(scan(`app.post("/api/x", auth, async (req, res) => { await storage.createAlert(req.body); });`)).toEqual(["POST /api/x:false"]);
    expect(scan(`class S { async m() { await db.insert(alerts).values(x); } }`)).toEqual(["m:false"]);
    expect(scan(`async function a(ids) { await Promise.all(ids.map(async (id) => storage.createAlert({ id }))); broadcastAlertCreated(r); }`)).toEqual(["a:true"]);
  });

  it("une émission hors de la portée ne compte pas", () => {
    const text = `function other() { broadcastAlertCreated(r); }\nasync function a() { await db.insert(alerts).values(x); }`;
    expect(scan(text)).toEqual(["a:false"]);
  });
});
