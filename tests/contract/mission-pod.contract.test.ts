import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missionPodFiles, missions } from "../../shared/schema";
import { missionPodListResponseSchema, missionPodUploadResponseSchema } from "../../shared/contracts/mission-pod";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { cleanupPodFiles, seedPodFile, tinyPdf } from "../support/pod";

/**
 * Preuve de livraison (POD). Faille d'origine : `insertMissionSchema` n'omettait pas `podUrl`
 * ni `podUploadedAt`, si bien que POST /api/missions pouvait écrire une fausse preuve.
 * Puis dépôt (POST /:id/pod-files), liste, téléchargement et trame temps réel.
 */

type Actor = "logistics" | "assignedDriver" | "otherDriver" | "client";
const ACTORS: Record<Actor, "logistics" | "driver" | "client"> = {
  logistics: "logistics",
  assignedDriver: "driver",
  otherDriver: "driver",
  client: "client",
};

type Scope = { type: string; userIds?: number[]; roles?: string[] };
type Captured = { eventType: string; scope?: Scope; payload?: Record<string, unknown> };

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const captured: Captured[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let actors: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const reaches = (scope: Scope | undefined, userId: number, role: string): boolean => {
  if (!scope) return false;
  if (scope.type === "broadcast") return true;
  if (scope.type === "user") return (scope.userIds ?? []).includes(userId);
  if (scope.type === "roles") return (scope.roles ?? []).includes(role);
  return false;
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from("JFIF TEST"), Buffer.from(uniqueTestToken("jpg"))]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function newMission(status: "draft" | "in_progress" | "delivered" = "in_progress", assignedDriver = false) {
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("POD"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status } as any)
    .returning();
  missionIds.push(mission.id);
  if (assignedDriver) {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const driver = await driverProfile(actors.userIdOf("assignedDriver"));
    await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: driver.id, status: "accepted" } as any);
  }
  return mission;
}

async function driverProfile(userId: number) {
  const [existing] = await db.select().from(drivers).where(eq(drivers.userId, userId));
  if (existing) return existing;
  const [created] = await db.insert(drivers).values({ userId, firstName: "TEST", lastName: uniqueTestToken("drv") } as any).returning();
  driverIds.push(created.id);
  return created;
}

type Upload = { name: string; type: string; data: Buffer };
async function upload(missionId: number, files: Upload[], actor: Actor = "logistics") {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  const response = await fetch(`${actors.baseUrl}/api/missions/${missionId}/pod-files`, {
    method: "POST",
    headers: { Cookie: actors.cookies.get(actor)! },
    body: form,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

const rowsOf = (missionId: number) => db.select().from(missionPodFiles).where(eq(missionPodFiles.missionId, missionId));
const podDir = (missionId: number) => path.resolve(process.cwd(), "uploads", "missions", "pod", `mission-${missionId}`);
const filesOnDisk = (missionId: number) => (fs.existsSync(podDir(missionId)) ? fs.readdirSync(podDir(missionId)) : []);

async function podColumns(missionId: number) {
  const [row] = await db
    .select({ podUrl: missions.podUrl, podUploadedAt: missions.podUploadedAt })
    .from(missions)
    .where(eq(missions.id, missionId));
  return row;
}

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: { scope?: Scope; payload?: Record<string, unknown> }) => {
    captured.push({ eventType, scope: data?.scope, payload: data?.payload });
  });
  actors = await startContractActors<Actor>(ACTORS, ids.userIds);
  await driverProfile(actors.userIdOf("otherDriver"));
}, 180000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  await cleanupPodFiles(missionIds);
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await actors?.close();
}, 120000);

describe("POD : le corps d'une requête ne pose jamais la preuve", { timeout: 180000 }, () => {
  it("POST /api/missions avec podUrl et podUploadedAt : colonnes laissées vides", async () => {
    const res = await actors.call("POST", "/api/missions", {
      actor: "logistics",
      body: {
        orderNumber: uniqueTestToken("POD"),
        pickupAddress: "TEST A",
        deliveryAddress: "TEST B",
        podUrl: "/api/missions/1/pod-files/1",
        podUploadedAt: new Date().toISOString(),
      },
    });
    expect(res.status).toBe(201);
    missionIds.push(res.body.id);
    expect(await podColumns(res.body.id)).toEqual({ podUrl: null, podUploadedAt: null });
  });

  it("PATCH /api/missions/:id avec podUrl : colonne inchangée", async () => {
    const mission = await newMission("planned" as any);
    const res = await actors.call("PATCH", `/api/missions/${mission.id}`, {
      actor: "logistics",
      body: { specialInstructions: "TEST pod", podUrl: "/faux", podUploadedAt: new Date().toISOString() },
    });
    expect(res.status).toBe(200);
    expect(await podColumns(mission.id)).toEqual({ podUrl: null, podUploadedAt: null });
  });
});

describe("POD : dépôt par la logistique", { timeout: 180000 }, () => {
  it("un PDF puis un JPEG : 201, lignes en base, podUrl sur le dernier fichier, rien en double", async () => {
    const mission = await newMission();
    const pdf = tinyPdf();
    const first = await upload(mission.id, [{ name: "bon.pdf", type: "application/pdf", data: pdf }]);
    expect(first.status).toBe(201);
    expect(missionPodUploadResponseSchema.safeParse(first.body).success).toBe(true);
    expect(first.body).toMatchObject({ duplicates: 0, fileCount: 1 });
    const second = await upload(mission.id, [{ name: "photo.jpg", type: "image/jpeg", data: JPEG }]);
    expect(second.status).toBe(201);

    const rows = await rowsOf(mission.id);
    expect(rows.map((r) => r.mime).sort()).toEqual(["application/pdf", "image/jpeg"]);
    const latest = Math.max(...rows.map((r) => r.id));
    const columns = await podColumns(mission.id);
    expect(columns.podUrl).toBe(`/api/missions/${mission.id}/pod-files/${latest}`);
    expect(columns.podUploadedAt).not.toBeNull();
    // Stockage sous le dossier de la mission, nom UUID, extension tirée du type.
    for (const row of rows) {
      expect(row.path).toMatch(new RegExp(`^uploads/missions/pod/mission-${mission.id}/[0-9a-f-]{36}\\.(pdf|jpg)$`));
      expect(row.uploadedBy).toBe(actors.userIdOf("logistics"));
    }
    expect(JSON.stringify(first.body)).not.toContain("uploads/");

    // Même contenu redéposé : aucun doublon en base ni sur disque.
    const again = await upload(mission.id, [{ name: "bon-bis.pdf", type: "application/pdf", data: pdf }]);
    expect(again.status).toBe(201);
    expect(missionPodUploadResponseSchema.safeParse(again.body).success).toBe(true);
    expect(again.body).toMatchObject({ files: [], duplicates: 1, fileCount: 2 });
    expect(await rowsOf(mission.id)).toHaveLength(2);
    expect(filesOnDisk(mission.id)).toHaveLength(2);
  });

  it("faux PDF (contenu HTML déclaré PDF) : 400 lisible, aucun fichier sur disque ni en base", async () => {
    const mission = await newMission();
    const res = await upload(mission.id, [{ name: "faux.pdf", type: "application/pdf", data: Buffer.from("<html><script>x</script></html>") }]);
    expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    expect(res.body.message).toBe("Le fichier n'est pas une photo ou un PDF lisible.");
    expect(filesOnDisk(mission.id)).toEqual([]);
    expect(await rowsOf(mission.id)).toHaveLength(0);
  });

  it("fichier de plus de 10 Mo : 400 lisible", async () => {
    const mission = await newMission();
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20)]);
    const res = await upload(mission.id, [{ name: "gros.pdf", type: "application/pdf", data: big }]);
    expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    expect(res.body.message).toBe("Un fichier dépasse 10 Mo.");
    expect(filesOnDisk(mission.id)).toEqual([]);
  });

  it("SVG : 400", async () => {
    const mission = await newMission();
    const res = await upload(mission.id, [{ name: "logo.svg", type: "image/svg+xml", data: SVG }]);
    expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    expect(await rowsOf(mission.id)).toHaveLength(0);
  });

  it("HEIC : 400 avec le message clair", async () => {
    const mission = await newMission();
    const res = await upload(mission.id, [{ name: "photo.heic", type: "image/heic", data: HEIC }]);
    expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    expect(res.body.message).toBe("Format HEIC non accepté : prenez la photo en JPEG ou envoyez un PDF.");
  });

  it("HEIC déclaré JPEG : le contenu réel est refusé avec le même message", async () => {
    const mission = await newMission();
    const res = await upload(mission.id, [{ name: "photo.jpg", type: "image/jpeg", data: HEIC }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Format HEIC non accepté : prenez la photo en JPEG ou envoyez un PDF.");
    expect(filesOnDisk(mission.id)).toEqual([]);
  });

  it("mission en brouillon : 409 lisible, aucun fichier gardé", async () => {
    const mission = await newMission("draft");
    const res = await upload(mission.id, [{ name: "bon.pdf", type: "application/pdf", data: tinyPdf() }]);
    expect(apiErrorProblems(res.status, res.body, 409)).toEqual([]);
    expect(res.body.message).toBe("Le POD se dépose une fois la mission en cours ou livrée.");
    expect(filesOnDisk(mission.id)).toEqual([]);
    expect(await rowsOf(mission.id)).toHaveLength(0);
  });

  it("mission inexistante : 404 et aucun dossier créé sur le disque", async () => {
    const missingId = 2_000_000_000;
    expect(fs.existsSync(podDir(missingId))).toBe(false);
    const res = await upload(missingId, [{ name: "bon.pdf", type: "application/pdf", data: tinyPdf() }]);
    expect(apiErrorProblems(res.status, res.body, 404)).toEqual([]);
    expect(fs.existsSync(podDir(missingId))).toBe(false);
  });

  it("aucun fichier joint : 400", async () => {
    const mission = await newMission();
    const res = await upload(mission.id, []);
    expect(res.status).toBe(400);
  });
});

describe("POD : cloison des rôles", { timeout: 180000 }, () => {
  it("chauffeur non affecté : 403 en dépôt comme en téléchargement", async () => {
    const mission = await newMission("in_progress", true);
    const seeded = await seedPodFile(mission.id, actors.userIdOf("logistics"));
    const put = await upload(mission.id, [{ name: "bon.pdf", type: "application/pdf", data: tinyPdf() }], "otherDriver");
    expect(apiErrorProblems(put.status, put.body, 403)).toEqual([]);
    const list = await actors.call("GET", `/api/missions/${mission.id}/pod-files`, { actor: "otherDriver" });
    expect(list.status).toBe(403);
    const file = await actors.call("GET", `/api/missions/${mission.id}/pod-files/${seeded.id}`, { actor: "otherDriver" });
    expect(file.status).toBe(403);
    expect(await rowsOf(mission.id)).toHaveLength(1);
  });

  it("chauffeur affecté : 201", async () => {
    const mission = await newMission("in_progress", true);
    const res = await upload(mission.id, [{ name: "bon.pdf", type: "application/pdf", data: tinyPdf() }], "assignedDriver");
    expect(res.status).toBe(201);
    expect(await rowsOf(mission.id)).toHaveLength(1);
  });

  it("client : 403", async () => {
    const mission = await newMission();
    const put = await upload(mission.id, [{ name: "bon.pdf", type: "application/pdf", data: tinyPdf() }], "client");
    expect(put.status).toBe(403);
    const list = await actors.call("GET", `/api/missions/${mission.id}/pod-files`, { actor: "client" });
    expect(list.status).toBe(403);
    const seeded = await seedPodFile(mission.id, actors.userIdOf("logistics"));
    const file = await actors.call("GET", `/api/missions/${mission.id}/pod-files/${seeded.id}`, { actor: "client" });
    expect(file.status).toBe(403);
  });
});

describe("POD : lecture", { timeout: 180000 }, () => {
  it("liste : métadonnées seulement, jamais le chemin", async () => {
    const mission = await newMission();
    await seedPodFile(mission.id, actors.userIdOf("logistics"));
    const res = await actors.call("GET", `/api/missions/${mission.id}/pod-files`, { actor: "logistics" });
    expect(res.status).toBe(200);
    expect(missionPodListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.files).toHaveLength(1);
    expect(Object.keys(res.body.files[0]).sort()).toEqual(["id", "mime", "originalName", "sizeBytes", "uploadedAt", "uploadedByName"]);
  });

  it("fichier : en-têtes de non-exécution, contenu servi", async () => {
    const mission = await newMission();
    const seeded = await seedPodFile(mission.id, actors.userIdOf("logistics"));
    const response = await fetch(`${actors.baseUrl}/api/missions/${mission.id}/pod-files/${seeded.id}`, {
      headers: { Cookie: actors.cookies.get("logistics")! },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toMatch(/^application\/pdf/);
    expect(response.headers.get("content-disposition")).toMatch(/^inline/);
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect((await response.text()).startsWith("%PDF-")).toBe(true);
  });

  it("nom d'origine non ASCII ou avec CR/LF : 200 et Content-Disposition valide, cache interdit", async () => {
    const mission = await newMission();
    for (const name of ["reçu été 日本.pdf", "a\r\nX-Injected: 1.pdf"]) {
      const seeded = await seedPodFile(mission.id, actors.userIdOf("logistics"));
      await db.update(missionPodFiles).set({ originalName: name }).where(eq(missionPodFiles.id, seeded.id));
      const response = await fetch(`${actors.baseUrl}/api/missions/${mission.id}/pod-files/${seeded.id}`, {
        headers: { Cookie: actors.cookies.get("logistics")! },
      });
      expect(response.status).toBe(200);
      const disposition = response.headers.get("content-disposition") ?? "";
      expect(disposition).toMatch(/^inline; filename="[\x20-\x7e]+"/);
      expect(response.headers.get("x-injected")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      await response.arrayBuffer();
    }
  });

  it("fileId d'une autre mission : 404", async () => {
    const mine = await newMission();
    const other = await newMission();
    const seeded = await seedPodFile(other.id, actors.userIdOf("logistics"));
    const res = await actors.call("GET", `/api/missions/${mine.id}/pod-files/${seeded.id}`, { actor: "logistics" });
    expect(apiErrorProblems(res.status, res.body, 404)).toEqual([]);
  });

  it("identifiant de fichier invalide : 400", async () => {
    const mission = await newMission();
    const res = await actors.call("GET", `/api/missions/${mission.id}/pod-files/12abc`, { actor: "logistics" });
    expect(res.status).toBe(400);
  });
});

describe("POD : trame temps réel", { timeout: 180000 }, () => {
  it("mission_pod_uploaded : compteur et dernier fichier au personnel, identifiant seul au chauffeur affecté, rien aux autres, aucun chemin", async () => {
    const mission = await newMission("in_progress", true);
    captured.length = 0;
    const res = await upload(mission.id, [{ name: "secret-nom.pdf", type: "application/pdf", data: tinyPdf() }]);
    expect(res.status).toBe(201);
    const frames = captured.filter((f) => f.eventType === "mission_pod_uploaded");
    const to = (actor: Actor) => frames.filter((f) => reaches(f.scope, actors.userIdOf(actor), ACTORS[actor]));

    const staff = to("logistics");
    expect(staff).toHaveLength(1);
    const rows = await rowsOf(mission.id);
    expect(staff[0].payload).toEqual({
      missionId: mission.id,
      fileCount: 1,
      latestFileId: rows[0].id,
      uploadedAt: expect.any(String),
    });
    expect(to("assignedDriver")).toHaveLength(1);
    expect(to("assignedDriver")[0].payload).toEqual({ missionId: mission.id });
    expect(to("otherDriver")).toEqual([]);
    expect(to("client")).toEqual([]);
    expect(frames.filter((f) => f.scope?.type === "broadcast")).toEqual([]);
    expect(JSON.stringify(frames)).not.toMatch(/uploads|secret-nom|\.pdf/);
  });

  it("dépôt en doublon : aucune trame", async () => {
    const mission = await newMission();
    const pdf = tinyPdf();
    await upload(mission.id, [{ name: "a.pdf", type: "application/pdf", data: pdf }]);
    captured.length = 0;
    await upload(mission.id, [{ name: "a.pdf", type: "application/pdf", data: pdf }]);
    expect(captured.filter((f) => f.eventType === "mission_pod_uploaded")).toEqual([]);
  });
});
