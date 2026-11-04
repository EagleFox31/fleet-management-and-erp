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
