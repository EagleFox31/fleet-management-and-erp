import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import * as roles from "../../../shared/constants/roles";
import {
  COVERED_ELSEWHERE,
  EXCLUSIONS,
  MAX_EXCLUSIONS,
  missingFromSweep,
  staleRows,
  signatureOf,
  SWEEP_ROUTES,
} from "../../support/client-scope-sweep-table";
import { scanClientOpenParamRoutes } from "../../support/route-guard-scan";

/**
 * Garde du balayage de cloison client (AGENTS.md §11) : toute route `isAnyUser` dont le chemin porte
 * un parametre doit figurer au balayage (`client-scope-sweep.contract.test.ts`), etre balayee par un
 * autre contrat nomme, ou figurer aux exclusions avec sa raison. Sinon une route ouverte a un client
 * peut repondre autrement pour l'objet d'un autre et pour un identifiant absent sans que rien ne le voie.
 *
 * Limite : seule la garde ecrite dans l'en-tete de la route est vue (pas une garde posee au montage).
 */
const root = fileURLToPath(new URL("../../..", import.meta.url));
const serverDir = `${root}server`;

describe("balayage de cloison : aucune route ouverte a un client ne manque", () => {
  const found = scanClientOpenParamRoutes(serverDir, roles as never);

  it("le scan voit les routes ouvertes (sinon il ne garde rien)", () => {
    expect(found.length).toBeGreaterThan(15);
    expect(found).toContain("GET /api/work-orders/:p");
  });

  it("chaque route ouverte est au balayage, couverte ailleurs ou exclue", () => {
    expect(missingFromSweep(found)).toEqual([]);
  });

  it("une route fictive absente de la table est signalee", () => {
    expect(missingFromSweep([...found, "GET /api/fictive/:p"])).toEqual(["GET /api/fictive/:p"]);
    expect(missingFromSweep([...found, "DELETE /api/work-orders/:p"])).toEqual(["DELETE /api/work-orders/:p"]);
  });

  it("les exclusions portent une raison et ne peuvent que rétrécir", () => {
    // Plafond en dur ici (et non importe) : relever MAX_EXCLUSIONS ne doit pas suffire a faire passer le test.
    expect(EXCLUSIONS.length).toBeLessThanOrEqual(1);
    expect(MAX_EXCLUSIONS).toBe(1);
    for (const e of EXCLUSIONS) expect(e.raison.length, signatureOf(e)).toBeGreaterThan(30);
  });

  it("une route couverte ailleurs figure bien dans le contrat nomme", () => {
    for (const c of COVERED_ELSEWHERE) {
      expect(existsSync(`${root}${c.file}`), c.file).toBe(true);
      // chemin exact : le fragment doit se terminer sur le delimiteur du litteral, pas sur un chemin plus long
      const source = readFileSync(`${root}${c.file}`, "utf8");
      const found = c.exact ? source.includes(c.fragment) : ["`", '"', "'"].some((q) => source.includes(`${c.fragment}${q}`));
      expect(found, signatureOf(c)).toBe(true);
    }
  });

  it("une route ne figure pas deux fois dans les listes", () => {
    const all = [...SWEEP_ROUTES, ...COVERED_ELSEWHERE, ...EXCLUSIONS].map((r) => `${signatureOf(r)}`);
    expect(all.length).toBe(new Set(all).size);
  });

  it("aucune ligne de la table n'est perimee (route supprimee, renommee ou restreinte)", () => {
    expect(staleRows(found)).toEqual([]);
  });
});

/** Le scan lit les gardes posees au montage et par `router.use`, pas seulement l'en-tete de la route. */
describe("scan des gardes effectives (arbre synthetique)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sweep-scan-"));
  const write = (name: string, text: string) => {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  };
  const scan = () => scanClientOpenParamRoutes(dir, roles as never);
  const routeFile = (head: string, route: string) =>
    `import { Router } from "express";\nconst router = Router();\n${head}\nrouter.get("${route}", async (req, res) => { res.json({}); });\nexport default router;\n`;
  mkdirSync(join(dir, "middleware"), { recursive: true });
  copyFileSync(`${serverDir}/middleware/auth.ts`, join(dir, "middleware", "auth.ts"));
  write(
    "api/index.ts",
    [
      'import { Router } from "express";',
      'import { isStaff } from "../middleware/auth";',
      'import a from "./a.routes";',
      'import b from "./b.routes";',
      'import c from "./c.routes";',
      'import d from "./d.routes";',
      'import e from "./e.routes";',
      'import f from "./f.routes";',
      "const apiRouter = Router();",
      'apiRouter.use("/a", a);',
      'apiRouter.use("/b", b);',
      'apiRouter.use("/c", isStaff, c);',
      'apiRouter.use("/d", d);',
      'apiRouter.use("/e", e);',
      'apiRouter.use("/f", f);',
      "",
    ].join("\n"),
  );
  write("api/a.routes.ts", routeFile("router.use(isAnyUser);", "/x/:id"));
  write("api/b.routes.ts", routeFile("", "/y/:id").replace('"/y/:id", async', '"/y/:id", authenticate, async'));
  write("api/c.routes.ts", routeFile("router.use(authenticate);", "/z/:id"));
  write("api/d.routes.ts", routeFile("", "/w/:id").replace('"/w/:id", async', '"/w/:id", isStaff, async'));
  write("api/e.routes.ts", routeFile("", "/v/:id"));
  write("api/f.routes.ts", routeFile("router.use(maGardeInconnue);", "/u/:id"));

  it("retient router.use(isAnyUser) et authenticate en en-tete", () => {
    const out = scan();
    expect(out).toContain("GET /api/a/x/:p");
    expect(out).toContain("GET /api/b/y/:p");
  });

  it("ignore une route couverte par une garde restrictive (montage ou en-tete) ou sans session", () => {
    const out = scan();
    expect(out).not.toContain("GET /api/c/z/:p");
    expect(out).not.toContain("GET /api/d/w/:p");
    expect(out).not.toContain("GET /api/e/v/:p");
  });

  it("une garde inconnue dans router.use compte comme permissive (echec ferme)", () => {
    expect(scan()).toContain("GET /api/f/u/:p");
  });

  it("une garde de session ajoutee apres la route ne la couvre pas", () => {
    write("api/e.routes.ts", routeFile("", "/v/:id").replace("export default", "router.use(isAnyUser);\nexport default"));
    expect(scan()).not.toContain("GET /api/e/v/:p");
  });

  const NL = "\n";
  const USE_ANY = `router.use(isAnyUser);${NL}`;
  const SECOND = (guards: string) =>
    `import { Router } from "express";${NL}const router = Router();${NL}const autre = Router();${NL}${guards}autre.use(isAnyUser);${NL}autre.get("/s/:id", async (req, res) => { res.json({}); });${NL}export default router;${NL}`;

  it("un router.use(isStaff) conditionnel ne couvre pas la route (il n'est pas toujours posé)", () => {
    write("api/index.ts", readFileSync(join(dir, "api/index.ts"), "utf8").replace('apiRouter.use("/f", f);', `apiRouter.use("/f", f);${NL}apiRouter.use("/g", g);`).replace("import f from", `import g from "./g.routes";${NL}import f from`));
    write("api/g.routes.ts", routeFile(`${USE_ANY}if (process.env.X) {${NL}  router.use(isStaff);${NL}}`, "/t/:id"));
    expect(scan()).toContain("GET /api/g/t/:p");
    write("api/g.routes.ts", routeFile(`${USE_ANY}router.use(isStaff);`, "/t/:id"));
    expect(scan()).not.toContain("GET /api/g/t/:p");
  });

  it("un chemin en gabarit ou illisible est retenu, jamais ignoré", () => {
    const withPath = (head: string, call: string) => routeFile(head, "/t/:id").replace('router.get("/t/:id"', call);
    write("api/g.routes.ts", withPath(USE_ANY, "router.get(`/t/${SEG}`"));
    expect(scan()).toContain("GET /api/g/t/:p");
    write("api/g.routes.ts", withPath(USE_ANY, "router.get(construire(SEG)"));
    expect(scan().some((s) => s.startsWith("GET /api/g/") && s.includes("construire"))).toBe(true);
    write("api/g.routes.ts", withPath(`${USE_ANY}router.use(isStaff);`, "router.get(construire(SEG)"));
    expect(scan().some((s) => s.includes("construire"))).toBe(false);
  });

  it("un second routeur du fichier, jamais monté, est retenu sans hériter des gardes du routeur monté (échec fermé)", () => {
    write("api/g.routes.ts", SECOND(`${USE_ANY}router.use(isStaff);${NL}`));
    expect(scan().some((s) => s.endsWith("/s/:p"))).toBe(true);
    write("api/g.routes.ts", SECOND(USE_ANY));
    expect(scan().some((s) => s.endsWith("/s/:p"))).toBe(true);
  });

  it("nettoyage", () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
