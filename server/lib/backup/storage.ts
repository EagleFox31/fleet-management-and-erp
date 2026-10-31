/** Stockage des sauvegardes chiffrées. Adaptateur local ; objet/S3 implémenteront la même interface. */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface BackupStorage {
  /** Chemin local où écrire le fichier `name` (dossier créé au besoin). */
  prepare(name: string): Promise<string>;
  remove(name: string): Promise<void>;
  exists(name: string): Promise<boolean>;
  list(): Promise<string[]>;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Dossier hors `uploads/` : `BACKUP_DIR`, sinon `backups/` à la racine du processus. */
export class LocalBackupStorage implements BackupStorage {
  readonly dir: string;

  constructor(dir: string = process.env.BACKUP_DIR || path.resolve(process.cwd(), "backups")) {
    this.dir = path.resolve(dir);
    const uploads = path.resolve(process.cwd(), "uploads");
    if (this.dir === uploads || this.dir.startsWith(uploads + path.sep)) {
      throw new Error("Le dossier de sauvegarde ne peut pas être sous uploads/.");
    }
  }

  private resolve(name: string): string {
    if (!SAFE_NAME.test(name)) throw new Error("Nom de sauvegarde invalide.");
    return path.join(this.dir, name);
  }

  async prepare(name: string) {
    const p = this.resolve(name);
    await mkdir(this.dir, { recursive: true });
    return p;
  }
  async remove(name: string) {
    await rm(this.resolve(name), { force: true });
  }
  async exists(name: string) {
    return stat(this.resolve(name)).then(() => true, () => false);
  }
  async list() {
    return readdir(this.dir).catch(() => [] as string[]);
  }
}
