## 2026-11-06T12:55:00+01:00 — 503 intermittent sur la garde de connexion : plafond de connexion des pools

- **Agent** : de (fleet-testeur) · **Branche** : `fix/contract-login-503` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : `work-order-items.contract.test.ts` échouait par intermittence en 503 sur le login après environ 30 s.
- **Comment** :
  - Cause côté environnement : le relais de ports de Docker Desktop accepte la socket puis la coupe à 30 s (`read ECONNRESET`) sous rafale.
  - Cause côté produit : aucun plafond de connexion, et neon 0.10.4 plantait (TypeError non rattrapée) dès qu'on en posait un.
  - Correctif : `DATABASE_CONNECT_TIMEOUT_MS` (défaut 10 000 ms, 0 = sans plafond, valeur invalide = démarrage refusé), appliqué à `pool` et `listenerPool` ; neon passe en 1.2.0. La garde reste fermée sur panne (503).
- **Comment tester (QA)** :
  - `tests/unit/server/db-pool-options.test.ts` : serveur TCP muet, rejet au plafond sans fuite. Rouge en 0.10.4 (TypeError), vert en 1.2.0.
  - `tests/integration/session-store-neon-pool.test.ts` : aller-retour de session à travers le Pool neon, store de production et création de table.
  - Campagnes sur Postgres local : unitaires 301/301, intégration 73/73 et 1/1, contrats 254/254, work-order-items 10/10 en boucle (13 à 18 s, aucun 503).
- **RAIDER** : R/A (plafond configurable par variable d'environnement, sans hypothèse d'hébergeur) ; D (comportement de la garde inchangé, contrats verts) ; Failure memory (`LESSONS_LEARNED.md`, `tests/README.md`).
- **Reste / risques** : le plafond borne aussi l'attente d'une place dans le pool (max 10 par défaut, inchangé) : sous saturation de plus de 10 s, la requête répond par un 5xx générique avec sa référence. Prod sur GO de l'utilisatrice.

