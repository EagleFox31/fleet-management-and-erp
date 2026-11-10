/**
 * Écrit la page hors ligne de l'APK dans `dist/public/` (après `npm run build`, avant `cap sync`).
 * Sans CAP_SERVER_URL, rien à écrire : l'APK embarque le bundle local.
 * Usage : CAP_SERVER_URL=https://fleet.example.com npx tsx scripts/android-offline-page.ts
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NATIVE_OFFLINE_PAGE, renderNativeOfflinePage, resolveNativeServer } from "../shared/native-shell";

const server = resolveNativeServer(process.env.CAP_SERVER_URL);
if (!server) {
  console.log("CAP_SERVER_URL absente : APK sur bundle local, pas de page hors ligne.");
} else {
  const webDir = path.resolve(process.cwd(), "dist/public");
  if (!existsSync(webDir)) {
    console.error(`${webDir} absent : lancer npm run build avant ce script.`);
    process.exit(1);
  }
  writeFileSync(path.join(webDir, NATIVE_OFFLINE_PAGE), renderNativeOfflinePage(server), "utf8");
  console.log(`APK sur ${server.url} ; page hors ligne écrite (${NATIVE_OFFLINE_PAGE}).`);
}
