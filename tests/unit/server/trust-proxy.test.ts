import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { trustProxyFromEnv } from "../../../server/lib/trust-proxy";

describe("trustProxyFromEnv", () => {
  it("absent, vide ou invalide : un saut (comportement historique)", () => {
    for (const raw of [undefined, "", "  ", "abc", "-1", "1.5", "true", "false", "100", "1 2"]) {
      expect(trustProxyFromEnv(raw), String(raw)).toBe(1);
    }
  });

  it("0 : aucun proxy de confiance ; n >= 1 : n sauts", () => {
    expect(trustProxyFromEnv("0")).toBe(false);
    expect(trustProxyFromEnv(" 0 ")).toBe(false);
    expect(trustProxyFromEnv("1")).toBe(1);
    expect(trustProxyFromEnv("2")).toBe(2);
  });
});

/**
 * Le profil `site` publie l'application sans reverse proxy : tout X-Forwarded-For y est forgeable.
 * Les profils derrière Caddy gardent le défaut (un saut).
 */
describe("deploy/docker-compose.yml : TRUST_PROXY par profil", () => {
  const compose = readFileSync(join(__dirname, "../../../deploy/docker-compose.yml"), "utf8");
  const blockOf = (service: string) => {
    const start = compose.search(new RegExp(`^  ${service}:\s*$`, "m"));
    expect(start, `service ${service} introuvable`).toBeGreaterThanOrEqual(0);
    const rest = compose.slice(start + 1);
    const next = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
    return next < 0 ? rest : rest.slice(0, next);
  };

  it("app-site (sans proxy) fixe TRUST_PROXY à 0", () => {
    expect(blockOf("app-site")).toMatch(/^\s+TRUST_PROXY:\s*"0"\s*$/m);
  });

  it("app-prod et app-recette (derrière Caddy) ne le désactivent pas", () => {
    for (const service of ["app-prod", "app-recette"]) {
      expect(blockOf(service), service).not.toMatch(/TRUST_PROXY:\s*"?0"?\s*$/m);
    }
  });
});
