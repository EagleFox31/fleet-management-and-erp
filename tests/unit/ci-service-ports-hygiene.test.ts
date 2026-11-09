import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Les services d'un job GitHub Actions (Postgres, wsproxy) ne publient pas de port hôte fixe.
 * Un mappage « 54320:5432 » échoue au démarrage si le port est déjà pris sur la VM :
 * le job meurt avant le premier test (incidents du 9 novembre 2026, contract (2) puis contract (3)).
 * Port hôte dynamique (« - 5432 ») et adresse construite par étape avec
 * `job.services.<service>.ports['<port>']`.
 *
 * Le docker-compose local de test garde son port fixe 54320 : il est hors de ce contrôle.
 */
const WORKFLOWS_DIR = path.resolve(__dirname, "../../.github/workflows");

// « - 54320:5432 », « - "5433:80" », « - 127.0.0.1:54320:5432 » : tout mappage qui fixe le port hôte.
const FIXED_HOST_PORT = /^\s*-\s*["']?(?:[\d.]+:)?\d+:\d+(?:\/(?:tcp|udp))?["']?\s*(?:#.*)?$/;

export function fixedHostPorts(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => FIXED_HOST_PORT.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`);
}

describe("workflows CI : aucun port hôte fixe sur les services", () => {
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f));

  it("trouve des workflows à contrôler", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s : ports de service dynamiques", (file) => {
    const src = readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
    expect(fixedHostPorts(src)).toEqual([]);
  });

  it("le motif détecte bien un port hôte fixe", () => {
    expect(fixedHostPorts("        ports:\n          - 54320:5432\n")).toEqual(["2: - 54320:5432"]);
    expect(fixedHostPorts('          - "5433:80"')).toHaveLength(1);
    expect(fixedHostPorts("          - 127.0.0.1:54320:5432")).toHaveLength(1);
    expect(fixedHostPorts("          - 5432\n          - 80")).toEqual([]);
  });
});
