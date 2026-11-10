# Journal b7 — APK FleetOS Tech

Modèle et règles : `docs/journal/README.md`.

## 2026-11-10T18:33:03+01:00 — APK utilisable contre la prod (#664)

- **Agent** : b7 · **Branche** : `feat/apk-prod-shell-b7`
- **Statut** : fait, en relecture
- **Quoi** : l'APK charge l'origine servie (`server.url`) au lieu du bundle local qui appelait `https://localhost/api`. Page hors ligne embarquée, géolocalisation au premier plan, preuve sur émulateur.
- **Comment** :
  - `shared/native-shell.ts`, `capacitor.config.ts`, `scripts/android-offline-page.ts` : origine validée, `errorPath`, pas d'`allowNavigation`.
  - `.github/workflows/build-android-apk.yml` : `CAP_SERVER_URL` depuis `FLEETOS_APP_URL` ; signature pour https seulement, http → APK debug ; keystore effacé en `always()` ; job `smoke-scope` (git diff) puis `smoke` sur émulateur API 33.
  - `scripts/android-smoke/` : serveur témoin et scénario en trois temps (en ligne, relance serveur coupé, premier lancement hors ligne).
  - Choix (b) `server.url` contre (a) bundle + `VITE_API_URL` : comparaison dans `docs/deploiement/android-apk.md`.
- **Pourquoi** : l'APK livrée ne joignait aucun serveur (LESSONS du 2026-11-10).
- **Comment tester (QA)** :
  - Prérequis : aucun.
  - Étapes : Actions → Build Android APK → Run workflow sur la branche.
  - Attendu : job `smoke` vert, `sw=oui idb=oui bridge=oui` dans le journal du job.
  - Preuve automatisée : `npx vitest run tests/unit/shared/native-shell.test.ts` → `15 passed`.
- **RAIDER** :
  - couvert : R et A (origine en variable de dépôt, aucune valeur en dur), D (sans variable, config de dev inchangée), E (signature https seulement, keystore effacé, aucun secret dans un log), failure memory (LESSONS + tests), scoped execution (`smoke-scope`) ;
  - ne s'applique pas : I et R (rétroactif), rien n'est écrit en base ni à distance.
- **Reste / risques** : variable `FLEETOS_APP_URL` et secrets keystore à poser par la propriétaire du dépôt ; `versionCode` reste à 1.
