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
