# Démos par profil

Parcours filmés (un par profil), exclus de `npm run test:e2e` : `playwright.config.ts` ignore `e2e/demo/` sauf si `E2E_DEMO=1`.

Le `.env` racine pointe la base de production (Neon) : ne jamais lancer ces commandes avec `--env-file=.env` seul. Forcer la base locale de test par un préfixe :

```bash
export DATABASE_URL=postgres://fleet:fleet@postgres:5432/fleet_test DATABASE_WS_PROXY=localhost:5433/v1
```

Les hôtes et ports ci-dessus sont ceux du compose de test du dépôt ; avec un compose personnel, adapter l'hôte (`localhost`, `127.0.0.1` ou `postgres`) et les ports, la base devant rester `fleet_test` ou une base dédiée `fleet_test_<suffixe>` (ex. `fleet_test_demo_compta`, pour ne pas toucher la base d'une autre session sur le même conteneur).

1. Le seed (`assertLocalDatabase` de `local-database-guard.ts`, appelé aussi dans chaque spec) refuse toute URL dont l'hôte n'est pas local ou dont la base n'est pas `fleet_test` ou `fleet_test_<suffixe>`.
2. `node --import tsx e2e/demo/seed-demo.ts` (idempotent : comptes, rôles, mots de passe et propriétaires réconciliés, état des scénarios remis à zéro ; à rejouer avant chaque passage de spec, sinon l'état du précédent subsiste, par exemple DEMO-MIS-001 déjà pris).
3. `E2E_DEMO=1 E2E_RECORD=1 node node_modules/@playwright/test/cli.js test e2e/demo/<spec> --reporter=list`

Vidéos : `test-results/recordings/<test>/video.webm`.

Résidu connu : le justificatif téléversé par la démo du secrétariat reste dans `uploads/` (hors base).

Parcours chauffeur (spec 10) : trois rôles dans trois contextes. Le logisticien programme la mission (camion, remorque `DEMO-REM-001`, chauffeur) et fixe les budgets ; le chauffeur se connecte avec son PIN (`1234`, posé par le seed), confirme le départ et déclare une panne ; le chef d'atelier, connecté d'avance, reçoit la trame `incident_reported` puis voit la panne dans « Pannes déclarées ». La spec vérifie en base l'affectation, les budgets, le statut `in_progress` et la panne. Suivi GPS : le serveur doit tourner avec `FEATURE_FLAGS=gps=on` ; le contexte chauffeur reçoit la permission `geolocation` et `drive()` fait avancer le camion par `context.setGeolocation`, puis un événement `online` vide le tampon. La spec vérifie « Position partagée », des lignes `vehicle_positions` pour la mission, et la livraison (statut `delivered`). Aucun seed GPS n'est nécessaire : les positions viennent du parcours. Repères `page-<rôle>` posés à l'ouverture de chaque page pour caler chaque vidéo (une par contexte) au montage.

Parcours comptable (spec 11, compte `compta1`, mot de passe de démo du seed) : le serveur doit tourner avec `FEATURE_FLAGS=finance=on,pending-invoices=on`, sinon les tuiles « À encaisser » et « À facturer » du tableau de bord comptable restent indisponibles. Contre un serveur déjà lancé : `E2E_BASE_URL=http://127.0.0.1:<port> E2E_SKIP_ACCOUNT_CHECK=1`. La spec vérifie aussi que la comptable reçoit un 403 sur la création d'un ordre de travail, d'une fiche pièce, d'une mission et d'un plein.

Parcours magasinier : pas de lien « Ordres de travail » dans son menu ; l'OT s'ouvre depuis la carte « en attente de pièces » de Demandes de pièces (repli par URL directe dans la spec 06).

Parcours logisticien (spec 04) : la mission est affectée avec un camion, la remorque `DEMO-REM-001` (seed) et un chauffeur ; la spec vérifie `assignments.trailer_id` en base. `DEMO_MARKS_FILE=<fichier>` fait écrire à `mark()` des repères horodatés pour caler la voix off au montage.
