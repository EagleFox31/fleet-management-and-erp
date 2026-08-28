/**
 * Réinitialise les mots de passe des comptes réels vers ceux listés sur la landing.
 * Conserve admin et jean.mballa inchangés.
 *
 * Usage: npx tsx --env-file=.env scripts/reset-listed-passwords.ts
 */
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

const SKIP_USERNAMES = new Set(["admin", "jean.mballa"]);

const PASSWORD_BY_USERNAME: Record<string, string> = {
  terry: "workshop123",
  ali: "tech123",
  dana: "secretary123",
  issouf: "logistics123",
  fatou: "warehouse123",
};

const sql = neon(process.env.DATABASE_URL!);

const activeUsers = await sql`
  SELECT id, username, role
  FROM users
  WHERE deleted_at IS NULL
  ORDER BY username
`;

console.log("=== Réinitialisation mots de passe (landing) ===\n");

for (const user of activeUsers) {
  if (SKIP_USERNAMES.has(user.username)) {
    console.log(`⏭️  ${user.username} (${user.role}) — conservé`);
    continue;
  }

  const newPassword = PASSWORD_BY_USERNAME[user.username];
  if (!newPassword) {
    console.log(`⚠️  ${user.username} (${user.role}) — pas de mot de passe listé, ignoré`);
    continue;
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await sql`UPDATE users SET password = ${hashedPassword} WHERE id = ${user.id}`;

  console.log(`✅ ${user.username} (${user.role}) → ${newPassword}`);
}

console.log("\nTerminé.");
