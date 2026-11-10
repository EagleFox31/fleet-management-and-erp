import { createServer, type Server } from "http";
import { expect } from "vitest";
import { getContractApp } from "./app";
import { cleanupCreated, createIdBag } from "./cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "./factories";

/**
 * Serveur HTTP in-process et sessions par rôle pour les tests de contrat.
 * Un acteur = un compte créé pour le fichier, supprimé par `stop()`.
 */
export type ContractResponse = { status: number; body: any; headers: Headers };

export async function startContractSession<A extends string>(actors: Record<A, TestUserRole>) {
  const ids = createIdBag();
  const app = await getContractApp();
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const cookies = new Map<A, string>();
  const userIds = new Map<A, number>();

  for (const [actor, role] of Object.entries(actors) as [A, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    userIds.set(actor, user.id);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status, `login ${actor} (${role}) : ${await res.clone().text()}`).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }

  async function call(method: string, path: string, options: { body?: unknown; actor?: A | null } = {}): Promise<ContractResponse> {
    const cookie = options.actor === null ? undefined : cookies.get(options.actor ?? (Object.keys(actors)[0] as A));
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(options.body !== undefined || ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()) ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // corps non JSON (fichier, vide)
    }
    return { status: response.status, body, headers: response.headers };
  }

  /** Réponse brute (fichier binaire) : l'appelant lit `arrayBuffer()`. */
  function raw(method: string, path: string, actor: A, body?: BodyInit): Promise<Response> {
    return fetch(baseUrl + path, { method, headers: { Cookie: cookies.get(actor)!, ...(body === undefined && ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()) ? { "Content-Type": "application/json" } : {}) }, body });
  }

  async function stop() {
    await cleanupCreated(ids);
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  /** Port et cookie de session, pour une requete envoyee par socket brut (`tests/support/raw-request.ts`). */
  const port = typeof address === "object" && address ? address.port : 0;
  const cookieOf = (actor: A) => cookies.get(actor)!;

  return { ids, call, raw, userId: (actor: A) => userIds.get(actor)!, port, cookieOf, stop };
}
