/**
 * Seed de recette (T-26a) : données fictives, un compte par profil.
 * Usage : APP_ENV=recette RECETTE_DB_HOST_ALLOW=<hôte> RECETTE_PASSWORD=... tsx scripts/recette-seed.ts
 * Les mots de passe viennent de l'environnement (RECETTE_PASSWORD_<ROLE>, repli RECETTE_PASSWORD) ;
 * jamais dans le dépôt. Idempotent : clés naturelles (username, immatriculation), ON CONFLICT DO NOTHING.
 */
import { assertRecetteEnvironment } from "./lib/recette-guard";
import { seedRecetteData } from "./lib/recette-data";

/** Un compte par profil ; deux techniciens et deux clients pour tester la cloison. */
export const RECETTE_ACCOUNTS: readonly { username: string; role: string; name: string }[] = [
  { username: "recette_admin", role: "admin", name: "Recette Admin" },
  { username: "recette_chef_atelier", role: "workshop_manager", name: "Recette Chef d'atelier" },
  { username: "recette_technicien_1", role: "technician", name: "Recette Technicien 1" },
  { username: "recette_technicien_2", role: "technician", name: "Recette Technicien 2" },
  { username: "recette_secretaire", role: "secretary", name: "Recette Secrétaire" },
  { username: "recette_logisticien", role: "logistics", name: "Recette Logisticien" },
  { username: "recette_magasinier", role: "warehouse", name: "Recette Magasinier" },
  { username: "recette_direction", role: "management", name: "Recette Direction" },
  { username: "recette_client_1", role: "client", name: "Recette Client 1" },
  { username: "recette_client_2", role: "client", name: "Recette Client 2" },
  { username: "recette_chauffeur", role: "driver", name: "Recette Chauffeur" },
];

export function passwordFor(role: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = `RECETTE_PASSWORD_${role.toUpperCase()}`;
  const value = env[key] ?? env.RECETTE_PASSWORD;
  if (!value || value.length < 12) {
    throw new Error(`Mot de passe de recette absent ou trop court (${key} ou RECETTE_PASSWORD, 12 caractères minimum).`);
  }
  return value;
}

export async function seedRecette(options: { closePool?: boolean } = {}): Promise<void> {
  assertRecetteEnvironment();
  const [{ pool }, bcrypt] = await Promise.all([import("../server/db"), import("bcryptjs")]);
  const hashes = new Map<string, string>();
  for (const account of RECETTE_ACCOUNTS) {
    if (!hashes.has(account.role)) hashes.set(account.role, await bcrypt.default.hash(passwordFor(account.role), 10));
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const a of RECETTE_ACCOUNTS) {
      await client.query(
        `INSERT INTO users (username, password, email, name, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING`,
        [a.username, hashes.get(a.role), `${a.username}@recette.invalid`, a.name, a.role],
      );
    }
    for (let i = 1; i <= 12; i++) {
      const owner = i <= 4 ? `recette_client_${i <= 2 ? 1 : 2}` : null;
      await client.query(
        `INSERT INTO vehicles (registration_number, brand, model, year, mileage, last_mileage, owner_id)
         VALUES ($1, 'MarqueTest', 'ModeleTest', 2020, $2, $2, (SELECT id FROM users WHERE username = $3))
         ON CONFLICT (registration_number) DO NOTHING`,
        [`RCT-${String(i).padStart(3, "0")}`, 10000 * i, owner],
      );
    }
    const pin = process.env.RECETTE_PIN;
    if (pin !== undefined && !/^\d{4}$/.test(pin)) throw new Error("RECETTE_PIN doit contenir exactement 4 chiffres.");
    await seedRecetteData(client, { pinHash: pin ? await bcrypt.default.hash(pin, 10) : null });
    await client.query("COMMIT");
    console.info("Seed de recette appliqué (comptes recette_*, véhicules RCT-001 à RCT-012, données RCT-*).");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    if (options.closePool !== false) await pool.end();
  }
}

if (process.argv[1] && /recette-seed\.ts$/.test(process.argv[1])) {
  seedRecette().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
