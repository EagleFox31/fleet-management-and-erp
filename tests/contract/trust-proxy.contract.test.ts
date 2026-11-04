import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { createApp } from "../../server/app";
import { storedLockoutKey } from "../../server/services/login-lockout-db-store";

/**
 * Sans proxy de confiance (TRUST_PROXY=0, profil `site`), un X-Forwarded-For forgé ne change pas
 * l'adresse comptée par la limite d'essais : toutes les requêtes comptent pour la connexion réelle.
 * L'application est recréée ici (le réglage est lu à la création), l'app partagée des autres
 * contrats garde le défaut.
 */

let server: Server;
let baseUrl = "";
const saved = { trust: process.env.TRUST_PROXY, max: process.env.AUTH_IP_FAILURE_MAX };
const keys: string[] = [];

beforeAll(async () => {
  process.env.TRUST_PROXY = "0";
  process.env.AUTH_IP_FAILURE_MAX = "3";
  const { app } = await createApp({ initializeDb: false });
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  for (const [name, value] of Object.entries({ TRUST_PROXY: saved.trust, AUTH_IP_FAILURE_MAX: saved.max })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys]);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("trust proxy désactivé", { timeout: 60000 }, () => {
  it("un X-Forwarded-For différent à chaque essai ne contourne pas le plafond par IP", async () => {
    const attempt = async (i: number) => {
      const name = `trust-proxy-probe-${Math.random().toString(36).slice(2)}`;
      keys.push(storedLockoutKey(name));
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `203.0.113.${i + 1}` },
        body: JSON.stringify({ username: name, password: "faux" }),
      });
      return res.status;
    };
    expect(await attempt(0)).toBe(401);
    expect(await attempt(1)).toBe(401);
    expect(await attempt(2)).toBe(401);
    expect(await attempt(3), "quatrième échec depuis la même connexion").toBe(429);
  });
});
