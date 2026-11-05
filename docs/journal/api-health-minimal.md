# Santé : réponse publique minimale

## Quoi
`GET /api/health` ne renvoie plus que `{ status, version }`. Le descriptif complet passe sur `GET /api/health/details`, réservé à `isAdmin`.

## Comment
- `server/api/index.ts` : handler public réduit (aucune lecture de données) ; ancien contenu déplacé derrière `isAdmin`.
- Choix : chemin séparé plutôt qu'une réponse enrichie selon le rôle, car la sonde (`deploy/docker-compose.yml`) ne lit que le code HTTP et un chemin dédié se teste et se garde plus simplement.
- Version : `APP_VERSION`, sinon `npm_package_version`, sinon `unknown`.
- `tests/contract/health.contract.test.ts` : clés autorisées seulement pour l'anonyme et le personnel ; détail refusé à l'anonyme et au non admin, 200 pour l'admin. Rouge constaté sur l'ancien code, puis vert.

## Pourquoi
Un point d'entrée sans session doit rester minimal : le détail n'a pas d'utilité pour une sonde.
