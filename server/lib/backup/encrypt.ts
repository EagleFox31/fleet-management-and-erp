/**
 * Chiffrement des sauvegardes : AES-256-GCM (node:crypto), en flux.
 * Format : "FMB1" | nonce (12) | texte chiffré | étiquette d'authentification (16).
 * La clé (32 octets, base64 ou hex de 64 caractères) vient de l'environnement ;
 * elle n'est jamais journalisée ni incluse dans un message d'erreur.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Readable, Writable } from "node:stream";

const MAGIC = Buffer.from("FMB1");
const NONCE_LEN = 12;
const TAG_LEN = 16;

export class BackupCryptoError extends Error {
  constructor(
    readonly code: "KEY_MISSING" | "KEY_INVALID" | "AUTH_FAILED" | "FORMAT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "BackupCryptoError";
  }
}

export function parseBackupKey(raw: string | undefined): Buffer {
  if (!raw) throw new BackupCryptoError("KEY_MISSING", "Clé de sauvegarde absente.");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new BackupCryptoError("KEY_INVALID", "La clé de sauvegarde doit faire 32 octets.");
  return key;
}

/** Chiffre `source` vers `target` ; renvoie taille et SHA-256 du fichier chiffré. */
export async function encryptStream(
  source: Readable,
  target: Writable,
  key: Buffer,
): Promise<{ sizeBytes: number; checksum: string }> {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const hash = createHash("sha256");
  let size = 0;
  const tap = (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
    return chunk;
  };
  async function* body() {
    yield tap(Buffer.concat([MAGIC, nonce]));
    for await (const chunk of source.pipe(cipher)) yield tap(chunk as Buffer);
    yield tap(cipher.getAuthTag());
  }
  // pipe() ne propage pas les erreurs de la source : on les relaie.
  source.once("error", (e) => cipher.destroy(e));
  await pipeline(body, target);
  return { sizeBytes: size, checksum: hash.digest("hex") };
}

export function encryptFile(inPath: string, outPath: string, key: Buffer) {
  return encryptStream(createReadStream(inPath), createWriteStream(outPath), key);
}

/** Déchiffre ; lève AUTH_FAILED si le fichier, l'étiquette ou la clé est incorrect. */
export async function decryptFile(inPath: string, outPath: string, key: Buffer): Promise<void> {
  const { size } = await stat(inPath);
  const headerLen = MAGIC.length + NONCE_LEN;
  if (size < headerLen + TAG_LEN) throw new BackupCryptoError("FORMAT_INVALID", "Fichier de sauvegarde invalide.");
  const fh = await open(inPath, "r");
  const header = Buffer.alloc(headerLen);
  const tag = Buffer.alloc(TAG_LEN);
  try {
    await fh.read(header, 0, headerLen, 0);
    await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    await fh.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupCryptoError("FORMAT_INVALID", "Fichier de sauvegarde invalide.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(inPath, { start: headerLen, end: size - TAG_LEN - 1 }),
      decipher,
      createWriteStream(outPath),
    );
  } catch {
    throw new BackupCryptoError("AUTH_FAILED", "Sauvegarde altérée ou clé incorrecte.");
  }
}
