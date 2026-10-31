/** pg_dump local. L'URL passe par l'environnement du processus fils, jamais par les arguments ni les logs. */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export class BackupDumpError extends Error {
  constructor(
    readonly code: "PG_DUMP_MISSING" | "PG_DUMP_VERSION" | "PG_DUMP_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "BackupDumpError";
  }
}

/** « pg_dump (PostgreSQL) 16.4 » -> 16 */
export function parsePgDumpMajor(output: string): number | null {
  const m = /(\d+)(?:\.\d+)*/.exec(output.replace(/^.*?pg_dump[^\d]*/i, ""));
  return m ? Number(m[1]) : null;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.once("error", () => reject(new BackupDumpError("PG_DUMP_MISSING", "pg_dump introuvable.")));
    p.once("close", (c) =>
      c === 0 ? resolve(out) : reject(new BackupDumpError("PG_DUMP_FAILED", "pg_dump a échoué.")),
    );
  });
}

/** Vérifie la présence de pg_dump et que sa version majeure est >= celle du serveur (`PG_SERVER_MAJOR`). */
export async function checkPgDump(
  bin = process.env.PG_DUMP_BIN || "pg_dump",
  minMajor = Number(process.env.PG_SERVER_MAJOR) || 0,
): Promise<number> {
  const major = parsePgDumpMajor(await run(bin, ["--version"]));
  if (major === null || major < minMajor) {
    throw new BackupDumpError("PG_DUMP_VERSION", "Version de pg_dump insuffisante.");
  }
  return major;
}

/** Écrit un dump au format custom dans `outPath` (clair : l'appelant le chiffre puis le supprime). */
export async function runPgDump(databaseUrl: string, outPath: string, bin = process.env.PG_DUMP_BIN || "pg_dump") {
  const p = spawn(bin, ["--format=custom", "--no-owner", "--no-acl"], {
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, PGDATABASE: databaseUrl },
  });
  const exit = new Promise<void>((resolve, reject) => {
    p.once("error", () => reject(new BackupDumpError("PG_DUMP_MISSING", "pg_dump introuvable.")));
    p.once("close", (c) =>
      c === 0 ? resolve() : reject(new BackupDumpError("PG_DUMP_FAILED", "pg_dump a échoué.")),
    );
  });
  await Promise.all([pipeline(p.stdout, createWriteStream(outPath)), exit]);
}
