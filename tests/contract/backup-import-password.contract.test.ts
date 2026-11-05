import { createServer, type Server } from "http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { BCRYPT_HASH_RE } from "../../server/lib/user-password";
import { storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { usersWithSafeSecrets } from "../../server/services/backup-import-service";
import { loginAttemptsByUsername, users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

/**
 * #323 : un compte restauré depuis une sauvegarde au mot de passe en clair était stocké en clair,
 * puis refusé au login. Les lignes passent ici par la même préparation que restoreBackup ; la route
 * /admin/import-backup n'est pas appelée (elle vide vehicles, parts, work_orders de la base partagée).
 */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const names: string[] = [];

async function restoredUser(password: string) {
  const [prepared] = await usersWithSafeSecrets([{ username: "x", email: "x", name: "x", role: "warehouse", password }]);
  const user = await createTestUser({ password: prepared.password });
  ids.userIds.push(user.id);
  names.push(user.username);
  return user;
}
const login = async (username: string, password: string) =>
  (await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })).status;
const storedPassword = async (id: number) => (await db.select({ p: users.password }).from(users).where(eq(users.id, id)))[0].p;

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180000);

afterAll(async () => {
  if (names.length) await db.delete(loginAttemptsByUsername).where(inArray(loginAttemptsByUsername.usernameNormalized, names.map(storedLockoutKey)));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("import de sauvegarde : mot de passe", () => {
  it("clair conforme : stocké haché, le compte se connecte", async () => {
    const user = await restoredUser("clair-restaure-1");
    expect(await storedPassword(user.id)).toMatch(BCRYPT_HASH_RE);
    expect(await login(user.username, "clair-restaure-1")).toBe(200);
  });

  it("SHA-256 hérité : repris, le login l'accepte et le migre en bcrypt", async () => {
    const sha = crypto.createHash("sha256").update("ancien-mdp-1").digest("hex");
    const user = await restoredUser(sha);
    expect(await storedPassword(user.id)).toBe(sha);
    expect(await login(user.username, "ancien-mdp-1")).toBe(200);
    expect(await storedPassword(user.id)).toMatch(BCRYPT_HASH_RE);
  });

  it("trop court : hash inutilisable, la valeur ne connecte pas", async () => {
    const user = await restoredUser("abc");
    expect(await storedPassword(user.id)).toMatch(BCRYPT_HASH_RE);
    expect(await login(user.username, "abc")).toBe(401);
  });
});
