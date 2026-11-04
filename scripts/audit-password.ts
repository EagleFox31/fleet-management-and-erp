/**
 * Audit local de robustesse mot de passe (dictionnaire + patterns).
 * Usage: npx tsx --env-file=.env scripts/audit-password.ts [username]
 */
import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { guardDatabaseConnection } from "../server/lib/production-db-guard";

const targetUsername = process.argv[2] ?? "dana";

// Top passwords fréquents (rockyou/OWASP + contexte FR/CM)
const TOP_PASSWORDS = [
  "123456", "password", "123456789", "12345678", "12345", "1234567890", "qwerty", "abc123",
  "111111", "123123", "admin", "letmein", "welcome", "monkey", "1234567", "password1",
  "1234", "000000", "123321", "dragon", "master", "hello", "freedom", "whatever",
  "qazwsx", "trustno1", "654321", "jordan", "harley", "password123", "shadow", "superman",
  "michael", "football", "baseball", "iloveyou", "starwars", "sunshine", "princess", "charlie",
  "aa123456", "donald", "password1!", "qwerty123", "1q2w3e4r", "1qaz2wsx", "admin123",
  "root", "toor", "pass", "test", "guest", "changeme", "secret", "demo", "default",
  "motdepasse", "bonjour", "cameroon", "cameroun", "douala", "yaounde", "afrique",
  "administrator", "login", "passw0rd", "P@ssw0rd", "Password1", "Password123", "Welcome1",
  "fleetmaster", "fleet", "FleetMaster", "yarofleet", "yaro", "Yaro", "YARO", "trigenys",
  "tech123", "workshop123", "secretary123", "logistics123", "warehouse123", "client123",
  "secretary", "technician", "workshop", "logistics", "warehouse", "manager", "atelier",
];

function verify(hash: string, plain: string): boolean {
  if (hash.startsWith("$2")) return bcrypt.compareSync(plain, hash);
  if (hash.length === 64 && /^[a-f0-9]+$/i.test(hash)) {
    return crypto.createHash("sha256").update(plain).digest("hex") === hash;
  }
  return false;
}

function buildCandidates(user: {
  username: string;
  name: string | null;
  email: string | null;
  role: string;
}): string[] {
  const set = new Set<string>(TOP_PASSWORDS);

  const username = user.username.toLowerCase();
  const nameParts = (user.name ?? "")
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter((p) => p.length >= 2);
  const emailLocal = (user.email ?? "").split("@")[0]?.toLowerCase() ?? "";

  const bases = new Set<string>([
    username,
    username.charAt(0).toUpperCase() + username.slice(1),
    user.role,
    ...nameParts,
    emailLocal,
    nameParts.join(""),
    nameParts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(""),
    `${nameParts[0] ?? ""}${nameParts[1] ?? ""}`,
  ].filter(Boolean));

  const suffixes = [
    "", "1", "12", "123", "1234", "12345", "123456", "!", "@", "#",
    "2020", "2021", "2022", "2023", "2024", "2025", "2026",
    "01", "001", "007", "99", "00",
  ];

  for (const base of bases) {
    for (const suf of suffixes) {
      set.add(`${base}${suf}`);
      set.add(`${base}${suf}!`);
      set.add(`${suf}${base}`);
      if (base.length > 0) {
        set.add(base.charAt(0).toUpperCase() + base.slice(1) + suf);
      }
    }
  }

  // Variantes leet basiques
  for (const base of [username, ...nameParts]) {
    set.add(base.replace(/a/g, "4").replace(/e/g, "3").replace(/i/g, "1").replace(/o/g, "0"));
  }

  // Phase 3 (optionnelle): numérique 6 chiffres — ~1M tests, plusieurs heures en bcrypt cost 10
  if (process.env.AUDIT_INCLUDE_NUMERIC === "1") {
    for (let i = 0; i <= 999999; i++) {
      set.add(String(i).padStart(6, "0"));
    }
  }

  return [...set];
}

// Hors production, refuse la base marquée production (ALLOW_PRODUCTION_DATABASE=1 pour une intervention voulue).
guardDatabaseConnection("audit-password");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  `SELECT username, name, email, role, password FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`,
  [targetUsername],
);

if (rows.length === 0) {
  console.error(`Compte '${targetUsername}' introuvable`);
  await pool.end();
  process.exit(1);
}

const user = rows[0] as {
  username: string;
  name: string | null;
  email: string | null;
  role: string;
  password: string;
};

const hash = user.password;
const hashType = hash.startsWith("$2") ? "bcrypt" : hash.length === 64 ? "sha256_legacy" : "unknown";
const bcryptCost = hash.startsWith("$2") ? hash.split("$")[2] : null;

console.log("=== AUDIT MOT DE PASSE ===");
console.log(JSON.stringify({
  username: user.username,
  name: user.name,
  email: user.email,
  role: user.role,
  hashType,
  bcryptCost,
}, null, 2));

const candidates = buildCandidates(user);
console.log(`\nCandidats générés: ${candidates.length.toLocaleString("fr-FR")}`);
console.log("Démarrage du test (bcrypt = lent, patience)...\n");

const started = Date.now();
let tested = 0;
let found: string | null = null;
const reportEvery = 5_000;

for (const pwd of candidates) {
  tested++;
  if (tested % reportEvery === 0) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ... ${tested.toLocaleString("fr-FR")} testés (${elapsed}s)`);
  }
  if (verify(hash, pwd)) {
    found = pwd;
    break;
  }
}

const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);

console.log("\n=== RÉSULTAT ===");
console.log(`Testés: ${tested.toLocaleString("fr-FR")} / ${candidates.length.toLocaleString("fr-FR")}`);
console.log(`Durée: ${elapsedSec}s`);

if (found) {
  console.log("VERDICT: CRACKABLE");
  console.log(`Mot de passe trouvé: ${found}`);
  console.log(`Longueur: ${found.length} caractères`);
  const category =
    found.length <= 6 ? "très faible" :
    found.length <= 8 && /^[0-9]+$/.test(found) ? "PIN numérique faible" :
    found.length <= 10 ? "faible" : "moyen";
  console.log(`Catégorie: ${category}`);
} else {
  console.log("VERDICT: non trouvé dans cette campagne");
  if (process.env.AUDIT_INCLUDE_NUMERIC === "1") {
    console.log("→ Pas dans top passwords + variantes profil + brute 6 chiffres (1M)");
  } else {
    console.log("→ Pas dans top passwords + variantes profil (~700 candidats)");
    console.log("→ Brute 6 chiffres (1M) non lancée — ajouter AUDIT_INCLUDE_NUMERIC=1 (plusieurs heures)");
  }
  console.log("→ Mot de passe probablement plus robuste OU hors de ce périmètre");
}

await pool.end();
