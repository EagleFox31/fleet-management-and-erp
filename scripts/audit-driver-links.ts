/**
 * Recense, en lecture seule, les fiches chauffeur liées à un compte hors `MISSION_READ_ROLES`
 * (technicien, client) : liaisons antérieures au refus de `POST/PATCH /api/drivers`. N'écrit rien.
 *
 * Usage, sur une base explicite (jamais la production sans accord) :
 *   DATABASE_URL=<base> node --import tsx scripts/audit-driver-links.ts
 * Sortie : nombre de fiches, puis une ligne par fiche (identifiant de fiche, de compte, rôle).
 */
import { pool } from "../server/db";
import { driversLinkedOutsideMissionReaders } from "../server/lib/driver-link";

try {
  const rows = await driversLinkedOutsideMissionReaders();
  console.log(`Fiches liées à un compte hors lecteurs des missions : ${rows.length}`);
  for (const row of rows) console.log(`fiche ${row.driverId} -> compte ${row.userId} (${row.role})`);
} finally {
  await pool.end();
}
