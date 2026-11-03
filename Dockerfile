# Image unique pour recette et production (la différence vient du .env injecté).
# Étape 1 : build (vite + esbuild vers dist/). Étape 2 : runtime, utilisateur non root.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY vendor ./vendor
# Toutes les dépendances : dist/index.js importe statiquement vite et @vitejs/plugin-react (server/vite.ts),
# même en production. Les rendre dynamiques permettra de revenir à --omit=dev (lot suivant).
RUN npm ci --include=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# init-database rejoue au démarrage server/db/migrations et server/db/triggers (lus depuis le cwd) :
# sans eux, le démarrage échoue (garde : tests/unit/deploy/dockerfile-runtime.test.ts).
COPY server/db/migrations ./server/db/migrations
COPY server/db/triggers ./server/db/triggers
# Papier à en-tête TAY des PDF et documents Word (repli sans en-tête s'il manque).
COPY attached_assets/TAY-header-final.png attached_assets/TAY-header.png ./attached_assets/
# Les fichiers téléversés sont écrits sous <cwd>/uploads : dossier monté en volume nommé.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
# PORT vient de l'environnement (5000 par défaut côté serveur).
ENV PORT=5000
EXPOSE 5000
# Pas de `npm start` : il passe par cross-env, dépendance de développement ; NODE_ENV est déjà fixé plus haut.
CMD ["node", "dist/index.js"]
