# APK Android FleetOS Tech

L'APK est construite par `.github/workflows/build-android-apk.yml` (Capacitor 8).
Elle charge l'application **servie par le serveur de prod** et n'embarque plus le
client compilé.

## Choix : `server.url` sur l'origine de prod

Deux approches ont été comparées.

| | (a) Bundle local + `VITE_API_URL` | (b) `server.url` = origine de prod (retenue) |
|---|---|---|
| Origine des appels | `https://localhost` vers `https://fleet…` : cross-origin | même origine |
| Cookie de session | cookie tiers (`SameSite=None`, `CapacitorCookies`) | cookie normal |
| CORS | `CORS_ORIGIN` et en-têtes à tenir (`Idempotency-Key`, `X-Offline-Owner`…) | aucun |
| Code client | 44 `fetch("/api…")` bruts, URL du WebSocket (`useRealTimeSync.ts`) et images `/uploads` à réécrire | inchangé |
| Mise à jour | nouvelle APK à chaque version | suit chaque déploiement |
| Démarrage hors ligne | possible | page « Serveur injoignable » |

Choix : (b), parce qu'elle ne demande ni réécriture du client ni cookie tiers, et que
l'APK reste à jour sans réinstallation.

Fonctionnement vérifié dans `@capacitor/android` : le serveur local natif ne traite que
les navigations HTML. Il y injecte le bridge, donc les plugins (caméra, géolocalisation,
notifications) restent disponibles. Les appels `/api` et `/ws` partent par le réseau
normal.

La géolocalisation est autorisée **au premier plan seulement** (`ACCESS_COARSE_LOCATION`,
`ACCESS_FINE_LOCATION`) : en V1, le suivi ne tourne qu'écran ouvert. Le manifeste ne
demande ni localisation en arrière-plan ni service au premier plan ; un test le vérifie
(`tests/unit/shared/native-shell.test.ts`).

### Limites connues

- La documentation Capacitor présente `server.url` comme un outil de live reload. Ce
  choix est volontaire. Il faudra le réévaluer si une fonction native exige le schéma
  local.
- Sans réseau au démarrage, l'APK affiche `offline.html` (page embarquée, sans accès aux
  plugins) avec un bouton « Réessayer ». Le mode hors ligne du technicien
  (`technician-offline`, désactivé) devra être revu avant son activation.
- `versionCode` reste à 1 dans `android/app/build.gradle`. Une APK signée s'installe par
  mise à jour seulement si elle porte la même signature.

## Valeurs de build

Le dépôt fournit toutes les valeurs. Aucune n'est écrite dans le code.

| Nom | Type GitHub | Valeur | Rôle |
|---|---|---|---|
| `FLEETOS_APP_URL` | **Variable** (Settings → Secrets and variables → Actions → Variables) | `https://fleet.trigenys.com` | Origine chargée par l'APK (`CAP_SERVER_URL`) |
| `ANDROID_KEYSTORE_BASE64` | Secret | keystore encodé en base64 | Signature release |
| `KEYSTORE_PASSWORD` | Secret | mot de passe du keystore | |
| `KEY_ALIAS` | Secret | alias de la clé (ex. `fleetos-tech`) | |
| `KEY_PASSWORD` | Secret | mot de passe de la clé | |

Comportement du workflow :

- Sans `FLEETOS_APP_URL`, le workflow affiche un avertissement et l'APK embarque le
  bundle local, qui ne joint aucun serveur.
- Si un keystore est présent sans `FLEETOS_APP_URL`, le build échoue, pour ne jamais
  publier une APK signée inutilisable.
- L'étape « Afficher l'origine embarquée » imprime le `server` réellement copié dans
  l'APK.
- Sur une PR, le keystore n'est jamais lu : on obtient une APK debug.
- `workflow_dispatch` accepte une entrée `server_url`, qui sert à construire une APK de
  test pointée sur un serveur du réseau local (ex. `http://192.168.1.20:5000`). Une
  origine `http` produit toujours une **APK debug non signée** (artefact
  `FleetOS-Tech-Debug-APK`), même si le keystore est posé : seule une origine `https`
  est signée, et le trafic en clair n'est autorisé que dans cette APK de test.
- Le keystore décodé est effacé en fin de job, même en cas d'échec.
- Le test sur émulateur (job `smoke`) ne tourne qu'en lancement manuel ou si la
  coquille native change (`android/**`, `capacitor.config.ts`, `scripts/android-*`,
  `client/public/sw.js`, `shared/native-shell.ts`, ce workflow).

`CAP_SERVER_URL` doit être une origine seule : `https://hôte[:port]`, sans chemin,
paramètre ni identifiants. `shared/native-shell.ts` refuse toute autre forme avec un
message.

## Créer le keystore (une seule fois, hors du dépôt)

Le keystore signe toutes les futures versions. **Le perdre empêche toute mise à jour**
de l'APK installée : il faudrait désinstaller l'application puis la réinstaller sur
chaque téléphone.

1. Dans un dossier **hors du dépôt**, générer la clé. `keytool` est fourni avec le JDK.
   Il demande les mots de passe de façon interactive, sans les garder dans
   l'historique :

   ```bash
   keytool -genkeypair -v -keystore fleetos-tech.keystore -alias fleetos-tech \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

2. L'encoder en base64 sur une seule ligne :

   ```bash
   base64 -w0 fleetos-tech.keystore > fleetos-tech.keystore.b64      # Linux / Git Bash
   ```

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("fleetos-tech.keystore")) | Set-Content fleetos-tech.keystore.b64
   ```

3. Poser les secrets avec l'interface GitHub ou `gh secret set`. La valeur se lit sur
   l'entrée standard, jamais en argument :

   ```bash
   gh secret set ANDROID_KEYSTORE_BASE64 < fleetos-tech.keystore.b64
   gh secret set KEYSTORE_PASSWORD      # saisie masquée
   gh secret set KEY_ALIAS
   gh secret set KEY_PASSWORD
   gh variable set FLEETOS_APP_URL --body "https://fleet.trigenys.com"
   ```

4. **Sauvegarder** `fleetos-tech.keystore`, l'alias et les deux mots de passe dans le
   gestionnaire de secrets (Bitwarden), avec une seconde copie hors ligne. Supprimer
   ensuite le fichier `.b64`.

5. Lancer le workflow (Actions → Build Android APK → Run workflow), puis récupérer
   l'artefact `FleetOS-Tech-Release-APK`.

Ne jamais écrire un mot de passe dans un fichier du dépôt, une passation, un ticket ou un
journal. Ne jamais commiter de `*.keystore` ni de `*.b64`.

## Tester contre un serveur local

1. Démarrer le serveur sur une base **locale**, en forçant `DATABASE_URL`, car le
   `.env` racine pointe sur la prod.
2. Lancer le workflow à la main avec `server_url = http://<IP-du-poste>:5000`.
3. Installer l'APK debug (artefact `FleetOS-Tech-Debug-APK`, non signée) sur un
   téléphone du même réseau.
4. Se connecter : les appels `/api` et le WebSocket partent vers ce serveur.
