import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * `server/storage.ts` contient des méthodes bouchons d'une ligne
 * (`{ return undefined; }`). Appelées par une route, elles échouent en silence :
 * `getMaintenanceSchedule` renvoyait toujours undefined, donc toute édition ou
 * suppression de planification répondait 404.
 *
 * Les bouchons encore appelés sont gelés ci-dessous : la liste ne peut que
 * rétrécir. Un nouveau bouchon appelé, ou un appel ajouté vers un bouchon,
 * fait échouer ce test.
 *
 * La détection couvre aussi les retours d'objet vide sur plusieurs lignes
 * (`{ return { workOrders: [], total: 0 }; }`) : `getWorkOrdersByOwner` y
 * échappait, et un client ne voyait aucun ordre de travail.
 */
const KNOWN_CALLED_STUBS: string[] = [];

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("bouchons de server/storage.ts", () => {
  const storageSource = readFileSync(join(serverDir, "storage.ts"), "utf8");
  const emptyValue = String.raw`(?:undefined|null|false|0|\[\])`;
  const emptyObject = String.raw`\{\s*(?:\w+:\s*${emptyValue},?\s*)*\}`;
  const stubPattern = new RegExp(String.raw`async (\w+)\([^)]*\)[^{\n]*\{\s*return (?:${emptyValue}|${emptyObject});\s*\}`, "g");
  const stubs = [...storageSource.matchAll(stubPattern)].map((m) => m[1]);
  const callers = serverSources(serverDir).map((path) => readFileSync(path, "utf8")).join("\n");

  it("la détection trouve bien des bouchons", () => {
    expect(stubs.length).toBeGreaterThan(0);
  });

  it("aucun nouveau bouchon n'est appelé par le serveur", () => {
    const called = stubs.filter((name) => new RegExp(`storage\\.${name}\\(`).test(callers));
    expect([...new Set(called)].sort()).toEqual([...KNOWN_CALLED_STUBS].sort());
  });
});
