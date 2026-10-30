# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T21:00:00+01:00 — T-45 — Routes du pointage

- **Agent** : api-1 · **Branche** : `lot/api/T-45-routes` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/time-tracking`, `PUT /api/time-tracking`, `GET /api/time-tracking/monthly-stats`, evenement `time_tracking_updated`.
- **Comment** : `server/api/time-tracking.routes.ts` derriere le drapeau `time-tracking` ; lecture admin, secretariat, direction ; saisie admin et secretariat ; personne inconnue 404 ; portee de l'evenement lue dans `REALTIME_EVENTS`.
- **Pourquoi** : P-20 ; une saisie par personne et par jour, rejouable, totaux calcules a la lecture.
- **Comment tester (QA)** : saisir JT puis M le meme jour au secretariat ; le total du mois suit ; la direction lit mais ne saisit pas.
- **Preuve** : contrat `time-tracking` 3 verts ; `tsc` global 0 erreur.
