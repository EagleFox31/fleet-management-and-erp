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
