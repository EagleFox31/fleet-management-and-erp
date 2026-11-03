# Image unique pour recette et production (la différence vient du .env injecté).
# Étape 1 : build (vite + esbuild vers dist/). Étape 2 : runtime sans devDependencies, utilisateur non root.

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
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# init-database rejoue au démarrage server/db/migrations et server/db/triggers (lus depuis le cwd) :
# sans eux, il les saute sans erreur et la base reste incomplète.
COPY server/db/migrations ./server/db/migrations
COPY server/db/triggers ./server/db/triggers
# Les fichiers téléversés sont écrits sous <cwd>/uploads : dossier monté en volume nommé.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
# PORT vient de l'environnement (5000 par défaut côté serveur).
ENV PORT=5000
EXPOSE 5000
CMD ["npm", "start"]
