## 2026-11-02 21:40 — ADM2, DRV2, MIS1 : défauts front corrigés, marqueurs retournés

- **Quoi** : correctifs front ADM2-1 (« Modifier » ouvre le formulaire sur `/admin/users`), ADM2-2 (mot de passe vide accepté en édition), DRV2-1/2 (panne envoyée sur `POST /api/driver/breakdowns`, véhicule requis), MIS1-UI-1 (motifs de refus lus dans `errors[]`, demande de renouvellement proposée). Tous les `test.fail` / `it.fails` correspondants deviennent des tests ordinaires : e2e 17:433, 18 (ADM2-1/2/3), 19 (DRV2-1/2/3), contrat `mission-assignment-eligibility`.
- **Preuves** : `npm run check` 0, `npm test` 932/932 ; contrat 3/3 ; e2e 17 5/5 ; e2e 18+19 16/17, le 17e (premier test de la spec 18, délai de 180 s) passé isolé en 3,4 min, délai porté à 300 s. Base de test ep-plain-lake, port 5058, sous `db-lock`.
- **Comment** : la purge de la spec 19 supprime désormais les `incidents` créés par la panne avant les véhicules (`incidents_vehicle_id_fkey`).
- **Pourquoi** : clore les défauts figés par #96 et #101 ; le serveur avait été corrigé par #102.
- **Pièges** : deux runs Playwright dans le même worktree s'écrasent leurs traces (`test-results`) ; un seul run à la fois par worktree. Le témoin PATCH du contrat créait ses données dans le `it` : délai explicite de 60 s.

