import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de couverture du masquage des coûts d'OT (`server/lib/work-order-cost-mask.ts`).
 *
 * Le middleware s'applique à tout GET monté sous `/api/work-orders`, mais seul un test de contrat
 * prouve qu'une route ne laisse pas passer un montant sous une clé inattendue. Ce test énumère les GET
 * (routes.ts, routeurs `server/api/*` montés sous `/work-orders`, routes `/work-orders/...` posées à la
 * racine de `/api`) et échoue si l'un n'est ni couvert par le contrat ni exempté avec sa raison.
 *
 * Route nouvelle : l'ajouter à ROUTES de `tests/contract/work-order-cost-mask.contract.test.ts` (champ
 * `covers`) avec une ligne chiffrée, ou ici avec la raison réelle de l'exemption.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CONTRACT = "tests/contract/work-order-cost-mask.contract.test.ts";

const EXEMPTIONS: Array<{ route: string; raison: string }> = [
  { route: "/api/work-orders/statistics", raison: "compteurs par statut (isStaff) : aucun montant dans la réponse" },
  { route: "/api/work-orders/:id/items", raison: "heures de main-d'oeuvre : le service ne touche jamais aux coûts d'OT" },
  { route: "/api/work-orders/:id/labor-rate", raison: "déjà réservée aux rôles coût (authorize WORK_ORDER_COST_READ_ROLES), le chauffeur est refusé en 403" },
  { route: "/api/work-orders/technician/:id", raison: "isTechnician (admin, workshop_manager, technician) : tous sont des rôles coût, le masquage ne s'y applique jamais" },
  { route: "/api/work-orders/:id/export", raison: "isTechnician ou isStockIssuer, document PDF ou CSV non JSON : hors du masquage par construction" },
];

const normalize = (route: string) => route.replace(/:\w+/g, ":id").replace(/\/+$/, "") || "/";
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

function getPaths(source: string, receivers: RegExp): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\b(\w+)\.(?:get|head)\(\s*["'`]([^"'`]*)["'`]/g)) {
    if (receivers.test(m[1])) out.push(m[2]);
  }
  return out;
}

function importedFile(indexSource: string, name: string): string | null {
  for (const m of indexSource.matchAll(/import\s+([^;]+?)\s+from\s+["'](\.\/[^"']+)["']/g)) {
    const clause = m[1];
    const isDefault = new RegExp(`^${name}\\b`).test(clause);
    const isNamed = new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}`).test(clause);
    if (isDefault || isNamed) return `server/api/${m[2].slice(2)}.ts`;
  }
  return null;
}

function enumerateWorkOrderGets(): string[] {
  const found = new Set<string>();

  for (const p of getPaths(read("server/routes.ts"), /^app$/)) {
    if (p === "/api/work-orders" || p.startsWith("/api/work-orders/")) found.add(normalize(p));
  }

  const index = read("server/api/index.ts");
  for (const m of index.matchAll(/apiRouter\.use\(\s*["']\/work-orders["']\s*,\s*(\w+)\s*\)/g)) {
    const file = importedFile(index, m[1]);
    if (!file) continue; // middleware (workOrderCostMask, workOrderBookingGuard) : pas un routeur importé de ./
    const source = read(file);
    for (const p of getPaths(source, new RegExp(`^(router|${m[1]})$`))) found.add(normalize(`/api/work-orders${p === "/" ? "" : p}`));
  }

  const apiDir = join(ROOT, "server/api");
  for (const file of readdirSync(apiDir).filter((f) => f.endsWith(".ts"))) {
    for (const p of getPaths(read(`server/api/${file}`), /^router$/)) {
      if (p === "/work-orders" || p.startsWith("/work-orders/")) found.add(normalize(`/api${p}`));
    }
  }
  return [...found].sort();
}

const covered = (): string[] =>
  [...read(CONTRACT).matchAll(/covers:\s*"([^"]+)"/g)].map((m) => normalize(m[1])).sort();

describe("masquage des coûts d'OT : couverture des GET sous /work-orders", () => {
  const routes = enumerateWorkOrderGets();

  it("le recensement voit les routes connues", () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        "/api/work-orders",
        "/api/work-orders/:id",
        "/api/work-orders/:id/parts",
        "/api/work-orders/:id/pending-part-requirements",
        "/api/work-orders/:id/tire-rotations",
        "/api/work-orders/:id/items",
        "/api/work-orders/:id/labor-rate",
        "/api/work-orders/vehicle/:id",
      ]),
    );
  });

  it("chaque GET est couvert par le contrat ou exempté avec sa raison", () => {
    const ok = new Set([...covered(), ...EXEMPTIONS.map((e) => normalize(e.route))]);
    const missing = routes.filter((r) => !ok.has(r));
    expect(
      missing,
      "GET sous /work-orders ni couvert par le contrat de masquage ni exempté : ajouter la route à ROUTES de " +
        `${CONTRACT} (champ covers) ou à EXEMPTIONS avec la raison réelle.`,
    ).toEqual([]);
  });

  it("les exemptions et les couvertures désignent des routes qui existent, sans doublon", () => {
    const exempt = EXEMPTIONS.map((e) => normalize(e.route));
    expect(exempt.filter((r) => !routes.includes(r)), "exemption périmée").toEqual([]);
    expect(covered().filter((r) => !routes.includes(r)), "route couverte qui n'existe plus").toEqual([]);
    expect(exempt.filter((r) => covered().includes(r)), "route à la fois couverte et exemptée").toEqual([]);
    expect(EXEMPTIONS.every((e) => e.raison.length > 20)).toBe(true);
  });
});
