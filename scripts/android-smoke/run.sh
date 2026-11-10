#!/usr/bin/env bash
# Test de fumée de l'APK sur émulateur (job `smoke` de build-android-apk.yml).
# L'APK debug est construite avec CAP_SERVER_URL=http://localhost:<port>, renvoyé vers le serveur
# témoin par `adb reverse`. localhost est un contexte sécurisé, comme l'origine https de prod :
# avec http://10.0.2.2, navigator.serviceWorker n'existe pas. Trois temps :
#   1. en ligne : bridge natif, /api, cookie et /ws en même origine, service worker aux
#      commandes, donnée écrite dans IndexedDB ;
#   2. serveur coupé, APK fermée puis relancée : la coque doit venir du service worker (pas de
#      « Serveur injoignable ») et la donnée IndexedDB rester lisible ;
#   3. données de l'APK effacées, serveur toujours coupé : page hors ligne embarquée.
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

# Attend qu'un des motifs apparaisse à l'écran (arbre d'accessibilité), affiche celui trouvé.
wait_for_screen() {
  local tries="$1"; shift
  for _ in $(seq 1 "$tries"); do
    sleep 2
    adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 || continue
    adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null || continue
    for pattern in "$@"; do
      if grep -q "$pattern" "$OUT/ui.xml"; then echo "$pattern"; return 0; fi
    done
  done
  echo "aucun"
}

relaunch() {
  adb shell am force-stop "$APP"
  adb shell am start -W -n "$APP/.MainActivity" > /dev/null
}

# --- 1. En ligne ---------------------------------------------------------------------------
# localhost:<port> de l'émulateur -> serveur témoin de l'hôte. On vérifie qu'il répond avant le
# premier lancement : sinon l'APK afficherait sa page hors ligne.
adb wait-for-device
adb reverse "tcp:$PORT" "tcp:$PORT"
for i in $(seq 1 60); do
  if adb shell "nc -z -w 2 127.0.0.1 $PORT" > /dev/null 2>&1; then
    echo "Serveur témoin joignable depuis l'émulateur (essai $i)."
    break
  fi
  [ "$i" = 60 ] && echo "::warning::nc n'a pas joint localhost:$PORT en 120 s, lancement quand même."
  sleep 2
done
adb install -r "$APK"
for attempt in 1 2 3; do
  if [ "$attempt" = 1 ]; then adb shell am start -W -n "$APP/.MainActivity"; else relaunch; fi
  for _ in $(seq 1 30); do
    [ -s "$REPORT" ] && break
    sleep 2
  done
  [ -s "$REPORT" ] && break
  echo "::warning::Aucun rapport après le lancement $attempt, nouvel essai."
done
adb exec-out screencap -p > "$OUT/1-en-ligne.png" || true
if [ ! -s "$REPORT" ]; then
  echo "::error::L'APK n'a envoyé aucun rapport au serveur témoin après 3 lancements."
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
    "service worker aux commandes (navigator.serviceWorker.controller)": r.swControlled === true,
    "donnée écrite dans IndexedDB": r.idbWritten === true,
  };
  let ok = true;
  for (const [label, pass] of Object.entries(checks)) {
    console.log(`${pass ? "OK   " : "ÉCHEC"} ${label}`);
    ok = ok && pass;
  }
  if (!ok) process.exit(1);
' "$REPORT"
sleep 3 # laisse le service worker finir sa revalidation en arrière-plan

# --- 2. Serveur coupé, relance : coque du service worker -----------------------------------
kill "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null || true
relaunch
SEEN=$(wait_for_screen 15 "SONDE-HORS-LIGNE" "Serveur injoignable")
adb exec-out screencap -p > "$OUT/2-relance-hors-ligne.png" || true
if [ "$SEEN" != "SONDE-HORS-LIGNE" ]; then
  echo "::error::Relance serveur coupé : la coque n'est pas servie par le service worker (écran : $SEEN)."
  grep -i -E "serviceworker|service worker|Capacitor|chromium" "$OUT/ui.xml" 2>/dev/null | head -5 || true
  exit 1
fi
DETAIL=$(grep -o 'sw=[a-z]* idb=[a-z]* bridge=[a-z]*' "$OUT/ui.xml" | head -1 || true)
echo "Relance hors ligne : $DETAIL"
case "$DETAIL" in
  *"sw=oui idb=oui"*) echo "OK    coque du service worker et donnée IndexedDB lisibles hors ligne" ;;
  *) echo "::error::Relance hors ligne incomplète : $DETAIL"; exit 1 ;;
esac
case "$DETAIL" in
  *"bridge=oui"*) echo "OK    bridge natif présent hors ligne" ;;
  *) echo "::warning::Hors ligne, la coque en cache n'a pas le bridge natif : plugins indisponibles jusqu'au retour du réseau." ;;
esac

# --- 3. Premier lancement sans réseau : page hors ligne embarquée --------------------------
adb shell pm clear "$APP" > /dev/null
relaunch
SEEN=$(wait_for_screen 15 "Serveur injoignable" "SONDE-HORS-LIGNE")
adb exec-out screencap -p > "$OUT/3-premier-lancement-hors-ligne.png" || true
if [ "$SEEN" != "Serveur injoignable" ]; then
  echo "::error::Premier lancement sans réseau : page hors ligne absente (écran : $SEEN)."
  exit 1
fi
echo "OK    page hors ligne au premier lancement sans réseau"
