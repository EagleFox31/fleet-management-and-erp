/**
 * Teste chaque compte réel contre TOUS les mots de passe listés (landing / seed / doc).
 * Usage: npx tsx --env-file=.env scripts/audit-listed-passwords.ts
 */
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { guardDatabaseConnection } from "../server/lib/production-db-guard";

/** Tous les mots de passe affichés sur la landing + doc */
const LISTED_PASSWORDS: Array<{ password: string; source: string }> = [
  { password: "admin123", source: "admin / landing" },
  { password: "workshop123", source: "workshop_manager / landing" },
  { password: "tech123", source: "technician / landing" },
  { password: "secretary123", source: "secretary / landing" },
  { password: "logistics123", source: "logistics / landing" },
  { password: "warehouse123", source: "warehouse / landing" },
  { password: "client123", source: "client / landing" },
  { password: "driver123", source: "variante chauffeur" },
  { password: "1234", source: "PIN court" },
  { password: "0000", source: "PIN court" },
];

function verify(hash: string, plain: string): boolean {
  if (hash.startsWith("$2")) return bcrypt.compareSync(plain, hash);
  if (hash.length === 64 && /^[a-f0-9]+$/i.test(hash)) {
    return crypto.createHash("sha256").update(plain).digest("hex") === hash;
  }
  return false;
}

// Hors production, refuse la base marquée production (ALLOW_PRODUCTION_DATABASE=1 pour une intervention voulue).
guardDatabaseConnection("audit-listed-passwords");
const sql = neon(process.env.DATABASE_URL!);
const allUsers = await sql`SELECT username, role, password FROM users WHERE deleted_at IS NULL ORDER BY username`;

console.log("=== COMPTES EN BASE ===");
for (const u of allUsers) {
  const type = u.password.startsWith("$2") ? "bcrypt" : "legacy";
  console.log(`  ${u.username} (${u.role}) [${type}]`);
}

console.log("\n=== Mots de passe testés pour CHAQUE compte ===");
console.log(`  ${LISTED_PASSWORDS.map((p) => p.password).join(", ")}\n`);

console.log("=== RÉSULTATS — chaque username × tous les mots de passe listés ===\n");

const summary: Array<{ username: string; role: string; matches: string[] }> = [];

for (const user of allUsers) {
  const matches: string[] = [];

  for (const { password } of LISTED_PASSWORDS) {
    if (verify(user.password, password)) {
      matches.push(password);
    }
  }

  summary.push({ username: user.username, role: user.role, matches });

  if (matches.length > 0) {
    console.log(`✅ ${user.username} (${user.role}): ${matches.join(", ")}`);
  } else {
    console.log(`❌ ${user.username} (${user.role}): aucun match`);
  }
}

console.log("\n=== MATRICE (✓ = match) ===\n");
const header = ["username".padEnd(14), ...LISTED_PASSWORDS.map((p) => p.password.padEnd(14))].join("");
console.log(header);
console.log("-".repeat(header.length));

for (const { username, matches } of summary) {
  const row = [
    username.padEnd(14),
    ...LISTED_PASSWORDS.map(({ password }) => (matches.includes(password) ? "✓".padEnd(14) : "·".padEnd(14))),
  ].join("");
  console.log(row);
}
