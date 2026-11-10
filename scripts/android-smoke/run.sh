#!/usr/bin/env bash
# Test de fumée de l'APK sur émulateur (job `smoke` de build-android-apk.yml).
# L'APK debug est construite avec CAP_SERVER_URL=http://10.0.2.2:<port> (10.0.2.2 = l'hôte vu
# de l'émulateur). On vérifie qu'elle charge l'origine, que le bridge natif est injecté et que
# /api, le cookie et /ws marchent en même origine, puis que la page hors ligne s'affiche.
set -euo pipefail

PORT="${SMOKE_PORT:-8080}"
OUT="${SMOKE_OUT:-android-smoke}"
APP=com.yarofleetos.tech
APK=android/app/build/outputs/apk/debug/app-debug.apk
REPORT="$OUT/report.json"
mkdir -p "$OUT"
rm -f "$REPORT"

node scripts/android-smoke/server.mjs "$PORT" "$REPORT" > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true' EXIT

adb install -r "$APK"
adb shell am start -W -n "$APP/.MainActivity"

for _ in $(seq 1 60); do
  [ -s "$REPORT" ] && break
  sleep 2
done
adb exec-out screencap -p > "$OUT/1-en-ligne.png" || true

if [ ! -s "$REPORT" ]; then
  echo "::error::L'APK n'a envoyé aucun rapport au serveur témoin en 120 s."
  cat "$OUT/server.log"
  exit 1
fi
cat "$REPORT"
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const checks = {
    "bridge natif injecté (Capacitor.isNativePlatform)": r.native === true,
    "plateforme android": r.platform === "android",
    "GET /api en même origine": r.ping === true,
    "cookie de session renvoyé": r.cookieSeen === true,
    "WebSocket /ws": r.ws === true,
  };
  let ok = true;
  for (const [label, pass] of Object.entries(checks)) {
    console.log(`${pass ? "OK  " : "ÉCHEC"} ${label}`);
    ok = ok && pass;
  }
  if (!ok) process.exit(1);
' "$REPORT"

# Serveur coupé : au redémarrage, Capacitor doit afficher la page hors ligne embarquée.
kill "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null || true
adb shell am force-stop "$APP"
adb shell am start -W -n "$APP/.MainActivity"
FOUND=0
for _ in $(seq 1 15); do
  sleep 2
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 || continue
  if adb shell cat /sdcard/ui.xml | grep -q "Serveur injoignable"; then FOUND=1; break; fi
done
adb exec-out screencap -p > "$OUT/2-hors-ligne.png" || true
if [ "$FOUND" != 1 ]; then
  echo "::error::Page hors ligne absente après coupure du serveur."
  exit 1
fi
echo "OK   page hors ligne affichée"
