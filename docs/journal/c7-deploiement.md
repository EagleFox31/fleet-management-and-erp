# Journal — c7, déploiement et exploitation

Entrées ajoutées à la fin, une par lot.

## 2026-11-04T10:09:25+01:00 — Image de prod sans dépendances de développement

- **Agent** : c7 · **Branche** : `ops/omit-dev` · **PR** : #252
- **Statut** : fait (image locale saine ; prod non redéployée, accord de l'utilisatrice attendu)
- **Quoi** :
  - étape runtime du `Dockerfile` en `npm ci --omit=dev` ;
  - `fflate` et `nanoid` déclarés dans `dependencies` ;
  - `vitest`, `@vitest/ui` et les `@types/*` passés en `devDependencies`.
- **Comment** :
  - `server/vite.ts` charge `vite` par `await import("vite")`, puis `vite.config.ts` par `loadConfigFromFile`. La configuration est étalée avec `configFile: false`, comme avant : le bloc `server` du fichier (polling, `host`) reste remplacé par les options du middleware, pas fusionné.
  - Garde `tests/unit/deploy/runtime-deps.test.ts` : rejoue le bundle esbuild de `server/index.ts` et lit `metafile.outputs` (import, `export … from`, `import()`, `require`). Un import de type, élidé, n'y figure pas.
  - Seule exception : `import("vite")` depuis `server/vite.ts`, liste blanche par fichier via `metafile.inputs`.
- **Pourquoi** : l'import statique de `vite` et de `vite.config` obligeait l'image à embarquer toutes les dépendances de développement. Le script d'import TAY est désormais livré en bundle hors image.
- **Comment tester (QA)** :
  - `docker build -t fleet-omitdev:test .`, puis `docker run --rm --entrypoint sh fleet-omitdev:test -c 'ls node_modules/vite'` : absent.
  - Depuis `deploy/` : `APP_IMAGE=fleet-omitdev APP_TAG=test SITE_DB_PASSWORD=<12+ car.> SITE_PORT=5077 docker compose -p omitdev --profile site up -d app-site`.
  - Attendu : conteneur `healthy`, `/api/health` 200 ; ensuite `docker compose -p omitdev --profile site down -v`.
  - Preuve automatisée : `runtime-deps.test.ts`. Il échoue si `server/index.ts` reçoit `export { defineConfig } from "vite"` ou `import("vitest")` (vérifié).
- **RAIDER** :
  - Durable : démarrage `node dist/index.js` et healthcheck inchangés ; mode dev vérifié (`/` 200, client vite injecté, `server.watch` non appliqué comme avant).
  - Engineering-grade : image 898 → 786 Mo, moins de paquets en production.
  - Idempotent et Retroactive : sans objet (build).
- **Reste / risques** : redéploiement de la prod à décider.

## 2026-11-04T11:11:07+01:00 — Garde base de production étendue aux scripts et vérifiée par hygiène (#264, PR #267)

- **Statut** : fait (réserves de relecture levées ; fusion par l'orchestrateur)
- **Quoi** :
  - `guardDatabaseConnection(source)` (`server/lib/production-db-guard.ts`) appelé par `server/db.ts` et par les 4 scripts à pool propre (audit-dana-password, audit-password, audit-listed-passwords, reset-listed-passwords) ;
  - `schema-prod` du compose : `NODE_ENV: production` (la cible `build` ne le fixe pas) ;
  - test d'hygiène `tests/unit/server/db-pool-hygiene.test.ts`, `tests/unit/deploy/compose-prod-node-env.test.ts`.
- **Comment** :
  - Hygiène : sur les fichiers suivis hors `tests/` et `server/db.ts`, une construction de pool ou client doit suivre un appel du garde ; un import de valeur d'un driver SQL (`@neondatabase/serverless`, `pg`, `postgres`, alias et `require` compris, `import type` exclu) exige l'import de `production-db-guard`.
  - Commentaires retirés avant la recherche (`//` précédé de `:` conservé pour les URL).
  - Liste gelée : `test-workflow-reminders.js`, qui ne peut que disparaître.
- **Pourquoi** : relecture de #267, deux faux négatifs prouvés : `import { Pool as P }` puis `new P(` passait sans garde, et un `// guardDatabaseConnection(` commenté comptait comme garde.
- **Comment tester (QA)** :
  - `npx vitest run tests/unit/server/db-pool-hygiene.test.ts` : 6/6.
  - Mutation vérifiée : sans le retrait des commentaires, le cas « garde en commentaire » échoue ; sans le contrôle d'import, le cas « import aliasé » échoue.
- **RAIDER** :
  - Durable : comportement du garde inchangé ; seul le test se durcit.
  - Agnostic : drivers listés, pas de chemin de script en dur.
  - Idempotent et Retroactive : sans objet (test et code de démarrage).
- **Reste / risques** : drizzle-kit push, marqueur de la prod VPS et message du garde suivis dans l'issue #268.

## 2026-11-04T12:03:08+01:00 — npm run dev stable : fichier temporaire de vite.config exclu du watch (régression #252)

- **Statut** : fait, PR brouillon
- **Quoi** : script `dev` en `tsx watch --exclude "*.timestamp-*.mjs"`, motif ajouté au `.gitignore`, garde `tests/unit/server/dev-watch-vite-config.test.ts`, leçon dans LESSONS_LEARNED.
- **Comment** : `loadConfigFromFile` est gardé, car il tient vite hors du bundle de prod. Vite 5.4 écrit et supprime toujours un `.mjs` temporaire à la racine ; on l'exclut du watch au lieu de changer le chargement.
- **Pourquoi** : signalé par b7, `npm run dev` redémarrait toutes les ~10 s et le serveur e2e de Playwright n'était jamais prêt.
- **Comment tester (QA)** :
  - `npm run dev` (avec DATABASE_URL local) pendant 2 min : 0 « Restarting ».
  - Avant le correctif : 10 relances en 100 s, chacune sur « unlink in ./vite.config.ts.timestamp-… ».
  - Le garde est rouge sur le package.json de main.
- **RAIDER** :
  - Durable : build de prod et runtime-deps inchangés.
  - Agnostic : motif générique, couvre tout script `tsx watch`.
  - Idempotent et Retroactive : sans objet.
- **Reste / risques** : à la montée en vite 6.1+, `configLoader: "runner"` supprimerait le fichier temporaire.

## 2026-11-04T13:06:19+01:00 — Triggers d'alertes carburant réécrits et posés au démarrage

- **Statut** : fait, PR brouillon
- **Quoi** : réécriture de `fuel-alerts-triggers.sql`, table `alert_recipient_settings`, ajout à `BOOTSTRAP_SQL_FILES`, test d'intégration (5 cas), garde unitaire, attendu de `recette-seed-reset` passé de 3 à 5 alertes.
- **Comment** : moyenne par sous-requête, `round()`, destinataires par rôles configurés, exception rattrapée puis WARNING, toutes les créations rejouables.
- **Pourquoi** : demandé par 0a. Retirés de #263 : installés, ils cassaient l'INSERT du 2e plein.
- **Comment tester (QA)** : `npm run test:integration -- tests/integration/fuel-alerts-triggers.test.ts` (vert) ; avec `FUEL_ALERTS_SQL` pointé sur l'original : 4/5 rouges.
- **Reste / risques** :
  - `AlertService.fuelRecipients` reste en dur côté TypeScript (à brancher sur `alert_recipient_settings`).
  - Le budget de 500 000 F CFA est encore une constante.
## 2026-11-04T11:17:27+01:00 — Garde base de production : drizzle-kit push et prod VPS (#268)

- **Statut** : fait, PR brouillon empilée sur #267
- **Quoi** :
  - `drizzle.config.ts` appelle `guardDatabaseConnection("drizzle-kit")` ;
  - marqueur par défaut `db-prod` (service Postgres de la prod VPS) ;
  - message « Connexion refusée », valable pour le serveur, un script ou drizzle-kit, avec une mise en garde contre `NODE_ENV=production` en local ;
  - `docs/deploiement/vps.md` : garde, NODE_ENV et alias d'hôte pour un tunnel SSH.
- **Comment** : drizzle-kit charge sa configuration avec résolution des alias de tsconfig, donc l'import du garde serveur fonctionne tel quel (vérifié : `drizzle-kit push` sur un hôte marqué `.invalid` sort en 1 avant toute connexion ; sur le Postgres local, « Changes applied »).
- **Pourquoi** : relecture de #267. `npm run db:push` avec une URL de prod écrivait le schéma sans refus, et la prod VPS n'était pas reconnue.
- **Comment tester (QA)** :
  - `npx vitest run tests/unit/server/drizzle-config-guard.test.ts tests/unit/server/production-db-guard.test.ts`.
  - Mutations vérifiées, une rouge par chemin : garde retiré de drizzle.config, marqueur db-prod retiré, ligne NODE_ENV retirée du message.
- **RAIDER** :
  - Durable : la prod n'est pas affectée (NODE_ENV=production dans l'image runtime et dans schema-prod) ; `test:db:schema` local inchangé.
  - Agnostic : marqueurs supplémentaires par `E2E_PRODUCTION_DB_MARKERS`, sans code.
- **Reste / risques** : un tunnel vers `localhost` sans alias reste indétectable, documenté.
## 2026-11-04T12:06:10+01:00 — Contrat KPI pannes : mois sans panne vérifiés par différence avant/après (mineur de #266, PR #269)

- **Statut** : fait, PR brouillon
- **Quoi** : `tests/contract/kpi-cdc.contract.test.ts`.
  - Le cas 2001 garde les invariants de #266 (12 mois, total = somme, moyenne). Son titre devient « total et moyenne cohérents avec la série » : il ne prouvait pas de zéros.
  - Nouveau cas sur 2002, par différence avant/après, et non par une base vide.
- **Comment** :
  - Lecture de référence de 2002, puis un OT correctif au 15 juin sur un véhicule créé par le test, puis seconde lecture.
  - Attendu : juin +1, les 11 autres mois +0, total +1, byVehicle à 1 pour ce véhicule.
  - L'OT est supprimé en `finally`, le véhicule par `cleanupCreated`.
- **Pourquoi** : la base de test est partagée entre suites et sessions. Une valeur absolue « 0 » n'y est pas fiable (leçon « période vide partagée » de #266). Le test prouve que seul le mois de la panne bouge, pas que les autres mois valent 0 dans l'absolu.
- **Comment tester (QA)** : `npm run test:contract -- kpi-cdc` sur Postgres local, 21/21. Mutation : OT déplacé au 15 juillet, le nouveau cas échoue.
- **RAIDER** :
  - Durable : aucun code produit touché.
  - Idempotent : données propres au test, supprimées.
- **Reste / risques** : une écriture concurrente sur 2002 pendant le test fausserait la différence. Aucune suite ne date d'OT en 2002 à ce jour.
## 2026-11-04T12:30:55+01:00 — merge=union sur les fichiers en ajout de fin
- **Statut** : fait, PR brouillon
- **Quoi** : `.gitattributes` : `merge=union` sur LESSONS_LEARNED, `docs/journal/*.md`, `PASSATION*.md` ; `docs/journal/README.md` reste en fusion normale. Test `tests/unit/gitattributes-union.test.ts`, ligne AGENTS §8, leçon.
- **Comment** : le test lit les attributs par `git check-attr` (comportement réel, pas le texte) et rejoue dans un dépôt temporaire deux branches qui ajoutent chacune une entrée en fin de LESSONS : merge sans conflit, les deux entrées présentes.
- **Pourquoi** : erreur répétée, cinq PR passées en CONFLICTING le 4 novembre pour des ajouts de fin indépendants.
- **Comment tester (QA)** : `npx vitest run tests/unit/gitattributes-union.test.ts` ; preuve rouge : sans les lignes `merge=union`, 6 tests sur 7 échouent.
- **RAIDER** : Durable — eol=lf existant conservé ; Retroactive — aucun fichier réécrit ; Engineering-grade — limite GitHub documentée.
- **Reste / risques** : GitHub reste CONFLICTING tant que l'auteur n'a pas mergé main en local ; union dupliquerait une ligne modifiée des deux côtés, d'où la règle ajout de fin.
## 2026-11-04T13:58:26+01:00 — suivi #287 : reprises sans effets secondaires, 57014, temps réel
- **Statut** : fait, PR brouillon
- **Quoi** :
  - Restauration de sauvegarde sortie de `routes.ts` vers un routeur `server/api/` et un service, en une transaction avec `suppressSideEffects`.
  - Même garde dans `scripts/import-7-fuel-records.ts` et le seed.
  - Trigger : `query_canceled` rattrapé, notification `alert_created` relayée par `db-event-relay`.
- **Comment** :
  - Helper `server/lib/suppress-side-effects.ts`, sur le modèle de `preventive-due.ts`.
  - Le relais relit les alertes par id et diffuse par `broadcastAlertCreated`, sans repli de rôles.
- **Pourquoi** : réserves 1, 2 et 5 de la relecture de #287.
- **Comment tester (QA)** :
  - `npm run test:integration -- tests/integration/fuel-alerts-triggers.test.ts tests/integration/fuel-alerts-realtime.test.ts` ;
  - `npx vitest run tests/unit/server/backup-import-service.test.ts tests/unit/server/db-event-relay-alerts.test.ts`.
- **Reste / risques** :
  - La ligne de dette AGENTS §9 ajoutée par #297 devient caduque : à retirer après la fusion de #297.
  - Le budget de 500 000 F CFA reste une constante.
## 2026-11-04T13:22:03+01:00 — #281 cycle d'alertes à requêtes bornées
- **Statut** : fait, PR brouillon empilée sur #287
- **Quoi** :
  - `alert-service.ts` : candidates en lot émises en fin de passage, chargements groupés, ordres de travail ouverts sans plafond de 50, `fuelRecipientRoles()` lu dans `alert_recipient_settings`.
  - Réserves 3 et 4 de #287 : la clé et le lien de l'alerte de consommation sont alignés sur le trigger, et le lien `/vehicles/<id>/fuel`, qui ne correspondait à aucune route, est corrigé. Index `fuel_records (vehicle_id, date, id)`.
- **Comment** : `AsyncLocalStorage` limité au passage planifié, donc les alertes nées d'une requête HTTP restent immédiates. Les listes passent en un seul paramètre jsonb. Une tranche d'insertion en échec est rejouée ligne à ligne.
- **Pourquoi** : 531 requêtes pour 12 véhicules, et des ordres de travail jamais alertés au-delà de 50.
- **Comment tester (QA)** : `npm run test:integration -- tests/integration/alert-cycle-query-count.test.ts` (4/4 vert) ; avec l'alert-service d'origine, 2/4 rouges.
- **Reste / risques** : réserves 1, 2 et 5 de #287 en lot de suivi (restauration import-backup, scripts d'import et seed sans `suppress_side_effects`, 57014 non rattrapé, temps réel des alertes du trigger).
## 2026-11-04T14:40:01+01:00 — #298 : verrou de sauvegarde, test isolé et garde listenerPool
- **Statut** : fait, PR brouillon
- **Quoi** :
  - Clé injectable pour `createAdvisoryBackupLock`, clé unique dans le test.
  - Connexions rendues en `finally`, plus de `listenerPool.end()` dans le test.
  - Garde `listenerPool` en test : `setup-db` épingle les deux variables, et `resolveListenerConnectionString` refuse une autre base.
- **Comment** :
  - Le test tient lui-même la clé de production pendant son passage.
  - La logique de chaîne de connexion est sortie de `server/db.ts` vers `server/lib/listener-connection.ts`, qui se teste sans base.
- **Pourquoi** : #298. Cause : clé de production partagée sur une base de test commune aux sessions.
- **Comment tester (QA)** :
  - `npm run test:integration -- tests/integration/backup-production.test.ts` ;
  - preuve rouge : avec `SELECT pg_advisory_lock(hashtext('backup')), pg_sleep(90)` lancé sur la base de test, la version de main échoue.
- **Reste / risques** : aucun changement de comportement hors `NODE_ENV=test`.
## 2026-11-04T14:18:11+01:00 — suivi #297 : plafond de 50 testé, repli d'emitAlerts, liens carburant repris
- **Statut** : fait, PR brouillon
- **Quoi** :
  - Test du plafond de 50 OT.
  - `emitAlerts` : repli objet par objet quand le lot échoue.
  - Reprise au démarrage des liens `/vehicles/<id>/fuel`.
  - Précision sur la sortie de `remindDaily` pour l'alerte de consommation.
- **Comment** :
  - `emitAlerts` enveloppe `emitAlertBatch` : si le lot échoue, chaque candidate est retentée seule, avec un journal récapitulatif (nombre, échantillon, première erreur) plutôt qu'une ligne par candidate.
  - `relinkLegacyFuelAlerts` (`server/init-database.ts`), appelée au démarrage : `UPDATE ... WHERE link ~ '^/vehicles/[0-9]+/fuel$'`.
- **Pourquoi** : relecture de #297 par 0a.
- **Alerte de consommation carburant, sortie de `remindDaily` (#297)** :
  - Elle porte la clé du trigger, `fuel-consumption:<id du plein>`, à la place de la clé quotidienne `remindDaily`.
  - Il y a donc une alerte par plein anormal, lue ou non, et plus de rappel quotidien tant que la consommation reste haute.
  - Le plein anormal suivant produit une nouvelle alerte.
  - Choix assumé : le trigger et le cycle ne doivent pas se doubler, et un rappel quotidien sur un fait passé (un plein) n'apporte rien.
- **Comment tester (QA)** :
  - `npm run test:integration -- tests/integration/alert-work-orders-beyond-50.test.ts tests/integration/alert-emit-fallback-relink.test.ts` ;
  - preuves rouges : le test des 50 échoue avec l'alert-service d'avant #297, le repli échoue avec celui de #297 (0 au lieu de 2).
- **Reste / risques** : la reprise des liens ne touche que le motif exact `/vehicles/<n>/fuel` ; `/vehicles/<n>/fuel-cards` et les autres liens restent intacts.

## 2026-11-04T15:28:00+01:00 — part-requirements-idempotence : course forcée par verrou de ligne
- **Statut** : fait, PR brouillon
- **Quoi** : le test « deux réceptions simultanées » retient les deux `UPDATE` sur un `FOR UPDATE` jusqu'à ce que les deux requêtes aient lu `ordered`.
- **Comment** : `waitForBlockedUpdates(2)` interroge `pg_stat_activity` (`wait_event_type = 'Lock'`), puis le verrou est relâché.
- **Pourquoi** : rouge 5 fois sur 5 sur main nu, alors que le stock était juste (5 → 7, un mouvement) ; la seconde requête lisait après le commit de la première et devenait un no-op réussi.
- **Comment tester (QA)** : `npm run test:integration -- tests/integration/part-requirements-idempotence.test.ts` ; rouge si l'on retire `eq(partRequirements.status, current.status)` du service.
- **Reste / risques** : aucun ; le code produit n'est pas modifié.
