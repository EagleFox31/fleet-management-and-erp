import { Pool } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const targetUsername = process.argv[2] ?? "dana";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  `SELECT username, role, password FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`,
  [targetUsername],
);

if (rows.length === 0) {
  console.log(`Compte '${targetUsername}' introuvable`);
  await pool.end();
  process.exit(1);
}

const user = rows[0] as { username: string; role: string; password: string };
const hash = user.password;
const hashType = hash.startsWith("$2") ? "bcrypt" : hash.length === 64 ? "sha256_legacy" : "unknown";
const bcryptCost = hash.startsWith("$2") ? hash.split("$")[2] : null;

console.log(JSON.stringify({ username: user.username, role: user.role, hashType, bcryptCost }, null, 2));

function verify(plain: string): boolean {
  if (hash.startsWith("$2")) return bcrypt.compareSync(plain, hash);
  if (hash.length === 64 && /^[a-f0-9]+$/i.test(hash)) {
    return crypto.createHash("sha256").update(plain).digest("hex") === hash;
  }
  return false;
}

const candidates = [
  "dana", "Dana", "dana123", "Dana123", "DanaDelRey", "delrey", "DelRey", "delrey123",
  "secretary123", "secretary", "Secretary123", "password", "Password123", "123456",
  "12345678", "admin123", "test123", "test", "changeme", "welcome", "motdepasse",
  "yaro", "yarofleet", "fleetmaster", "cameroon", "douala", "yaounde",
  "yaro123", "Dana2024", "Dana2025", "Dana2026",
  "000000", "111111", "abc123", "qwerty", "letmein", "password123", "1234567890",
  "fatou123", "terry123", "ali123", "issouf123",
];

console.log(`Test dictionnaire: ${candidates.length} candidats...`);
let found: string | null = null;
for (const pwd of candidates) {
  if (verify(pwd)) {
    found = pwd;
    break;
  }
}

if (found) {
  console.log("RESULTAT: CRACKABLE — match dictionnaire trouve");
  console.log(`Longueur: ${found.length} caracteres`);
  console.log(`Mot de passe: ${found}`);
} else {
  console.log(`RESULTAT: non trouve dans ce dictionnaire (${candidates.length} entrees)`);
  console.log("Conclusion: pas trivial avec cette liste; brute-force en ligne reste possible sans rate limit");
}

await pool.end();
