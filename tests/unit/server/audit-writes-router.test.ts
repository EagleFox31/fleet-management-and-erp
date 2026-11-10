import express, { type ErrorRequestHandler } from "express";
import http from "http";
import type { AddressInfo } from "net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setAuditSink, type AuditEntry } from "../../../server/lib/audit";
import { AUDIT_CONFIG } from "../../../server/lib/audit-config";
import { AppError } from "../../../server/lib/app-error";
import { parseRouteId } from "../../../server/lib/route-id";
import { auditWrites } from "../../../server/middleware/audit-writes";

/**
 * Le journal d'audit compare le chemin de la requete a des motifs. Une liste de chaines ne prouve rien :
 * c'est Express qui decide ce qui s'execute (barre absorbee par chaque montage, forme absolue, casse,
 * id lu par la route). Ici, un vrai routeur monte comme `server/app.ts` et `server/api/index.ts`, et une
 * seule propriete : toute ecriture repondue < 400 laisse exactement une entree, sur le bon objet.
 */
const entries: AuditEntry[] = [];
let createdBody: unknown = { id: 77 };
let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  const app = express();
  const apiRouter = express.Router();
  const workOrderParts = express.Router();
  apiRouter.use(express.json());
  apiRouter.use(auditWrites(AUDIT_CONFIG));
  apiRouter.post("/work-orders", (_req, res) => {
    res.status(201).json(createdBody);
  });
  apiRouter.patch("/technician/work-orders/:id/status", (req, res) => {
    res.json({ id: parseRouteId(req.params.id, "Ordre de travail invalide") });
  });
  workOrderParts.post("/:workOrderId/parts", (req, res) => {
    res.json({ id: parseRouteId(req.params.workOrderId, "Ordre de travail invalide") });
  });
  apiRouter.use("/work-orders", workOrderParts);
  app.use("/api", apiRouter);
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(err instanceof AppError ? err.status : 500).end();
  };
  app.use(onError);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setAuditSink(async (entry) => {
    entries.push(entry);
  });
});

afterAll(async () => {
  setAuditSink(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  entries.length = 0;
  createdBody = { id: 77 };
});

/** Chemin envoye tel quel sur la ligne de requete (fetch le normaliserait). */
function send(method: string, path: string, body: unknown = {}): Promise<number> {
  const { port } = server.address() as AddressInfo;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** L'entree est ecrite sur `finish`, juste apres l'envoi : on laisse passer quelques tours de boucle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

const EXECUTED = [
  ["PATCH", "/api/technician/work-orders/62/status"],
  ["PATCH", "/api//technician/work-orders/62/status"],
  ["POST", "/api//work-orders/62/parts"],
  ["POST", "/api/work-orders//62/parts"],
  ["PATCH", "/API/Technician/Work-Orders/62/status/"],
  ["PATCH", "/api/technician/work-orders/6%32/status"],
] as const;

const REFUSED = [
  ["PATCH", "/api/technician/work-orders/0x3e/status"],
  ["PATCH", "/api/technician/work-orders/%2062/status"],
  ["PATCH", "/api/technician/work-orders/6.2e1/status"],
  ["POST", "/api/work-orders/0x3e/parts"],
] as const;

describe("auditWrites dans un vrai routeur Express", () => {
  it.each(EXECUTED)("%s %s s'execute et laisse une entree sur l'ordre 62", async (method, path) => {
    const status = await send(method, path);
    await settle();
    expect(status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityType: "work_order", entityId: "62", method });
  });

  it("forme absolue (`PATCH http://hote/api/...`) : journalisee, chemin enregistre sans l'hote", async () => {
    const status = await send("PATCH", `${baseUrl}/api/technician/work-orders/62/status`);
    await settle();
    expect(status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityId: "62", path: "/api/technician/work-orders/62/status" });
  });

  it("barres doublees : chemin enregistre reduit", async () => {
    await send("POST", "/api/work-orders//62/parts");
    await settle();
    expect(entries[0]?.path).toBe("/api/work-orders/62/parts");
  });

  it.each(REFUSED)("%s %s : id non canonique refuse en 400 par la route, rien a journaliser", async (method, path) => {
    const status = await send(method, path);
    await settle();
    expect(status).toBe(400);
    expect(entries).toHaveLength(0);
  });
});

describe("auditWrites : id d'une creation lu dans la reponse", () => {
  it("POST /work-orders : id entier positif de la reponse", async () => {
    expect(await send("POST", "/api/work-orders")).toBe(201);
    await settle();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "create", entityType: "work_order", entityId: "77" });
  });

  it.each([
    ["id absent", {}],
    ["id texte", { id: "77" }],
    ["id decimal", { id: 7.5 }],
    ["id nul", { id: 0 }],
    ["corps null", null],
  ])("%s : entree gardee, sans id", async (_label, body) => {
    createdBody = body;
    expect(await send("POST", "/api/work-orders")).toBe(201);
    await settle();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entityId).toBeNull();
  });
});
