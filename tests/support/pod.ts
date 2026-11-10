import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { missionPodFiles } from "../../shared/schema";

/** PDF minimal valide, au contenu unique (donc au sha256 unique). */
export function tinyPdf(tag: string = randomUUID()): Buffer {
  return Buffer.from(`%PDF-1.4\n% TEST ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`, "latin1");
}

/** Dépose un POD directement en base et sur disque (sans passer par la route). */
export async function seedPodFile(missionId: number, userId: number) {
  const content = tinyPdf();
  const relative = path.posix.join("uploads", "missions", "pod", `mission-${missionId}`, `TEST-${randomUUID()}.pdf`);
  const absolute = path.resolve(process.cwd(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  const [row] = await db
    .insert(missionPodFiles)
    .values({
      missionId,
      path: relative,
      originalName: "TEST-pod.pdf",
      mime: "application/pdf",
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      uploadedBy: userId,
    })
    .returning();
  return row;
}

/** Supprime lignes et dossiers POD des missions de test (à appeler avant de supprimer les missions). */
export async function cleanupPodFiles(missionIds: readonly number[]) {
  if (missionIds.length === 0) return;
  await db.delete(missionPodFiles).where(inArray(missionPodFiles.missionId, [...missionIds]));
  for (const id of missionIds) {
    fs.rmSync(path.resolve(process.cwd(), "uploads", "missions", "pod", `mission-${id}`), { recursive: true, force: true });
  }
}
