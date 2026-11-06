import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_DB_CONNECT_TIMEOUT_MS,
  MAX_DB_CONNECT_TIMEOUT_MS,
  dbConnectTimeoutMs,
  dbPoolOptions,
} from "../../../server/lib/db-pool-options";

/**
 * Plafond de connexion des pools (`server/db.ts`).
 *
 * Incident : un test de contrat échouait par intermittence en 503 sur la garde de connexion, après
 * 30 s. Le relais de ports de Docker Desktop acceptait la socket puis la coupait (read ECONNRESET) ;
 * sans plafond, le driver attendait jusque-là, et attendrait sans fin un pair muet. Avec le driver
 * 0.10.4, poser un plafond faisait en plus planter le processus (TypeError non rattrapée).
 */
describe("dbConnectTimeoutMs", () => {
  it("vaut le défaut si la variable est absente ou vide", () => {
    expect(dbConnectTimeoutMs({})).toBe(DEFAULT_DB_CONNECT_TIMEOUT_MS);
    expect(dbConnectTimeoutMs({ DATABASE_CONNECT_TIMEOUT_MS: "  " })).toBe(DEFAULT_DB_CONNECT_TIMEOUT_MS);
  });

  it("lit un entier en millisecondes, 0 compris (sans plafond)", () => {
    expect(dbConnectTimeoutMs({ DATABASE_CONNECT_TIMEOUT_MS: " 2500 " })).toBe(2500);
    expect(dbConnectTimeoutMs({ DATABASE_CONNECT_TIMEOUT_MS: "0" })).toBe(0);
  });

  it.each(["abc", "-1", "1.5", "10s"])("refuse « %s » plutôt que de l'ignorer", (value) => {
    expect(() => dbConnectTimeoutMs({ DATABASE_CONNECT_TIMEOUT_MS: value })).toThrow(/DATABASE_CONNECT_TIMEOUT_MS/);
  });

  it("accepte la borne haute de setTimeout et refuse au-delà (Node ramènerait le délai à 1 ms)", () => {
    expect(dbConnectTimeoutMs({ DATABASE_CONNECT_TIMEOUT_MS: String(MAX_DB_CONNECT_TIMEOUT_MS) })).toBe(2 ** 31 - 1);
    for (const value of [String(2 ** 31), "99999999999999999999"]) {
      expect(() => dbConnectTimeoutMs({ DATABASE_CONNECT_TIMEOUT_MS: value })).toThrow(/DATABASE_CONNECT_TIMEOUT_MS/);
    }
  });

  it("passe le plafond au pool", () => {
    expect(dbPoolOptions("postgres://u:p@h/db", { DATABASE_CONNECT_TIMEOUT_MS: "1234" })).toEqual({
      connectionString: "postgres://u:p@h/db",
      connectionTimeoutMillis: 1234,
    });
  });
});

/**
 * Garde de version du driver installé.
 *
 * Un `node_modules` partagé (jonction de worktree) peut garder un driver antérieur à celui de
 * `package.json`. Le test du pair muet tombe alors en délai de test (10 s) sans dire pourquoi.
 * La version minimale est lue dans `package.json`, pas recopiée ici.
 */
const NEON_PACKAGE = "@neondatabase/serverless";

function parseVersion(version: string): number[] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Version illisible : « ${version} »`);
  return match.slice(1).map(Number);
}

function isOlderThan(installed: string, required: string): boolean {
  const [a, b] = [parseVersion(installed), parseVersion(required)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

function requiredNeonVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  return pkg.dependencies[NEON_PACKAGE];
}

function installedNeonVersion(): string {
  // Le paquet n'exporte pas son package.json : on remonte depuis son point d'entrée.
  let dir = path.dirname(createRequire(import.meta.url).resolve(NEON_PACKAGE));
  for (;;) {
    const file = path.join(dir, "package.json");
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      if (pkg.name === NEON_PACKAGE) return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`package.json de ${NEON_PACKAGE} introuvable`);
    dir = parent;
  }
}

function assertNeonDriverUpToDate(): void {
  const installed = installedNeonVersion();
  const required = requiredNeonVersion();
  if (isOlderThan(installed, required)) {
    throw new Error(
      `node_modules obsolète : npm ci (${NEON_PACKAGE} ${installed} installé, ${required} attendu par package.json)`,
    );
  }
}

describe("garde de version du driver", () => {
  it("compare les versions numériquement", () => {
    expect(isOlderThan("0.10.4", "^1.2.0")).toBe(true);
    expect(isOlderThan("1.1.9", "^1.2.0")).toBe(true);
    expect(isOlderThan("1.2.0", "^1.2.0")).toBe(false);
    expect(isOlderThan("1.10.0", "^1.2.0")).toBe(false);
    expect(isOlderThan("2.0.0", "^1.2.0")).toBe(false);
  });

  it("le driver installé satisfait package.json", () => {
    expect(() => assertNeonDriverUpToDate()).not.toThrow();
  });
});

describe("pool face à un pair qui accepte la socket puis se tait", () => {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
  });
  const saved = {
    webSocketConstructor: neonConfig.webSocketConstructor,
    wsProxy: neonConfig.wsProxy,
    useSecureWebSocket: neonConfig.useSecureWebSocket,
    pipelineConnect: neonConfig.pipelineConnect,
  };

  beforeAll(async () => {
    // Sur un driver plus ancien, le test ci-dessous attendrait son délai de 10 s au lieu d'échouer
    // net : la garde donne la cause tout de suite.
    assertNeonDriverUpToDate();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    neonConfig.webSocketConstructor = ws;
    neonConfig.wsProxy = `127.0.0.1:${port}/v1`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineConnect = false;
  });

  afterAll(async () => {
    Object.assign(neonConfig, saved);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("échoue au plafond, sans planter le processus ni garder la connexion", async () => {
    const pool = new Pool(dbPoolOptions("postgres://u:p@db:5432/x", { DATABASE_CONNECT_TIMEOUT_MS: "300" }));
    const started = Date.now();
    await expect(pool.connect()).rejects.toThrow(/timeout/i);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3000);
    expect(pool.totalCount).toBe(0);
    await pool.end();
  }, 10_000);
});
